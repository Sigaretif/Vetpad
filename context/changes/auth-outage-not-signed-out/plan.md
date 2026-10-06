# Awaria Supabase Auth odróżniona od braku sesji — Implementation Plan

## Overview

`src/middleware.ts` przestaje zamieniać każdy błąd Supabase Auth na „wylogowany”.
Wynik `getUser()` trafia do jednej z trzech klas — brak sesji, sesja odrzucona,
awaria — i tylko awaria jest awarią: wpis `error` w logu i strona ze statusem 503
zamiast przekierowania na logowanie. Nieprzechwycony wyjątek dostaje wpis z trasą,
metodą i `user_id`, zostaje odpowiedzią 500, a członek widzi stronę zamiast pustej
odpowiedzi.

To krok 1 z sekcji 6 raportu
`context/audits/observability/2026-10-05_verify-add-offer-from-otodom.md`; zamyka P1
i P4 opisane w `context/audits/observability/2026-10-05_add-offer-from-otodom.md`
(sekcja 5, Platform / plumbing).

## Current State Analysis

- `src/middleware.ts:10-13` czyta `data.user` z `supabase.auth.getUser()` i nie
  czyta `error`. Każdy błąd daje `locals.user = null`.
- Dla `null` trasy z `PROTECTED_ROUTES` (`src/middleware.ts:4,22-26`) przekierowują
  na `/auth/signin`. Cztery trasy zapisu robią to same: `src/pages/api/offers.ts:98-102`,
  `src/pages/api/notes.ts:31-34`, `src/pages/api/criteria.ts:37-40`,
  `src/pages/api/requirements.ts:37-40`. Tylko pierwsza loguje — jako
  `refused` / `auth` / `signed_out` na poziomie `info`.
- `next()` nie jest opakowane (`src/middleware.ts:28`). Jedyną granicą przechwycenia
  jest Astro (`node_modules/astro/dist/core/routing/handler.js:101-108`): loguje sam
  stos i renderuje 500. `src/pages/500.astro` nie istnieje, więc odpowiedź jest pusta.
- Klasyfikacja awarii Auth istnieje w jednym miejscu, jako warunek wewnątrz
  `signInErrorMessage` (`src/pages/api/auth/signin.ts:9`): błąd ponawialny, status
  ≥ 500 albo `AuthUnknownError`.
- Reporter `src/lib/log.ts` ma białą listę czternastu kluczy (`:9-24`); nie ma na
  niej trasy, metody, nazwy błędu ani pól Auth. Jego jedynym wywołującym jest
  `src/pages/api/offers.ts`.
- Middleware nie ma testu. `tests/` nie zawiera pliku, który importuje
  `src/middleware.ts`.
- `scripts/smoke.mjs` sprawdza przekierowania anonimowego gościa (`:579,634-657`) i
  działa przy żywym lokalnym Supabase, więc awarii Auth nie odegra.

## Desired End State

Żądanie z ciasteczkiem sesji kończy się jednym z trzech wyników:

| Klasa           | Kiedy                                                                                            | Co widzi członek                                                                | Wpis                                                     |
| --------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- | -------------------------------------------------------- |
| brak sesji      | brak ciasteczka; Auth odpowiada `session_not_found`                                              | to samo co dziś                                                                 | brak                                                     |
| sesja odrzucona | status 400–499 poza 429 (`refresh_token_not_found`, `bad_jwt`, `user_not_found`, `user_banned`…) | to samo co dziś: logowanie na trasach chronionych                               | `info`: `event: "auth_check"`, `outcome: "rejected"`     |
| awaria          | błąd sieci, 5xx, 540 uśpionego projektu, nieczytelna odpowiedź, 429, błąd bez statusu            | strona 503 na każdej ścieżce poza `/auth/*` i `/api/auth/*`; ciasteczko zostaje | `error`: `event: "auth_check"`, `outcome: "unavailable"` |

Oba wpisy niosą `route` (wzorzec trasy, np. `/offers/[id]`), `method`, `error_name`,
`auth_status` i `auth_code`. Zero-config (brak `SUPABASE_URL` / `SUPABASE_KEY`)
zostaje stanem: `locals.user = null`, żadnego wpisu.

Wyjątek rzucony w middleware, trasie albo stronie zostawia jeden wpis `error`:
`event: "request"`, `outcome: "unhandled"`, `route`, `method`, `error_name` i
`user_id`, gdy jest znany. Wyjątek leci dalej, odpowiedź ma status 500, a jej treścią
jest `src/pages/500.astro`.

W żadnym wpisie nie ma emaila, tokenu, wartości ciasteczka, query stringa, surowej
ścieżki ani komunikatu błędu.

Weryfikacja: `npm test` (testy middleware i klasyfikacji), `npm run lint`,
`npx astro sync && npx astro check`, `npm run build`, `npm run smoke` z nowymi
krokami, zrzuty bramki wizualnej, ręcznie odegrana awaria na lokalnym Supabase.

### Key Discoveries:

- `getUser()` nie rzuca dla błędów Auth — zwraca je jako `{ data: { user: null }, error }`,
  awarię sieci i 5xx też (`node_modules/@supabase/auth-js/src/GoTrueClient.ts:3245-3286`).
  Rzuca tylko błąd, który nie jest `AuthError` (`:3284`).
- Bez ciasteczka `getUser()` zwraca `AuthSessionMissingError` bez żadnego zapytania
  sieciowego (`GoTrueClient.ts:3262-3264`). Awarię widzi więc tylko ktoś, kto ma
  ciasteczko sesji; anonimowy gość nie zauważy zmiany.
- `session_not_found` jest zamieniane na `AuthSessionMissingError` już w bibliotece
  (`node_modules/@supabase/auth-js/src/lib/fetch.ts:138-143`). Pozostałe odrzucenia
  sesji to `AuthApiError` ze statusem 4xx i kodem.
- Błąd sieci to `AuthRetryableFetchError` ze statusem `0`; 500–504 i 520–530 to ten
  sam błąd ze swoim statusem (`lib/fetch.ts:72-100,228-236`). Uśpiony projekt
  odpowiada 540: `AuthApiError` bez kodu albo, dla treści HTML, `AuthUnknownError`
  bez statusu.
