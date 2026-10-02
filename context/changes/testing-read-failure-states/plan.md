# Stany nieudanego odczytu i limity zespołu — testy jednostkowe Implementation Plan

## Overview

Pięć modułów `src/lib` (`team-limits.ts`, `offer-board.ts`, `members.ts`,
`notes.ts`, `criteria.ts`) nie jest dziś importowanych przez żaden test; chroni
je wyłącznie `scripts/smoke.mjs`, który sprawdza tylko znaczniki `ok`. Plan
dodaje testy dla dwóch ryzyk:

1. **Nieudany odczyt pokazany jako pusty stan** — błąd odczytu nie może wyglądać
   jak „brak notatek”, „osoba z usuniętym kontem” ani „brak limitów”. Lokalny
   Supabase nie zwróci błędu na żądanie, więc warstwą są testy hermetyczne ze
   `stubFetch`, bez mockowania `@/lib/*`.
2. **Limit zespołu złamany przez fakt, którego ogłoszenie nie podaje** — testy
   czystych funkcji `limitBreaches` i `normalizePlace`, do tego parsowanie
   sortowania tablicy i jeden krok smoke dla reguły „nieznane na końcu”, która
   żyje w zapytaniu SQL.

Zmiana leży poza fazami `test-plan.md` §3 (fazy 3 i 4 czekają na S-04). Kod
produkcyjny się nie zmienia: każda reguła rozstrzygnięta w wywiadzie pokrywa się
z obecnym zachowaniem. To ochrona przed regresją, nie naprawa błędu.

## Current State Analysis

- Żaden plik w `tests/` nie importuje żadnej z 16 funkcji tych modułów
  (`research.md` §5). `limitBreaches`, `auditStatus` i `saverName` wykonują się
  w testach renderowania bez asercji na wynik; `parseLimitsForm` przechodzi
  przez `tests/pages/api/criteria.test.ts`.
- Smoke nie ma żadnego kroku szukającego `="error"`, nie sprawdza nazwy autora
  ani kolejności wierszy tablicy (`research.md` §5).
- Funkcje odczytu przyjmują klienta jako argument i zwracają unię ze stanem
  błędu; żadna nie rzuca. `team-limits.ts` i `offer-board.ts` nie mają importów
  wykonywalnych.
- Reguła „nieznane na końcu” jest w jednym miejscu: `src/pages/dashboard.astro:26`
  (`nullsFirst: false`). `offer-board.ts` trzyma tylko mapę kolumn, parsowanie
  `?sort=&dir=` i budowanie linku.
- Wynik bazowy Strykera z 2026-10-01 (`reports/mutation/mutation.html`,
  `research.md` §6):

  | Moduł | Wynik | Zabite | Ocalałe | Bez pokrycia | Razem |
  |---|---|---|---|---|---|
  | `src/lib/team-limits.ts` | 6,0% | 5 | 35 | 43 | 83 |
  | `src/lib/offer-board.ts` | 0% | 0 | 13 | 35 | 48 |
  | `src/lib/members.ts` | 0% | 0 | 3 | 126 | 129 |
  | `src/lib/notes.ts` (cały plik) | 0% | 0 | 0 | 60 | 60 |
  | `src/lib/notes.ts:1-99` (odczyt) | 0% | 0 | — | — | 40 |
  | `src/lib/criteria.ts` (cały plik) | 22,35% (w `change.md`: 22,4%) | 59 | 42 | 163 | 264 |
  | `src/lib/criteria.ts:151-285` (odczyt) | 0% | 0 | 1 | 137 | 138 |

## Desired End State

- `npm test` zawiera pięć nowych plików pod `tests/lib/`, każdy z asercjami
  wyprowadzonymi ze źródeł (PRD, CLAUDE.md, plany archiwalne, decyzje z tego
  planu), nigdy z wyniku testowanej funkcji.
- `scripts/smoke.mjs` dowodzi na prawdziwej bazie, że oferta bez ceny albo bez
  metrażu stoi za ofertą, która tę wartość podaje — w obu kierunkach sortowania.
- Reguły, których źródła dotąd nie zapisywały, są zapisane: w PRD (FR-002) i w
  CLAUDE.md (`## Structure`).
- `context/changes/testing-read-failure-states/mutation.md` ma dla każdej z faz
  1–5 wynik Strykera po fazie obok wyniku bazowego oraz decyzję dla każdego
  ocalałego mutanta w zakresie: **asercja**, **równoważny** albo **świadomie
  pominięty** (z powodem). Kryterium ukończenia to brak mutanta bez decyzji —
  nie próg liczbowy.
- `test-plan.md` §6 opisuje, jak dodać test funkcji odczytu i test czystej
  reguły; CLAUDE.md `## Testing` wskazuje testy referencyjne.

Weryfikacja: `npm test`, `npm run lint`, `npx astro check` zielone; smoke zielony
na podglądzie produkcyjnym z lokalnym Supabase; `mutation.md` kompletny.

### Key Discoveries:

- `createClient(new Headers(), { set: vi.fn() } as unknown as AstroCookies)`
  buduje klienta w teście; plik testu nadpisuje `astro:env/server` własnym
  `vi.mock` z `SUPABASE_TEST_URL`/`SUPABASE_TEST_KEY`
  (`tests/pages/api/criteria.test.ts:9-12`). Import `@/lib/supabase` nie jest
  mockowaniem `@/lib/*`.
- Błąd odczytu: odpowiedź `500` z ciałem `{ code, message }` — bez ponowień.
  Statusy 503 i 520 oraz odrzucony `fetch` dla GET są ponawiane do 3 razy
  (ok. 7 s) i kończą się wynikiem z `error`, nie wyjątkiem (`research.md` §4).
- `maybeSingle()`: `200 []` → `data: null` bez błędu („brak wiersza”); więcej
  niż jeden wiersz → `error` `PGRST116`. Status 404 z ciałem-tablicą daje
  `data: []` bez błędu — nie nadaje się na zaślepkę błędu.
- Fixture'y smoke powstają bez ceny i metrażu (`scripts/smoke.mjs:230-247`);
  pierwsza dostaje cenę w kroku „fixture offer gets a price above the limit”
  (`:1088`), obie żyją do kroków kaskady (`:1163`). `fixtureBoardRow` (`:550`)
  znajduje wiersz po `href="/offers/<id>"`.
- Postgres domyślnie stawia NULL-e na końcu dla `ASC` i na początku dla `DESC`,
  więc usunięcie `nullsFirst: false` zmienia kolejność tylko w kierunku `desc` —
  to kierunek rozstrzygający w kroku smoke.
- Stryker widzi tylko `npm test`: krok smoke nie zabije żadnego mutanta
  (CLAUDE.md `## Testing`).

## What We're NOT Doing

- **Żadnej zmiany kodu produkcyjnego.** Odrzucone w wywiadzie: przeniesienie
  `loadBoard` do `src/lib`, czytanie `sort`/`dir` bez rozróżniania wielkości
  liter, `unknown` dla `null` autora bez klienta, inne traktowanie pustej
  etykiety lokalizacji, odwróconego zakresu cen, pustego limitu miasta i limitu
  z przecinkiem.
