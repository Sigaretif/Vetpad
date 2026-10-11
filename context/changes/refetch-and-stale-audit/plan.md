# Ponowne pobranie ogłoszenia i znacznik nieaktualnego audytu — Implementation Plan

## Overview

Członek zespołu pobiera dane zapisanego ogłoszenia ponownie, na żądanie (FR-009, S-09).
Notatki zostają dokładnie takie, jak zostawili je autorzy, a istniejący audyt dostaje
znacznik „nieaktualny" z zachętą do ponownego uruchomienia, gdy od jego wykonania zmieniły
się dane ogłoszenia albo kryteria zespołu (FR-003). Znacznik widać na karcie oferty i na
tablicy. Powiadomienie o duplikacie dostaje brakującą połowę FR-005: propozycję ponownego
pobrania.

## Current State Analysis

- **Zapis jest przygotowany w bazie.** `public.offers` ma politykę
  `offers_update_authenticated` opisaną „re-fetch, S-09" i kolumnę `fetched_at`
  (`supabase/migrations/20260922202756_create_offers.sql:20`, `:101-106`). Trigger zamraża
  wyłącznie `created_by`. Migracja nie jest potrzebna.
- **Pobieranie jest gotowe do ponownego użycia.** `ingestOffer`
  (`src/lib/otodom/index.ts:37`) normalizuje adres, pobiera i mapuje; `fetch.ts:185`
  odrzuca lądowanie na innym ogłoszeniu niż żądane. Trasa dodawania
  (`src/pages/api/offers.ts`) trzyma u siebie komunikaty dla każdej przyczyny, a każdy z
  nich kończy się słowami „Nic nie zostało zapisane" — fałszywymi przy ponownym pobraniu.
- **Audyt zapisuje to, co trzeba porównać, i nikt tego nie czyta.** `completeAudit`
  zapisuje `criteria_revision` i `listing_fingerprint` (`src/lib/audit/store.ts:209-210`),
  ale `VIEW_COLUMNS` (`:290`) ich nie wybiera, a `loadAuditIndex` (`:487`) zwraca sam
  zbiór identyfikatorów.
- **Odcisk ma wersję.** `listingFingerprint` (`src/lib/audit/input.ts:345`) liczy
  `v1:` + SHA-256 z surowych wartości `AUDIT_OFFER_COLUMNS`; zdjęcia, współrzędne i `raw`
  do niego nie wchodzą.
- **Bieżącą rewizję kryteriów czyta prywatna funkcja** w `src/lib/criteria.ts:323`,
  używana tylko przez `loadAuditCriteria`.
- **Karta nie pokazuje daty pobrania**, a `?error=` na `src/pages/offers/[id].astro:59`
  należy w całości do edytora notatek.
- **Tablica celowo nie czyta opisu** (`BOARD_COLUMNS`, `src/lib/offer-board.ts:61`), a
  `AuditStatus` ma trzy wartości (`:74`).
- **Nieudany ponowny audyt już zostawia poprzedni wynik** (S-04; `failAudit`,
  `src/lib/audit/store.ts:232`) — ta część FR-009 jest tylko do sprawdzenia.
- **Powiadomienie o duplikacie** (`src/components/offers/DuplicateNotice.astro`) mówi, kto
  zapisał ofertę, i niczego nie proponuje.

## Desired End State

Na karcie oferty stoi data ostatniego pobrania i przycisk „Pobierz ponownie z otodom.pl".

| Co się stało przy pobraniu                                   | Co widzi członek                                                         | Co jest w bazie  |
| ------------------------------------------------------------ | ------------------------------------------------------------------------ | ---------------- |
| Udane, dane czytane przez audyt takie same                   | komunikat „bez zmian", nowa data pobrania                                | wiersz nadpisany |
| Udane, dane czytane przez audyt inne                         | komunikat „dane się zmieniły", nowa data, audyt (jeśli jest) oznaczony   | wiersz nadpisany |
| Udane, ale znika pole, które zapisane ogłoszenie podaje      | lista znikających pól i przycisk świadomego nadpisania; nic nie zapisano | bez zmian        |
| Świadome nadpisanie, znikają te same pola albo mniej         | jak przy udanym pobraniu                                                 | wiersz nadpisany |
| Świadome nadpisanie, znika pole, którego członek nie widział | ponownie lista znikających pól; nic nie zapisano                         | bez zmian        |
| Pobranie nieudane (wygasło, blokada, sieć, zmiana formatu)   | komunikat z przyczyną, kończący się informacją, że zapisane dane zostały | bez zmian        |
| Pod adresem stoi inne ogłoszenie (`otodom_id` się różni)     | komunikat z tą przyczyną                                                 | bez zmian        |
| Ogłoszenie stało się wynajmem albo nie jest mieszkaniem      | komunikat z tą przyczyną                                                 | bez zmian        |

W żadnym wierszu tej tabeli `public.offer_notes` i `public.offer_audits` nie są zapisywane.

Aktualność audytu, liczona przy każdym odczycie z zapisanych wartości i stanu bieżącego:

| Ogłoszenie (odcisk zapisany a bieżący) | Kryteria (rewizja zapisana a bieżąca) | Wynik                               |
| -------------------------------------- | ------------------------------------- | ----------------------------------- |
| ta sama wersja, równe                  | równe                                 | aktualny                            |
| ta sama wersja, różne                  | równe                                 | nieaktualny — ogłoszenie            |
| ta sama wersja, równe                  | różne                                 | nieaktualny — kryteria              |
| ta sama wersja, różne                  | różne                                 | nieaktualny — ogłoszenie i kryteria |
| inna wersja albo nie da się odczytać   | różne                                 | nieaktualny — kryteria              |
| ta sama wersja, różne                  | nie da się odczytać                   | nieaktualny — ogłoszenie            |
| inna wersja albo nie da się odczytać   | równe                                 | nie udało się ustalić               |
| ta sama wersja, równe                  | nie da się odczytać                   | nie udało się ustalić               |
| inna wersja albo nie da się odczytać   | nie da się odczytać                   | nie udało się ustalić               |