- Przy awarii ponawialnej biblioteka nie usuwa sesji; usuwa ją przy odrzuceniu
  refresh tokenu (`GoTrueClient.ts`, `_callRefreshToken`). Po powrocie Auth członek
  jest więc nadal zalogowany.
- `next("/ścieżka")` przepisuje żądanie bez ponownego uruchomienia middleware
  (`node_modules/astro/dist/core/middleware/astro-middleware.js:22-33`; dokumentacja
  Astro, „Middleware → Rewriting”). `context.rewrite()` uruchomiłby je ponownie.
- Astro przekierowuje na stronę błędu tylko odpowiedzi 404 i 500
  (`node_modules/astro/dist/core/constants.js:6`). 503 musi więc być zwykłą stroną,
  która sama ustawia status.
- Po wyjątku Astro renderuje `500.astro` w nowym przebiegu i uruchamia w nim
  middleware jeszcze raz, z `routePattern` równym `/500` i pierwotną ścieżką w
  `url.pathname` (`node_modules/astro/dist/core/errors/default-handler.js:64-76`,
  `core/fetch/fetch-state.js:411`). Gdy ten przebieg rzuci, Astro ponawia go bez
  middleware i niczego nie loguje (`default-handler.js:90-100`).
- Bezpośrednie żądanie `/500` trafia w tę samą stronę i dostaje status 500
  (`node_modules/astro/dist/core/routing/helpers.js:30-41`).
- Odświeżanie wygasłego tokenu ponawia próby do około 30 s
  (`GoTrueClient.ts:4777-4800`).

## What We're NOT Doing

- Pod-powody na granicy pobrania z otodom (A4, A6, A15) — następna zmiana.
- Odczyty karty i tablicy (A8, A9, P2, P11).
- Logowanie w pozostałych trasach (P3, P6, P7, P8). `src/pages/api/auth/signin.ts`
  zmienia tylko źródło predykatu awarii; nie zaczyna logować.
- Czasy trwania i opakowanie `fetch` w `createClient` (P9), w tym skrócenie
  30-sekundowego ponawiania odświeżenia tokenu.
- Klient: nasłuch `astro:hydration-error` i błędów przeglądarki (P10); strumieniowane
  komponenty (P5).
- Sentry i jakakolwiek nowa zależność.
- Zmiana kodu tras, które same sprawdzają `locals.user`. Middleware zatrzymuje awarię
  przed trasą, więc ich `signed_out` staje się prawdziwe bez dotykania ich.
- Nagłówek `Retry-After` i automatyczne odświeżanie strony 503.
- Komunikat błędu w logu — ani błędu Auth, ani wyjątku. Stos wyjątku loguje Astro w
  tym samym wywołaniu.
- Baner konfiguracji dla nieosiągalnej usługi: `src/lib/config-status.ts` nadal
  wykrywa tylko brak zmiennych.
- Edycja raportów z audytu. Ponowne sprawdzenie to osobny przebieg
  `/10x-observability-audit --verify`.

## Implementation Approach

Kolejność wynika z zależności. Najpierw klasyfikacja jako czysta funkcja i nowe
klucze reportera, bo middleware i jego testy z nich korzystają. Potem strony błędów
— `next("/503")` potrzebuje istniejącej trasy, a bramka wizualna dotyczy wyłącznie
ich. Dopiero wtedy middleware, zaczynane od czerwonego testu. Na końcu siatka: smoke,
próba wyjątku na zbudowanym podglądzie, mutacje i dokumentacja.

Klasyfikacja rozszerza wzorzec z `signInErrorMessage`, zamiast budować drugi: jego
warunek awarii staje się eksportowaną funkcją, z której korzystają obie strony.
Reguła domyka się w stronę awarii — „odrzucona” wymaga statusu 4xx, a wszystko, czego
nie da się rozpoznać, jest awarią: widoczną, zalogowaną, bez wylogowania.

Punkt (4) zakresu spełnia konstrukcja, nie zmiana tras: przy awarii middleware
odpowiada przed `next()` na każdej ścieżce poza `/auth/*` i `/api/auth/*`, więc
`src/pages/api/offers.ts` nigdy nie zobaczy `user: null` pochodzącego z awarii.
Dowodzi tego test middleware dla `POST /api/offers`.

`route` w logu to `context.routePattern`, nie `url.pathname`: wzorzec nie zawiera
tekstu od użytkownika ani query stringa i grupuje wpisy po trasie.

## Critical Implementation Details

**Drugi przebieg dla strony 500.** Gdy `routePattern` to `/500`, middleware nie pyta
Auth i nie stosuje reguł przekierowań ani 503 — inaczej każdy wyjątek kosztowałby
drugie zapytanie do Auth, a awaria w jego trakcie podmieniłaby stronę 500 stroną 503.
Opakowanie `next()` zostaje także tu: wyjątek z samej `500.astro` Astro połyka bez
logu, więc to jedyne miejsce, które go zapisze.

**Przepisanie żądania POST.** `next("/503")` buduje nowe żądanie ze starego i odczyt
treści po którejkolwiek stronie przepisania rzuca. Middleware nie czyta treści
żądania, a `503.astro` też nie może.

**Awarie w testach.** Test awarii używa ciasteczka z niewygasłym tokenem, żeby
biblioteka od razu zapytała `GET /auth/v1/user`. Wygasły token z odpowiedzią 5xx na
odświeżenie jest ponawiany około 30 s. Odrzucenie przez odświeżenie odgrywa status
400 z kodem `refresh_token_not_found` — nie jest ponawiane.

**Obca treść w konsoli.** `auth-js` potrafi sam napisać do konsoli (ostrzeżenie o
`getSession`, `console.error` przy nieudanym odtworzeniu sesji). Jeśli taki wpis
pojawi się w scenariuszu, test nazywa go wprost w oczekiwanej liście; nie filtruje
konsoli po `event`, bo wtedy asercja liczby wpisów przestaje cokolwiek znaczyć.

## Phase 1: Klasyfikacja błędów Auth i pola reportera

### Overview

Powstaje czysta funkcja, która mówi, czym jest błąd Auth, a reporter dostaje klucze,
których potrzebują wpisy middleware. Żadne zachowanie aplikacji się nie zmienia.