- **Walidatory formularzy** `parseLimitsForm`, `parseNumber`, `requirementsError`
  (`criteria.ts:1-150`) i `noteError` (`notes.ts:100-113`) — poza ryzykiem (1);
  Stryker w fazach 4 i 5 biegnie po zakresach wierszy odczytu.
- **Trasy** `src/pages/api/notes.ts`, `requirements.ts`, `auth/signin.ts` jako
  całość — cienkie okablowanie, bramką jest RLS, warstwą zostaje smoke.
- `src/lib/otodom/labels.ts`, `config-status.ts`, `uuid.ts`, `format.ts`,
  `utils.ts`.
- **Powtórzone parametry sortowania** (`?sort=price&sort=area`) — bez asercji;
  źródła milczą, a interfejs ich nie generuje.
- **Test hermetyczny zapytania tablicy** (parametr `order`) — reguła
  „nieznane na końcu” jest dowodzona wyłącznie na prawdziwej bazie, w smoke.
- **Asercje renderowania stanów błędu** (`data-notes-state="error"` itd.) —
  to własność widoków, nie `src/lib`; L11 („oznaczona, nigdy ukryta”) również.
- **„Naprawianie” znanego fałszywego alarmu** — oferta z samym powiatem albo
  gminą może dostać znacznik „inne miasto”
  (`team-search-criteria/plan-brief.md:64`); test tego nie wiąże w żadną stronę.
- **Próg wyniku mutacji**, Stryker w CI, zmiana `stryker.config.json`.
- **Zmiana `test-plan.md` §1–§5** (mapa ryzyk, rollout) — to rola
  `/10x-test-plan`; plan dotyka tylko §6.
- **Gałęzie ponowień** (503, 520, odrzucony `fetch`) i fałszywe zegary.
- **Bramka wizualna** — żaden widok się nie zmienia.

## Implementation Approach

Jedna faza na moduł, od najtańszej warstwy: najpierw dwie czyste funkcje (fazy
1–2), potem trzy moduły odczytu w kolejności zależności — `members.ts` przed
`notes.ts` i `criteria.ts`, bo oba wołają `resolveAuthors` (fazy 3–5) — na końcu
cookbook (faza 6).

Każda faza 1–5 ma ten sam rytm:

1. Test pisany ze źródeł wymienionych w „Test contract”. Wartości oczekiwane
   wpisane ręcznie; test nie importuje stałych z testowanego modułu, żeby z nich
   wyliczać oczekiwanie.
2. `npm test`, lint, `astro check`.
3. Stryker zawężony do modułu fazy. Dla każdego ocalałego mutanta pytanie
   z CLAUDE.md: „czy ta zmiana zaszkodziłaby użytkownikowi?” — tak → asercja i
   ponowny przebieg; nie → **równoważny** albo **świadomie pominięty** z
   jednozdaniowym powodem. Wynik i decyzje trafiają do `mutation.md`.

Tryb wykonania: `/10x-implement` dla wszystkich faz — kod już istnieje, żadna
faza nie zaczyna się od czerwonego testu.

Tag `describe`: `(#1)` — najbliższy wiersz mapy ryzyk („an invented or
incomplete fact … an unknown shown as a value in a view”); faza 6 dopisuje to do
akapitu o tagach w §6.

## Critical Implementation Details

- **Czerwony test z wyroczni zatrzymuje fazę.** Jeśli asercja napisana ze źródeł
  nie przechodzi na obecnym kodzie, to usterka albo sprzeczność źródeł: faza
  staje i zgłasza ją użytkownikowi. Oczekiwania nie dopasowuje się do wyniku, a
  kodu produkcyjnego nie zmienia się bez decyzji.
- **Gałąź `catch` przez krawędź HTTP.** Sieć jej nie wywoła (odrzucony `fetch`
  kończy się wynikiem z `error`). Wywołuje ją odpowiedź `200` o kształcie, na
  którym kod się wykłada (np. ciało niebędące tablicą tam, gdzie kod iteruje).
  Gdzie żaden kształt odpowiedzi nie doprowadzi do wyjątku (kandydat:
  `resolveSaver`), mutanty bloku `catch` dostają decyzję „świadomie pominięty —
  nieosiągalne z krawędzi HTTP”; nie sięgamy po `vi.mock` modułów wewnętrznych.
- **Zakresy wierszy Strykera** (`notes.ts:1-99`, `criteria.ts:151-285`) są
  poprawne, dopóki pliki się nie zmieniają — a plan ich nie zmienia. Gdyby
  zmieniły się z innego powodu, zakres trzeba odczytać na nowo z pliku.
- **Raport Strykera jest nadpisywany** przy każdym przebiegu
  (`reports/mutation/`, git-ignored): liczby i decyzje zapisuje się w
  `mutation.md` przed kolejnym przebiegiem.
- **`npx astro sync` przed `npm run lint`** — jak w `test-plan.md` §6.2.

---

## Phase 1: Limity zespołu — `limitBreaches` i `normalizePlace`

### Overview

Testy czystych funkcji z `src/lib/team-limits.ts` oraz zapisanie w źródłach
reguł, które rozstrzygnął wywiad. Dokumenty idą pierwsze: test ma się opierać na
zapisanym zdaniu, nie na komentarzu w kodzie.

### Changes Required:

#### 1. PRD — pusta etykieta lokalizacji

**File**: `context/foundation/prd.md`

**Intent**: Doprecyzować w FR-002, czym jest lokalizacja „niepodana”, żeby test
miał źródło inne niż `null`.

**Contract**: Zdanie FR-002 „an attribute the listing does not state never
breaks a limit” dostaje dopowiedzenie: lokalizacja podana jako pusty tekst albo
jako same spacje i przecinki nie podaje żadnego miejsca i jest traktowana tak
samo jak niepodana. Reszta FR-002 bez zmian.

#### 2. CLAUDE.md — kolejność złamań i limity, których formularz nie dopuszcza

**File**: `CLAUDE.md`

**Intent**: Zapisać trzy rozstrzygnięcia przy istniejącym odwołaniu do
`src/lib/team-limits.ts` w `## Structure`, wskazując test jako referencję.

**Contract**: Punkt o `team_criteria` / `src/lib/team-limits.ts` w `## Structure`
zyskuje: (a) złamania wracają zawsze w kolejności `city`, `price_above`,
`price_below`, `area_below`; (b) dla limitów, których formularz i checki tabeli
nie dopuszczają, funkcja ocenia każdą granicę ceny osobno (odwrócony zakres może
dać oba znaczniki ceny), pusty limit miasta czyta jako brak limitu, a limit
miasta z przecinkiem porównuje w całości — więc oznacza każdą ofertę z podaną
lokalizacją; (c) `tests/lib/team-limits.test.ts` jest referencją. Krótko, bez
parafrazowania reszty pliku (CLAUDE.md, Conventions, ostatni punkt).

#### 3. Test czystych funkcji