Zmiana modelu albo poziomu rozumowania w ustawieniach audytu nie zmienia żadnego wiersza
tej tabeli. Ponowny audyt, który się powiódł, zapisuje nowe wartości i wraca do
„aktualny"; taki, który się nie powiódł, zostawia poprzedni wynik razem z jego znacznikiem.

Weryfikacja: `npm test`, `npm run smoke` na lokalnym Supabase, strony `/dev/offer-card`,
`/dev/forms`, `/dev/board` oraz jedno ręczne pobranie prawdziwego ogłoszenia.

### Key Discoveries:

- `src/pages/api/audits.ts:163` liczy odcisk z wiersza przeczytanego przez
  `readAuditOffer` — z wartości po przejściu przez bazę. Porównanie „zmieniło się / bez
  zmian" po pobraniu musi używać tej samej drogi (wiersz przed zapisem i wiersz zwrócony
  przez zapis), a nie świeżo zmapowanego obiektu, bo baza normalizuje liczby i daty.
- `tests/lib/audit/input.test.ts:631` dowodzi, że liczba przysłana jako tekst daje ten sam
  odcisk — `readAuditOffer` jest już miejscem tej normalizacji.
- Usunięcie konta kasuje wymagania członka i podbija rewizję kryteriów
  (`supabase/migrations/20260927144141_create_team_criteria.sql:197`), więc audyty stają
  się wtedy nieaktualne bez żadnej dodatkowej reguły.
- `scripts/smoke.mjs:1733-1745` pokazuje kształt wiersza, którym smoke kończy próbę
  audytu przez Data API, a `:518` czyta bieżącą rewizję kryteriów.
- `auditNoNotesConfig` (`eslint.config.js:120`) jest wzorcem strukturalnego zakazu importu
  modułu notatek.
- `src/components/offers/AddOfferForm.tsx` jest wzorcem wyspy formularza z długim
  oczekiwaniem (`usePendingSubmit`, `SubmitButton` z `pendingText`).
- `FIELDS` w `src/lib/log.ts:9` jest zamkniętą listą pól wpisu; nowe pole dopisuje się do
  listy.

## What We're NOT Doing

- **Bez bramki wizualnej** — decyzja użytkownika; bez macierzy 7 stanów i bez zrzutów.
  Nowe stany dostają fixtury i sekcje na `/dev/*`, zmiana przechodzi `npm run lint`.
- **Bez migracji i bez nowej kolumny.** Aktualność jest liczona przy odczycie; żadna flaga
  nie jest zapisywana, nic nie jest zapisywane w `public.offer_audits` przy pobraniu.
- **Bez historii i bez różnic** (PRD, Non-Goals): system mówi, czy dane się zmieniły, i
  które pola by zniknęły — nigdy, jaka była poprzednia wartość.
- **Bez wykrywania błędnie zmienionej wartości.** Zatrzymanie dotyczy wyłącznie pola,
  które przestało być podane; cena zmieniona na inną liczbę jest zapisywana.
- **Bez ponownego pobrania w tle, harmonogramu i powiadomień**; pobranie nie uruchamia
  audytu ani go nie usuwa.
- **Bez oznaczania ogłoszenia jako wygasłego** — nieudane pobranie zostawia kartę taką,
  jaka była, i tylko o tym mówi.
- **Bez zmiany `source_url`** przy pobraniu, także gdy otodom przekierował na nowy slug.
- **Bez blokady współbieżności.** Dwa pobrania naraz zapisują te same dane; pobranie w
  trakcie audytu jest dozwolone — audyt zapisze odcisk tego, co przeczytał, i od razu
  będzie nieaktualny.
- **Bez speca Playwright** i bez żądania do otodom.pl w jakimkolwiek teście lub smoke.
- Bez nowej zależności w `package.json`, bez zmian w `scripts/account-deletion.sql` i
  `scripts/audit-state.sql`, bez zmian instrukcji i schematu audytu, bez nowej wersji
  odcisku.

## Implementation Approach

Dwie czyste reguły niosą obie decyzje, od których zależy wiarygodność znacznika: „czy
audyt jest aktualny" i „które podane pola zniknęłyby po pobraniu". Stoją w `src/lib/`,
są testowane bez sieci i bez renderowania, a widoki i trasa tylko je pytają. Trasa
ponownego pobrania powtarza porządek trasy dodawania — wszystko, co da się sprawdzić za
darmo, potem jedno pobranie, potem jeden zapis oceniany po liczbie wierszy. Karta i
tablica dostają aktualność jako gotową wartość, każda ze swojego odczytu, który może się
nie udać niezależnie od pozostałych.

## Critical Implementation Details

- **Zapisany adres jest niezaufany.** `source_url` może zmienić każdy członek przez Data
  API, a Worker pobierze to, co tam stoi. Trasa przepuszcza go przez `normalizeOfferUrl`
  przed pobraniem i odmawia, gdy nie jest adresem ogłoszenia otodom — bez żądania.
- **Zgoda na utratę pól jest związana z listą.** Formularz potwierdzenia odsyła tokeny
  kolumn, które członek zobaczył; drugie pobranie zapisuje tylko wtedy, gdy zbiór
  znikających pól zawiera się w zaakceptowanym. Tokeny spoza `AUDIT_OFFER_COLUMNS` są
  ignorowane po obu stronach: w trasie i przy renderowaniu parametru adresu, który każdy
  może wpisać ręcznie.
- **Porównanie po pobraniu idzie przez bazę.** Odcisk „przed" pochodzi z wiersza
  przeczytanego na początku trasy, odcisk „po" z wiersza zwróconego przez zapis
  (`update … select`), oba przez `readAuditOffer`.
- **Wiersz zapisanej oferty, który się nie czyta, nie blokuje pobrania.** Ponowne pobranie
  jest właśnie tym, co go naprawia: reguła utraconych pól nie jest wtedy stosowana, a
  komunikat po zapisie jest neutralny, bez „zmieniło się / bez zmian".

## Phase 1: Reguły i odczyty

### Overview

Obie czyste reguły oraz odczyty, które dostarczają im dane. Po tej fazie nic nie zmienia
się w interfejsie; rośnie tylko to, co `loadOfferAudit` i `loadAuditIndex` zwracają.

### Changes Required:

#### 1. Reguła aktualności audytu

**File**: `src/lib/audit/freshness.ts` (nowy)

**Intent**: Jedno miejsce odpowiadające, czy zapisany wynik audytu jest aktualny, i z
jakiego powodu nie jest. Karta i tablica pytają tę funkcję, zamiast porównywać same.

**Contract**: `auditFreshness(stored, current)` zwraca
`{ state: "fresh" } | { state: "stale"; reasons: ("listing" | "criteria")[] } | { state: "unknown" }`
dokładnie według tabeli z „Desired End State". `stored` to `criteriaRevision: number | null`
i `listingFingerprint: string | null` z wiersza audytu; `current` to bieżąca rewizja
(`number | null`, gdzie `null` to nieudany odczyt) i bieżący odcisk (`string | null`).
Wersja odcisku to tekst przed pierwszym dwukropkiem; brak dwukropka albo pusta wersja
czyta się jak „nie da się odczytać". Powody zawsze w kolejności `listing`, `criteria`.
Obok: `currentListingFingerprint(row: unknown): Promise<string | null>` — `readAuditOffer`
i `listingFingerprint`, `null` dla wiersza, który się nie czyta. Moduł nie importuje
dostawcy ani `@/lib/notes`; `@/lib/supabase` wchodzi tylko przez `import type`.

#### 2. Wartości porównawcze w odczytach audytu

**File**: `src/lib/audit/store.ts`

**Intent**: Karta i tablica muszą dostać to, co audyt zapisał do porównania. Wartość,
która się nie czyta, nie chowa wyniku audytu — daje „nie udało się ustalić".

**Contract**: `VIEW_COLUMNS` dostaje `criteria_revision` i `listing_fingerprint`;
`StoredAudit` dostaje `criteriaRevision: number | null` i `listingFingerprint: string | null`
(`null` dla wartości, która nie jest liczbą całkowitą ≥ 0 albo niepustym tekstem — wynik
pozostaje `ok`, nie `broken`). `AuditIndex` w wariancie `ok` zmienia `audited` ze zbioru
na `ReadonlyMap<string, { criteriaRevision: number | null; listingFingerprint: string | null }>`;
`loadAuditIndex` wybiera obie kolumny. Zasada „nieudany odczyt nigdy nie jest »nie
audytowano«" zostaje bez zmian.

#### 3. Bieżąca rewizja kryteriów

**File**: `src/lib/criteria.ts`

**Intent**: Widoki potrzebują samej rewizji, bez kryteriów. Istniejący prywatny odczyt
dostaje publiczne wejście.

**Contract**: `loadCriteriaRevision(supabase): Promise<{ ok: true; revision: number } | { ok: false }>`;
brak klienta, błąd zapytania, brak wiersza, wartość nieczytelna i wyjątek to `{ ok: false }`.
Nigdy nie rzuca. `loadAuditCriteria` zachowuje dotychczasowe zachowanie.

#### 4. Reguła utraconych pól

**File**: `src/lib/offer-refetch.ts` (nowy)

**Intent**: Odpowiedź na pytanie otwarte nr 1 z PRD: które pola czytane przez audyt
zapisane ogłoszenie podaje, a pobrane już nie. Tylko taka utrata zatrzymuje zapis.

**Contract**: `lostFacts(stored: AuditOffer, fetched: AuditOffer): AuditOfferColumn[]` w
kolejności `AUDIT_OFFER_COLUMNS`. „Podane" znaczy: wartość różna od `null`; dla `title` i
`description` — tekst niepusty po przycięciu; dla `features` — niepusta lista. Pole jest
utracone, gdy było podane i nie jest. Zmiana jednej podanej wartości na inną nie jest
utratą. Obok: `LOST_FACT_LABELS: Record<AuditOfferColumn, string>` (polska nazwa każdej
kolumny, zgodna z etykietami karty), `readLostTokens(value: string): AuditOfferColumn[]`
(lista rozdzielona przecinkami, nieznane tokeny i powtórzenia odrzucone, kolejność
`AUDIT_OFFER_COLUMNS`) oraz `isLossAccepted(lost, accepted): boolean` (zawieranie zbiorów).

#### 5. Testy reguł i odczytów

**File**: `tests/lib/audit/freshness.test.ts`, `tests/lib/offer-refetch.test.ts` (nowe),
`tests/lib/audit/store.test.ts`, `tests/lib/criteria.test.ts`, `tests/lib/offer-board.test.ts`

**Intent**: Każdy wiersz obu tabel reguł ma swój przypadek, a każdy przypadek „bez wyniku"
stoi obok takiego, który wynik daje (wzorzec `tests/lib/team-limits.test.ts`).

**Contract**: Aktualność — dziewięć wierszy tabeli, odcisk bez dwukropka, zmiana
ustawień audytu nieobecna w wejściu z definicji. Utracone pola — każdy rodzaj kolumny
(liczba, tekst, `title`, `features`), zmiana wartości bez utraty, zgoda na te same pola,
na nadzbiór i na podzbiór, tokeny wrogie i nieznane. Odczyty — istniejące testy
`store.test.ts` i `offer-board.test.ts` dostosowane do mapy; nieudany odczyt rewizji obok
udanego.

### Success Criteria:

#### Automated Verification:

- Testy jednostkowe przechodzą: `npm test`
- Typy przechodzą: `npx astro sync && npx astro check`
- Lint przechodzi: `npm run lint`
- Stryker na regule aktualności nie zostawia nieocenionego ocalałego mutanta: `npx stryker run --mutate "src/lib/audit/freshness.ts"`
- Stryker na regule utraconych pól nie zostawia nieocenionego ocalałego mutanta: `npx stryker run --mutate "src/lib/offer-refetch.ts"`

#### Manual Verification:

- Karta oferty z audytem i tablica renderują się jak przed fazą (brak regresji po zmianie kształtu `AuditIndex`)

**Implementation Note**: Po tej fazie i po przejściu weryfikacji automatycznej zatrzymaj
się na potwierdzenie ręczne. Pola wyboru dla tych pozycji stoją w sekcji `## Progress`.

---

## Phase 2: Trasa ponownego pobrania

### Overview