### Changes Required:

#### 1. Test klasyfikacji

**File**: `tests/lib/auth-error.test.ts` (nowy)

**Intent**: Ustalić trzy klasy, zanim powstanie moduł, na błędach zbudowanych z klas
`auth-js` — tak jak zwraca je `getUser()`.

**Contract**: Przypadki z „Test contract” poniżej, według wzorca testu czystej reguły
(`context/foundation/test-plan.md` §6.8, `tests/lib/team-limits.test.ts`): każdy
przypadek jednej klasy stoi obok przypadku granicznego innej, oczekiwane wartości
wpisane ręcznie.

#### 2. Moduł klasyfikacji

**File**: `src/lib/auth-error.ts` (nowy)

**Intent**: Jedno miejsce, które odróżnia awarię Auth od braku sesji i od sesji
odrzuconej, wspólne dla middleware i logowania.

**Contract**: `isAuthOutage(error: AuthError): boolean` — warunek przeniesiony bez
zmian z `src/pages/api/auth/signin.ts:9`. `classifyAuthError(error: AuthError):
"missing" | "rejected" | "unavailable"`, w tej kolejności: `isAuthSessionMissingError`
→ `missing`; `isAuthOutage` → `unavailable`; status od 400 do 499 różny od 429 →
`rejected`; wszystko inne → `unavailable`. Bez stanu w zakresie modułu.

#### 3. Logowanie korzysta ze wspólnego predykatu

**File**: `src/pages/api/auth/signin.ts`

**Intent**: Żeby warunek awarii istniał raz. Zachowanie trasy się nie zmienia.

**Contract**: `signInErrorMessage` woła `isAuthOutage` zamiast własnego warunku;
komentarz o statusie 540 przechodzi do `src/lib/auth-error.ts`. Teksty, kolejność
gałęzi i przekierowania bez zmian.

#### 4. Nowe klucze reportera

**File**: `src/lib/log.ts`, `tests/lib/log.test.ts`

**Intent**: Wpisy middleware mają trafić do logu przez białą listę, nie obok niej.

**Contract**: Lista `FIELDS` dostaje `route`, `method`, `error_name`, `auth_status`,
`auth_code`. `tests/lib/log.test.ts` dostaje przypadek, który podaje te pięć pól i
oczekuje całego wpisu wpisanego ręcznie, z `auth_status: 0` zachowanym jako wartość.
Przypadek powstaje przed zmianą listy.

### Test contract

| Błąd                                          | Klasa         |
| --------------------------------------------- | ------------- |
| `AuthSessionMissingError`                     | `missing`     |
| `AuthApiError` 400, `refresh_token_not_found` | `rejected`    |
| `AuthApiError` 403, `bad_jwt`                 | `rejected`    |
| `AuthApiError` 403, `user_not_found`          | `rejected`    |
| `AuthApiError` 499 bez kodu                   | `rejected`    |
| `AuthApiError` 429, `over_request_rate_limit` | `unavailable` |
| `AuthApiError` 500                            | `unavailable` |
| `AuthApiError` 540 bez kodu                   | `unavailable` |
| `AuthRetryableFetchError` ze statusem 0       | `unavailable` |
| `AuthRetryableFetchError` ze statusem 503     | `unavailable` |
| `AuthUnknownError`                            | `unavailable` |
| `AuthError` bez statusu                       | `unavailable` |

`isAuthOutage` dostaje własne przypadki: prawda dla czterech z powyższych (status 0,
503, 540, `AuthUnknownError`), fałsz dla 429 i dla 403.

### Success Criteria:

#### Automated Verification:

- `npx vitest run tests/lib/auth-error.test.ts` przechodzi, a przed dodaniem `src/lib/auth-error.ts` był czerwony
- Nowy przypadek w `tests/lib/log.test.ts` jest czerwony przed dopisaniem kluczy do białej listy i zielony po nim
- `npm test` przechodzi
- `npm run lint` przechodzi
- `npx astro sync && npx astro check` przechodzi

**Implementation Note**: Faza nie ma kroków ręcznych; po przejściu weryfikacji
automatycznej można przejść dalej. Bloki faz używają zwykłych punktów — pola wyboru
są w sekcji `## Progress` na końcu planu.

---

## Phase 2: Strony błędów i bramka wizualna

### Overview

Powstają dwa widoki — strona 500 i strona 503 — z jednego komponentu, strona
`/dev/errors`, na której da się je obejrzeć, oraz zestaw zrzutów. Middleware jeszcze
na nie nie kieruje; `/500` i `/503` działają tylko pod własnym adresem.

### Changes Required:

#### 1. Cel linku „Spróbuj ponownie”

**File**: `src/lib/error-pages.ts` (nowy), `tests/lib/error-pages.test.ts` (nowy)

**Intent**: Link na stronie 503 ma prowadzić tam, dokąd członek szedł, i nigdy poza
aplikację.

