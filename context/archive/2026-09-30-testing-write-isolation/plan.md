# Izolacja zapisów (test-plan Faza 2, ryzyko #5) Implementation Plan

## Overview

Domykamy osiem luk z `research.md` §6 i jedną decyzję użytkownika ponad nie
(usunięcie konta), tak żeby regresja w politykach, triggerach lub kaskadach
zaświeciła na czerwono, zanim S-09, S-10 i S-11 dołożą kolejne zapisy. Sonda z
researchu nie znalazła wady — to ochrona przed regresją, nie naprawa błędu.

Trzy warstwy, każda tam, gdzie daje prawdziwy sygnał najtaniej:

- **`scripts/smoke.mjs`** (lokalny Supabase, Data API) — polityki, triggery
  zamrażające i kaskada `offer_notes.offer_id`. Stub nie odpowie za politykę.
- **`scripts/account-deletion.sql`** (psql, transakcja z `ROLLBACK`) — akcje
  `on delete` na `auth.users`, niedostępne dla klucza publishable.
- **`tests/pages/api/criteria.test.ts`** (Vitest, stub na krawędzi HTTP) —
  gałąź trasy „zapis odfiltrowany do zera wierszy”, której prawdziwe polityki
  nie wyprodukują dla zalogowanego członka.

## Current State Analysis

- Izolacja żyje w migracjach: polityki `*_own` na `offer_notes` i
  `member_requirements` plus triggery zamrażające; `src/pages/api/` wiąże każdy
  zapis z użytkownikiem sesji i nie czyta autora z formularza (research §1, §2).
- Smoke ma osiem kroków odmowy (po cztery na tabelę), ale „niezmieniony”
  sprawdza jednym polem przez `bodyIncludes` (`scripts/smoke.mjs:602-606`,
  `:745-749`). Drugi członek nigdy nie ma notatki na ofercie-fixturze, więc nie
  istnieje scenariusz „udany zapis obok cudzego wiersza”.
- Pętla kroków porównuje `status`, `location*`, `errorCode`, `bodyIncludes`,
  `rows`, `minRows`, `revisionDelta` (`:858-868`). Nie ma oczekiwania „taki sam
  jak przedtem”; `withRevision` (`:321-326`) jest wzorcem wrappera przed/po.
- `supabaseRest` zwraca `rows: undefined`, gdy odpowiedź nie jest tablicą
  (`:184`) — krok bez `Prefer: return=representation` z oczekiwaniem `rows`
  pada, nie przechodzi po cichu.
- Sprzątanie wymagań oczekuje samego `204` (`:799-808`), a wymagania drugiego
  członka nie są czytane między `:706` a ich usunięciem.
- `offers.created_by` występuje w smoke tylko w insercie fixtury (`:210`).
- `tests/pages/api/` zawiera wyłącznie `offers.test.ts`; `tests/fixtures/http.ts`
  zna tylko endpoint `offers`.
- Usunięcie konta nie ma żadnego testu, a już raz zawiodło: trigger
  zamrażający autora przywracał usunięte id i blokował kasowanie konta
  (`context/foundation/lessons.md`, F4).
- Re-fetch, usuwanie notatki i oferty nie mają tras (S-09, S-11), archiwum nie
  ma schematu (S-10) — testowalna jest tylko ich połowa bazodanowa.

## Desired End State

Po wykonaniu planu:

- `npm run smoke` na lokalnym Supabase przechodzi i zawiera kroki, które
  porównują **całe wiersze z datami** drugiego członka przed zapisem i po nim —
  po odmowie i po udanym zapisie obok.
- Smoke zawiera stały krok kontrolny: zapis, który ma zmienić obserwowany
  wiersz, musi zostać zgłoszony jako zmiana. Porównanie, które nic nie widzi,
  wywraca przebieg.
- `npm run test:db` wykonuje `scripts/account-deletion.sql` i kończy się kodem
  0, nie zostawiając śladu w bazie; job `smoke` w CI uruchamia go przed
  buildem.
- `npm test` zawiera `tests/pages/api/criteria.test.ts`.
- `context/foundation/test-plan.md` §6.3 opisuje, jak dodać sprawdzenie
  izolacji dla nowej ścieżki zapisu, i mówi wprost, że S-09, S-10 i S-11
  dodają własne sprawdzenie na poziomie trasy.
- Każda rodzina nowych kroków była raz czerwona po celowym zepsuciu polityki,
  triggera lub gałęzi trasy; wynik zapisany w §6.6.

Weryfikacja: `npm run lint`, `npx astro check`, `npm test`, `npm run test:db`,
`npm run smoke` na podglądzie produkcyjnym, zielony job `smoke` w CI.

### Key Discoveries:

- Odmówiony cudzy `UPDATE`/`DELETE` nie jest błędem: `200` z `[]` tylko z
  `Prefer: return=representation`, **`204` z pustym ciałem bez niego** — tak
  samo jak udany zapis (research §3, sonda 1–3). `42501` dotyczy wyłącznie
  sfałszowanego insertu lub upsertu: `403` dla członka, `401` dla anonima
  (sonda 4–6, 10).
- Kaskada usuwa cudzą notatkę, choć wołający nie ma do niej polityki `delete` —
  akcja referencyjna nie podlega RLS wołającego (sonda 15). To zachowanie
  zgodne z FR-015, nie luka.
- Ścieżka SQL działa bez klucza secret: sprawdzone 2026-10-01 na lokalnej
  bazie — `psql` na `DB_URL` z `supabase status -o env`, w transakcji
  `delete from auth.users` dla `sigaretif3@vetpad.local`, `ROLLBACK`, konto z
  powrotem. Smoke używa kont 1 i 2, konto 3 jest wolne.
- Wyrocznia dla usunięcia konta jest w PRD (`prd.md:128`): oferty i notatki
  zostają, podpisane „osoba z usuniętym kontem”, „and nobody edits them any
  more”; wymagania znikają razem z kontem.
- Kroki smoke są uporządkowane i stanowe: sprawdzenie ma sens dopiero, gdy
  istnieje wiersz, który mogłoby błędnie ruszyć (`smoke.mjs:569`, `:712`), a
  usunięcie oferty-fixtury jest ostatnim krokiem notatek, żeby nieudany krok
  nic po sobie nie zostawił.

## What We're NOT Doing

- **Żadnych zmian w `src/` ani w `supabase/migrations/`.** Jeśli nowy krok
  wykryje wadę, implementacja zatrzymuje się i zgłasza ją użytkownikowi — nie
  naprawia jej w tym planie i nie dopasowuje oczekiwania do zachowania.
- **Sprawdzenia na poziomie trasy dla re-fetchu, usuwania notatki, usuwania
  oferty i archiwum.** Tras nie ma; każdy ze slice'ów S-09, S-10, S-11 dodaje
  własne (zapisane w §6.3). W szczególności ryzyko „re-fetch jako
  usuń-i-wstaw” należy do S-09.