**File**: `tests/lib/team-limits.test.ts` (nowy)

**Intent**: Udowodnić, że limit łamie tylko fakt podany w ogłoszeniu, na
przypadkach z „Test contract” poniżej.

**Contract**: Importuje `limitBreaches` i `normalizePlace` z `@/lib/team-limits`.
Oferty i limity budowane w teście jako literały (`LimitedOffer`, `TeamLimits`);
`noLimits`/`boardLimits` z `src/pages/dev/_offer-fixtures.ts` wolno użyć jako
danych wejściowych, nigdy jako oczekiwania. Przypadki tego samego rodzaju przez
`it.each`. `describe` z tagiem `(#1)`.

#### 4. Dziennik mutantów

**File**: `context/changes/testing-read-failure-states/mutation.md` (nowy)

**Intent**: Jedno miejsce na wynik Strykera po każdej fazie i decyzję dla
każdego ocalałego mutanta.

**Contract**: Nagłówek z tabelą bazową z 2026-10-01 (jak w „Current State
Analysis”). Sekcja na fazę: polecenie, wynik po fazie (zabite / ocalałe / bez
pokrycia / razem), tabela ocalałych — wiersz i mutacja, decyzja (asercja /
równoważny / świadomie pominięty), powód w jednym zdaniu. Faza 1 wypełnia
sekcję `team-limits.ts`.

### Test contract

| # | Zachowanie | Źródło |
|---|---|---|
| L1 | `price`, `area_m2` albo `location_label` równe `null` nie dają żadnego znacznika, także gdy pozostałe limity są ustawione | PRD FR-002, Guardrails |
| L2 | Cena w walucie innej niż PLN (np. `EUR`) albo z `price_currency: null` nie daje ani `price_above`, ani `price_below` | `team-search-criteria/plan.md:37`, `:129` |
| L3/L4 | `price === priceMax` i `price === priceMin` się mieszczą; o 1 zł powyżej / poniżej już nie | `plan.md:129`, `:268` |
| L5 | `area_m2 === areaMin` nie łamie; mniejszy łamie | `plan.md:129` |
| L6 | Limit `null` nie łamie niczego, dla każdego z czterech limitów | `plan.md:20` |
| L7 | „Warszawa” łamie „Ząbki, wołomiński, mazowieckie”, nie łamie „Stary Mokotów, Mokotów, Warszawa, mazowieckie” | `plan.md:53`, `:129` |
| L8 | Limit „lodz” nie oznacza oferty z „Łódź” (i odwrotnie) | `plan.md:269` |
| L9 | Łącznik i półpauza czytane jak spacja: „Bielsko Biała” = „Bielsko-Biała” = „Bielsko–Biała”; wielkość liter i nadmiarowe spacje bez znaczenia | `plan.md:402`, `reviews/impl-review.md:74` |
| L10 | Oferta łamiąca miasto, cenę maksymalną i metraż dostaje trzy znaczniki | `plan.md:256` |
| L12 | Kolejność wyniku: `city`, `price_above`, `price_below`, `area_below` — asercja na dokładną tablicę | decyzja z wywiadu, CLAUDE.md (zmiana 2) |
| L13 | `location_label` równe `""`, `"  "` albo `" , "` przy limicie miasta „Warszawa” — żadnego znacznika | decyzja z wywiadu, PRD FR-002 (zmiana 1) |
| L14a | `priceMin` 900 000, `priceMax` 800 000: oferta 850 000 PLN → `price_above` i `price_below`; 950 000 → samo `price_above`; 750 000 → samo `price_below` | decyzja z wywiadu, CLAUDE.md (zmiana 2) |
| L14b | Limit miasta `""` albo `"  "`, oferta „Ząbki, wołomiński, mazowieckie” → żadnego znacznika | decyzja z wywiadu, CLAUDE.md (zmiana 2) |
| L14c | Limit miasta „Warszawa, mazowieckie”, oferta „Stary Mokotów, Mokotów, Warszawa, mazowieckie” → `city` | decyzja z wywiadu, CLAUDE.md (zmiana 2) |

Każda reguła „nie łamie” ma obok przypadek, w którym ten sam limit **jest**
złamany — inaczej test przeszedłby na funkcji zwracającej zawsze `[]`.

### Success Criteria:

#### Automated Verification:

- Test fazy przechodzi: `npm test -- tests/lib/team-limits.test.ts`
- Cały zestaw przechodzi: `npm test`
- Lint przechodzi: `npx astro sync && npm run lint`
- Typy przechodzą: `npx astro check`
- Stryker kończy przebieg: `npx stryker run --mutate "src/lib/team-limits.ts"`
- `mutation.md` ma wynik po fazie obok bazowego (6,0%, 5/83) i decyzję dla każdego ocalałego mutanta w `team-limits.ts`

#### Manual Verification:

- Dopisane zdania w PRD (FR-002) i CLAUDE.md oddają decyzje z wywiadu i nie zmieniają innych reguł
- Decyzje „równoważny” i „świadomie pominięty” w `mutation.md` dla `team-limits.ts` są zaakceptowane

**Implementation Note**: Po przejściu weryfikacji automatycznej zatrzymaj się na
potwierdzenie kroków ręcznych przed kolejną fazą. Checkboxy żyją w `## Progress`.

---

## Phase 2: Sortowanie tablicy — parsowanie w teście, kolejność w smoke

### Overview

Dwie warstwy dla dwóch różnych własności: `parseBoardSort`/`boardSortHref` jako
czyste funkcje, a „nieznane na końcu” na prawdziwej bazie, bo to własność
zapytania SQL, o której zaślepka by skłamała.

### Changes Required:

#### 1. Test parsowania i linku sortowania

**File**: `tests/lib/offer-board.test.ts` (nowy)

**Intent**: Udowodnić, że adres zawsze daje poprawne sortowanie i nigdy nie
rzuca, oraz że link przełącza kierunek tak, jak opisuje plan tablicy.

**Contract**: Importuje `parseBoardSort` i `boardSortHref` z
`@/lib/offer-board`; wejściem jest `new URLSearchParams("…")`. Przypadki przez
`it.each`. `auditStatus` (punkt wymiany S-04), `BOARD_COLUMNS` i
`BOARD_SORT_COLUMN` nie dostają własnych asercji — ich mutanty rozstrzyga
`mutation.md`.

#### 2. Krok smoke: nieznana cena i nieznany metraż na końcu

**File**: `scripts/smoke.mjs`

**Intent**: Dowieść faktycznej kolejności wierszy na `/dashboard` dla ofert bez
ceny i bez metrażu, w obu kierunkach — guardrail PRD, którego dotąd pilnowała
tylko weryfikacja ręczna (`shared-offer-board/plan.md:71`).