**Contract**: `retryHref(method: string, originPathname: string): string`. Zwraca
`originPathname` tylko dla metody `GET`, gdy ścieżka nie jest `/503`, nie zaczyna się
od `/api/`, nie zaczyna się od `//` i nie zawiera `\`; w każdym innym przypadku `/`.
Test powstaje pierwszy i obejmuje każdy z tych warunków obok ścieżki, która go nie
łamie (`/dashboard`, `/offers/<uuid>`).

#### 2. Komponent widoku

**File**: `src/components/ErrorPage.astro` (nowy)

**Intent**: Jeden widok dla obu stron i dla `/dev/errors`, zbudowany z tokenów ról i
komponentów `src/components/ui`.

**Contract**: Właściwości `variant: "500" | "503"` i `retryHref?: string`. Nie ma
właściwości na błąd ani jego treść. Element główny niesie `data-error-page` z
wartością wariantu. Teksty:

- 503 — nagłówek „Nie możemy teraz potwierdzić Twojej sesji”; treść „Usługa logowania
  chwilowo nie odpowiada. To nie jest wylogowanie — spróbuj ponownie za chwilę.”;
  link główny „Spróbuj ponownie” (`retryHref`), link drugorzędny „Przejdź do
  logowania” (`/auth/signin`).
- 500 — nagłówek „Coś poszło nie tak”; treść „Vetpad napotkał nieoczekiwany błąd.
  Spróbuj ponownie za chwilę. Jeśli to było zapisywanie, sprawdź najpierw, czy zmiana
  już jest na miejscu.”; link „Wróć do listy ofert” (`/dashboard`).

Linki biorą wygląd z `buttonVariants`. Bez wyspy React.

#### 3. Strona 500

**File**: `src/pages/500.astro` (nowy)

**Intent**: Członek, którego żądanie skończyło się wyjątkiem, widzi stronę Vetpada
zamiast pustej odpowiedzi.

**Contract**: Renderuje `ErrorPage` z wariantem `500` w `src/layouts/Layout.astro`,
nie w `AppLayout` — Topbar czyta `locals.user`, którego w tym przebiegu może nie być.
Nie czyta `Astro.props.error`, `Astro.locals` ani treści żądania. Bez eksportu
`prerender`.

#### 4. Strona 503

**File**: `src/pages/503.astro` (nowy)

**Intent**: Widok awarii Auth, na który middleware przepisuje żądanie.

**Contract**: Ustawia `Astro.response.status = 503` w każdym przebiegu, także pod
własnym adresem. Renderuje `ErrorPage` z wariantem `503` w `Layout.astro`, z
`retryHref(Astro.request.method, Astro.originPathname)`. Nie czyta treści żądania
ani `Astro.locals`.

#### 5. Strona deweloperska

**File**: `src/pages/dev/errors.astro` (nowy)

**Intent**: Jedyny praktyczny sposób obejrzenia obu widoków bez wyjątku i bez
martwego Auth.

**Contract**: Wzorzec `src/pages/dev/board.astro`: renderuje się tylko pod
`astro dev`, wszędzie indziej odpowiada 404. Dwie sekcje, `data-state="500"` i
`data-state="503"`, każda renderuje `ErrorPage` — ten sam komponent co strony
produkcyjne.

#### 6. Test renderowania

**File**: `tests/components/ErrorPage.test.ts` (nowy)

**Intent**: Utrwalić kontrakt, na którym polegają smoke i middleware.

**Contract**: Przez Container API, według `tests/components/offers/render.test.ts`.
Dla każdego wariantu: znacznik `data-error-page`, nagłówek i cele linków wpisane
ręcznie; dla 503 link główny ma przekazany `retryHref`.

#### 7. Zestaw zrzutów

**File**: `scripts/ui-screenshots.mjs`

**Intent**: Bramka wizualna dla nowych widoków.

**Contract**: Zestaw `errors` na `/dev/errors`: `errors-desktop`, `errors-mobile`,
`errors-focus-retry` (link „Spróbuj ponownie” osiągnięty klawiszem Tab) i
`errors-hover-retry` (ten sam link przez pole `hover`). Katalog wyjściowy:
`context/changes/auth-outage-not-signed-out/screenshots`.

### Macierz 7 stanów

| Stan     | Widok                                                                                                                  | Zrzut                             |
| -------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| default  | strona 500 i strona 503                                                                                                | `errors-desktop`, `errors-mobile` |
| hover    | link „Spróbuj ponownie”                                                                                                | `errors-hover-retry`              |
| focus    | ten sam link, `:focus-visible`                                                                                         | `errors-focus-retry`              |
| disabled | nie dotyczy — widoki mają wyłącznie linki, żadnej kontrolki, którą da się wyłączyć                                     | —                                 |
| error    | nie dotyczy — oba widoki same są stanem błędu i nie mają własnego wariantu błędu; baner zero-config należy do `Layout` | —                                 |
| empty    | nie dotyczy — treść jest stała, widoki nie czytają danych                                                              | —                                 |
| loading  | nie dotyczy — brak wyspy i brak asynchronicznego odczytu; strona jest gotowa w pierwszej odpowiedzi                    | —                                 |

### Success Criteria:

#### Automated Verification:

- `npx vitest run tests/lib/error-pages.test.ts tests/components/ErrorPage.test.ts` przechodzi, a przed dodaniem modułu i komponentu był czerwony
- `npm test` przechodzi
- `npm run lint` przechodzi, w tym reguła tokenów dla nowych widoków
- `npx astro sync && npx astro check` przechodzi
- `npm run build` przechodzi
- `node scripts/ui-screenshots.mjs errors context/changes/auth-outage-not-signed-out/screenshots` zapisuje cztery zrzuty zestawu `errors`

#### Manual Verification:

- Zrzuty pokazują każdy wiersz macierzy, który ma zrzut; `errors-mobile` nie przewija się w poziomie, a pierścień fokusu na `errors-focus-retry` jest widoczny
- Teksty obu stron przeczytane i zaakceptowane

**Implementation Note**: Po przejściu weryfikacji automatycznej zatrzymaj się na
potwierdzenie kroków ręcznych. Jeśli triage `/10x-impl-review` zmieni któryś widok,
zestaw `errors` jest wykonywany ponownie przed commitem (`CLAUDE.md`, `### UI`).

---

## Phase 3: Middleware

### Overview

Middleware czyta `error`, klasyfikuje go, loguje, przepisuje awarię na `/503` i
opakowuje resztę w log-i-rzuć-dalej. Zaczyna się od testu.

### Changes Required:

#### 1. Fixture sesji i zapytań Auth

**File**: `tests/fixtures/http.ts`

**Intent**: Test middleware ma odgrywać Auth na krawędzi HTTP, tak jak testy tras
odgrywają Data API.

**Contract**: Eksport budujący nagłówek `Cookie` z sesją dla `SUPABASE_TEST_URL` —
ciasteczko `sb-supabase-auth-token` w kodowaniu `@supabase/ssr` (`base64-` i JSON
sesji w base64url), z tokenem niewygasłym albo wygasłym na życzenie — oraz predykat
rozpoznający zapytania do `/auth/v1/user` i `/auth/v1/token`. Blok komentarza
opisuje, jak klient Auth rozmawia z serwerem, odczytane z `node_modules`, w stylu
istniejących bloków tego pliku. Tokeny i email w fixture są kanarkami o nazwanych
stałych.