- **Zmiana `id` oferty przez Data API** (research, pytanie otwarte 4) — poza
  #5; trafia do §6.6 jako zaobserwowane i nieocenione.
- **Ustawienie `enable_anonymous_sign_ins` na hostowanym projekcie** — smoke
  widzi tylko lokalne `supabase/config.toml`; trafia do §6.6.
- **pgTAP / `supabase test db`.** Nowy framework dla jednego scenariusza;
  zwykły `psql` z blokami `DO` trzyma się zasady „zero zależności” ze smoke.
- **Klucz `service_role` / `secret`.** Skrypt SQL łączy się z lokalnym
  Postgresem jego opublikowanym, lokalnym hasłem — to nie jest klucz API.
- **Test Vitest tras notatek i wymagań.** Ich izolację dowodzi smoke; testu
  trasy wymaga tylko gałąź nieosiągalna w smoke.
- **Zmiana zachowania `requirements.ts:60`** (usuwanie bez `.select()`, zero
  wierszy to sukces) — świadoma decyzja udokumentowana w kodzie; §6.3 każe
  S-11 rozstrzygnąć to wprost dla własnych tras.
- **Pogoń za wynikiem mutacyjnym.** Celowe psucie jest jednorazowe i ręczne,
  po jednym na rodzinę kroków; Stryker nie wchodzi do tej fazy.

## Implementation Approach

Kolejność według koszt × sygnał. Najpierw harness (Faza 1), bo każdy późniejszy
krok smoke na nim stoi. Potem notatki i oferty (Faza 2) — najwyższy priorytet,
bo S-09 i S-11 piszą właśnie tam. Wymagania i limity (Faza 3) używają tego
samego wrappera. Test trasy (Faza 4) jest tani i niezależny. Skrypt SQL
(Faza 5) wnosi nową powierzchnię i krok CI, więc idzie po tym, co pewne.
Dokumentacja (Faza 6) opisuje to, co faktycznie dowieziono.

Wszystkie fazy idą przez `/10x-implement`. `/10x-tdd` nie pasuje: kod pod
testem już istnieje i jest poprawny, więc nie da się nazwać pierwszego
czerwonego testu — czerwień uzyskujemy celowym psuciem, nie kolejnością pisania.

Wyrocznią każdego oczekiwania jest PRD (FR-002, FR-003, FR-009, FR-012–FR-015,
NFR `prd.md:119`, `prd.md:128`). Tabela sondy w `research.md` §3 mówi, **jak
PostgREST sygnalizuje** wynik (status, nagłówek `Prefer`), nie **co ma być
wynikiem**.

## Critical Implementation Details

**Kolejność stanów w smoke.** Nowe fixtury (druga oferta, notatki drugiego
członka) powstają przed blokiem RLS notatek, a każde porównanie biegnie, gdy
obserwowany wiersz istnieje. Pusta migawka „przed” nie dowodzi niczego — wrapper
traktuje ją jako błąd kroku, nie jako „bez zmian”. Usunięcie obu ofert-fixtur
zostaje na końcu, a ostatni krok sprzątania usuwa obie naraz, więc nieudany krok
kaskady nic nie zostawia.

**Daty w skrypcie SQL.** `on delete set null` wykonuje się jako `UPDATE`, a
trigger ustawia wtedy `updated_at := now()`; w jednej transakcji `now()` stoi w
miejscu, a PRD nie mówi nic o dacie osieroconej notatki. Skrypt porównuje więc
dla wierszy usuniętego autora tożsamość i treść bez `updated_at`. Wiersze
pozostałych członków porównuje w całości.

**Reset lokalnej bazy przy celowym psuciu.** Zepsute polityki i triggery cofa
`npx supabase db reset` (lokalny, nigdy `--linked`). Reset kasuje dane wpisane
ręcznie do lokalnej bazy — agent pyta użytkownika o zgodę przed pierwszym
psuciem i po resecie restartuje `npm run dev`, jeśli działa.

---

## Phase 1: Harness smoke — migawka całego wiersza, fixtury, krok kontrolny

### Overview

Daje smoke'owi oczekiwanie „wiersze identyczne przed i po”, fixtury z dwoma
członkami obok siebie i stały dowód, że porównanie potrafi wykryć zmianę. Nie
dodaje jeszcze żadnego sprawdzenia izolacji poza krokiem kontrolnym.

### Changes Required:

#### 1. Wrapper migawki i oczekiwania w pętli

**File**: `scripts/smoke.mjs`

**Intent**: Dodać wrapper na wzór `withRevision`, który przed krokiem i po nim
czyta wskazane wiersze z `select=*` i raportuje, czy są identyczne. Bez tego
„niezmieniony” zostaje porównaniem jednego pola.

**Contract**: Wrapper przyjmuje listę obserwowanych odczytów (ścieżka Data API
i konto, które czyta) oraz funkcję kroku; zwraca wynik kroku rozszerzony o
pole z wynikiem porównania (`same` / `changed`) i liczbą obserwowanych wierszy.
Odczyty mają deterministyczną kolejność (`order=`), a porównanie obejmuje
wszystkie kolumny, w tym `created_at` i `updated_at`. Pusta migawka „przed”
albo nieudany odczyt to błąd kroku. Pętla dostaje dwa oczekiwania: „identyczne”
i „zmienione”; linia raportu pokazuje wynik porównania, a linia `expected`
nazywa oczekiwanie. Wrapper składa się z `withRevision` w dowolnej kolejności.

#### 2. Fixtury: druga oferta i notatki obu członków

**File**: `scripts/smoke.mjs`

**Intent**: Postawić obok siebie wiersze dwóch członków na tej samej ofercie i
wiersze na drugiej ofercie, żeby dało się zadać pytania „czy udany zapis został
na swoim wierszu” i „czy usunięcie zabrało coś z innej oferty”.

**Contract**: Drugie stałe id oferty i parametryzacja `createFixtureOffer`.
Po krokach trasy `/api/notes` (pierwszy członek, oferta 1) powstają przez Data
API: notatka drugiego członka na ofercie 1, notatki obu członków na ofercie 2.
Każdy krok tworzący asertuje `rows: 1`. Istniejący krok „member keeps one note
per offer” (`:570-574`) i „another member reads the note” (`:576-580`) dostają
filtr autora albo nową liczbę wierszy — tak, żeby nadal asertowały to, co
nazywa ich tytuł. Ostatni krok sprzątania usuwa obie oferty-fixtury jednym
żądaniem (`id=in.(…)`).

#### 3. Stały krok kontrolny

**File**: `scripts/smoke.mjs`

**Intent**: Udowodnić w każdym przebiegu, że porównanie widzi zmianę — inaczej
wrapper czytający zły wiersz przechodziłby zawsze.