**Contract**: Kroki wstawione po „board marks the fixture offer above the price
limit” i przed krokami kaskady. W tym miejscu pierwsza oferta fixture ma cenę w
PLN, druga nie ma ceny. Nowy zapis nadaje **drugiej** ofercie `area_m2`
(pierwsza metrażu nie ma) — zapis oferty owinięty w `withSnapshot` na
`observedNotes(ALL_FIXTURE_NOTES)` z `snapshot: "same"`, jak każdy zapis oferty
w tym pliku. Pomocnik obok `fixtureBoardRow` zwraca, która z dwóch ofert fixture
stoi wyżej w HTML (pozycja `href="/offers/<id>"`); brak któregokolwiek wiersza
to nieudany krok, nie „kolejność zgodna”. Cztery kroki: `sort=price` w `asc` i
`desc` — pierwsza oferta przed drugą; `sort=area` w `asc` i `desc` — druga przed
pierwszą. Odwrócenie ról między wymiarami wyklucza przejście na stałej
kolejności. Porównanie jest względne (tylko dwa wiersze fixture), więc inne
oferty w lokalnej bazie nie przeszkadzają. Nagłówek pliku opisuje nowe kroki;
nad krokami komentarz z nazwą guardraila.

#### 3. README — opis smoke

**File**: `README.md`

**Intent**: Opis tego, co sprawdza smoke, ma objąć nowe kroki.

**Contract**: Akapit o `scripts/smoke.mjs` (sekcja z `BASE_URL=… npm run smoke`)
— jedno zdanie: oferta bez ceny albo metrażu stoi na tablicy za ofertą, która tę
wartość podaje, w obu kierunkach sortowania.

#### 4. Dziennik mutantów

**File**: `context/changes/testing-read-failure-states/mutation.md`

**Intent**: Wynik i decyzje dla `offer-board.ts`.

**Contract**: Sekcja fazy 2 w ustalonym kształcie. Mutanty na `nullsFirst` nie
istnieją w tym module — reguła żyje w `dashboard.astro`, poza zakresem
`mutate`; sekcja odnotowuje, że pilnuje jej krok smoke.

### Test contract

| # | Zachowanie | Źródło |
|---|---|---|
| S1 | Bez parametrów → `{ key: "added", dir: "desc" }` | `shared-offer-board/plan.md:91` |
| S2 | Sam `sort`: `added` → `desc`, `price` → `asc`, `area` → `desc` | `plan.md:91` |
| S3 | Poprawny `sort` z nieznanym albo brakującym `dir` → domyślny kierunek tego klucza; poprawny `dir` jest respektowany dla każdego klucza w obu kierunkach | `plan.md:92-95` |
| S6 | Nieznany `sort` (`bogus`, także z poprawnym `dir=asc`) → `{ added, desc }` | `plan.md:92-95` |
| S7 | Ściśle, małe litery: `sort=PRICE` i `sort=` (pusty) → `{ added, desc }`; `sort=price&dir=ASC` → `{ price, asc }` jako domyślny kierunek klucza, `sort=area&dir=ASC` → `{ area, desc }` | decyzja z wywiadu (mieści się w S3) |
| S8 | Nigdy nie rzuca i nie przyjmuje nazw z prototypu: `sort=toString`, `sort=__proto__`, `sort=constructor` → `{ added, desc }` | `plan.md:31`, `:377` („nigdy nie rzuca”) |
| S4 | `boardSortHref`: aktywny klucz odwraca kierunek (`asc`↔`desc`), inny klucz startuje od swojego domyślnego; wynik to dokładnie `/dashboard?sort=<key>&dir=<dir>` | `plan.md:96` |
| S5 | (smoke) Oferta bez ceny stoi za ofertą z ceną dla `sort=price` w `asc` i `desc`; oferta bez metrażu za ofertą z metrażem dla `sort=area` w `asc` i `desc` | PRD Guardrails, `plan.md:31`, `:71`, `:165` |

### Success Criteria:

#### Automated Verification:

- Test fazy przechodzi: `npm test -- tests/lib/offer-board.test.ts`
- Cały zestaw przechodzi: `npm test`
- Lint przechodzi: `npx astro sync && npm run lint`
- Typy przechodzą: `npx astro check`
- Smoke przechodzi na podglądzie produkcyjnym z lokalnym Supabase: `npm run build && npm run preview`, potem `BASE_URL=http://localhost:4321 npm run smoke`
- Stryker kończy przebieg: `npx stryker run --mutate "src/lib/offer-board.ts"`
- `mutation.md` ma wynik po fazie obok bazowego (0%, 0/48) i decyzję dla każdego ocalałego mutanta w `offer-board.ts`

#### Manual Verification:

- Celowe zepsucie: po lokalnym usunięciu `nullsFirst: false` z `src/pages/dashboard.astro` i przebudowaniu oba kroki `desc` smoke są czerwone; po przywróceniu pliku smoke jest zielony
- Decyzje „równoważny” i „świadomie pominięty” w `mutation.md` dla `offer-board.ts` są zaakceptowane

**Implementation Note**: Po przejściu weryfikacji automatycznej zatrzymaj się na
potwierdzenie kroków ręcznych przed kolejną fazą.

---

## Phase 3: Nazywanie członka — `resolveSaver`, `resolveAuthors`, nazwy

### Overview

Pierwsza faza hermetyczna. Chroni rozróżnienie, którego nie wolno pomylić:
`deleted` to fakt z wiersza, `unknown` to wszystko, czego nie udało się ustalić.
Pokazanie usuniętego konta przy nieudanym odczycie wymyślałoby fakt o członku
zespołu.

### Changes Required:

#### 1. Kształty żądań odczytu `members`

**File**: `tests/fixtures/http.ts`

**Intent**: Udokumentować w komentarzu nagłówkowym, jak moduł rozmawia z
Supabase przy odczycie, tak jak opisane są już trasy ofert i kryteriów.

**Contract**: Blok komentarza „as the member-naming module talks to it”: żądanie
`resolveSaver` (`GET /rest/v1/members?select=email&id=eq.<id>`, `maybeSingle`:
`200 []` → `data: null`) i `resolveAuthors`
(`GET /rest/v1/members?select=id,email&id=in.(…)`), oraz ogólna uwaga o błędzie
odczytu: `500` z `{ code, message }` daje `error` bez ponowień, 503/520 i
odrzucony `fetch` są ponawiane, 404 z tablicą nie jest błędem. Dokładne kształty
URL odczytane z `node_modules/@supabase/postgrest-js`, nie z pamięci. Pomocniki
dodawane tylko wtedy, gdy potrzebuje ich więcej niż jeden test.

#### 2. CLAUDE.md — `null` autora nie zależy od klienta

**File**: `CLAUDE.md`

**Intent**: Zapisać rozstrzygnięcie sprzeczności dwóch zdań planu
`duplicate-listing-notice`.

**Contract**: Punkt o `public.members` / `src/lib/members.ts` w `## Structure`:
zdanie „A `null` author column is a deleted account” dostaje dopowiedzenie, że
obowiązuje także bez klienta — to fakt z wiersza, który nie wymaga odczytu.
`tests/lib/members.test.ts` wskazany jako referencja.

#### 3. Test modułu

**File**: `tests/lib/members.test.ts` (nowy)