`POST /api/offer-refetch`: formularz z karty oferty, przekierowanie z wynikiem. Po tej
fazie pobranie działa z żądania wysłanego ręcznie; przycisku jeszcze nie ma.

### Changes Required:

#### 1. Wspólne komunikaty pobierania

**File**: `src/lib/otodom/failure.ts` (nowy), `src/pages/api/offers.ts`

**Intent**: Dwie trasy mówią o tych samych przyczynach z innym zakończeniem zdania.
Komunikaty i podział na odmowę i awarię przechodzą do jednego modułu, żeby nowa przyczyna
nadal wywracała sprawdzenie wyczerpujące w obu miejscach.

**Contract**: `ingestFailureMessage(reason, status, action: "add" | "refetch")` i
`INGEST_OUTCOME` wyniesione z trasy dodawania. Dla `add` każdy komunikat jest co do znaku
taki jak dziś — `tests/pages/api/offers.test.ts` przechodzi bez zmiany asercji. Dla
`refetch` żaden komunikat nie zawiera słów „Nic nie zostało zapisane"; każdy mówi, że
zapisane dane oferty pozostały bez zmian, a `not_for_sale` i `not_a_flat` mówią, czym
ogłoszenie jest teraz. Moduł jest czysty: bez `astro:env/server` i bez klienta.

#### 2. Trasa

**File**: `src/pages/api/offer-refetch.ts` (nowy)

**Intent**: Jedno świadome pobranie i jeden zapis w `public.offers`, z osobnym,
rozróżnialnym komunikatem dla każdego wyjścia. Trasa nie czyta ani nie zapisuje notatek i
audytów.

**Contract**: Formularz `POST` z polami `offer_id` i `accept_lost` (lista tokenów, domyślnie
pusta). Kolejność: sesja → klient Supabase → formularz → `offer_id` jako UUID → odczyt
wiersza (`source_url`, `otodom_id`, `AUDIT_OFFER_COLUMNS`) → `normalizeOfferUrl` na
zapisanym adresie → wpis `started` → `ingestOffer` z limitem 45 s → zgodność `otodom_id`
(porównanie jako tekst) → `lostFacts` wobec `isLossAccepted` → zapis → wynik.
Zapis to `update` po `id` z kolumnami `OfferInsert` i `fetched_at`, zwracający
`AUDIT_OFFER_COLUMNS`; nigdy `id`, `source_url`, `created_by`, `created_at`. Jest oceniany
po kodzie błędu i liczbie wierszy: brak odpowiedzi to „nie udało się potwierdzić", zero
wierszy to oferta usunięta w międzyczasie.
Odpowiedzi: brak sesji → `/auth/signin`; nieczytelny `offer_id`, brak oferty i oferta
usunięta w międzyczasie → `/dashboard?error=…`; każda inna odmowa i awaria →
`/offers/<id>?error=…&form=refetch#pobranie`; zatrzymanie na utraconych polach →
`/offers/<id>?lost=<tokeny>#pobranie`; sukces → `/offers/<id>?refetched=changed|unchanged|saved`
(`saved`, gdy wiersz sprzed zapisu albo po nim nie czyta się przez `readAuditOffer`).
Nigdy 500 i nigdy JSON.

#### 3. Wpisy logu

**File**: `src/lib/log.ts`, `src/pages/api/offer-refetch.ts`

**Intent**: Każde wyjście z trasy zostawia jeden wpis, a pobranie, które może trwać 45 s,
także wpis przed sobą (wzorzec `src/pages/api/offers.ts`).

**Contract**: `event: "offer_refetch"`, `outcome` jedno z `started`, `saved`, `held`,
`refused`, `failed`; awaria to `error`, reszta `info`. Do `FIELDS` dochodzą `changed`
(boolean) i `lost_columns` (nazwy kolumn rozdzielone przecinkami — nigdy wartości).
Wpis nie zawiera adresu, tytułu, treści ogłoszenia ani `details` z Postgresa.

#### 4. Strukturalny zakaz notatek

**File**: `eslint.config.js`

**Intent**: Niezmiennik „notatki nigdy nie są nadpisywane przez działanie maszyny" dostaje
tę samą ochronę co audyt: trasa pobrania nie może zaimportować modułu notatek.

**Contract**: Nowy blok na wzór `auditNoNotesConfig`, obejmujący
`src/pages/api/offer-refetch.ts` i `src/lib/offer-refetch.ts`, z własnym komunikatem
wskazującym na niezmiennik z `CLAUDE.md`.

#### 5. Testy trasy

**File**: `tests/pages/api/offer-refetch.test.ts`, `tests/pages/api/offer-refetch.unconfigured.test.ts`
(nowe), `tests/lib/otodom/failure.test.ts` (nowy), `tests/lib/log.test.ts`

**Intent**: Każdy wiersz pierwszej tabeli z „Desired End State" ma scenariusz, z atrapą na
krawędzi HTTP (`tests/fixtures/http.ts`, `tests/fixtures/otodom.ts`) i bez mockowania
`@/lib/*`.

**Contract**: Każdy scenariusz podaje, ile żądań trafiło do otodom i ile zapisów do
`offers`. Scenariusze odmowy sprzed pobrania dowodzą zera żądań do otodom; scenariusze
nieudanego pobrania, innego `otodom_id` i zatrzymania na utraconych polach — zera
zapisów. W całym pliku żadne żądanie nie trafia pod `offer_notes` ani `offer_audits`, co
sprawdza jedna wspólna asercja. Zapis nie niesie `source_url`, `created_by`, `created_at`
ani `id`. Wrogi `source_url` w wierszu (inny host) kończy się bez żądania. Zapis, który
dotarł do zera wierszy, jest zgłoszony jako nieudany (wzorzec
`tests/pages/api/criteria.test.ts`). Kanarki sprzedającego z fixtury nie trafiają do
zapisu ani do logu.

### Success Criteria:

#### Automated Verification:

- Testy jednostkowe i testy trasy przechodzą: `npm test`
- Typy przechodzą: `npx astro sync && npx astro check`
- Lint przechodzi, a import `@/lib/notes` dodany na próbę w trasie go wywraca: `npm run lint`
- Budowanie przechodzi bez sekretów: `npm run build`