**Contract**: Dwa kroki opakowane wrapperem z oczekiwaniem „zmienione”: autor
edytuje treść własnej notatki, a obserwowana jest ta notatka; autor zapisuje tę
samą notatkę bez zmiany treści, a obserwowana jest ta notatka — zmienia się
wtedy tylko `updated_at`, więc krok dowodzi, że porównanie obejmuje daty.

### Test contract (krok kontrolny)

- **Zachowanie:** porównanie migawek zgłasza zmianę, gdy zmienia się treść, i
  gdy zmienia się wyłącznie data.
- **Regresja:** wrapper obserwujący zły wiersz, pustą listę albo jedno pole.
- **Źródło:** research §4 (wiersz 1: „identical” wymaga porównania całego
  wiersza), §6 luka 2; decyzja użytkownika „kontrola + celowe psucie”.
- **Przypadek brzegowy:** zmiana samej daty; pusta migawka „przed”.
- **Anty-wzorzec:** uznanie wiersza za niezmieniony po porównaniu jednego pola.

### Success Criteria:

#### Automated Verification:

- Lint przechodzi: `npm run lint`
- Smoke przechodzi na podglądzie produkcyjnym z lokalnym Supabase: `npm run build && npm run preview` + `BASE_URL=http://localhost:4321 npm run smoke`
- Po przebiegu smoke w lokalnej bazie nie zostaje żadna oferta-fixtura (`source_url` zaczynające się od `https://example.com/smoke/`)

#### Manual Verification:

- Raport smoke pokazuje oba kroki kontrolne jako PASS z wynikiem „zmienione”
- Tymczasowa zmiana wrappera, żeby porównywał tylko `pros`, wywraca krok kontrolny „sama data”; zmiana cofnięta

**Implementation Note**: Po zakończeniu fazy i przejściu weryfikacji
automatycznej zatrzymaj się na potwierdzenie weryfikacji ręcznej przez
użytkownika. Pola wyboru dla tych pozycji są w `## Progress`.

---

## Phase 2: Izolacja notatek i ofert (luki 1, 2, 4, 5, 6, 7)

### Overview

Dowodzi, że po każdym zapisie na `offer_notes` lub `offers` — odmówionym i
udanym — notatki pozostałych członków są identyczne co do całego wiersza, że
autora oferty nie da się zmienić, i że usunięcie oferty zabiera notatki
wszystkich członków z tej oferty i nic z innej.

### Changes Required:

#### 1. Odmowy z porównaniem całego wiersza

**File**: `scripts/smoke.mjs`

**Intent**: Zastąpić „note is unchanged” (jedno pole) porównaniem całego
wiersza wokół każdej próby drugiego członka, i pokazać pułapkę `204`.

**Contract**: Kroki „another member cannot edit / delete the note” i
„cannot write a note as its author” biegną w wrapperze obserwującym notatkę
pierwszego członka, z oczekiwaniem „identyczne”; filtr celuje wprost w wiersz
pierwszego członka (`author_id=eq.<A>`), bo na ofercie są już dwie notatki.
Dochodzą: cudzy `DELETE` **bez** `Prefer` — oczekiwany status `204`, a dowodem
odmowy jest wyłącznie „identyczne”; sfałszowany **upsert**
(`on_conflict=offer_id,author_id`, `resolution=merge-duplicates`) na istniejącą
notatkę pierwszego członka — `403`, `42501`, „identyczne”; insert anonima —
`401`, `42501`. Krok `:602-606` znika, zastąpiony powyższymi.

#### 2. Udany zapis obok cudzego wiersza

**File**: `scripts/smoke.mjs`

**Intent**: Zakwestionować „UPDATE się udał, więc zmienił się tylko wskazany
wiersz” — filtr bez autora trafia w wiersze obu członków, a polityka ma
przepuścić tylko własny.

**Contract**: Drugi członek wysyła `PATCH offer_notes?offer_id=eq.<oferta 1>`
bez filtra autora: `200`, `rows: 1`, notatka pierwszego członka „identyczne”.
Drugi członek wysyła `DELETE offer_notes?offer_id=eq.<oferta 2>` bez filtra
autora: `200`, `rows: 1`, notatka pierwszego członka na ofercie 2
„identyczne”. Istniejące kroki tożsamości (`:607-608`) obserwują dodatkowo
notatkę drugiego członka na tej samej ofercie.

#### 3. Zapis oferty nie rusza notatek ani autora oferty

**File**: `scripts/smoke.mjs`

**Intent**: Postawić strażnika schematu dla FR-009, zanim powstanie S-09, i
dać `offers.created_by` pierwszy krok w smoke.

**Contract**: Drugi członek (nie ten, który zapisał ofertę) wysyła `PATCH` na
ofertę 1 z kolumnami danych ogłoszenia, które zmieniłby re-fetch (tytuł, opis,
cena, `fetched_at`), oraz `created_by` ustawionym na siebie: `200`, `rows: 1`;
wszystkie notatki na obu ofertach „identyczne”. Osobny `PATCH` z
`created_by: null`. Po obu odczyt z filtrem `created_by=eq.<A>` zwraca
`rows: 1`. Istniejący krok ceny (`:761-771`) dostaje ten sam wrapper.

#### 4. Kaskada usunięcia oferty

**File**: `scripts/smoke.mjs`

**Intent**: Sprawdzić FR-015 w obu kierunkach: „każdego członka” i „nic
więcej”.

**Contract**: Krok „fixture offer is deleted with its notes” (`:820-829`)
wykonuje drugi członek — dowolny członek usuwa ofertę (PRD, Access Control) —
w wrapperze obserwującym notatki na ofercie 2: `200`, `rows: 1`,
„identyczne”. Bezpośrednio przed nim odczyt notatek oferty 1 zwraca wiersze
obu członków; po nim `rows: 0`. Potem usunięcie oferty 2 i `rows: 0` dla jej
notatek; na końcu krok sprzątania z Fazy 1.

#### 5. Komentarz nagłówkowy smoke

**File**: `scripts/smoke.mjs`

**Intent**: Nagłówek pliku opisuje, co smoke sprawdza; nowe kroki notatek i
ofert muszą się w nim znaleźć.

**Contract**: Akapit „Member notes” w komentarzu nagłówkowym (`:10-19`):
dwie oferty-fixtury, notatki obu członków, porównanie całych wierszy, kaskada.

### Test contract