**Intent**: Udowodnić cztery warianty autora dla obu funkcji odczytu i to, że
`unknown` nikogo nie nazywa.

**Contract**: Własny `vi.mock("astro:env/server", …)` z wartościami testowymi,
klient z `createClient(new Headers(), …)`, sieć przez `stubFetch` z
`afterEach(restoreFetch)`. Gałąź „brak klienta” — argument `null`, bez zaślepki.
Liczba zapytań sprawdzana na `stub.requests`. Teksty „Ty” / „Ciebie” wpisane
ręcznie z adnotacją, że to kopia interfejsu z planu `member-notes`, nie PRD.

#### 4. Dziennik mutantów

**File**: `context/changes/testing-read-failure-states/mutation.md`

**Intent**: Wynik i decyzje dla `members.ts`.

**Contract**: Sekcja fazy 3 w ustalonym kształcie.

### Test contract

| # | Zachowanie | Źródło |
|---|---|---|
| R4a | `resolveSaver`: `createdBy === null` → `deleted`, z klientem i bez; żadnego zapytania | `duplicate-listing-notice/plan.md:115`, decyzja z wywiadu (OQ-5) |
| R4b | `createdBy === viewerId` → `self`, bez zapytania, także bez klienta | `plan.md:115` |
| R4c | Wiersz z niepustym e-mailem → `member` z tym e-mailem; dokładnie jedno zapytanie do `members` | `plan.md:115` |
| R4d | Brak klienta (dla cudzego id), odpowiedź `500`, `200 []` (brak wiersza), `email: null`, e-mail pusty albo z samych spacji → `unknown`; nigdy `deleted`; nigdy nie rzuca | `plan.md:115`, `:56`; CLAUDE.md `## Structure` |
| R5a | `resolveAuthors`: wynik tej samej długości i w kolejności wejścia, dla wejścia mieszającego `null`, widza, znanego członka, członka bez wiersza i powtórzone id | `member-notes/plan.md:138` |
| R5b | Jedno zapytanie dla unikalnych id (powtórzone id nie mnoży zapytań; `null` i widz nie trafiają do filtra) | `plan.md:138` |
| R5c | Nic do odczytu (pusta lista, same `null`, sam widz) → żadnego zapytania | `plan.md:138` |
| R5d | Odpowiedź `500`, brak klienta, wiersz z `email: null` albo pustym → `unknown` dla tych id; `null` nadal `deleted`, widz nadal `self` | `plan.md:138`, OQ-5 |
| R6 | `saverName` i `authorName` dla `unknown` → `null` | CLAUDE.md `## Structure`, `member-notes/plan.md:139` |
| R7 | `deleted`: `saverName` → „osobę z usuniętym kontem”, `authorName` → „Osoba z usuniętym kontem” | PRD NFR (`prd.md:128`) |
| R8 | `member` → e-mail bez zmian w obu funkcjach; `self`: `saverName` → „Ciebie”, `authorName` → „Ty” | `member-notes/plan.md:139`, decyzja z wywiadu (OQ-9) |

### Success Criteria:

#### Automated Verification:

- Test fazy przechodzi: `npm test -- tests/lib/members.test.ts`
- Cały zestaw przechodzi: `npm test`
- Lint przechodzi: `npx astro sync && npm run lint`
- Typy przechodzą: `npx astro check`
- Stryker kończy przebieg: `npx stryker run --mutate "src/lib/members.ts"`
- `mutation.md` ma wynik po fazie obok bazowego (0%, 0/129) i decyzję dla każdego ocalałego mutanta w `members.ts`

#### Manual Verification:

- Dopisane zdanie w CLAUDE.md oddaje decyzję o `null` autora
- Decyzje „równoważny” i „świadomie pominięty” w `mutation.md` dla `members.ts` są zaakceptowane

**Implementation Note**: Po przejściu weryfikacji automatycznej zatrzymaj się na
potwierdzenie kroków ręcznych przed kolejną fazą.

---

## Phase 4: Odczyt notatek — `loadNotes`

### Overview

Nieudany odczyt notatek nie może wyglądać jak „brak notatek”: pusty formularz
wysłany upsertem nadpisałby istniejącą notatkę członka (`member-notes/plan.md:62`,
guardrail PRD o notatkach).

### Changes Required:

#### 1. Kształt żądania odczytu `offer_notes`

**File**: `tests/fixtures/http.ts`

**Intent**: Dopisać do komentarza nagłówkowego żądanie odczytu notatek.

**Contract**: `GET /rest/v1/offer_notes` z `select`, filtrem `offer_id=eq.<id>`
i `order=updated_at.desc`; odpowiedź to tablica wierszy. Po nim, gdy są cudzy
autorzy, jedno żądanie `members` z fazy 3.

#### 2. Test modułu

**File**: `tests/lib/notes.test.ts` (nowy)

**Intent**: Udowodnić, że każda porażka odczytu daje `error`, a udany odczyt
dzieli notatki na własną i cudze z poprawnie nazwanymi autorami.

**Contract**: Mechanika jak w fazie 3. Handler rozróżnia tabele przez
`isTableRequest`. Gałąź wyjątku: odpowiedź `200` z ciałem, które nie jest
tablicą. Tylko `loadNotes`; `noteError` i stałe poza zakresem.

#### 3. Dziennik mutantów

**File**: `context/changes/testing-read-failure-states/mutation.md`

**Intent**: Wynik i decyzje dla części odczytu `notes.ts`.

**Contract**: Sekcja fazy 4; bazowe podane dla całego pliku (0/60) i dla zakresu
`1-99` (0/40), z adnotacją, że `100-113` jest poza zakresem zmiany.

### Test contract

| # | Zachowanie | Źródło |
|---|---|---|
| R1a | Brak klienta → `{ state: "error" }`, bez żadnego żądania | CLAUDE.md `## Structure`, `member-notes/plan.md:152` |
| R1b | Odpowiedź `500` na `offer_notes` → `{ state: "error" }`; `members` nie jest pytane | `plan.md:152`, `:62` |
| R1c | Odpowiedź `200` o nieoczekiwanym kształcie (wyjątek w środku) → `{ state: "error" }`; funkcja nie rzuca | `plan.md:152` |
| R1d | Kontrola: `200 []` → `{ state: "ok", own: null, others: [] }` — „brak notatek” istnieje jako osobny stan i różni się od błędu | `plan.md:152` |
| N1 | Udany odczyt: notatka widza trafia do `own` z autorem `self`, pozostałe do `others` w kolejności odpowiedzi, z polami `pros`/`cons`/`observations`/`updatedAt` przepisanymi z wiersza | `plan.md:152`, `:138` |
| N2 | Notatka z `author_id: null` trafia do `others` z autorem `deleted` — nigdy do `own`, także gdy `viewerId` jest `undefined` | PRD NFR (`prd.md:128`), `plan.md:138` |
| R3 | Odczyt notatek udany, `members` odpowiada `500` → stan `ok`, notatka pokazana, autor `unknown` | wniosek z `plan.md:138` i `:62` (`research.md` R3) |
| N3 | Żądanie pyta o notatki tej oferty, od najnowszej edycji (`offer_id=eq.<id>`, `order=updated_at.desc` w zapisanym URL) | `plan.md:152` („most recently edited first”) |