#### Manual Verification:

- Żądanie `POST /api/offer-refetch` bez sesji przekierowuje na `/auth/signin`, a z sesją i nieistniejącym `offer_id` wraca na `/dashboard` z komunikatem

**Implementation Note**: Po tej fazie i po przejściu weryfikacji automatycznej zatrzymaj
się na potwierdzenie ręczne.

---

## Phase 3: Karta oferty

### Overview

Przycisk, data pobrania, komunikaty, propozycja w powiadomieniu o duplikacie i znacznik w
sekcji audytu. Po tej fazie funkcja jest używalna z karty.

### Changes Required:

#### 1. Formularz ponownego pobrania

**File**: `src/components/offers/RefetchForm.tsx` (nowy)

**Intent**: Wyspa z jednym przyciskiem i stanem oczekiwania do 45 s, w dwóch trybach:
zwykłe pobranie i świadome nadpisanie mimo utraty pól.

**Contract**: Eksport domyślny; props `offerId`, `serverError?`, `acceptLost?: string`
(tokeny do ukrytego pola `accept_lost`, kontrolowanego — nie w `name`/`value` przycisku)
i `compact?` dla powiadomienia o duplikacie. Składa się z `SubmitButton`, `ServerError` i
`usePendingSubmit` z `src/components/form/`. Wyspa nie dostaje żadnej treści z wiersza
oferty poza identyfikatorem.

#### 2. Blok pobrania na karcie i komunikaty strony

**File**: `src/components/offers/OfferCard.astro`, `src/components/offers/RefetchNotice.astro`
(nowy), `src/components/offers/OfferView.astro`, `src/pages/offers/[id].astro`

**Intent**: Członek widzi, z kiedy są dane, może je odświeżyć i dostaje jednoznaczną
odpowiedź, co się stało.

**Contract**: W nagłówku karty, pod „Zapisane przez…", blok z `id="pobranie"`: data i
godzina `fetched_at` oraz `RefetchForm`. Parametr `lost` — odczytany przez `readLostTokens`
— zamienia blok w ostrzeżenie z listą nazw z `LOST_FACT_LABELS` i formularzem w trybie
nadpisania; pusty wynik odczytu nie pokazuje ostrzeżenia. `RefetchNotice` w slocie
`notice` dla `refetched=changed|unchanged|saved`, z trzema różnymi zdaniami; inna wartość
nie pokazuje niczego. Strona rozdziela `?error=`: z `form=refetch` trafia do bloku
pobrania, w każdym innym przypadku do edytora notatek jak dziś. Wszystko z adresu jest
renderowane jako tekst.

#### 3. Propozycja w powiadomieniu o duplikacie

**File**: `src/components/offers/DuplicateNotice.astro`

**Intent**: Brakująca połowa FR-005: powiadomienie o duplikacie proponuje ręczne ponowne
pobranie.

**Contract**: Nowy prop `offerId`; pod zdaniem o tym, kto zapisał ofertę, `RefetchForm` w
trybie `compact`. Zdania o autorze i wariant `unknown` zostają bez zmian. Powiadomienie
niczego nie pobiera samo.

#### 4. Znacznik w sekcji audytu

**File**: `src/components/offers/OfferAudit.astro`, `src/components/offers/OfferView.astro`,
`src/pages/offers/[id].astro`

**Intent**: Wynik audytu wykonanego na starszych danych albo kryteriach jest oznaczony, z
powodem i zachętą do ponownego uruchomienia; audyt nie jest ani usuwany, ani uruchamiany.

**Contract**: Strona czyta bieżącą rewizję (`loadCriteriaRevision`) obok trzech
dotychczasowych odczytów, liczy bieżący odcisk z wiersza oferty
(`currentListingFingerprint`) i przekazuje `auditFreshness(...)` do sekcji. Sekcja dostaje
atrybut `data-audit-freshness` o wartościach `none` (brak wyniku do oceny, także `error` i
`broken`), `fresh`, `stale`, `unknown`; `data-audit-state` i `data-audit-available` nie
zmieniają znaczenia. Dla `stale` — ostrzeżenie nad przyciskiem, z jednym z trzech zdań
powodu i zachętą do ponownego uruchomienia; zachęta znika, gdy próba trwa, a gdy brak
klucza dostawcy, przycisk mówi o tym jak dziś. Dla `unknown` — stonowane zdanie, że
aktualności nie udało się ustalić. Dla `fresh` — nic. Znacznik stoi także przy „Wynik
poprzedniego audytu" po nieudanej próbie. Tekst znacznika pochodzi z kodu, nie z wiersza.

#### 5. Stany na stronach `/dev` i testy renderu

**File**: `src/pages/dev/offer-card.astro`, `src/pages/dev/_offer-fixtures.ts`,
`src/pages/dev/forms.astro`, `tests/components/offers/render.test.ts`

**Intent**: Każdy nowy stan ma miejsce, w którym da się go obejrzeć, i test, który go
pilnuje.

**Contract**: `/dev/offer-card`: sekcja audytu jako `stale` z każdym z trzech powodów,
`unknown`, `stale` obok trwającej próby i obok nieudanej; karta z blokiem pobrania, z
błędem pobrania i z ostrzeżeniem o utraconych polach; powiadomienie o duplikacie z
przyciskiem. `/dev/forms`: `RefetchForm` w stanach domyślnym, oczekiwania, błędu i
nadpisania. Testy renderu: wartość `data-audit-freshness` dla każdego stanu obok `fresh`,
wroga wartość `lost` i `refetched` w adresie (znaczniki HTML, nieznane tokeny) renderowana
jako tekst albo pomijana, obecność formularza w powiadomieniu o duplikacie.

### Success Criteria:

#### Automated Verification:

- Testy jednostkowe i testy renderu przechodzą: `npm test`
- Typy przechodzą: `npx astro sync && npx astro check`
- Lint przechodzi, w tym `tokensOnlyConfig`: `npm run lint`
- Budowanie przechodzi bez sekretów: `npm run build`

#### Manual Verification:

- `/dev/offer-card` pokazuje wszystkie nowe stany sekcji audytu, karty i powiadomienia o duplikacie, czytelne w ciemnym motywie
- `/dev/forms` pokazuje `RefetchForm` w czterech stanach
- Na lokalnej ofercie zmiana tytułu przez Data API oznacza audyt jako nieaktualny z powodu ogłoszenia, a zmiana limitu na `/criteria` — z powodu kryteriów
- Błąd edytora notatek nadal pojawia się przy edytorze, a nie w bloku pobrania

**Implementation Note**: Po tej fazie i po przejściu weryfikacji automatycznej zatrzymaj
się na potwierdzenie ręczne.

---

## Phase 4: Tablica

### Overview

Tablica odróżnia audyt aktualny od nieaktualnego i od takiego, którego aktualności nie
udało się ustalić.

### Changes Required:

#### 1. Statusy i reguła wiersza

**File**: `src/lib/offer-board.ts`, `src/components/offers/AuditStatusBadge.astro`

**Intent**: Po zmianie kryteriów tablica pokazuje, które oferty czekają na ponowny audyt;
„Audytowano" przestaje obejmować wynik, o którym nie wiadomo, czy jest aktualny.

**Contract**: `AuditStatus` dostaje `stale` i `freshness_unknown`. `auditStatus(offer, index, freshness)`:
nieudany odczyt indeksu → `unknown`; brak wyniku → `not_audited`; wynik → `audited`,
`stale` albo `freshness_unknown` według aktualności tej oferty; brak aktualności dla
audytowanej oferty to `freshness_unknown`. Każdy nowy status ma własne słowa i ikonę,
czytelne bez koloru, oraz wartość w `data-audit-status`. Moduł zostaje czysty — same
importy typów.

#### 2. Odczyt aktualności dla tablicy

**File**: `src/lib/audit/freshness.ts`, `src/pages/dashboard.astro`,
`src/components/offers/OfferBoard.astro`, `src/components/offers/OfferBoardItem.astro`

**Intent**: Tablica liczy odciski tylko dla ofert z wynikiem audytu, osobnym odczytem,
który może się nie udać bez szkody dla listy ofert.

**Contract**: `loadBoardFreshness(supabase, index, revision)` zwraca
`{ ok: true; byOffer: ReadonlyMap<string, AuditFreshness> } | { ok: false }`: jedno
zapytanie o `id` i `AUDIT_OFFER_COLUMNS` ofert z indeksu, odcisk każdej, `auditFreshness`
z rewizją przekazaną przez stronę. Pusty indeks nie wysyła zapytania. Nieudany odczyt
ofert to `{ ok: false }` — każdy audytowany wiersz czyta się wtedy jako
`freshness_unknown`, nigdy `audited`. `BOARD_COLUMNS` zostaje bez opisu. Kontener tablicy
dostaje `data-audit-freshness-state="ok"|"error"` obok `data-audits-state`. Nigdy nie
rzuca.

#### 3. Stany na `/dev/board` i testy

**File**: `src/pages/dev/board.astro`, `src/pages/dev/_offer-fixtures.ts`,
`tests/lib/offer-board.test.ts`, `tests/lib/audit/freshness.test.ts`,
`tests/components/offers/offer-board-item.test.ts`

**Intent**: Pięć statusów widać obok siebie, a reguła wiersza ma przypadek dla każdego.

**Contract**: `/dev/board`: wiersze `stale` i `freshness_unknown` oraz tablica z nieudanym
odczytem aktualności. Testy: każdy status z regułą, która go daje, obok sąsiedniego;
`loadBoardFreshness` z udanym odczytem, z nieudanym i z pustym indeksem (zero żądań),
klient budowany w teście i sieć na krawędzi HTTP (wzorzec `tests/lib/criteria.test.ts`).

### Success Criteria:

#### Automated Verification:

- Testy jednostkowe i testy renderu przechodzą: `npm test`
- Typy przechodzą: `npx astro sync && npx astro check`
- Lint przechodzi: `npm run lint`
- Budowanie przechodzi bez sekretów: `npm run build`

#### Manual Verification:

- `/dev/board` pokazuje pięć statusów audytu, rozróżnialnych bez koloru
- Na lokalnej tablicy zmiana limitu na `/criteria` zmienia status audytowanej oferty na „nieaktualny"
- Sortowanie i znaczniki limitów działają jak przed fazą

**Implementation Note**: Po tej fazie i po przejściu weryfikacji automatycznej zatrzymaj
się na potwierdzenie ręczne.

---

## Phase 5: Smoke i dokumentacja

### Overview

Dowód na żywej lokalnej bazie i zapis reguł tam, gdzie następna zmiana ich szuka.

### Changes Required:

#### 1. Kroki smoke

**File**: `scripts/smoke.mjs`

**Intent**: Nowa trasa i nowy znacznik są sprawdzone na produkcyjnym podglądzie i lokalnym
Supabase — bez jednego żądania do otodom.pl i bez uruchomienia audytu.

**Contract**: Do trasy trafiają wyłącznie żądania, które kończy ona przed pobraniem: bez
sesji, ze sfałszowaną sesją (`requestWithForgedSession`), z nieczytelnym `offer_id` i z
nieistniejącym; krok dla identyfikatora oferty-fixtury odmawia wysłania, na wzór
`requestAuditOfMissingOffer`. Aktualność: druga oferta-fixtura dostaje przez Data API
ukończony audyt z bieżącą rewizją i odciskiem, który smoke liczy sam według formatu `v1`
(niezależna implementacja kilku linii) — karta musi nieść `data-audit-freshness="fresh"`;
po zmianie tytułu tej oferty przez Data API — `stale`, a tablica `data-audit-status="stale"`
i `data-audit-freshness-state="ok"`. Pierwsza oferta-fixtura zostaje bez audytu przez cały
przebieg i niesie `none`. Zmiana kolumn ogłoszenia jest objęta `withSnapshot` na notatkach
obu kont: wynik `same`. Sprzątanie i kolejność istniejących kroków audytu pozostają
spójne z tym, co plik już zakłada o drugiej ofercie.

#### 2. Reguły projektu i opis tras

**File**: `CLAUDE.md`, `README.md`

**Intent**: Następna zmiana ma znaleźć moduły odniesienia i nie budować drugiego
mechanizmu.