#### 2. Test middleware

**File**: `tests/middleware.test.ts` (nowy), `tests/middleware.unconfigured.test.ts` (nowy)

**Intent**: Każda klasa i każda ścieżka wyjścia middleware ma przypadek, zanim
middleware się zmieni.

**Contract**: `onRequest` wołane bezpośrednio z ręcznie zbudowanym kontekstem
(`request`, `url`, `routePattern`, `locals`, `cookies`, `redirect`) i z `next`, które
zapisuje swój argument. `astro:env/server` nadpisane jak w
`tests/pages/api/offers.test.ts`; plik `unconfigured` działa w stanie z
`tests/setup.ts`. Żadnego `vi.mock` na `@/lib/*`. Wpisy według
`context/foundation/test-plan.md` §6.9: cały wpis wpisany ręcznie, `toStrictEqual`,
liczba wpisów tam, gdzie jest tezą. Przypadki z „Test contract” poniżej.

#### 3. Middleware

**File**: `src/middleware.ts`

**Intent**: Odróżnić brak sesji od sesji odrzuconej i od awarii, zalogować dwie
ostatnie, awarii nie zamieniać w przekierowanie na logowanie, a wyjątkowi dać
kontekst.

**Contract**:

- Zero-config: klient `null` → `locals.user = null`, żadnego wpisu, dalsza logika
  jak dziś.
- `getUser()` bez błędu → `locals.user` z wyniku, jak dziś.
- Błąd klasy `missing` → `locals.user = null`, żadnego wpisu.
- Błąd klasy `rejected` → `locals.user = null`, wpis `info`:
  `{ event: "auth_check", outcome: "rejected", route, method, error_name, auth_status, auth_code }`.
  Dalsza logika jak dziś, czyli przekierowanie na `/auth/signin` tylko na trasach
  chronionych.
- Błąd klasy `unavailable` → `locals.user = null`, wpis `error` o tym samym kształcie
  z `outcome: "unavailable"`. Gdy ścieżka nie jest `/auth`, nie zaczyna się od
  `/auth/` ani od `/api/auth/`, middleware zwraca `next("/503")`; w przeciwnym razie
  `next()` bez argumentu.
- `route` to `context.routePattern`, `method` to `context.request.method`,
  `error_name` to `error.name`, `auth_status` to `error.status`, `auth_code` to
  `error.code`. Nic z `error.message`.
- Cała praca middleware po rozpoznaniu drugiego przebiegu jest w jednym `try`: przy
  wyjątku wpis `error` `{ event: "request", outcome: "unhandled", route, method, user_id, error_name }`
  — `user_id` tylko gdy użytkownik jest już znany, `error_name` to `name` wyjątku, a
  dla wartości niebędącej `Error` stały tekst `NonError` — po czym ten sam wyjątek
  jest rzucany dalej.
- Drugi przebieg (`context.routePattern === "/500"`): middleware nie tworzy zapytania
  do Auth, nie przekierowuje i nie przepisuje; zostawia `locals.user`, jeśli jest
  ustawione, a w przeciwnym razie ustawia `null`, i woła `next()` w tym samym
  opakowaniu.
- `PROTECTED_ROUTES` i przekierowanie `/` → `/dashboard` dla zalogowanego bez zmian.

### Test contract

Wpisy pokazane bez pola `level`, które dodaje reporter.

| #   | Stan Auth                                                         | Żądanie                   | Odpowiedź                              | `next`                                       | Wpisy                                                                                                                                                     |
| --- | ----------------------------------------------------------------- | ------------------------- | -------------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | brak ciasteczka                                                   | `GET /dashboard`          | 302 → `/auth/signin`                   | niewołane                                    | brak; żadnego zapytania sieciowego                                                                                                                        |
| 2   | brak ciasteczka                                                   | `GET /`                   | odpowiedź `next`                       | `next()`                                     | brak                                                                                                                                                      |
| 3   | sesja ważna                                                       | `GET /dashboard`          | odpowiedź `next`                       | `next()`; `locals.user.id` ustawione         | brak                                                                                                                                                      |
| 4   | sesja ważna                                                       | `GET /`                   | 302 → `/dashboard`                     | niewołane                                    | brak                                                                                                                                                      |
| 5   | `/user` → 403 `bad_jwt`                                           | `GET /dashboard`          | 302 → `/auth/signin`                   | niewołane                                    | jeden `info`: `auth_check` / `rejected`, `route: "/dashboard"`, `method: "GET"`, `error_name: "AuthApiError"`, `auth_status: 403`, `auth_code: "bad_jwt"` |
| 6   | token wygasły, `/token` → 400 `refresh_token_not_found`           | `GET /offers/<uuid>`      | 302 → `/auth/signin`                   | niewołane                                    | jeden `info` z `route: "/offers/[id]"`, `auth_status: 400`, `auth_code: "refresh_token_not_found"`                                                        |
| 7   | `/user` → 403 `bad_jwt`                                           | `GET /`                   | odpowiedź `next`                       | `next()`                                     | jeden `info` `rejected`                                                                                                                                   |
| 8   | `/user` → 503                                                     | `GET /dashboard`          | odpowiedź `next`                       | `next("/503")`, raz; `locals.user` to `null` | jeden `error`: `auth_check` / `unavailable`, `error_name: "AuthRetryableFetchError"`, `auth_status: 503`                                                  |
| 9   | `fetch` odrzucony                                                 | `GET /dashboard`          | odpowiedź `next`                       | `next("/503")`                               | jeden `error` z `auth_status: 0`                                                                                                                          |
| 10  | `/user` → 540 z treścią HTML                                      | `GET /criteria`           | odpowiedź `next`                       | `next("/503")`                               | jeden `error` z `error_name: "AuthUnknownError"`, bez `auth_status`                                                                                       |
| 11  | `/user` → 429 `over_request_rate_limit`                           | `GET /dashboard`          | odpowiedź `next`                       | `next("/503")`                               | jeden `error` z `auth_status: 429`, `auth_code: "over_request_rate_limit"`                                                                                |
| 12  | `/user` → 503                                                     | `POST /api/offers`        | odpowiedź `next`                       | `next("/503")`                               | jeden `error` z `route: "/api/offers"`, `method: "POST"`                                                                                                  |
| 13  | `/user` → 503                                                     | `GET /`                   | odpowiedź `next`                       | `next("/503")`                               | jeden `error`                                                                                                                                             |
| 14  | `/user` → 503                                                     | `GET /auth/signin`        | odpowiedź `next`                       | `next()`                                     | jeden `error`                                                                                                                                             |
| 15  | `/user` → 503                                                     | `POST /api/auth/signout`  | odpowiedź `next`                       | `next()`                                     | jeden `error`                                                                                                                                             |
| 16  | sesja ważna, `next` rzuca `TypeError`                             | `GET /offers/<uuid>`      | ten sam obiekt wyjątku rzucony dalej   | wołane raz                                   | jeden `error`: `request` / `unhandled`, `route: "/offers/[id]"`, `method: "GET"`, `user_id`, `error_name: "TypeError"`                                    |
| 17  | brak ciasteczka, `next` rzuca tekst                               | `GET /auth/signin`        | ta sama wartość rzucona dalej          | wołane raz                                   | jeden `error` bez `user_id`, z `error_name: "NonError"`                                                                                                   |
| 18  | ciasteczko obecne, `routePattern` to `/500`, ścieżka `/dashboard` | `GET`                     | odpowiedź `next`                       | `next()`                                     | brak; żadnego zapytania sieciowego                                                                                                                        |
| 19  | jak 18, `next` rzuca                                              | `GET`                     | wyjątek rzucony dalej                  | wołane raz                                   | jeden `error` `unhandled` z `route: "/500"`                                                                                                               |
| 20  | zero-config (osobny plik)                                         | `GET /dashboard`, `GET /` | 302 → `/auth/signin`; odpowiedź `next` | —                                            | brak; żadnego zapytania sieciowego                                                                                                                        |