### Success Criteria:

#### Automated Verification:

- Test fazy przechodzi: `npm test -- tests/lib/notes.test.ts`
- Cały zestaw przechodzi: `npm test`
- Lint przechodzi: `npx astro sync && npm run lint`
- Typy przechodzą: `npx astro check`
- Stryker kończy przebieg: `npx stryker run --mutate "src/lib/notes.ts:1-99"`
- `mutation.md` ma wynik po fazie obok bazowego (zakres 0/40; cały plik 0%, 0/60) i decyzję dla każdego ocalałego mutanta w `notes.ts:1-99`

#### Manual Verification:

- Decyzje „równoważny” i „świadomie pominięty” w `mutation.md` dla `notes.ts:1-99` są zaakceptowane

**Implementation Note**: Po przejściu weryfikacji automatycznej zatrzymaj się na
potwierdzenie kroków ręcznych przed kolejną fazą.

---

## Phase 5: Odczyt kryteriów — `loadCriteria` i `loadTeamLimits`

### Overview

Nieudany odczyt limitów nie może wyglądać jak „brak limitów”: na tablicy
ukryłby każde złamanie, a na `/criteria` formularz wypełniony pustymi polami
nadpisałby wiersz zespołu.

### Changes Required:

#### 1. CLAUDE.md — nieczytelna wartość to nieudany odczyt

**File**: `CLAUDE.md`

**Intent**: Zapisać regułę, którą dotąd opisywało tylko review jako obserwację
implementacji.

**Contract**: Punkt o `team_criteria` / `src/lib/criteria.ts` w `## Structure`,
przy „a failed read is its own state, never "no limits"”: wartość w wierszu,
która nie czyta się jako limit (zero, ujemna, tekst nieliczbowy, puste miasto),
też jest nieudanym odczytem, nigdy „brakiem limitu”. `tests/lib/criteria.test.ts`
wskazany jako referencja.

#### 2. Kształty żądań odczytu kryteriów

**File**: `tests/fixtures/http.ts`

**Intent**: Dopisać do komentarza nagłówkowego odczyty `team_criteria` i
`member_requirements`.

**Contract**: `GET /rest/v1/team_criteria?select=…&id=eq.true` (`maybeSingle`:
`200 []` to brak wiersza singletonu) w dwóch wariantach `select` — z
`updated_at, updated_by` dla `loadCriteria` i bez nich dla `loadTeamLimits` —
oraz `GET /rest/v1/member_requirements` z `order=updated_at.desc`. Odnotować, że
`loadCriteria` wysyła oba odczyty równolegle.

#### 3. Test modułu

**File**: `tests/lib/criteria.test.ts` (nowy)

**Intent**: Udowodnić listę warunków porażki obu funkcji odczytu i podpis zmiany
limitów.

**Contract**: Mechanika jak w fazie 3. Handler odpowiada osobno dla
`team_criteria`, `member_requirements` i `members`. Tylko `loadCriteria` i
`loadTeamLimits`; walidatory formularzy poza zakresem. Wartości nieczytelne
przez `it.each`, osobno dla każdej z czterech kolumn limitów.

#### 4. Dziennik mutantów

**File**: `context/changes/testing-read-failure-states/mutation.md`

**Intent**: Wynik i decyzje dla części odczytu `criteria.ts`.

**Contract**: Sekcja fazy 5; bazowe podane dla całego pliku (22,35%, 59/264) i
dla zakresu `151-285` (0/138), z adnotacją, że `1-150` jest poza zakresem zmiany
i że wynik całego pliku nie jest celem.

### Test contract

| # | Zachowanie | Źródło |
|---|---|---|
| R9a | `loadCriteria`: brak klienta → `{ state: "error" }`, bez żądań | CLAUDE.md `## Structure`, `team-search-criteria/plan.md:120` |
| R9b | `team_criteria` odpowiada `500` → `error` | `plan.md:120` |
| R9c | `team_criteria` odpowiada `200 []` (brak wiersza singletonu) → `error` | `plan.md:120`, `:21` |
| R9d | Odpowiedź o nieoczekiwanym kształcie (wyjątek) → `error`; nie rzuca | `plan.md:120` |
| R10 | `team_criteria` udane, `member_requirements` odpowiada `500` → `error` | `plan.md:120`, `plan-brief.md:47` |
| R13 | Wiersz z wartością nieczytelną jako limit — `0`, ujemna, tekst nieliczbowy w `price_min`/`price_max`/`area_min`; `city` puste, z samych spacji albo niebędące tekstem — → `error` w `loadCriteria` i `{ ok: false }` w `loadTeamLimits` | decyzja z wywiadu (OQ-4), CLAUDE.md (zmiana 1) |
| C1 | Kontrola: wiersz z czterema `null` → stan `ok` z czterema limitami `null` (nigdy `0`, nigdy `""`) — „brak limitów” istnieje jako osobny stan | `plan.md:20`, `plan-brief.md:23` |
| C2 | Udany odczyt: limity z wiersza trafiają do `limits` (miasto bez zmian, liczby jako liczby); wymagania widza do `own`, pozostałe do `others` w kolejności odpowiedzi | `plan.md:120` |
| R12a | `updated_by` null, `updated_at` z datą → `limitsChangedBy` to `deleted`, `limitsChangedAt` to ta data | migracja `20260927144141_create_team_criteria.sql:20-21` |
| R12b | `updated_at` null → `limitsChangedBy: null` i `limitsChangedAt: null` (limity nigdy nieustawione); `updated_by` = widz → `self`; inny członek → `member` z e-mailem | migracja `:20-21`, `plan.md:177` |
| C3 | Autorzy wymagań i podpis limitów czytani jednym żądaniem `members`; gdy odpowiada `500`, stan zostaje `ok`, a autorzy i podpis to `unknown` | `plan.md:120`, `member-notes/plan.md:138` |
| R11a | `loadTeamLimits`: brak klienta, `500`, `200 []`, nieoczekiwany kształt → `{ ok: false }`; nie rzuca | CLAUDE.md `## Structure`, `plan.md:22`, `:121` |
| R11b | Kontrola: czytelny wiersz → `{ ok: true, limits }` z tymi samymi wartościami; cztery `null` → `ok: true` z czterema `null` | `plan.md:121`, `:20` |

### Success Criteria:

#### Automated Verification:

- Test fazy przechodzi: `npm test -- tests/lib/criteria.test.ts`
- Cały zestaw przechodzi: `npm test`
- Lint przechodzi: `npx astro sync && npm run lint`
- Typy przechodzą: `npx astro check`
- Stryker kończy przebieg: `npx stryker run --mutate "src/lib/criteria.ts:151-285"`
- `mutation.md` ma wynik po fazie obok bazowego (zakres 0/138; cały plik 22,35%, 59/264) i decyzję dla każdego ocalałego mutanta w `criteria.ts:151-285`