**Contract**: `CLAUDE.md`, sekcja `## Structure`: `src/pages/api/offer-refetch.ts` jako
odniesienie trasy nadpisującej wiersz, `src/lib/offer-refetch.ts` dla reguły utraconych
pól, `src/lib/audit/freshness.ts` jako jedyne miejsce porównania aktualności, nowe
atrybuty `data-audit-freshness` i `data-audit-freshness-state`; sekcja `## Testing`: co
smoke robi dla aktualności i że do trasy pobrania wysyła tylko żądania kończone przed
pobraniem; wzmianki „S-09 compares…" zamienione na wskazanie modułu. `README.md`: wiersz
`POST /api/offer-refetch` w tabeli tras. Każda reguła nazywa plik odniesienia, nie liczbę.

#### 3. Zamknięcie pytania otwartego nr 1

**File**: `context/foundation/prd.md`, `context/foundation/roadmap.md`

**Intent**: Decyzja użytkownika z tego planu trafia do PRD, który wiąże reguły projektu.

**Contract**: PRD, Open Questions: pytanie nr 1 przeniesione do bloku rozstrzygniętych z
datą 2026-10-09 i treścią — pole, które przestało być podane, zatrzymuje zapis i wymaga
świadomego nadpisania; błędnie zmieniona wartość nie jest wykrywana. Roadmapa, Open
Roadmap Questions: to samo pytanie przekreślone ze wskazaniem na PRD. Status S-09 w
roadmapie nie jest tu ruszany — robią to `/10x-implement` i `/10x-archive`.

### Success Criteria:

#### Automated Verification:

- Testy jednostkowe przechodzą: `npm test`
- Typy przechodzą: `npx astro sync && npx astro check`
- Lint przechodzi: `npm run lint`
- Budowanie przechodzi bez sekretów: `npm run build`
- Skrypty bazy przechodzą bez zmian: `npm run test:db`
- Smoke przechodzi na podglądzie produkcyjnym i lokalnym Supabase: `npm run smoke`

#### Manual Verification:

- Ponowne pobranie prawdziwego ogłoszenia z karty lokalnej oferty kończy się komunikatem „bez zmian" albo „dane się zmieniły" i nową datą pobrania
- Notatka dodana przed tym pobraniem czyta się po nim co do znaku tak samo, z tą samą datą edycji
- Oferta z audytem, której tytuł zmieniono przez Data API, wraca do zgodności z otodom po pobraniu, a jej audyt jest oznaczony jako nieaktualny
- Wklejenie adresu zapisanej oferty na `/dashboard` otwiera kartę z powiadomieniem o duplikacie, a przycisk w powiadomieniu pobiera dane ponownie
- Pobranie oferty, której zapisany `source_url` zmieniono przez Data API na adres wygasłego ogłoszenia, zostawia kartę bez zmian i podaje przyczynę

**Implementation Note**: Ręczne pobranie sięga do otodom.pl i jest działaniem użytkownika.
Żaden krok tej fazy nie wysyła żądania do dostawcy modelu: audyt potrzebny do weryfikacji
ręcznej jest zapisywany przez Data API albo uruchamiany przez użytkownika z własnej woli.

---

## Testing Strategy

### Unit Tests:

- Reguła aktualności: dziewięć wierszy tabeli, wersja odcisku, kolejność powodów.
- Reguła utraconych pól: każdy rodzaj kolumny, zgoda jako zawieranie zbiorów, odczyt
  tokenów z adresu.
- Odczyty: wartości porównawcze w `loadOfferAudit` i `loadAuditIndex`, bieżąca rewizja,
  aktualność dla tablicy — każdy nieudany odczyt obok udanego.
- Komunikaty pobierania: dla `add` bez zmian, dla `refetch` bez słów „Nic nie zostało
  zapisane".
- Stryker lokalnie, zawężony do `src/lib/audit/freshness.ts` i `src/lib/offer-refetch.ts`;
  każdy ocalały mutant oceniony według `### Mutation testing (Stryker)`, wynik nie jest
  celem.

### Integration Tests:

- Trasa pobrania z atrapą na krawędzi HTTP: każdy wiersz pierwszej tabeli, z liczbą żądań
  do otodom i zapisów do `offers`; zero żądań do `offer_notes` i `offer_audits`.
- Render przez Container API: `data-audit-freshness`, ostrzeżenie o utraconych polach,
  powiadomienie o duplikacie, statusy tablicy.
- Smoke: odmowy trasy sprzed pobrania, aktualność na karcie i tablicy przez Data API,
  notatki obu kont niezmienione po zmianie kolumn ogłoszenia.

### Manual Testing Steps:

1. Dodaj prawdziwe ogłoszenie, napisz notatkę, pobierz ponownie — komunikat, data, notatka.
2. Zapisz audyt (przez Data API albo własnym uruchomieniem), zmień limit na `/criteria` —
   znacznik na karcie i tablicy z powodem „kryteria".
3. Zmień tytuł oferty przez Data API — znacznik z powodem „ogłoszenie"; pobierz ponownie.
4. Wyczyść przez Data API pole, które otodom podaje, i pobierz — bez ostrzeżenia; ustaw
   pole, którego otodom nie podaje, i pobierz — ostrzeżenie z nazwą pola, potem
   świadome nadpisanie.
5. Wklej adres zapisanej oferty — powiadomienie o duplikacie z przyciskiem.

## Performance Considerations

Tablica wysyła jedno dodatkowe zapytanie o opisy ofert z wynikiem audytu i liczy dla
każdej SHA-256 przez Web Crypto. Dla zespołu trzech osób to dziesiątki ofert po kilka
kilobajtów; koszt rośnie liniowo z liczbą audytowanych ofert. To nie jest przejście po
treści pobranej strony, o którym mówi reguła o czasie CPU, ale jeśli tablica urośnie do
setek audytowanych ofert, właściwym krokiem jest sprawdzenie czasu CPU żądania
`/dashboard` w panelu Workers, a nie pamięć podręczna w zmiennej modułu. Pobranie mieści
się w tym samym limicie 45 s co dodawanie; świadome nadpisanie to drugie pobranie.

## Migration Notes