| Sprawdzenie | Zachowanie | Regresja, którą łapie | Źródło | Przypadek brzegowy / błędu | Anty-wzorzec, którego unika |
|---|---|---|---|---|---|
| Odmowy | Po cudzym PATCH, DELETE, insercie i upsercie notatka autora jest identyczna co do wiersza | Polityka `*_own` poluzowana do „każdy członek”; upsert omijający `with check` | FR-012; research §3 sonda 1–6, §6 luki 2, 7 | `204` bez `Prefer` (status jak przy sukcesie); `401` dla anonima | Asercja samego statusu; porównanie jednego pola |
| Udany zapis obok | Zapis z filtrem bez autora zmienia lub usuwa tylko własny wiersz | Polityka `update`/`delete` bez warunku autora; nowa polityka `for all` | FR-012, FR-015; research sonda 8, luka 1 | Filtr obejmujący wiersze obu członków | „UPDATE się udał, więc zmienił tylko swój wiersz” |
| Zapis oferty | Zmiana danych ogłoszenia zostawia każdą notatkę identyczną, z `updated_at` | Trigger na `offers` piszący do `offer_notes`; kolumna notatki przeniesiona do `offers` | FR-009, NFR `prd.md:119`; research sonda 9, luka 4 | Zapis przez członka, który oferty nie zapisał | Zdrowa ścieżka bez odczytu notatki po zapisie |
| Autor oferty | `created_by` zostaje przy pierwotnym członku po próbie przypisania i wyzerowania | Usunięty lub rozluźniony `offers_freeze_created_by` | `prd.md:128`, FR-005; research sonda 9, 9b, luka 5 | `created_by: null` przy istniejącym koncie | Oczekiwanie odczytane z odpowiedzi PATCH zamiast z osobnego odczytu |
| Kaskada | Usunięcie oferty zabiera notatki obu członków z tej oferty i nic z drugiej | `on delete cascade` zmienione na `restrict`/`set null`; kaskada po autorze zamiast po ofercie | FR-015; research sonda 15, luka 6 | Usuwa członek bez polityki `delete` do cudzej notatki | Sprawdzanie kaskady na jednej notatce i jednej ofercie |

### Success Criteria:

#### Automated Verification:

- Lint przechodzi: `npm run lint`
- Smoke przechodzi na podglądzie produkcyjnym z lokalnym Supabase: `BASE_URL=http://localhost:4321 npm run smoke`
- Każdy nowy krok zapisu notatki lub oferty asertuje liczbę wierszy albo wynik porównania — żaden nie polega na samym statusie
- Po przebiegu smoke w lokalnej bazie nie zostaje żadna oferta-fixtura ani jej notatka

#### Manual Verification:

- Celowe psucie na lokalnej bazie (psql), każde osobno, smoke po każdym: polityka `update` na `offer_notes` poluzowana do `true` — czerwone kroki „odmowa PATCH” i „udany PATCH obok”
- Polityka `delete` na `offer_notes` poluzowana do `true` — czerwone kroki „odmowa DELETE”, „DELETE bez Prefer” i „udany DELETE obok”
- Trigger `offers_freeze_created_by` wyłączony — czerwony krok autora oferty
- Tymczasowy trigger na `offers` przestawiający `updated_at` notatek — czerwony krok „zapis oferty”
- Lokalna baza przywrócona przez `npx supabase db reset` za zgodą użytkownika; smoke znów zielony

**Implementation Note**: Po zakończeniu fazy i przejściu weryfikacji
automatycznej zatrzymaj się na potwierdzenie weryfikacji ręcznej przez
użytkownika. Jeśli którykolwiek krok jest czerwony bez psucia, to wada w
migracjach: zatrzymaj się i zgłoś ją, nie zmieniaj oczekiwania.

---

## Phase 3: Izolacja wymagań i limitów (luki 2, 3, 7)

### Overview

Dowodzi, że wymagania drugiego członka są identyczne po każdym zapisie
pierwszego — edycji, usunięciu przez trasę, wyczyszczeniu i przywróceniu
limitów — i że zapis z szerokim filtrem dotyka tylko własnego wiersza.

### Changes Required:

#### 1. Odmowy z porównaniem całego wiersza

**File**: `scripts/smoke.mjs`

**Intent**: To samo co w Fazie 2 dla `member_requirements`: jedno pole
zastąpić całym wierszem i dołożyć sfałszowany upsert, bo trasa pisze upsertem.

**Contract**: Kroki `:724-744` biegną w wrapperze obserwującym wymagania
pierwszego członka, oczekiwanie „identyczne”; krok `:745-749` znika.
Dochodzi sfałszowany upsert (`on_conflict=author_id`,
`resolution=merge-duplicates`) podpisany pierwszym członkiem: `403`, `42501`,
„identyczne”.

#### 2. Udany zapis obok cudzego wiersza

**File**: `scripts/smoke.mjs`

**Intent**: Sprawdzić przypadki z sondy 11 i 12 — filtr obejmujący oba
wiersze.

**Contract**: Pierwszy członek wysyła `PATCH member_requirements` z filtrem
obejmującym obu autorów: `200`, `rows: 1`, wymagania drugiego „identyczne”,
rewizja `+1`. Drugi członek wysyła `DELETE` z takim samym filtrem: `200`,
`rows: 1`, wymagania pierwszego „identyczne”; po nim drugi członek zapisuje
swoje wymagania ponownie, żeby dalsze kroki miały co obserwować.

#### 3. Wymagania drugiego członka wokół zapisów pierwszego i limitów

**File**: `scripts/smoke.mjs`

**Intent**: Zamknąć lukę 3 — wymagania drugiego członka nie są dziś czytane po
żadnym późniejszym zapisie.

**Contract**: Wrapper obserwujący wymagania drugiego członka, oczekiwanie
„identyczne”, wokół: patcha tożsamości (`:750-754`), usunięcia przez trasę
(`:778-782`), wyczyszczenia limitów (`:784-788`) i przywrócenia limitów
(`:798`). Istniejące oczekiwania `revisionDelta` zostają.

#### 4. Sprzątanie liczy wiersze

**File**: `scripts/smoke.mjs`

**Intent**: Usunąć asercję samego `204`, która przechodzi niezależnie od tego,
czy wiersz istniał.

**Contract**: Kroki `:799-808` wysyłają `Prefer: return=representation`.
Usunięcie wymagań drugiego członka oczekuje `rows: 1` — dowód, że wiersz
dotrwał do końca. Usunięcie wymagań pierwszego oczekuje `rows: 0` (usunęła je
trasa). Krok „no smoke requirements remain” zostaje jako ostatnia siatka.

#### 5. Komentarz nagłówkowy smoke

**File**: `scripts/smoke.mjs`

**Intent**: Akapit „Team criteria” ma opisywać nowe sprawdzenia.

**Contract**: Komentarz nagłówkowy (`:20-33`): porównanie całych wierszy,
szeroki filtr, sprzątanie liczące wiersze.

### Test contract