#### Manual Verification:

- Dopisane zdanie w CLAUDE.md oddaje decyzję o nieczytelnej wartości limitu
- Decyzje „równoważny” i „świadomie pominięty” w `mutation.md` dla `criteria.ts:151-285` są zaakceptowane

**Implementation Note**: Po przejściu weryfikacji automatycznej zatrzymaj się na
potwierdzenie kroków ręcznych przed kolejną fazą.

---

## Phase 6: Cookbook — `test-plan.md` §6 i wskazania w CLAUDE.md

### Overview

Zapisać wzorce, które powstały w fazach 1–5, tak żeby następny test funkcji
odczytu albo czystej reguły nie zaczynał od zera.

### Changes Required:

#### 1. Cookbook

**File**: `context/foundation/test-plan.md`

**Intent**: Dwie nowe podsekcje §6 i notatka o tej zmianie; §1–§5 bez zmian
poza wpisem w §8.

**Contract**:

- Akapit o tagach na początku §6: `(#1)` obejmuje też nieudany odczyt pokazany
  jako pusty stan i limit złamany przez niepodany fakt.
- Nowa podsekcja **§6.7** „Adding a unit test for a read function (a failed
  read is its own state)”: gdzie (`tests/lib/<moduł>.test.ts`), test
  referencyjny (`tests/lib/criteria.test.ts`), budowa klienta, jak wywołać błąd
  zapytania, brak wiersza i wyjątek przez krawędź HTTP, których odpowiedzi nie
  używać (503/520, odrzucony `fetch`, 404 z tablicą), obowiązkowy przypadek
  kontrolny „pusty, ale udany”, wyrocznia, polecenie uruchomienia, pułapki.
- Nowa podsekcja **§6.8** „Adding a unit test for a pure rule (team limits,
  board sort)”: test referencyjny (`tests/lib/team-limits.test.ts`), para
  „nie łamie” / „łamie” dla każdej reguły, wartości oczekiwane pisane ręcznie,
  co robić z wejściem, o którym źródła milczą (pytanie do użytkownika, reguła
  zapisana w PRD albo CLAUDE.md w tej samej zmianie), oraz kiedy regułę dowodzi
  smoke zamiast testu jednostkowego (własność zapytania SQL — krok sortowania).
- §6.6: wpis „Outside the rollout — `testing-read-failure-states`” z tym, co
  dostarczono, wynikami Strykera przed i po dla każdego modułu (z `mutation.md`),
  rodzajami mutantów świadomie pominiętych oraz tym, co odroczone (walidatory
  formularzy, test zapytania tablicy, powtórzone parametry sortowania).
- §8: data zmiany §6. Numery 6.4 i 6.5 zostają zarezerwowane dla faz 3 i 4.

#### 2. CLAUDE.md — testy referencyjne

**File**: `CLAUDE.md`

**Intent**: `## Testing` ma wskazywać nowe wzorce przez nazwane pliki.

**Contract**: W punkcie zaczynającym się od „A test lives under `tests/`…”:
`tests/lib/criteria.test.ts` jako referencja testu funkcji odczytu z klientem
zbudowanym w teście i siecią zaślepioną na krawędzi HTTP;
`tests/lib/team-limits.test.ts` jako referencja testu czystej reguły. W punkcie
o `scripts/smoke.mjs` — jedno zdanie o kroku sortowania z ofertami bez ceny i
metrażu. Bez liczb, tylko nazwane ścieżki.

#### 3. Zamknięcie dziennika mutantów

**File**: `context/changes/testing-read-failure-states/mutation.md`

**Intent**: Podsumowanie przed archiwizacją.

**Contract**: Tabela zbiorcza na górze: moduł, wynik bazowy, wynik końcowy,
liczba mutantów świadomie pominiętych. Bez nowych przebiegów Strykera.

### Success Criteria:

#### Automated Verification:

- Cały zestaw przechodzi: `npm test`
- Lint przechodzi: `npx astro sync && npm run lint`
- Typy przechodzą: `npx astro check`
- Każda ścieżka wskazana w nowych podsekcjach §6 i w CLAUDE.md `## Testing` istnieje w repozytorium

#### Manual Verification:

- Podsekcje §6.7 i §6.8 wystarczają, żeby dodać kolejny test funkcji odczytu albo czystej reguły bez czytania tego planu
- Wpis w §6.6 zgadza się z `mutation.md`

**Implementation Note**: Ostatnia faza; po niej `/10x-impl-review`, a wybór
między `/git-ship` i `/git-land` należy do użytkownika.

---

## Testing Strategy

### Unit Tests:

- Czyste funkcje (`team-limits.ts`, `offer-board.ts`): bez zaślepek, bez
  `vi.mock`; każda reguła „nie” ma parę „tak”.
- Funkcje odczytu (`members.ts`, `notes.ts`, `criteria.ts`): hermetycznie, sieć
  zaślepiona na krawędzi HTTP; każdy stan błędu ma obok przypadek kontrolny
  „pusty, ale udany”, bo właśnie tych dwóch stanów nie wolno pomylić.
- Anty-wzorce z CLAUDE.md: żadnych wartości oczekiwanych wyliczanych logiką
  testowanego kodu, żadnych kopii tego samego testu — `it.each` na własność.

### Integration Tests:

- `scripts/smoke.mjs`: cztery kroki kolejności wierszy tablicy (cena i metraż,
  `asc` i `desc`) na lokalnym Supabase.

### Mutation Testing:

- Bramka selektywna, lokalna, zawężona do modułu fazy; decyzja dla każdego
  ocalałego mutanta w `mutation.md`. Wynik nie jest celem.

### Manual Testing Steps:

1. Faza 2: usuń lokalnie `nullsFirst: false` z `dashboard.astro`, przebuduj,
   uruchom smoke — oba kroki `desc` czerwone; przywróć plik, smoke zielony.
2. Fazy 1–5: przejrzyj w `mutation.md` decyzje inne niż „asercja”.
3. Fazy 1, 3, 5: przeczytaj dopisane zdania w PRD i CLAUDE.md.

## Performance Considerations

Testy hermetyczne nie korzystają z gałęzi ponowień postgrest-js, więc żaden nie
czeka na back-off. Stryker to pięć zawężonych przebiegów lokalnych; nie wchodzi
do CI ani do `npm test`.

## Migration Notes

Brak: żadnej migracji, żadnej zmiany w `src/`. Zmiana smoke dopisuje jeden zapis
do drugiej oferty fixture, którą smoke i tak usuwa na końcu przebiegu.

## References

- Related research: `context/changes/testing-read-failure-states/research.md`
- Zakres i wymagania: `context/changes/testing-read-failure-states/change.md`
- Wzorzec testu hermetycznego: `tests/pages/api/criteria.test.ts:9-12,29-43`
- Zaślepka HTTP: `tests/fixtures/http.ts:38-72,149-157`
- Wzorzec testu czystej funkcji: `tests/lib/safe-url.test.ts`
- Kroki tablicy w smoke: `scripts/smoke.mjs:550-555,646-661,1088-1105`
- Reguła sortowania: `src/pages/dashboard.astro:20-33`
- Kontrakty funkcji: `context/archive/2026-09-27-team-search-criteria/plan.md`,
  `context/archive/2026-09-26-shared-offer-board/plan.md`,
  `context/archive/2026-09-26-member-notes/plan.md`,
  `context/archive/2026-09-26-duplicate-listing-notice/plan.md`