Sprawdzian nieobecności, jedna tabela scenariuszy (5, 6, 8, 10, 16): konsola nie
zawiera emaila użytkownika z fixture, tokenu dostępu, refresh tokenu, wartości
ciasteczka, parametru query dopisanego do adresu żądania, identyfikatora z surowej
ścieżki w przypadku 6 ani komunikatu błędu — ani `msg` z odpowiedzi Auth, ani
`message` wyjątku. Każdy scenariusz najpierw nazywa `outcome` swojego wpisu.

### Success Criteria:

#### Automated Verification:

- Przypadki 5–19 w `tests/middleware.test.ts` są czerwone przed zmianą `src/middleware.ts` i zielone po niej; przypadki 1–4 i 20 są zielone przed i po
- `npm test` przechodzi, w tym `tests/pages/api/offers.test.ts` bez zmiany asercji
- `npm run lint` przechodzi
- `npx astro sync && npx astro check` przechodzi
- `npm run build` przechodzi
- `npm run smoke` przechodzi bez zmian w `scripts/smoke.mjs`

#### Manual Verification:

- W `npm run dev` z lokalnym Supabase logowanie, tablica, karta oferty, kryteria i wylogowanie działają jak przed zmianą, a terminal nie pokazuje żadnego wpisu `auth_check`

**Implementation Note**: Po przejściu weryfikacji automatycznej zatrzymaj się na
potwierdzenie kroku ręcznego.

---

## Phase 4: Smoke, mutacje, dokumentacja

### Overview

Siatka pod całą zmianą: smoke pilnuje, że odrzucona sesja nie stała się awarią i że
strony błędów istnieją; próba na zbudowanym podglądzie potwierdza drogę wyjątku;
mutacje sprawdzają testy; dokumentacja opisuje nowy stan.

### Changes Required:

#### 1. Kroki smoke

**File**: `scripts/smoke.mjs`

**Intent**: Zmiana zachowania tras chronionych ma odbicie w smoke — po stronie, którą
smoke umie odegrać.

**Contract**: Nowe kroki, wszystkie przed logowaniem:

- sfałszowane ciasteczko sesji (nazwa z hosta `SUPABASE_URL`, token niewygasły,
  podpis nieprawdziwy) na `GET /dashboard` → 302 na `/auth/signin`;
- to samo ciasteczko na `POST /api/offers` → 302 na `/auth/signin`;
- `GET /503` → 503, treść zawiera `data-error-page="503"`;
- `GET /500` → 500, treść zawiera `data-error-page="500"`;
- `GET /dev/errors` → 404.

Krok ze sfałszowanym ciasteczkiem wysyła je zamiast słoika ciasteczek i niczego w nim
nie zostawia; bez `SUPABASE_URL` zwraca ten sam błąd konfiguracji co pozostałe kroki
Supabase. Komentarz nagłówkowy skryptu opisuje nowe kroki. Zadanie `smoke` w
`.github/workflows/ci.yml` nie wymaga zmian.

#### 2. Dziennik mutantów

**File**: `context/changes/auth-outage-not-signed-out/mutation.md` (nowy)

**Intent**: Sprawdzić, że testy trzymają granice klas, kształt wpisów i listę ścieżek
wyłączonych z 503.

**Contract**: Przebieg
`npx stryker run --mutate "src/middleware.ts,src/lib/auth-error.ts,src/lib/error-pages.ts,src/lib/log.ts"`.
Format i trzy decyzje (asercja / równoważny / świadomie pominięty) jak w
`context/archive/2026-10-05-offers-outcome-logging/mutation.md`. Kryterium to brak
mutanta bez decyzji, nie próg liczbowy.

#### 3. Reguły w CLAUDE.md

**File**: `CLAUDE.md`

**Intent**: Żeby następna zmiana nie przywróciła `user: null` dla awarii i nie
zbudowała drugiej klasyfikacji.

**Contract**: W `## Structure` punkt o middleware: `src/lib/auth-error.ts` jako
referencja klasyfikacji błędu Auth, `src/middleware.ts` jako referencja wpisu spoza
trasy i miejsca, które awarii nie zamienia w przekierowanie, `tests/middleware.test.ts`
jako referencja testu. W `### UI` punkt o `/dev/errors` na wzór pozostałych stron
deweloperskich. W `## Testing` zdanie o krokach smoke ze sfałszowanym ciasteczkiem.
Nazwane instancje, bez liczb i bez parafrazy kodu.