| Sprawdzenie | Zachowanie | Regresja, którą łapie | Źródło | Przypadek brzegowy / błędu | Anty-wzorzec, którego unika |
|---|---|---|---|---|---|
| Odmowy | Po cudzym PATCH, DELETE, insercie i upsercie wymagania autora są identyczne co do wiersza | Polityka `*_own` poluzowana; upsert omijający `with check` | FR-002; research sonda 10, luki 2, 7 | Upsert na istniejący wiersz (konflikt klucza głównego) | Porównanie jednego pola |
| Szeroki filtr | PATCH i DELETE obejmujące oba wiersze dotykają tylko własnego | Polityka `update`/`delete` bez warunku autora | FR-002; research sonda 11, 12 | Filtr `in.(A,B)` | „Zapis się udał, więc trafił tylko w swój wiersz” |
| Zapisy sąsiada i limitów | Wymagania drugiego członka identyczne po edycji i usunięciu pierwszego oraz po każdej zmianie limitów | Trigger limitów lub rewizji piszący do `member_requirements`; trasa usuwania bez filtra autora | FR-002, FR-003; research sonda 13, luka 3 | Wyczyszczenie limitów (zapis samych nulli) | Zdrowa ścieżka bez odczytu sąsiada |
| Sprzątanie | Usunięcie zwraca liczbę wierszy, która istniała | Wymagania sąsiada skasowane wcześniej po cichu | research §4 (wiersz „Avoid asserting only no error”) | Usunięcie wiersza, którego już nie ma (`rows: 0`) | Asercja samego `204` |

### Success Criteria:

#### Automated Verification:

- Lint przechodzi: `npm run lint`
- Smoke przechodzi na podglądzie produkcyjnym z lokalnym Supabase: `BASE_URL=http://localhost:4321 npm run smoke`
- W `scripts/smoke.mjs` nie zostaje żaden krok zapisu do `member_requirements` z oczekiwaniem samego statusu
- Po przebiegu smoke limity zespołu mają wartości sprzed przebiegu, a konta 1 i 2 nie mają wymagań

#### Manual Verification:

- Celowe psucie na lokalnej bazie: polityka `update` na `member_requirements` poluzowana do `true` — czerwone kroki „odmowa PATCH” i „szeroki PATCH”
- Polityka `delete` na `member_requirements` poluzowana do `true` — czerwone kroki „odmowa DELETE” i „szeroki DELETE”
- Lokalna baza przywrócona przez `npx supabase db reset` za zgodą użytkownika; smoke znów zielony

**Implementation Note**: Po zakończeniu fazy i przejściu weryfikacji
automatycznej zatrzymaj się na potwierdzenie weryfikacji ręcznej przez
użytkownika.

---

## Phase 4: Hermetyczny test trasy `/api/criteria` (luka 8)

### Overview

Druga warstwa: gałąź trasy, w której zapis limitów odfiltrowany do zera
wierszy jest zgłaszany jako nieudany. Prawdziwe polityki nie dadzą tej
odpowiedzi zalogowanemu członkowi, więc smoke jej nie osiągnie.

### Changes Required:

#### 1. Kształt żądania limitów w fixturze HTTP

**File**: `tests/fixtures/http.ts`

**Intent**: Fixtura zna tylko endpoint `offers`; test trasy kryteriów
potrzebuje rozpoznania żądania do `team_criteria` i udokumentowanego kształtu.

**Contract**: Pomocnik rozpoznający żądanie do wskazanej tabeli Data API
(uogólnienie `isOffersRequest`, które zostaje jako cienka nakładka albo jest
zastąpione we wszystkich użyciach) oraz dopisek w komentarzu o kształcie
żądania: `PATCH <SUPABASE_URL>/rest/v1/team_criteria?id=eq.true&select=id` z
`Prefer: return=representation`, odpowiedź tablicą. Kształt odczytany z
postgrest-js w `node_modules`, jak dla `offers`.

#### 2. Test trasy

**File**: `tests/pages/api/criteria.test.ts`

**Intent**: Udowodnić, że trasa odróżnia zapis, który nie trafił w żaden
wiersz, od udanego — i że nie wysyła podpisu ani daty.

**Contract**: `describe` z tagiem `(#5)`. Własny `vi.mock("astro:env/server")`
z wartościami testowymi, ręcznie zbudowany kontekst, `afterEach(restoreFetch)`
— wzorzec `tests/pages/api/offers.test.ts`. Przypadki przez `it.each` tam,
gdzie różni je tylko wejście:

- `PATCH` odpowiada `200 []` przy `intent=save` i przy `intent=clear` —
  przekierowanie na `/criteria` z `?error=`, `&form=limits` i fragmentem
  `#limity`; komunikat zapisu różni się od komunikatu czyszczenia.
- `PATCH` odpowiada `200` z jednym wierszem — przekierowanie na
  `/criteria#limity` bez `error`; dokładnie jedno żądanie `PATCH`, którego
  ciało ma cztery klucze limitów i żadnego z `id`, `updated_by`, `updated_at`.
- `PATCH` odpowiada `403` z `code: "42501"` — przekierowanie z błędem
  mówiącym o sesji, nie sukces.
- Odwrócony zakres cen — przekierowanie z błędem i **zero** żądań do Supabase.

### Test contract

- **Zachowanie:** zapis limitów, który nie zmienił żadnego wiersza, jest
  zgłaszany członkowi jako nieudany, z nazwą formularza; udany zapis wysyła
  wyłącznie cztery limity.
- **Regresja:** usunięcie sprawdzenia `data.length === 0` albo `.select("id")`
  (trasa uznaje `204`/pustą tablicę za sukces); trasa zaczyna wysyłać
  `updated_by` z sesji zamiast zostawić podpis triggerowi.
- **Źródło:** research §6 luka 8; FR-003 (limity wspólne, podpis ustawia
  baza); `CLAUDE.md` Conventions (trasa formularza zgłasza błąd przez
  `?error=` i `&form=`).
- **Przypadek brzegowy / błędu:** `200 []`; `42501`; formularz odrzucony przed
  jakimkolwiek żądaniem.
- **Anty-wzorzec:** mock `@/lib/supabase`; asercja samego statusu `302`
  (sukces i błąd mają ten sam); komunikaty importowane z kodu pod testem —
  test asertuje fragmenty rozróżniające, zapisane ręcznie.

### Success Criteria:

#### Automated Verification:

- Testy przechodzą: `npm test`
- Sam plik przechodzi: `npm test -- tests/pages/api/criteria.test.ts`
- Lint przechodzi: `npx astro sync && npm run lint`
- Typy przechodzą: `npx astro check`
- `tests/pages/api/offers.test.ts` nadal przechodzi po zmianie fixtury

#### Manual Verification:

- Tymczasowe usunięcie gałęzi `updated.data.length === 0` z `src/pages/api/criteria.ts` wywraca przypadek `200 []`; zmiana cofnięta, `git diff src/` pusty