- Cookbook i workflow mutacji: `context/foundation/test-plan.md` §6, CLAUDE.md
  `### Mutation testing (Stryker)`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Limity zespołu — `limitBreaches` i `normalizePlace`

#### Automated

- [x] 1.1 Test fazy przechodzi: `npm test -- tests/lib/team-limits.test.ts` — 6b8baf6
- [x] 1.2 Cały zestaw przechodzi: `npm test` — 6b8baf6
- [x] 1.3 Lint przechodzi: `npx astro sync && npm run lint` — 6b8baf6
- [x] 1.4 Typy przechodzą: `npx astro check` — 6b8baf6
- [x] 1.5 Stryker kończy przebieg: `npx stryker run --mutate "src/lib/team-limits.ts"` — 6b8baf6
- [x] 1.6 `mutation.md` ma wynik po fazie obok bazowego (6,0%, 5/83) i decyzję dla każdego ocalałego mutanta w `team-limits.ts` — 6b8baf6

#### Manual

- [x] 1.7 Dopisane zdania w PRD (FR-002) i CLAUDE.md oddają decyzje z wywiadu i nie zmieniają innych reguł — 6b8baf6
- [x] 1.8 Decyzje „równoważny” i „świadomie pominięty” w `mutation.md` dla `team-limits.ts` są zaakceptowane — 6b8baf6

### Phase 2: Sortowanie tablicy — parsowanie w teście, kolejność w smoke

#### Automated

- [x] 2.1 Test fazy przechodzi: `npm test -- tests/lib/offer-board.test.ts` — 5eed138
- [x] 2.2 Cały zestaw przechodzi: `npm test` — 5eed138
- [x] 2.3 Lint przechodzi: `npx astro sync && npm run lint` — 5eed138
- [x] 2.4 Typy przechodzą: `npx astro check` — 5eed138
- [x] 2.5 Smoke przechodzi na podglądzie produkcyjnym z lokalnym Supabase: `npm run build && npm run preview`, potem `BASE_URL=http://localhost:4321 npm run smoke` — 5eed138
- [x] 2.6 Stryker kończy przebieg: `npx stryker run --mutate "src/lib/offer-board.ts"` — 5eed138
- [x] 2.7 `mutation.md` ma wynik po fazie obok bazowego (0%, 0/48) i decyzję dla każdego ocalałego mutanta w `offer-board.ts` — 5eed138

#### Manual

- [x] 2.8 Celowe zepsucie: po lokalnym usunięciu `nullsFirst: false` z `src/pages/dashboard.astro` i przebudowaniu oba kroki `desc` smoke są czerwone; po przywróceniu pliku smoke jest zielony — 5eed138
- [x] 2.9 Decyzje „równoważny” i „świadomie pominięty” w `mutation.md` dla `offer-board.ts` są zaakceptowane — 5eed138

### Phase 3: Nazywanie członka — `resolveSaver`, `resolveAuthors`, nazwy

#### Automated

- [x] 3.1 Test fazy przechodzi: `npm test -- tests/lib/members.test.ts` — 0525369
- [x] 3.2 Cały zestaw przechodzi: `npm test` — 0525369
- [x] 3.3 Lint przechodzi: `npx astro sync && npm run lint` — 0525369
- [x] 3.4 Typy przechodzą: `npx astro check` — 0525369
- [x] 3.5 Stryker kończy przebieg: `npx stryker run --mutate "src/lib/members.ts"` — 0525369
- [x] 3.6 `mutation.md` ma wynik po fazie obok bazowego (0%, 0/129) i decyzję dla każdego ocalałego mutanta w `members.ts` — 0525369

#### Manual

- [x] 3.7 Dopisane zdanie w CLAUDE.md oddaje decyzję o `null` autora — 0525369
- [x] 3.8 Decyzje „równoważny” i „świadomie pominięty” w `mutation.md` dla `members.ts` są zaakceptowane — 0525369

### Phase 4: Odczyt notatek — `loadNotes`

#### Automated

- [x] 4.1 Test fazy przechodzi: `npm test -- tests/lib/notes.test.ts`
- [x] 4.2 Cały zestaw przechodzi: `npm test`
- [x] 4.3 Lint przechodzi: `npx astro sync && npm run lint`
- [x] 4.4 Typy przechodzą: `npx astro check`
- [x] 4.5 Stryker kończy przebieg: `npx stryker run --mutate "src/lib/notes.ts:1-99"`
- [x] 4.6 `mutation.md` ma wynik po fazie obok bazowego (zakres 0/40; cały plik 0%, 0/60) i decyzję dla każdego ocalałego mutanta w `notes.ts:1-99`

#### Manual

- [x] 4.7 Decyzje „równoważny” i „świadomie pominięty” w `mutation.md` dla `notes.ts:1-99` są zaakceptowane

### Phase 5: Odczyt kryteriów — `loadCriteria` i `loadTeamLimits`

#### Automated

- [ ] 5.1 Test fazy przechodzi: `npm test -- tests/lib/criteria.test.ts`
- [ ] 5.2 Cały zestaw przechodzi: `npm test`
- [ ] 5.3 Lint przechodzi: `npx astro sync && npm run lint`
- [ ] 5.4 Typy przechodzą: `npx astro check`
- [ ] 5.5 Stryker kończy przebieg: `npx stryker run --mutate "src/lib/criteria.ts:151-285"`
- [ ] 5.6 `mutation.md` ma wynik po fazie obok bazowego (zakres 0/138; cały plik 22,35%, 59/264) i decyzję dla każdego ocalałego mutanta w `criteria.ts:151-285`

#### Manual

- [ ] 5.7 Dopisane zdanie w CLAUDE.md oddaje decyzję o nieczytelnej wartości limitu
- [ ] 5.8 Decyzje „równoważny” i „świadomie pominięty” w `mutation.md` dla `criteria.ts:151-285` są zaakceptowane

### Phase 6: Cookbook — `test-plan.md` §6 i wskazania w CLAUDE.md

#### Automated

- [ ] 6.1 Cały zestaw przechodzi: `npm test`
- [ ] 6.2 Lint przechodzi: `npx astro sync && npm run lint`
- [ ] 6.3 Typy przechodzą: `npx astro check`
- [ ] 6.4 Każda ścieżka wskazana w nowych podsekcjach §6 i w CLAUDE.md `## Testing` istnieje w repozytorium

#### Manual

- [ ] 6.5 Podsekcje §6.7 i §6.8 wystarczają, żeby dodać kolejny test funkcji odczytu albo czystej reguły bez czytania tego planu
- [ ] 6.6 Wpis w §6.6 zgadza się z `mutation.md`