#### 4. Runbook

**File**: `context/foundation/deployment-runbook.md`

**Intent**: Wiersz o uśpionym projekcie opisuje objaw, którego po tej zmianie nie ma.

**Contract**: W „## Symptoms that lie” wiersz „Login fails in production, and no
banner appears” mówi, co członek teraz widzi (strona 503 zamiast logowania) i co jest
w logu (`event: "auth_check"`, `outcome: "unavailable"`, `auth_status`). Sekcja
„## Logs” dostaje zdanie o `auth_check` i `request`. Procedura wznowienia projektu
bez zmian.

#### 5. README

**File**: `README.md`

**Intent**: Opis ochrony tras i tabela tras mają zgadzać się z kodem.

**Contract**: Tabela tras dostaje `/500` i `/503`. Akapit o ochronie tras mówi, że
awaria Auth odpowiada stroną 503 na każdej ścieżce poza `/auth/*` i `/api/auth/*`.
Akapit o smoke wymienia nowe kroki.

#### 6. Wzorzec w planie testów

**File**: `context/foundation/test-plan.md`

**Intent**: Następny test middleware ma powstać według tego samego wzoru.

**Contract**: Nowy podpunkt w §6 po 6.9: test middleware — kontekst budowany ręcznie,
Auth na krawędzi HTTP przez fixture sesji, `tests/middleware.test.ts` jako referencja,
pułapki z „Critical Implementation Details” tego planu (token niewygasły dla awarii,
obca treść w konsoli). Rejestr świeżości (§8) według konwencji pliku.

### Success Criteria:

#### Automated Verification:

- `npm run smoke` z nowymi krokami przechodzi na podglądzie produkcyjnym (`npm run build`, `npm run preview`) przy lokalnym Supabase
- Próba wyjątku na podglądzie produkcyjnym: tymczasowy `throw new Error("KANAREK-500")` we frontmatterze `src/pages/criteria.astro` daje zalogowanemu członkowi odpowiedź 500 z `data-error-page="500"` i bez tekstu `KANAREK-500` w treści, a log serwera ma dokładnie jeden wpis `request` / `unhandled` z `route: "/criteria"`, `method: "GET"` i `user_id`; zmiana zostaje cofnięta
- Przebieg Strykera zawężony do czterech plików kończy się, a `mutation.md` ma decyzję dla każdego ocalałego i niepokrytego mutanta
- `npm test` przechodzi
- `npm run lint` przechodzi
- `npx astro sync && npx astro check` przechodzi
- `npm run build` przechodzi po cofnięciu próby

#### Manual Verification:

- Awaria odegrana ręcznie: zalogowana przeglądarka, zatrzymany lokalny kontener Supabase Auth — `/dashboard` pokazuje stronę 503, terminal jeden wpis `auth_check` / `unavailable` na żądanie, a `/auth/signin` nadal się renderuje; po wznowieniu kontenera „Spróbuj ponownie” otwiera tablicę bez ponownego logowania
- Wysłanie formularza dodawania oferty przy zatrzymanym Auth pokazuje stronę 503, a nie błąd przepisania żądania
- Dziennik mutantów przeczytany: decyzje „świadomie pominięty” mają powód, z którym się zgadzasz
- Punkty w `CLAUDE.md`, wiersz runbooka i akapity README opisują to, co robi kod, i nie powtarzają go

**Implementation Note**: Po przejściu weryfikacji automatycznej zatrzymaj się na
potwierdzenie kroków ręcznych przez człowieka.

---

## Testing Strategy

### Unit Tests:

- `tests/lib/auth-error.test.ts` — trzy klasy i granice 400, 429, 499/500, błąd bez
  statusu.