**Implementation Note**: Po zakończeniu fazy i przejściu weryfikacji
automatycznej zatrzymaj się na potwierdzenie weryfikacji ręcznej przez
użytkownika.

---

## Phase 5: Usunięcie konta — skrypt SQL z rollbackiem

### Overview

Pokrywa akcje `on delete` na `auth.users`, których klucz publishable nie
dosięgnie: konto znika, oferty i notatki zostają bez autora i bez możliwości
edycji, wymagania znikają, a wiersze pozostałych członków są nietknięte.
Wszystko w jednej transakcji zakończonej `ROLLBACK`.

### Changes Required:

#### 1. Skrypt SQL

**File**: `scripts/account-deletion.sql`

**Intent**: Usunąć trzecie konto z seeda wewnątrz transakcji i sprawdzić, co
PRD mówi o danych po usuniętym członku — klasę błędu, która już raz zawiodła
(`lessons.md`, F4).

**Contract**: Jeden plik, zaczyna się od `begin`, kończy `rollback`; każda
asercja to blok `DO`, który przy niespełnieniu rzuca wyjątek z nazwą
sprawdzenia, a przy sukcesie skrypt wypisuje jedną linię podsumowania przed
`rollback`. Pierwsza asercja wymaga istnienia `sigaretif3@vetpad.local` i
`sigaretif1@vetpad.local` — konta istnieją tylko po seedzie, więc skrypt
odmawia pracy na bazie, która nie jest lokalna. Fixtury tworzone w transakcji:
oferta zapisana przez konto 3, oferta zapisana przez konto 1, notatki konta 3
na obu, notatka konta 1 na ofercie konta 3, wymagania obu kont, limity
podpisane kontem 3 (zmiana limitu z ustawionym `request.jwt.claims` konta 3,
bo podpis ustawia trigger z `auth.uid()`). Migawka wierszy konta 1 jako
`to_jsonb` przed usunięciem. Asercje po `delete from auth.users`:

- usunięcie się powiodło (nie zablokował go żaden trigger zamrażający);
- oferta konta 3 istnieje, `created_by` jest `null`, pozostałe kolumny bez
  zmian;
- obie notatki konta 3 istnieją, `author_id` jest `null`; `id`, `offer_id`,
  `pros`, `cons`, `observations`, `created_at` bez zmian (bez `updated_at` —
  patrz Critical Implementation Details);
- wymagania i wiersz `members` konta 3 nie istnieją;
- limity mają te same wartości, `updated_by` jest `null`;
- notatka, wymagania i oferta konta 1 identyczne z migawką, całe wiersze;
- jako rola `authenticated` z `request.jwt.claims` konta 1: `update`, `delete`
  i próba przejęcia (`author_id` na siebie) osieroconej notatki dotykają zera
  wierszy.

#### 2. Skrypt npm

**File**: `package.json`

**Intent**: Jedno polecenie do lokalnego uruchomienia, bez nowej zależności.

**Contract**: `test:db` uruchamia `psql` z `ON_ERROR_STOP=1` na pliku
`scripts/account-deletion.sql`, z adresem z `DB_URL`, a gdy go brak — z
lokalnym adresem domyślnym Supabase CLI (port z `supabase/config.toml`,
`[db]`). Nie wchodzi do `npm test`: wymaga działającej bazy.

#### 3. Krok w jobie `smoke`

**File**: `.github/workflows/ci.yml`

**Intent**: Skrypt ma być bramką, nie ręczną procedurą.

**Contract**: Krok „Start local Supabase” zapisuje do `supabase.env` także
`DB_URL`. Nowy krok po nim, przed `npm run build`, uruchamia `npm run test:db`
z `DB_URL` z tego pliku. `DB_URL` nie trafia do `.env` ani `.dev.vars`
aplikacji. Jeśli obraz runnera nie ma `psql`, krok używa
`docker exec -i supabase_db_vetpad psql -U postgres` z plikiem na wejściu —
rozstrzyga pierwszy przebieg CI.

### Test contract

- **Zachowanie:** usunięcie konta się udaje; oferty i notatki usuniętego
  członka zostają z pustym autorem i nikt ich nie edytuje; jego wymagania
  znikają; dane pozostałych członków są identyczne.
- **Regresja:** trigger zamrażający autora bez wyjątku „konto już nie
  istnieje” (blokuje usunięcie — F4); nowa kolumna autora bez `on delete`;
  `set null` zamienione na `cascade` na notatkach (usunięcie konta kasuje
  tekst napisany przez człowieka); polityka pozwalająca przejąć osieroconą
  notatkę.
- **Źródło:** `prd.md:128`; `lessons.md` „Declare `on delete` on every author
  column”; research §2 (cztery kolumny wskazujące `auth.users`), pytanie
  otwarte 1; decyzja użytkownika „SQL z rollbackiem”.
- **Przypadek brzegowy / błędu:** notatka usuniętego członka na ofercie innego
  członka; przejęcie osieroconej notatki; baza bez kont z seeda (odmowa).
- **Anty-wzorzec:** „usunięcie nie rzuciło błędu, więc jest dobrze” — skrypt
  porównuje wiersze; oczekiwania z PRD, nie z komentarzy migracji.

### Success Criteria:

#### Automated Verification:

- Skrypt przechodzi na lokalnej bazie: `npm run test:db` kończy się kodem 0
- Po przebiegu konto `sigaretif3@vetpad.local` istnieje, a w bazie nie ma żadnej fixtury skryptu
- Drugi przebieg pod rząd też przechodzi (skrypt nie zostawia stanu)
- Smoke nadal przechodzi: `BASE_URL=http://localhost:4321 npm run smoke`
- Lint przechodzi: `npm run lint`

#### Manual Verification:

- Celowe psucie na lokalnej bazie: funkcja triggera zamrażającego autora notatki podmieniona tak, by zawsze przywracała autora — `npm run test:db` kończy się kodem różnym od 0 z nazwą sprawdzenia; baza przywrócona przez `npx supabase db reset` za zgodą użytkownika
- Job `smoke` w CI jest zielony z nowym krokiem (sprawdzane na PR po `/git-ship` albo na `master` po `/git-land` — wybór ścieżki należy do użytkownika)

**Implementation Note**: Po zakończeniu fazy i przejściu weryfikacji
automatycznej zatrzymaj się na potwierdzenie weryfikacji ręcznej przez
użytkownika. Wynik w CI jest znany dopiero po wypchnięciu; do tego czasu ta
pozycja zostaje otwarta.

---

## Phase 6: Dokumentacja i cookbook

### Overview

Zapisuje wzorce, które faktycznie dowieziono, tak żeby S-09, S-10 i S-11
dodały własne sprawdzenia bez ponownego researchu.

### Changes Required:

#### 1. Cookbook §6.3