Brak migracji i brak zmian danych. Audyty zapisane przed tą zmianą mają już
`criteria_revision` i `listing_fingerprint` w wersji `v1`, więc dostają właściwy znacznik
od pierwszego wyświetlenia. Wdrożenie nie wymaga `supabase db push`.

## References

- Roadmapa: `context/foundation/roadmap.md`, S-09 i wiersz gotowości (issue #20)
- PRD: `context/foundation/prd.md` — FR-003, FR-005, FR-009, FR-010, Open Questions nr 1
- Trasa wzorcowa: `src/pages/api/offers.ts`
- Wzorzec wyspy formularza: `src/components/offers/AddOfferForm.tsx`
- Odcisk ogłoszenia: `src/lib/audit/input.ts:345`
- Odczyty audytu: `src/lib/audit/store.ts:290`, `:487`
- Wzorzec zakazu importu: `eslint.config.js:120`
- Wzorzec testu czystej reguły: `tests/lib/team-limits.test.ts`
- Wzorzec testu trasy: `tests/pages/api/offers.test.ts`, `tests/pages/api/criteria.test.ts`
- Lekcje: `context/foundation/lessons.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Reguły i odczyty

#### Automated

- [x] 1.1 Testy jednostkowe przechodzą: `npm test` — 0f57179
- [x] 1.2 Typy przechodzą: `npx astro sync && npx astro check` — 0f57179
- [x] 1.3 Lint przechodzi: `npm run lint` — 0f57179
- [x] 1.4 Stryker na regule aktualności nie zostawia nieocenionego ocalałego mutanta: `npx stryker run --mutate "src/lib/audit/freshness.ts"` — 0f57179
- [x] 1.5 Stryker na regule utraconych pól nie zostawia nieocenionego ocalałego mutanta: `npx stryker run --mutate "src/lib/offer-refetch.ts"` — 0f57179

#### Manual

- [x] 1.6 Karta oferty z audytem i tablica renderują się jak przed fazą (brak regresji po zmianie kształtu `AuditIndex`) — 0f57179

### Phase 2: Trasa ponownego pobrania

#### Automated

- [x] 2.1 Testy jednostkowe i testy trasy przechodzą: `npm test` — c06a498
- [x] 2.2 Typy przechodzą: `npx astro sync && npx astro check` — c06a498
- [x] 2.3 Lint przechodzi, a import `@/lib/notes` dodany na próbę w trasie go wywraca: `npm run lint` — c06a498
- [x] 2.4 Budowanie przechodzi bez sekretów: `npm run build` — c06a498

#### Manual

- [x] 2.5 Żądanie `POST /api/offer-refetch` bez sesji przekierowuje na `/auth/signin`, a z sesją i nieistniejącym `offer_id` wraca na `/dashboard` z komunikatem — c06a498

### Phase 3: Karta oferty

#### Automated

- [x] 3.1 Testy jednostkowe i testy renderu przechodzą: `npm test` — 1c557db
- [x] 3.2 Typy przechodzą: `npx astro sync && npx astro check` — 1c557db
- [x] 3.3 Lint przechodzi, w tym `tokensOnlyConfig`: `npm run lint` — 1c557db
- [x] 3.4 Budowanie przechodzi bez sekretów: `npm run build` — 1c557db

#### Manual

- [x] 3.5 `/dev/offer-card` pokazuje wszystkie nowe stany sekcji audytu, karty i powiadomienia o duplikacie, czytelne w ciemnym motywie — 1c557db
- [x] 3.6 `/dev/forms` pokazuje `RefetchForm` w czterech stanach — 1c557db
- [x] 3.7 Na lokalnej ofercie zmiana tytułu przez Data API oznacza audyt jako nieaktualny z powodu ogłoszenia, a zmiana limitu na `/criteria` — z powodu kryteriów
- [x] 3.8 Błąd edytora notatek nadal pojawia się przy edytorze, a nie w bloku pobrania — 1c557db

### Phase 4: Tablica

#### Automated

- [x] 4.1 Testy jednostkowe i testy renderu przechodzą: `npm test`
- [x] 4.2 Typy przechodzą: `npx astro sync && npx astro check`
- [x] 4.3 Lint przechodzi: `npm run lint`
- [x] 4.4 Budowanie przechodzi bez sekretów: `npm run build`

#### Manual

- [x] 4.5 `/dev/board` pokazuje pięć statusów audytu, rozróżnialnych bez koloru
- [ ] 4.6 Na lokalnej tablicy zmiana limitu na `/criteria` zmienia status audytowanej oferty na „nieaktualny"
- [x] 4.7 Sortowanie i znaczniki limitów działają jak przed fazą

### Phase 5: Smoke i dokumentacja

#### Automated

- [ ] 5.1 Testy jednostkowe przechodzą: `npm test`
- [ ] 5.2 Typy przechodzą: `npx astro sync && npx astro check`
- [ ] 5.3 Lint przechodzi: `npm run lint`
- [ ] 5.4 Budowanie przechodzi bez sekretów: `npm run build`
- [ ] 5.5 Skrypty bazy przechodzą bez zmian: `npm run test:db`
- [ ] 5.6 Smoke przechodzi na podglądzie produkcyjnym i lokalnym Supabase: `npm run smoke`

#### Manual

- [ ] 5.7 Ponowne pobranie prawdziwego ogłoszenia z karty lokalnej oferty kończy się komunikatem „bez zmian" albo „dane się zmieniły" i nową datą pobrania
- [ ] 5.8 Notatka dodana przed tym pobraniem czyta się po nim co do znaku tak samo, z tą samą datą edycji
- [ ] 5.9 Oferta z audytem, której tytuł zmieniono przez Data API, wraca do zgodności z otodom po pobraniu, a jej audyt jest oznaczony jako nieaktualny
- [ ] 5.10 Wklejenie adresu zapisanej oferty na `/dashboard` otwiera kartę z powiadomieniem o duplikacie, a przycisk w powiadomieniu pobiera dane ponownie
- [ ] 5.11 Pobranie oferty, której zapisany `source_url` zmieniono przez Data API na adres wygasłego ogłoszenia, zostawia kartę bez zmian i podaje przyczynę