- `tests/lib/error-pages.test.ts` — cel linku: metoda, ścieżki API, `/503`, `//` i `\`.
- `tests/lib/log.test.ts` — pięć nowych kluczy, zero jako wartość.
- `tests/components/ErrorPage.test.ts` — znaczniki, teksty i cele linków.

### Integration Tests:

- `tests/middleware.test.ts` — middleware z prawdziwym `@/lib/supabase`, sieć
  zastąpiona na krawędzi HTTP: każda klasa, każda ścieżka wyjścia, drugi przebieg,
  brak danych w konsoli.
- `tests/middleware.unconfigured.test.ts` — zero-config.
- `tests/pages/api/offers.test.ts` — bez zmian; `signed_out` zostaje wpisem dla
  żądania, które dotarło do trasy bez użytkownika.
- `npm run smoke` — odrzucona sesja nadal kończy na logowaniu, strony błędów
  odpowiadają swoim statusem, `/dev/errors` nie istnieje w buildzie.

### Manual Testing Steps:

1. `npm run build`, `npm run preview`, lokalny Supabase, logowanie kontem z
   `supabase/seed.sql`.
2. `docker ps` wskazuje kontener Auth lokalnego Supabase; `docker stop <nazwa>`.
3. Odświeżenie `/dashboard`: strona 503, w terminalu wpis `auth_check` /
   `unavailable`. `/auth/signin` renderuje formularz.
4. Wysłanie formularza dodawania oferty z otwartej wcześniej karty: strona 503.
5. `docker start <nazwa>`; „Spróbuj ponownie” otwiera tablicę, członek jest
   zalogowany.
6. Po najbliższym wdrożeniu, poza tą zmianą: `npx wrangler tail --format json`
   pokazuje pola wpisu jako osobne klucze.

## Performance Considerations

Middleware robi to samo jedno zapytanie do Auth co dziś; drugi przebieg dla strony
500 przestaje robić drugie. Najwyżej jeden dodatkowy wpis na żądanie. Przy awarii
każde żądanie z ciasteczkiem zostawia wpis `error` — dla kilkuosobowego zespołu o
rzędy wielkości poniżej limitu Workers Logs
(`context/foundation/deployment-runbook.md`, „## Logs”).

Znane ograniczenie poza zakresem: gdy token dostępu wygasł, a Auth nie odpowiada,
biblioteka ponawia odświeżenie do około 30 s i dopiero wtedy middleware dostaje błąd,
więc strona 503 pojawia się z opóźnieniem (P9).

## Migration Notes

Brak migracji bazy i brak zmian w konfiguracji; zmiana nie wymaga `supabase db push`
ani nowych sekretów. Ciasteczka sesji zostają w dotychczasowym kształcie.

## References

- Audyt: `context/audits/observability/2026-10-05_add-offer-from-otodom.md` (sekcja 5,
  P1 i P4) i `context/audits/observability/2026-10-05_verify-add-offer-from-otodom.md`
  (sekcja 6, krok 1)
- Middleware: `src/middleware.ts:6-29`
- Wzorzec klasyfikacji: `src/pages/api/auth/signin.ts:6-23`
- Reporter: `src/lib/log.ts:9-49`, `tests/lib/log.test.ts`
- Wzorzec testu wpisu: `context/foundation/test-plan.md` §6.9,
  `tests/pages/api/offers.test.ts`, `tests/fixtures/http.ts`, `tests/fixtures/console.ts`
- Wzorzec testu renderowania: `tests/components/offers/render.test.ts`
- Wzorzec strony deweloperskiej: `src/pages/dev/board.astro`
- Wzorzec dziennika mutantów:
  `context/archive/2026-10-05-offers-outcome-logging/mutation.md`
- Biblioteki: `node_modules/@supabase/auth-js/src/GoTrueClient.ts:3245-3286`,
  `node_modules/@supabase/auth-js/src/lib/fetch.ts:72-143`,
  `node_modules/astro/dist/core/middleware/astro-middleware.js:22-33`,
  `node_modules/astro/dist/core/errors/default-handler.js:64-100`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Klasyfikacja błędów Auth i pola reportera

#### Automated

- [x] 1.1 `npx vitest run tests/lib/auth-error.test.ts` przechodzi, a przed dodaniem `src/lib/auth-error.ts` był czerwony — efd0627
- [x] 1.2 Nowy przypadek w `tests/lib/log.test.ts` jest czerwony przed dopisaniem kluczy do białej listy i zielony po nim — efd0627
- [x] 1.3 `npm test` przechodzi — efd0627
- [x] 1.4 `npm run lint` przechodzi — efd0627
- [x] 1.5 `npx astro sync && npx astro check` przechodzi — efd0627

### Phase 2: Strony błędów i bramka wizualna

#### Automated

- [x] 2.1 `npx vitest run tests/lib/error-pages.test.ts tests/components/ErrorPage.test.ts` przechodzi, a przed dodaniem modułu i komponentu był czerwony
- [x] 2.2 `npm test` przechodzi
- [x] 2.3 `npm run lint` przechodzi, w tym reguła tokenów dla nowych widoków
- [x] 2.4 `npx astro sync && npx astro check` przechodzi
- [x] 2.5 `npm run build` przechodzi
- [x] 2.6 `node scripts/ui-screenshots.mjs errors context/changes/auth-outage-not-signed-out/screenshots` zapisuje cztery zrzuty zestawu `errors`

#### Manual

- [x] 2.7 Zrzuty pokazują każdy wiersz macierzy, który ma zrzut; `errors-mobile` nie przewija się w poziomie, a pierścień fokusu na `errors-focus-retry` jest widoczny
- [x] 2.8 Teksty obu stron przeczytane i zaakceptowane

### Phase 3: Middleware

#### Automated

- [ ] 3.1 Przypadki 5–19 w `tests/middleware.test.ts` są czerwone przed zmianą `src/middleware.ts` i zielone po niej; przypadki 1–4 i 20 są zielone przed i po
- [ ] 3.2 `npm test` przechodzi, w tym `tests/pages/api/offers.test.ts` bez zmiany asercji
- [ ] 3.3 `npm run lint` przechodzi
- [ ] 3.4 `npx astro sync && npx astro check` przechodzi
- [ ] 3.5 `npm run build` przechodzi
- [ ] 3.6 `npm run smoke` przechodzi bez zmian w `scripts/smoke.mjs`

#### Manual

- [ ] 3.7 W `npm run dev` z lokalnym Supabase logowanie, tablica, karta oferty, kryteria i wylogowanie działają jak przed zmianą, a terminal nie pokazuje żadnego wpisu `auth_check`

### Phase 4: Smoke, mutacje, dokumentacja

#### Automated

- [ ] 4.1 `npm run smoke` z nowymi krokami przechodzi na podglądzie produkcyjnym (`npm run build`, `npm run preview`) przy lokalnym Supabase
- [ ] 4.2 Próba wyjątku na podglądzie produkcyjnym: tymczasowy `throw new Error("KANAREK-500")` we frontmatterze `src/pages/criteria.astro` daje zalogowanemu członkowi odpowiedź 500 z `data-error-page="500"` i bez tekstu `KANAREK-500` w treści, a log serwera ma dokładnie jeden wpis `request` / `unhandled` z `route: "/criteria"`, `method: "GET"` i `user_id`; zmiana zostaje cofnięta
- [ ] 4.3 Przebieg Strykera zawężony do czterech plików kończy się, a `mutation.md` ma decyzję dla każdego ocalałego i niepokrytego mutanta
- [ ] 4.4 `npm test` przechodzi
- [ ] 4.5 `npm run lint` przechodzi
- [ ] 4.6 `npx astro sync && npx astro check` przechodzi
- [ ] 4.7 `npm run build` przechodzi po cofnięciu próby

#### Manual

- [ ] 4.8 Awaria odegrana ręcznie: zalogowana przeglądarka, zatrzymany lokalny kontener Supabase Auth — `/dashboard` pokazuje stronę 503, terminal jeden wpis `auth_check` / `unavailable` na żądanie, a `/auth/signin` nadal się renderuje; po wznowieniu kontenera „Spróbuj ponownie” otwiera tablicę bez ponownego logowania
- [ ] 4.9 Wysłanie formularza dodawania oferty przy zatrzymanym Auth pokazuje stronę 503, a nie błąd przepisania żądania
- [ ] 4.10 Dziennik mutantów przeczytany: decyzje „świadomie pominięty” mają powód, z którym się zgadzasz
- [ ] 4.11 Punkty w `CLAUDE.md`, wiersz runbooka i akapity README opisują to, co robi kod, i nie powtarzają go