**File**: `context/foundation/test-plan.md`

**Intent**: Zastąpić „TBD” instrukcją dodawania sprawdzenia izolacji dla nowej
ścieżki zapisu.

**Contract**: Sekcja `### 6.3` w kształcie §6.1/§6.2 (Where, Reference,
Oracle, wzorce, Run, Pitfalls), obejmująca: wrapper migawki i oba oczekiwania
jako referencję w `scripts/smoke.mjs`; regułę „licz wiersze, nigdy sam status”
z tabelą sygnatur odmowy per operacja i per `Prefer`; regułę „najpierw wiersz
sąsiada, potem sprawdzenie” i krok kontrolny; kiedy smoke, kiedy
`scripts/account-deletion.sql`, kiedy test trasy
(`tests/pages/api/criteria.test.ts` jako referencja gałęzi zero wierszy);
tag `(#5)`. **Osobny punkt: S-09, S-10 i S-11 dodają każdy własne sprawdzenie
na poziomie trasy** — S-09: re-fetch przez trasę zostawia każdą notatkę
identyczną i jest `UPDATE`, nie usuń-i-wstaw (kaskada skasowałaby notatki);
S-10: archiwizacja nie rusza notatek, a kolumna archiwizującego dostaje
`on delete` i przypadek w `scripts/account-deletion.sql`; S-11: trasy usuwania
notatki i oferty rozstrzygają wprost, czym jest zero usuniętych wierszy, i
dostają krok kaskady przez trasę.

#### 2. Notatki fazy i tabele strategii

**File**: `context/foundation/test-plan.md`

**Intent**: Doprowadzić zamrożoną część planu do zgodności z tym, co powstało.

**Contract**: §6.6 „Phase 2 — Write isolation” (co dowieziono, wynik celowego
psucia, odroczone: zmiana `id` oferty przez Data API,
`enable_anonymous_sign_ins` na hostowanym projekcie, sprawdzenia tras
S-09–S-11). §3 wiersz 2, kolumna „Test types”: integration (smoke), SQL na
lokalnej bazie, jeden hermetyczny test trasy — kolumny Status nie ruszamy,
należy do orkiestratora. §4: wiersz dla `scripts/account-deletion.sql`. §5:
wiersz „write-isolation smoke steps” obejmuje `npm run test:db`. Linia `Last
updated` i §8.

#### 3. Reguły projektu

**File**: `CLAUDE.md`

**Intent**: Sekcja `## Testing` i opis seeda mają nazywać nowe powierzchnie i
ich zależności.

**Contract**: W `## Testing`: smoke tworzy dwie oferty-fixtury i notatki obu
kont; `scripts/account-deletion.sql` (`npm run test:db`) jako powierzchnia
wymagająca lokalnej bazy, uruchamiana w jobie `smoke`, zawsze z `ROLLBACK`;
`tests/pages/api/criteria.test.ts` jako referencja trasy, której zapis trafił
w zero wierszy. W `## Structure`, punkt o `supabase/seed.sql`: skrypt SQL
używa `sigaretif3@vetpad.local`, więc usunięcie lub zmiana nazwy tego konta
wywraca job `smoke`. Reguły nazywają referencje, bez liczb.

#### 4. README

**File**: `README.md`

**Intent**: README jest opisem tego, co pokrywa smoke i czego potrzebuje.

**Contract**: Akapit o `npm run smoke` (druga oferta-fixtura, porównanie
całych wierszy) i nowy akapit o `npm run test:db` (wymaga `psql` i lokalnego
Supabase, nic nie zostawia, nigdy na bazie hostowanej).

### Success Criteria:

#### Automated Verification:

- Lint przechodzi: `npm run lint`
- Testy przechodzą: `npm test`
- `context/foundation/test-plan.md` §6.3 nie zawiera „TBD” i wymienia S-09, S-10 i S-11 z ich sprawdzeniami na poziomie trasy
- Każda ścieżka pliku nazwana w nowych fragmentach `CLAUDE.md`, `README.md` i `test-plan.md` istnieje w repozytorium

#### Manual Verification:

- Użytkownik czyta §6.3 i potwierdza, że da się z niej dodać sprawdzenie dla S-09 bez sięgania do `research.md`

**Implementation Note**: Po tej fazie plan jest wykonany. Wypchnięcie zmian to
osobna decyzja użytkownika między `/git-ship` a `/git-land`.

---

## Testing Strategy

### Unit Tests:

- `tests/pages/api/criteria.test.ts`: zero wierszy przy zapisie i przy
  czyszczeniu, jeden wiersz, `42501`, formularz odrzucony bez żądania.

### Integration Tests:

- `scripts/smoke.mjs`: odmowy i udane zapisy obok cudzego wiersza na
  `offer_notes` i `member_requirements`, zapis oferty wobec notatek, autor
  oferty, kaskada na dwóch ofertach, krok kontrolny.
- `scripts/account-deletion.sql`: usunięcie konta w transakcji z `ROLLBACK`.

### Manual Testing Steps:

1. Zgoda użytkownika na `npx supabase db reset` lokalnej bazy.
2. Dla każdej pozycji celowego psucia z Faz 2, 3 i 5: zastosować zmianę przez
   psql, uruchomić smoke lub `npm run test:db`, zanotować czerwone kroki.
3. `npx supabase db reset`, restart `npm run dev`, pełny zielony przebieg.
4. Celowe psucie gałęzi trasy z Fazy 4 i wrappera z Fazy 1; cofnięcie.
5. Po wypchnięciu: job `smoke` zielony.

## Performance Considerations

Smoke rośnie o kilkadziesiąt żądań do lokalnego PostgREST (dwa odczyty na
każdy opakowany krok) — rząd sekund w jobie, który już startuje Supabase.
Skrypt SQL to jedna transakcja.

## Migration Notes

Brak zmian schematu i danych. Jedyny skutek uboczny dla lokalnej bazy to
`npx supabase db reset` przy celowym psuciu — kasuje dane wpisane ręcznie i
wymaga zgody użytkownika.

## References

