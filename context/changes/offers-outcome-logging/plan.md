# Wpis w logu dla każdego wyniku dodawania oferty — Implementation Plan

## Overview

Każde wyjście z `POST /api/offers` zostawia w Workers Logs jeden ustrukturyzowany
wpis: etap, powód, status z otodom, kod błędu bazy, id członka i ogłoszenia. Dziś
zapis, duplikat, odmowa, blokada otodom i błąd bazy to ta sama linia
`POST /api/offers → 302`. Przy okazji trzy komunikaty, które mówią nieprawdę albo
wskazują zły etap, dostają prawdziwą treść. Status 302 i cele przekierowań zostają.

To krok 1 z sekcji 6 raportu
`context/audits/observability/2026-10-05_add-offer-from-otodom.md`; zamyka A1, A2,
A3, A5, A7, A10, A11, A16 i A18.

## Current State Analysis

- W `src/` nie ma ani jednego wywołania `console.*` ani modułu logującego.
  `no-console` jest ostrzeżeniem (`eslint.config.js:25`).
- `src/pages/api/offers.ts` ma 13 wyjść (`:47-49`, `:52-54`, `:57-62`, `:65-67`,
  `:71-73`, `:74-76`, `:79-81`, `:91-95`, `:97` w trzech wariantach, `:100`).
  Wszystkie odpowiadają 302 przez `fail()` albo `context.redirect`.
- Błędy Supabase są sprawdzane jako prawda/fałsz: `existing.error` (`:71`),
  `inserted.error` (`:89`), `twin.error` (`:93`). Używany jest tylko
  `inserted.error.code` do rozgałęzienia na `23505` (`:91`).
- `ingestOffer` zwraca `{ ok: false, reason, status?, detail? }`
  (`src/lib/otodom/index.ts:12-14`). `failureMessage` czyta `reason` i `status`
  (`src/pages/api/offers.ts:80`); `detail` nie ma czytelnika poza
  `scripts/otodom-inspect.mjs:60`.
- `shape_changed` należy jednocześnie do `FetchFailureReason` i `MapFailureReason`
  (`src/lib/otodom/types.ts:9-14`), więc z samego `reason` nie da się odczytać etapu.
- `tests/pages/api/offers.test.ts` pokrywa cztery odmowy i udany zapis. Nie ma
  przypadku dla błędu pre-checku, błędu zapisu ani wyszukania bliźniaka
  (`src/pages/api/offers.ts:71-73,89-98`).
- Runbook wymaga logu, którego nie ma
  (`context/foundation/deployment-runbook.md:140-143`).

## Desired End State

Członek, który wkleja adres, widzi to samo co dziś — poza trzema przypadkami, w
których tekst był mylący. Osoba czytająca `npx wrangler tail --format json` albo
widok logów w panelu widzi dla każdego żądania wpis z polami, po których da się
filtrować:

- `event: "offer_add"` i `outcome`: `started`, `saved`, `duplicate`, `refused`
  albo `failed`;
- `stage`: `auth`, `config`, `body`, `url`, `precheck`, `fetch`, `map`, `insert`
  albo `twin`;
- `reason`, a przy pobraniu `status` z otodom i `detail` z mappera;
- przy błędzie bazy `db_code`, `db_message`, `db_hint`, `db_status`;
- `user_id`, `listing` (token `ID…` z końca sluga), `otodom_id`, `offer_id`.

Odmowa oczekiwana (`refused`) i sukcesy idą przez `console.info`, awaria
(`failed`) przez `console.error`. W żadnym wpisie nie ma `details` z Postgresa,
HTML strony, payloadu `ad`, opisu ani tytułu ogłoszenia, emaila ani pełnego adresu.

Weryfikacja: `npm test` (testy trasy sprawdzają wpis dla każdego wyjścia i brak
kanarków w konsoli), `npm run lint` (wywołanie `console` poza `src/lib/log.ts` jest
błędem), `npx astro check`, `npm run build`, `npm run smoke` bez zmian w skrypcie.

### Key Discoveries:

- Workers Logs indeksuje pola tylko wtedy, gdy logowany jest pojedynczy obiekt;
  tekst trafia do jednego pola `message` (dokumentacja Cloudflare, „Workers Logs →
  Logging structured JSON objects", sprawdzona 2026-10-05). Stąd jeden argument i
  płaskie klucze.
- `postgrest-js` 2.116.0 nigdy nie odrzuca obietnicy: błąd sieci to
  `{ error, status: 0 }` z pustym `code`
  (`node_modules/@supabase/postgrest-js/src/PostgrestBuilder.ts:292-354`). POST nie
  jest ponawiany, GET jest — do trzech razy przy odrzuconym `fetch`, 503 i 520
  (`src/fetchWithRetry.ts:95-125`).
- `error.details` z Postgresa przy naruszeniu `check` albo `not null` cytuje
  odrzucony wiersz, a więc opis ogłoszenia. `error.message` cytuje najwyżej nazwę
  ograniczenia albo wartość kolumny typowanej (liczba, data).
- `tests/fixtures/http.ts` pozwala odegrać każdą z brakujących gałęzi na krawędzi
  HTTP: `500` z `{ code, message }` daje od razu wynik z `error` (`:152-156`), a
  handler zwracający odrzuconą obietnicę daje `status: 0` bez oznaczenia żądania
  jako nieplanowane (`:53-57`).
- `tests/setup.ts` ustawia stan zero-config, a `tests/pages/api/offers.test.ts:21-24`
  nadpisuje go dla całego pliku — wyjście „brak konfiguracji" wymaga osobnego pliku
  testu.
- Jedynym konsumentem kształtu `IngestResult` poza trasą jest
  `tests/lib/otodom/fetch.test.ts:139-190`; `scripts/otodom-inspect.mjs:11-13`
  importuje `fetch.ts`, `map.ts` i `url.ts` bezpośrednio, nie `index.ts`.

## What We're NOT Doing

- Nagłówki `cf-mitigated` / `retry-after`, pod-powody `shape_changed` na granicy
  pobrania, rozbicie `network` i docelowy adres przekierowania (A4, A6, A15 — krok 3
  z audytu). Tu trafia tylko `stage`, bo bez niego wpis nie mówi, czy zawiódł
  parser strony, czy mapper.
- Sygnały dryfu mappera (A13, A14) i typ treści przy nieczytelnym body (A17). To
  wyjście dostaje wpis jak każde inne, bez `content_type`.
- `src/middleware.ts` (P1, P4), strony docelowe (A8, A9, P2), pozostałe trasy (P3,
  P6–P8), czasy trwania i opakowanie `fetch` w `createClient` (P9), klient (P10).
- Sentry i jakakolwiek nowa zależność. Reporter pisze przez `console`.
- Zmiana statusów odpowiedzi albo celów przekierowań. Zmieniają się wyłącznie trzy
  teksty w `?error=`.
- Zmiany w `scripts/smoke.mjs`: kontrakt trasy się nie zmienia, a nowe gałęzie
  wymagają awarii bazy, której smoke nie odgrywa.
- Bramka wizualna: nie dotyczy, żaden widok się nie zmienia. Nowe teksty renderuje
  istniejący stan błędu `AddOfferForm` (`/dev/forms`).
- Edycja raportu z audytu. Ponowne sprawdzenie to osobny przebieg
  `/10x-observability-audit --verify`.

## Implementation Approach

Najpierw sam reporter z białą listą egzekwowaną w czasie działania i reguła lint,
która czyni go jedynym ujściem — żeby żadna późniejsza faza nie mogła zalogować
czegoś obok niego. Potem trasa w dwóch krokach, każdy zaczynany od testu: najpierw
trzy gałęzie błędów bazy, które dziś nie mają żadnego pokrycia i tracą najwięcej
(kod błędu nie trafia nawet do `?error=`), potem pozostałe wyjścia i wynik
pobierania. Na końcu siatka: test przekrojowy prywatności, mutacje i dokumentacja.

Poziom wynika z `outcome`, a `outcome` dla powodów z `ingestOffer` z jednej tabeli
obok `failureMessage`. Dodanie powodu bez wpisu w tej tabeli nie przechodzi
`npx astro check`.

Kształt jest pojedynczym obiektem ze stałym `event`. Dokumentacja Sentry potwierdza
tylko tyle, że `captureConsoleIntegration` zamienia wywołanie konsoli na
`captureMessage`; jak buduje komunikat z obiektu, nie dało się sprawdzić bez
zainstalowanego SDK. Wszystkie wywołania `console` są w jednym module, więc zmiana
dodająca Sentry dostosuje kształt w jednym miejscu.

## Critical Implementation Details

**Kolejność wpisów.** Wpis `started` powstaje po pre-checku i tuż przed
`ingestOffer`: duplikat po adresie nigdy go nie zostawia, a wywołanie przerwane
przez platformę w trakcie 45 s pobierania zostawia ślad z `user_id` i `listing`.
Każdy inny wpis powstaje bezpośrednio przed `return`.

**Awarie bazy w testach.** Dla pre-checku i wyszukania bliźniaka test używa `500`
albo `401` z `{ code, message }`: odrzucony `fetch`, 503 i 520 są dla GET ponawiane
przez około 7 s. Brak odpowiedzi przy zapisie odgrywa handler zwracający odrzuconą
obietnicę — zwrócenie `undefined` oznaczyłoby żądanie jako nieplanowane i
`restoreFetch` wywróciłby test.

## Phase 1: Reporter i jedno ujście

### Overview

Powstaje `src/lib/log.ts` — jedyne miejsce w `src/`, które woła `console`. Biała
lista pól działa w czasie działania, nie tylko w typach.

### Changes Required:

#### 1. Test reportera

**File**: `tests/lib/log.test.ts` (nowy)

**Intent**: Udowodnić, zanim powstanie moduł, że reporter wypuszcza wyłącznie pola
z białej listy i wyłącznie wartości proste.

**Contract**: Przypadki z „Test contract" poniżej. Konsola szpiegowana przez
`vi.spyOn`, przywracana po każdym teście; oczekiwane obiekty wpisane ręcznie.

#### 2. Pomocnik testowy konsoli

**File**: `tests/fixtures/console.ts` (nowy)

**Intent**: Jeden sposób przechwytywania konsoli dla testów reportera i trasy, żeby
asercje o wpisach i o braku kanarków czytały to samo.

**Contract**: `captureConsole()` szpieguje `log`, `info`, `warn`, `error` i `debug`,
ucisza je i zwraca `entries()` — listę `{ method, args }` w kolejności wywołań —
oraz `text()`, czyli wszystkie argumenty zserializowane do jednego tekstu.
`restoreConsole()` przywraca oryginały; testy wołają go w `afterEach`.

#### 3. Reporter

**File**: `src/lib/log.ts` (nowy)

**Intent**: Zapisać jedno zdarzenie jako jeden obiekt, z którego nie da się
przypadkiem wypuścić danych spoza listy.

**Contract**: `logEvent(level: "info" | "error", fields: LogFields): void`.
`LogFields` ma wymagane `event` i opcjonalne `outcome`, `stage`, `reason`, `status`,
`detail`, `db_code`, `db_message`, `db_hint`, `db_status`, `user_id`, `listing`,
`otodom_id`, `offer_id`. Moduł trzyma stałą listę tych kluczy i buduje wpis,
przechodząc po niej, nigdy po kluczach wejścia. Wartość trafia do wpisu tylko jako
niepusty tekst, skończona liczba albo wartość logiczna; tekst jest przycinany do
300 znaków. Wpis dostaje pole `level`. Dokładnie jedno wywołanie, z jednym
argumentem: `console.info` dla `info`, `console.error` dla `error`. Bez importów
wykonawczych i bez stanu w zakresie modułu.

#### 4. Reguła lint

**File**: `eslint.config.js`

**Intent**: Uczynić reporter jedynym ujściem na poziomie narzędzia, nie umowy.

**Contract**: `no-console` staje się błędem dla `src/`, z wyłączeniem
`src/lib/log.ts`. Blok dla skryptów (`:108-109`) zostaje bez zmian.

### Test contract

| Przypadek                                                      | Oczekiwanie                                                                                                        |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `info` z `event`, `outcome`, `user_id`                         | jedno `console.info`, jeden argument równy `{ level: "info", event, outcome, user_id }`; `console.error` niewołane |
| `error` z `db_code`, `db_status: 0`                            | jedno `console.error`; `db_status: 0` jest we wpisie (zero to wartość, nie brak)                                   |
| pola `undefined`, `null`, pusty tekst                          | klucza nie ma we wpisie                                                                                            |
| klucz spoza listy (`details`, `email`) podany przez rzutowanie | klucza nie ma we wpisie                                                                                            |
| wartość będąca obiektem albo tablicą pod kluczem z listy       | klucza nie ma we wpisie                                                                                            |
| `NaN` i `Infinity` pod `status`                                | klucza nie ma we wpisie                                                                                            |
| `db_message` dłuższy niż 300 znaków                            | we wpisie dokładnie 300 pierwszych znaków                                                                          |

### Success Criteria:

#### Automated Verification:

- `npx vitest run tests/lib/log.test.ts` przechodzi, a przed dodaniem `src/lib/log.ts` był czerwony
- `npm test` przechodzi
- `npm run lint` przechodzi z `no-console` jako błędem w `src/`
- Wywołanie `console.log` dopisane na próbę w `src/pages/api/offers.ts` wywraca `npm run lint`, po czym zostaje usunięte
- `npx astro sync && npx astro check` przechodzi

**Implementation Note**: Po przejściu weryfikacji automatycznej tej fazy można
przejść dalej; faza nie ma kroków ręcznych. Bloki faz używają zwykłych punktów —
pola wyboru są w sekcji `## Progress` na końcu planu.

---

## Phase 2: Błędy bazy w trasie

### Overview

Trzy gałęzie bez pokrycia — pre-check, zapis, wyszukanie bliźniaka — dostają testy,
wpisy z kodem błędu i prawdziwe komunikaty. Zamyka A2, A7, A10, A16.

### Changes Required:

#### 1. Testy gałęzi błędów

**File**: `tests/pages/api/offers.test.ts`

**Intent**: Zapisać oczekiwane zachowanie każdej gałęzi — przekierowanie, tekst i
wpis w logu — zanim trasa zacznie cokolwiek logować.

**Contract**: Nowy `describe` z przypadkami z „Test contract" poniżej. `submit`
przyjmuje użytkownika z polem `email`, żeby późniejsze asercje prywatności miały
co wykryć. Handlery budowane z `stubFetch`, `jsonResponse`, `isOffersRequest` i
`isOtodomRequest`; nic w `@/lib/*` nie jest mockowane. Konsola przez
`captureConsole`.

#### 2. Token ogłoszenia

**File**: `src/pages/api/offers.ts`

**Intent**: Dać wpisowi identyfikator ogłoszenia, który nie niesie słów z tytułu.

**Contract**: Lokalna funkcja zwracająca token `ID…` z końca sluga znormalizowanego
adresu (`mieszkanie-54-m-warszawa-IDKANAR1` → `IDKANAR1`) albo `undefined`, gdy
slug go nie ma. Pełny adres i slug nigdy nie trafiają do wpisu.

#### 3. Wpisy i teksty dla błędów bazy

**File**: `src/pages/api/offers.ts`

**Intent**: Przestać wyrzucać obiekt błędu Supabase i przestać mówić członkowi coś,
czego trasa nie wie.

**Contract**: Każde wyjście poniżej woła `logEvent` raz, tuż przed `return`.
`db_*` pochodzą z `error.code`, `error.message`, `error.hint` i `status` wyniku;
`error.details` nie jest czytane nigdzie.

| Wyjście                                | `outcome` / `stage` / `reason`             | Poziom | Pola                                                         | Tekst w `?error=`                                                                                             |
| -------------------------------------- | ------------------------------------------ | ------ | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| Pre-check zwrócił błąd                 | `failed` / `precheck` / `precheck_failed`  | error  | `db_*`, `user_id`, `listing`                                 | „Nie udało się sprawdzić, czy ta oferta jest już zapisana. Niczego nie pobrano — spróbuj ponownie za chwilę." |
| Duplikat po adresie                    | `duplicate` / `precheck` / —               | info   | `offer_id`, `user_id`, `listing`                             | bez zmian (`?duplicate=1`)                                                                                    |
| Zapis bez odpowiedzi (`status === 0`)  | `failed` / `insert` / `insert_unconfirmed` | error  | `db_message`, `db_status`, `user_id`, `listing`, `otodom_id` | „Nie udało się potwierdzić zapisu oferty. Sprawdź listę ofert, zanim dodasz ją ponownie."                     |
| Zapis odrzucony, kod inny niż `23505`  | `failed` / `insert` / `insert_failed`      | error  | `db_*`, `user_id`, `listing`, `otodom_id`                    | `SAVE_FAILED`, bez zmian                                                                                      |
| `23505`, bliźniak znaleziony           | `duplicate` / `twin` / —                   | info   | `offer_id`, `user_id`, `listing`, `otodom_id`                | bez zmian (`?duplicate=1`)                                                                                    |
| `23505`, odczyt bliźniaka zwrócił błąd | `failed` / `twin` / `twin_lookup_failed`   | error  | `db_*` odczytu, `user_id`, `listing`, `otodom_id`            | „To ogłoszenie jest już zapisane, ale nie udało się otworzyć jego karty. Poszukaj go na liście ofert."        |
| `23505`, bliźniaka nie widać           | `failed` / `twin` / `twin_missing`         | error  | `user_id`, `listing`, `otodom_id`                            | ten sam tekst co wyżej                                                                                        |

Komentarz nad `failureMessage` („One reason, one distinguishable message") pozostaje
prawdziwy: trzy nowe stałe stoją obok `SAVE_FAILED` i `NOT_CONFIGURED`.

### Test contract

Wszystkie przypadki zaczynają od `PASTED_URL` i użytkownika `USER_ID`. Asercje o
wpisach po pre-checku czytają wpis końcowy i nie liczą wpisów — faza 3 dodaje przed
nim `started`.

| Przypadek                     | Odpowiedzi stubu                                                                                   | Oczekiwanie                                                                                                                                                                                                                                                                                                                   |
| ----------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pre-check zawodzi             | GET `offers` → `401 { code: "PGRST301", message: "JWT expired" }`                                  | cel `/dashboard`, tekst zawiera „sprawdzić, czy ta oferta jest już zapisana"; zero żądań do otodom, zero insertów; dokładnie jeden wpis, `console.error`, z `stage: "precheck"`, `reason: "precheck_failed"`, `db_code: "PGRST301"`, `db_message: "JWT expired"`, `db_status: 401`, `user_id: USER_ID`, `listing: "IDKANAR1"` |
| Zapis odrzucony przez RLS     | insert → `403 { code: "42501", message: … }`                                                       | tekst `SAVE_FAILED` jak dziś; wpis `error` z `stage: "insert"`, `reason: "insert_failed"`, `db_code: "42501"`, `db_status: 403`, `otodom_id` z fixture                                                                                                                                                                        |
| Zapis odrzucony przez `check` | insert → `400 { code: "23514", message: …, details: "Failing row contains (… <CANARY_PHONE> …)" }` | wpis z `db_code: "23514"`; `text()` konsoli nie zawiera „Failing row" ani kanarka                                                                                                                                                                                                                                             |
| Zapis bez odpowiedzi          | insert → odrzucona obietnica                                                                       | tekst zawiera „potwierdzić zapisu"; wpis `reason: "insert_unconfirmed"`, `db_status: 0`, bez `db_code`                                                                                                                                                                                                                        |
| Bliźniak znaleziony           | insert → `409 { code: "23505", … }`, GET po `otodom_id` → `[{ id }]`                               | cel `/offers/<id>` z `duplicate=1`; wpis `info`, `outcome: "duplicate"`, `stage: "twin"`, `offer_id`                                                                                                                                                                                                                          |
| Bliźniaka nie widać           | insert → `409 23505`, GET po `otodom_id` → `[]`                                                    | tekst zawiera „jest już zapisane"; wpis `error`, `reason: "twin_missing"`                                                                                                                                                                                                                                                     |
| Odczyt bliźniaka zawodzi      | insert → `409 23505`, GET po `otodom_id` → `500 { code: "XX000", … }`                              | ten sam tekst; wpis `reason: "twin_lookup_failed"`, `db_code: "XX000"`, `db_status: 500`                                                                                                                                                                                                                                      |
| Duplikat po adresie           | GET po `source_url` → `[{ id }]`                                                                   | cel `/offers/<id>` z `duplicate=1`; jeden wpis `info`, `stage: "precheck"`; zero żądań do otodom                                                                                                                                                                                                                              |

### Success Criteria:

#### Automated Verification:

- Nowe przypadki w `tests/pages/api/offers.test.ts` są czerwone przed zmianą trasy i zielone po niej
- `npm test` przechodzi, w tym dotychczasowe przypadki trasy bez zmiany ich asercji
- `npm run lint` przechodzi
- `npx astro sync && npx astro check` przechodzi

**Implementation Note**: Faza nie ma kroków ręcznych — awarii bazy nie da się
wywołać lokalnie bez zatrzymania Supabase, a wtedy middleware odsyła do logowania,
zanim trasa dojdzie do pre-checku (P1 z audytu, poza zakresem).

---

## Phase 3: Pozostałe wyjścia i wynik pobierania

### Overview

Wynik `ingestOffer` niesie etap, każdy powód ma przypisany `outcome`, a pozostałe
wyjścia trasy dostają wpisy. Zamyka A1, A3, A5, A11, A18.

### Changes Required:

#### 1. Etap w wyniku pobierania

**File**: `src/lib/otodom/index.ts`

**Intent**: Pozwolić wywołującemu odróżnić `shape_changed` z parsowania strony od
`shape_changed` z mappera bez zgadywania po `detail`.

**Contract**: Wariant porażki `IngestResult` zyskuje wymagane pole
`stage: "url" | "fetch" | "map"`, ustawiane tam, gdzie powstaje porażka. Typ etapu
jest eksportowany. Wariant sukcesu i `fetchOfferAd` / `mapAdToOffer` /
`normalizeOfferUrl` bez zmian.

#### 2. Testy `ingestOffer`

**File**: `tests/lib/otodom/fetch.test.ts`

**Intent**: Zapisać nowe pole w istniejących oczekiwaniach — wymaganie się zmieniło,
więc asercje dokładnej równości dostają `stage` — i dodać przypadek, którego dotąd
nie dało się wyrazić.

**Contract**: Każda porażka w `describe("ingestOffer…")` oczekuje swojego `stage`.
Nowa para: strona bez `__NEXT_DATA__` daje `stage: "fetch"`, a ogłoszenie bez tytułu
daje `stage: "map"` — obie z `reason: "shape_changed"`.

#### 3. Testy pozostałych wyjść

**File**: `tests/pages/api/offers.test.ts`,
`tests/pages/api/offers.unconfigured.test.ts` (nowy)

**Intent**: Dopisać do istniejących przypadków asercję o wpisie i pokryć wyjścia,
które nie mają dziś testu.

**Contract**: Przypadki z „Test contract" poniżej. Nowy plik nie nadpisuje
`astro:env/server`, więc działa w stanie zero-config z `tests/setup.ts`.

#### 4. Tabela powód → wynik i wpisy

**File**: `src/pages/api/offers.ts`

**Intent**: Rozdzielić odmowy oczekiwane od awarii w jednym miejscu, obok tekstów,
i zalogować każde pozostałe wyjście.

**Contract**: Obok `failureMessage` powstaje przypisanie każdego
`IngestFailureReason` do `refused` albo `failed`, wyczerpujące tak samo jak
`failureMessage` (nowy powód bez wpisu nie przechodzi `npx astro check`):

- `refused` (info): `empty`, `malformed`, `foreign_host`, `not_an_offer`,
  `not_for_sale`, `not_a_flat`, `not_found`, `expired`;
- `failed` (error): `http_denied`, `upstream_error`, `shape_changed`, `timeout`,
  `network`.

Wyjścia:

| Wyjście                      | `outcome` / `stage` / `reason`                  | Poziom   | Pola                                          |
| ---------------------------- | ----------------------------------------------- | -------- | --------------------------------------------- |
| Brak użytkownika             | `refused` / `auth` / `signed_out`               | info     | —                                             |
| Supabase nieskonfigurowany   | `refused` / `config` / `unconfigured`           | info     | `user_id`                                     |
| Body nie jest formularzem    | `refused` / `body` / `unreadable_body`          | info     | `user_id`                                     |
| Adres odrzucony przed siecią | `refused` / `url` / powód z `normalizeOfferUrl` | info     | `user_id`                                     |
| Tuż przed `ingestOffer`      | `started` / `fetch` / —                         | info     | `user_id`, `listing`                          |
| Porażka `ingestOffer`        | z tabeli / `result.stage` / `result.reason`     | z tabeli | `status`, `detail`, `user_id`, `listing`      |
| Zapisano                     | `saved` / `insert` / —                          | info     | `offer_id`, `otodom_id`, `user_id`, `listing` |

`status` trafia do wpisu zawsze, gdy wynik go niesie — także dla 404 i 410, których
tekst dla członka nie pokazuje. Teksty i cele przekierowań tych wyjść bez zmian.

### Test contract

| Przypadek                                | Oczekiwany wpis końcowy                                                                                                                                 |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mieszkanie na wynajem                    | `info`, `refused` / `map` / `not_for_sale`                                                                                                              |
| Dom na sprzedaż                          | `info`, `refused` / `map` / `not_a_flat`, `detail` równy tokenowi `ProperType` z fixture                                                                |
| Strona bez `__NEXT_DATA__`               | `error`, `failed` / `fetch` / `shape_changed`                                                                                                           |
| Ogłoszenie bez tytułu                    | `error`, `failed` / `map` / `shape_changed`, `detail: "id, title, url or description missing"`                                                          |
| HTTP 403 z otodom                        | `error`, `failed` / `fetch` / `http_denied`, `status: 403`                                                                                              |
| HTTP 404 z otodom                        | `info`, `refused` / `fetch` / `not_found`, `status: 404`                                                                                                |
| Adres z innego hosta                     | `info`, `refused` / `url` / `foreign_host`; jeden wpis, zero żądań sieciowych                                                                           |
| Udany zapis                              | dwa wpisy, oba `info`: `started` / `fetch`, potem `saved` / `insert` z `offer_id: INSERTED_OFFER_ID` i `otodom_id` z fixture; `console.error` niewołane |
| Brak użytkownika                         | `info`, `refused` / `auth` / `signed_out`, bez `user_id`; cel `/auth/signin`                                                                            |
| Body nie jest formularzem                | `info`, `refused` / `body` / `unreadable_body`                                                                                                          |
| Supabase nieskonfigurowany (osobny plik) | `info`, `refused` / `config` / `unconfigured`; zero żądań sieciowych                                                                                    |

Każda porażka po pre-checku ma przed wpisem końcowym wpis `started`; odmowy przed
siecią i duplikat po adresie go nie mają.

### Success Criteria:

#### Automated Verification:

- Nowe i rozszerzone przypadki w `tests/pages/api/offers.test.ts`, `tests/pages/api/offers.unconfigured.test.ts` i `tests/lib/otodom/fetch.test.ts` są czerwone przed zmianą i zielone po niej
- `npm test` przechodzi
- `npm run lint` przechodzi
- `npx astro sync && npx astro check` przechodzi, a usunięcie na próbę jednego powodu z tabeli powód → wynik go wywraca
- `npm run build` przechodzi
- `npm run smoke` przechodzi bez zmian w `scripts/smoke.mjs`

#### Manual Verification:

- W `npm run dev` z lokalnym Supabase adres z olx.pl daje w terminalu jeden wpis `refused` / `url` / `foreign_host`, a formularz pokazuje ten sam komunikat co przed zmianą
- Wklejenie jednego prawdziwego ogłoszenia sprzedaży mieszkania daje wpisy `started` i `saved`, a ponowne wklejenie tego samego adresu wpis `duplicate`; żaden wpis nie zawiera tytułu, opisu ani pełnego adresu ogłoszenia

**Implementation Note**: Po przejściu weryfikacji automatycznej zatrzymaj się na
potwierdzenie kroków ręcznych przez człowieka, zanim zaczniesz fazę 4.

---

## Phase 4: Dowód prywatności, mutacje, dokumentacja

### Overview

Siatka pod całą zmianą: test, który przechodzi przez wszystkie wyjścia i szuka w
konsoli tego, czego tam nie może być; mutacje zawężone do dwóch plików; reguła i
runbook zgodne z kodem.

### Changes Required:

#### 1. Test przekrojowy prywatności

**File**: `tests/pages/api/offers.test.ts`

**Intent**: Jedna asercja, która zawiedzie, gdy ktokolwiek dopisze do wpisu pole
niosące dane ogłoszenia, sprzedającego albo członka.

**Contract**: Nowy `describe`, który odgrywa po jednym scenariuszu na każdy `stage`
(w tym udany zapis z `flatSaleAd()` i zapis odrzucony z `details` zawierającym
kanarka) i sprawdza, że `text()` konsoli nie zawiera: żadnego z `SELLER_CANARIES`,
`CANARY_PHONE`, `CANARY_NAME`, emaila użytkownika testowego, tytułu z fixture,
parametru `utm_source` z wklejonego adresu ani słów ze sluga poza tokenem `ID…`.

#### 2. Dziennik mutantów

**File**: `context/changes/offers-outcome-logging/mutation.md` (nowy)

**Intent**: Sprawdzić, że testy z faz 1–3 rzeczywiście trzymają białą listę,
poziomy i teksty, i zapisać decyzję dla każdego ocalałego mutanta.

**Contract**: Przebieg
`npx stryker run --mutate "src/lib/log.ts,src/pages/api/offers.ts,src/lib/otodom/index.ts"`.
Format i trzy decyzje (asercja / równoważny / świadomie pominięty) jak w
`context/archive/2026-10-01-testing-read-failure-states/mutation.md`. Kryterium to
brak mutanta bez decyzji, nie próg liczbowy.

#### 3. Reguła w CLAUDE.md

**File**: `CLAUDE.md`

**Intent**: Żeby następna trasa logowała tak samo, a nie wymyślała drugiego stylu.

**Contract**: Jeden punkt w `## Conventions`, nazywający instancje referencyjne:
`src/lib/log.ts` jako jedyny moduł w `src/` wołający `console` (`no-console` jest
błędem wszędzie indziej), `src/pages/api/offers.ts` jako referencja trasy, która
loguje każde wyjście jednym wpisem, oraz zasada pól: identyfikatory, kody i tokeny
z białej listy — nigdy `details` z Postgresa, HTML strony, payload `ad`, email ani
query string; odmowa oczekiwana to `info`, awaria to `error`. Bez liczb i bez
parafrazy kodu (CLAUDE.md, Conventions, ostatni punkt).

#### 4. Runbook

**File**: `context/foundation/deployment-runbook.md`

**Intent**: Zastąpić polecenie „loguj" opisem logu, który istnieje, i sposobem jego
czytania.

**Contract**: W „### Ingestion starts failing (otodom)" akapit o logowaniu statusów
mówi, że trasa je loguje, i podaje rozróżnienie: `reason: "http_denied"` ze
`status` to odmowa portalu, `reason: "shape_changed"` ze `stage: "fetch"` to strona
bez danych, ze `stage: "map"` to zmieniony payload. Sekcja „## Logs" dostaje jedno
zdanie o `event: "offer_add"`. Uzasadnienie i procedura sondy bez zmian.

#### 5. Wzorzec w planie testów

**File**: `context/foundation/test-plan.md`

**Intent**: Żeby test kolejnej logującej trasy powstał według tego samego wzoru.

**Contract**: Nowy podpunkt w §6 po 6.8: test wpisu w logu — `captureConsole` z
`tests/fixtures/console.ts`, oczekiwany wpis wpisany ręcznie, asercja braku danych
obok asercji obecności pól, `tests/pages/api/offers.test.ts` jako referencja.
Rejestr świeżości (§8) według konwencji tego pliku.

### Success Criteria:

#### Automated Verification:

- `npm test` przechodzi z testem przekrojowym prywatności
- Próba: `error.details` przekazane z trasy do `logEvent` nie zmienia wyjścia konsoli (reporter je odrzuca), a po dopisaniu klucza `details` także do białej listy reportera testy prywatności są czerwone; obie zmiany zostają cofnięte
- Przebieg Strykera zawężony do trzech plików kończy się, a `mutation.md` ma decyzję dla każdego ocalałego i niepokrytego mutanta
- `npm run lint` przechodzi
- `npx astro sync && npx astro check` przechodzi
- `npm run build` przechodzi

#### Manual Verification:

- Dziennik mutantów przeczytany: decyzje „świadomie pominięty" mają powód, z którym się zgadzasz
- Punkt w `CLAUDE.md` i akapit w runbooku opisują to, co robi kod, i nie powtarzają go

**Implementation Note**: Po przejściu weryfikacji automatycznej zatrzymaj się na
potwierdzenie kroków ręcznych przez człowieka.

---

## Testing Strategy

### Unit Tests:

- `tests/lib/log.test.ts` — biała lista w czasie działania, poziom, przycinanie,
  zero jako wartość.
- `tests/lib/otodom/fetch.test.ts` — `stage` dla każdej porażki `ingestOffer`.

### Integration Tests:

- `tests/pages/api/offers.test.ts` — trasa z prawdziwymi `@/lib/supabase` i
  `@/lib/otodom`, sieć zastąpiona na krawędzi HTTP: wpis dla każdego wyjścia, trzy
  nowe teksty, brak danych w konsoli.
- `tests/pages/api/offers.unconfigured.test.ts` — wyjście zero-config.
- `npm run smoke` — regresja kontraktu trasy, bez nowych kroków.

### Manual Testing Steps:

1. `npm run dev` z lokalnym Supabase, logowanie kontem z `supabase/seed.sql`.
2. Adres z olx.pl: jeden wpis `refused` w terminalu, komunikat bez zmian.
3. Jedno prawdziwe ogłoszenie sprzedaży mieszkania: `started`, potem `saved`.
4. Ten sam adres ponownie: `duplicate`.
5. Po najbliższym wdrożeniu, poza tą zmianą: `npx wrangler tail --format json`
   pokazuje pola wpisu jako osobne klucze.

## Performance Considerations

Najwyżej dwa wywołania `console` na żądanie i jeden mały obiekt — bez wpływu na
limit CPU. Workers Logs na planie Free przyjmuje 200 tys. zdarzeń dziennie
(`context/foundation/deployment-runbook.md:105`); dodawanie ofert przez kilkuosobowy
zespół zostaje o rzędy wielkości poniżej.

## Migration Notes

Brak migracji bazy i brak zmian w konfiguracji. Zmiana nie wymaga `supabase db push`.

## References

- Audyt: `context/audits/observability/2026-10-05_add-offer-from-otodom.md`
  (sekcje 5 i 6)
- Trasa: `src/pages/api/offers.ts:43-101`
- Wynik pobierania: `src/lib/otodom/index.ts:12-32`, `src/lib/otodom/types.ts:5-14`
- Wzorzec testu trasy: `tests/pages/api/offers.test.ts`, `tests/fixtures/http.ts`
- Wzorzec dziennika mutantów:
  `context/archive/2026-10-01-testing-read-failure-states/mutation.md`
- Wymaganie runbooka: `context/foundation/deployment-runbook.md:140-143`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Reporter i jedno ujście

#### Automated

- [x] 1.1 `npx vitest run tests/lib/log.test.ts` przechodzi, a przed dodaniem `src/lib/log.ts` był czerwony — 53273ea
- [x] 1.2 `npm test` przechodzi — 53273ea
- [x] 1.3 `npm run lint` przechodzi z `no-console` jako błędem w `src/` — 53273ea
- [x] 1.4 Wywołanie `console.log` dopisane na próbę w `src/pages/api/offers.ts` wywraca `npm run lint`, po czym zostaje usunięte — 53273ea
- [x] 1.5 `npx astro sync && npx astro check` przechodzi — 53273ea

### Phase 2: Błędy bazy w trasie

#### Automated

- [x] 2.1 Nowe przypadki w `tests/pages/api/offers.test.ts` są czerwone przed zmianą trasy i zielone po niej
- [x] 2.2 `npm test` przechodzi, w tym dotychczasowe przypadki trasy bez zmiany ich asercji
- [x] 2.3 `npm run lint` przechodzi
- [x] 2.4 `npx astro sync && npx astro check` przechodzi

### Phase 3: Pozostałe wyjścia i wynik pobierania

#### Automated

- [ ] 3.1 Nowe i rozszerzone przypadki w `tests/pages/api/offers.test.ts`, `tests/pages/api/offers.unconfigured.test.ts` i `tests/lib/otodom/fetch.test.ts` są czerwone przed zmianą i zielone po niej
- [ ] 3.2 `npm test` przechodzi
- [ ] 3.3 `npm run lint` przechodzi
- [ ] 3.4 `npx astro sync && npx astro check` przechodzi, a usunięcie na próbę jednego powodu z tabeli powód → wynik go wywraca
- [ ] 3.5 `npm run build` przechodzi
- [ ] 3.6 `npm run smoke` przechodzi bez zmian w `scripts/smoke.mjs`

#### Manual

- [ ] 3.7 W `npm run dev` z lokalnym Supabase adres z olx.pl daje w terminalu jeden wpis `refused` / `url` / `foreign_host`, a formularz pokazuje ten sam komunikat co przed zmianą
- [ ] 3.8 Wklejenie jednego prawdziwego ogłoszenia sprzedaży mieszkania daje wpisy `started` i `saved`, a ponowne wklejenie tego samego adresu wpis `duplicate`; żaden wpis nie zawiera tytułu, opisu ani pełnego adresu ogłoszenia

### Phase 4: Dowód prywatności, mutacje, dokumentacja

#### Automated

- [ ] 4.1 `npm test` przechodzi z testem przekrojowym prywatności
- [ ] 4.2 Próba: `error.details` przekazane z trasy do `logEvent` nie zmienia wyjścia konsoli (reporter je odrzuca), a po dopisaniu klucza `details` także do białej listy reportera testy prywatności są czerwone; obie zmiany zostają cofnięte
- [ ] 4.3 Przebieg Strykera zawężony do trzech plików kończy się, a `mutation.md` ma decyzję dla każdego ocalałego i niepokrytego mutanta
- [ ] 4.4 `npm run lint` przechodzi
- [ ] 4.5 `npx astro sync && npx astro check` przechodzi
- [ ] 4.6 `npm run build` przechodzi

#### Manual

- [ ] 4.7 Dziennik mutantów przeczytany: decyzje „świadomie pominięty" mają powód, z którym się zgadzasz
- [ ] 4.8 Punkt w `CLAUDE.md` i akapit w runbooku opisują to, co robi kod, i nie powtarzają go