- Research: `context/changes/testing-write-isolation/research.md`
- Plan testów: `context/foundation/test-plan.md` §2 (ryzyko #5, Risk Response Guidance), §3, §6.3
- Wyrocznia: `context/foundation/prd.md` — FR-002, FR-003, FR-009, FR-012–FR-015, NFR `:119`, `:128`
- Lekcja F4: `context/foundation/lessons.md` — „Declare `on delete` on every author column”
- Wzorzec wrappera: `scripts/smoke.mjs:321-326` (`withRevision`)
- Wzorzec testu trasy: `tests/pages/api/offers.test.ts`, `tests/fixtures/http.ts`
- Gałąź pod testem: `src/pages/api/criteria.ts:93-96`
- Poprzednia faza rolloutu: `context/archive/2026-09-30-testing-ingestion-guardrails/`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Harness smoke — migawka całego wiersza, fixtury, krok kontrolny

#### Automated

- [x] 1.1 Lint przechodzi: `npm run lint` — 97ff2fa
- [x] 1.2 Smoke przechodzi na podglądzie produkcyjnym z lokalnym Supabase: `npm run build && npm run preview` + `BASE_URL=http://localhost:4321 npm run smoke` — 97ff2fa
- [x] 1.3 Po przebiegu smoke w lokalnej bazie nie zostaje żadna oferta-fixtura (`source_url` zaczynające się od `https://example.com/smoke/`) — 97ff2fa

#### Manual

- [x] 1.4 Raport smoke pokazuje oba kroki kontrolne jako PASS z wynikiem „zmienione” — 97ff2fa
- [x] 1.5 Tymczasowa zmiana wrappera, żeby porównywał tylko `pros`, wywraca krok kontrolny „sama data”; zmiana cofnięta — 97ff2fa

### Phase 2: Izolacja notatek i ofert (luki 1, 2, 4, 5, 6, 7)

#### Automated

- [x] 2.1 Lint przechodzi: `npm run lint` — afa4637
- [x] 2.2 Smoke przechodzi na podglądzie produkcyjnym z lokalnym Supabase: `BASE_URL=http://localhost:4321 npm run smoke` — afa4637
- [x] 2.3 Każdy nowy krok zapisu notatki lub oferty asertuje liczbę wierszy albo wynik porównania — żaden nie polega na samym statusie — afa4637
- [x] 2.4 Po przebiegu smoke w lokalnej bazie nie zostaje żadna oferta-fixtura ani jej notatka — afa4637

#### Manual

- [x] 2.5 Celowe psucie na lokalnej bazie (psql), każde osobno, smoke po każdym: polityka `update` na `offer_notes` poluzowana do `true` — czerwone kroki „odmowa PATCH” i „udany PATCH obok” — afa4637
- [x] 2.6 Polityka `delete` na `offer_notes` poluzowana do `true` — czerwone kroki „odmowa DELETE”, „DELETE bez Prefer” i „udany DELETE obok” — afa4637
- [x] 2.7 Trigger `offers_freeze_created_by` wyłączony — czerwony krok autora oferty — afa4637
- [x] 2.8 Tymczasowy trigger na `offers` przestawiający `updated_at` notatek — czerwony krok „zapis oferty” — afa4637
- [x] 2.9 Lokalna baza przywrócona przez `npx supabase db reset` za zgodą użytkownika; smoke znów zielony — afa4637

### Phase 3: Izolacja wymagań i limitów (luki 2, 3, 7)

#### Automated

- [x] 3.1 Lint przechodzi: `npm run lint` — 42a98bb
- [x] 3.2 Smoke przechodzi na podglądzie produkcyjnym z lokalnym Supabase: `BASE_URL=http://localhost:4321 npm run smoke` — 42a98bb
- [x] 3.3 W `scripts/smoke.mjs` nie zostaje żaden krok zapisu do `member_requirements` z oczekiwaniem samego statusu — 42a98bb
- [x] 3.4 Po przebiegu smoke limity zespołu mają wartości sprzed przebiegu, a konta 1 i 2 nie mają wymagań — 42a98bb

#### Manual

- [x] 3.5 Celowe psucie na lokalnej bazie: polityka `update` na `member_requirements` poluzowana do `true` — czerwone kroki „odmowa PATCH” i „szeroki PATCH” — 42a98bb
- [x] 3.6 Polityka `delete` na `member_requirements` poluzowana do `true` — czerwone kroki „odmowa DELETE” i „szeroki DELETE” — 42a98bb
- [x] 3.7 Lokalna baza przywrócona przez `npx supabase db reset` za zgodą użytkownika; smoke znów zielony — 42a98bb

### Phase 4: Hermetyczny test trasy `/api/criteria` (luka 8)

#### Automated

- [x] 4.1 Testy przechodzą: `npm test` — 12b1120
- [x] 4.2 Sam plik przechodzi: `npm test -- tests/pages/api/criteria.test.ts` — 12b1120
- [x] 4.3 Lint przechodzi: `npx astro sync && npm run lint` — 12b1120
- [x] 4.4 Typy przechodzą: `npx astro check` — 12b1120
- [x] 4.5 `tests/pages/api/offers.test.ts` nadal przechodzi po zmianie fixtury — 12b1120

#### Manual

- [x] 4.6 Tymczasowe usunięcie gałęzi `updated.data.length === 0` z `src/pages/api/criteria.ts` wywraca przypadek `200 []`; zmiana cofnięta, `git diff src/` pusty — 12b1120

### Phase 5: Usunięcie konta — skrypt SQL z rollbackiem

#### Automated

- [x] 5.1 Skrypt przechodzi na lokalnej bazie: `npm run test:db` kończy się kodem 0 — ecc0c74
- [x] 5.2 Po przebiegu konto `sigaretif3@vetpad.local` istnieje, a w bazie nie ma żadnej fixtury skryptu — ecc0c74
- [x] 5.3 Drugi przebieg pod rząd też przechodzi (skrypt nie zostawia stanu) — ecc0c74
- [x] 5.4 Smoke nadal przechodzi: `BASE_URL=http://localhost:4321 npm run smoke` — ecc0c74
- [x] 5.5 Lint przechodzi: `npm run lint` — ecc0c74

#### Manual

- [x] 5.6 Celowe psucie na lokalnej bazie: funkcja triggera zamrażającego autora notatki podmieniona tak, by zawsze przywracała autora — `npm run test:db` kończy się kodem różnym od 0 z nazwą sprawdzenia; baza przywrócona przez `npx supabase db reset` za zgodą użytkownika — ecc0c74
- [x] 5.7 Job `smoke` w CI jest zielony z nowym krokiem (sprawdzane na PR po `/git-ship` albo na `master` po `/git-land` — wybór ścieżki należy do użytkownika) — ecc0c74

### Phase 6: Dokumentacja i cookbook

#### Automated

- [x] 6.1 Lint przechodzi: `npm run lint` — 17d2e4f
- [x] 6.2 Testy przechodzą: `npm test` — 17d2e4f
- [x] 6.3 `context/foundation/test-plan.md` §6.3 nie zawiera „TBD” i wymienia S-09, S-10 i S-11 z ich sprawdzeniami na poziomie trasy — 17d2e4f
- [x] 6.4 Każda ścieżka pliku nazwana w nowych fragmentach `CLAUDE.md`, `README.md` i `test-plan.md` istnieje w repozytorium — 17d2e4f

#### Manual

- [x] 6.5 Użytkownik czyta §6.3 i potwierdza, że da się z niej dodać sprawdzenie dla S-09 bez sięgania do `research.md` — 17d2e4f
