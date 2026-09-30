# Runner testów i strażnicy ingestii — plan implementacji

## Overview

Realizujemy fazę 1 rolloutu z `context/foundation/test-plan.md` („Test runner and ingestion guardrails”). Plan pokrywa trzy ryzyka:

- **#1**: ingestia zapisuje fałszywą albo niepełną ofertę;
- **#6, połowa „zapis”**: telefon albo imię sprzedawcy trafia do bazy;
- **#7**: zapisany URL spoza https ląduje w `href`/`src`.

Wprowadzamy Vitest. Użytkownik dał na to wyraźną zgodę 2026-09-30, co wymaga CLAUDE.md `## Testing`. Konfiguracja ładuje Astro bez adaptera Cloudflare.

Każdy z trzech strażników dostaje test, który padnie, gdy strażnik zniknie. Testy biegną na ręcznie napisanych fixturach, a sieć jest zaślepiona na krawędzi HTTP. Widoki renderujemy przez Astro Container API. `npm test` staje się wymaganą bramką w jobie `ci`.

Testy odsłaniają dwie luki w kodzie produkcyjnym i obie naprawiamy w tej zmianie:
- `numericOrUnknown` przyjmuje `"1e3"`/`"0x10"`;
- galeria wywraca się na `images: [null]`.

## Current State Analysis

- **Testów nie ma wcale.** Nie istnieje żaden plik `*.test.*`, runnera nie ma w `package.json`, a CLAUDE.md `## Testing` mówi „There is no unit-test runner”. Mapper sprawdzono ręcznie przez `scripts/otodom-inspect.mjs` na żywych ogłoszeniach (`context/archive/2026-09-22-paste-listing-to-card/plan.md:437`). `scripts/smoke.mjs` uderza w `/api/offers` tylko ścieżkami odrzucanymi przed fetchem.
- **Decyzja zapisz/odrzuć zapada w jednym miejscu.** `ingestOffer` wykonuje kolejno normalizację, fetch i mapowanie (`src/lib/otodom/index.ts:21-32`). Jedyny `insert` w `src/` stoi za `if (!result.ok)` (`src/pages/api/offers.ts:79-87`) i dokleja wyłącznie `source_url` i `created_by`.
- **Kolejność bramek w mapperze** (`src/lib/otodom/map.ts:203-234`):
  1. `ad`, `adCategory` i `target` muszą być rekordami;
  2. niezgodność `adCategory.type` z `target.OfferType` → `shape_changed`;
  3. nie sprzedaż → `not_for_sale`;
  4. nie `FLAT` → `not_a_flat` (w polu `detail` idzie `ProperType`);
  5. brak id, tytułu, URL-a lub opisu → `shape_changed`;
  6. `characteristics` nie jest tablicą → `shape_changed`.
- **Fakty liczbowe:**
  - `numericOrUnknown` (`map.ts:65-77`) parsuje stringi przez `Number()`, więc `"1e3"` daje 1000, a `"0x10"` daje 16;
  - `integerOrUnknown` (`map.ts:80-83`) dokłada wymóg liczby całkowitej;
  - waluta przeżywa tylko przy znanej kwocie (`map.ts:244-247`);
  - `price_currency` bierze walutę z `price_per_m`, gdy `price` jest nieznana (`map.ts:266`).
- **Whitelist kluczy:** `RAW_AD_KEYS`, `RAW_LOCATION_KEYS`, `RAW_TARGET_KEYS` (`map.ts:11-32`). Kolumny strukturalne czytają tylko nazwane ścieżki. `raw.description` trzyma oryginalny HTML.
- **Fetch:** `fetchOfferAd` (`src/lib/otodom/fetch.ts:332-383`) mapuje odpowiedzi na powody porażki:
  - 404/410 → `not_found`;
  - ≥500 → `upstream_error`;
  - inna odpowiedź nie-OK → `http_denied`;
  - przekierowanie poza hosty otodom → `http_denied`;
  - przekierowanie na ścieżkę, która nie jest ofertą → `not_found`;
  - brak `__NEXT_DATA__`, zepsuty JSON albo brak `pageProps` → `shape_changed`;
  - `shouldShowExpiredAdPage` na `ad` albo na `pageProps` → `expired`;
  - abort → `timeout`;
  - inny wyjątek → `network`.
- **Render zapisanych URL-i (#7):** są trzy miejsca i wszystkie przechodzą przez `safeHttpsUrl` (`src/lib/safe-url.ts:7-15`):
  - `OfferCard.astro:34,57-59` (link do źródła);
  - `OfferGallery.astro:15-19,38,44`;
  - `OfferBoardItem.astro:89-94,106-117`.

  `OfferGallery.astro:16` czyta `image.thumbnail` bez sprawdzenia, czy element istnieje. `OfferCard.astro:31` sprawdza tylko `Array.isArray`. Wiersz z `images: [null]`, który każdy członek może zapisać PATCH-em przez PostgREST, rzuca więc TypeError w renderze karty.
- **Toolchain (zweryfikowany w research na kopii repo):**
  - vitest 5.0.3 z gołym `getViteConfig()` pada na starcie, bo `@astrojs/cloudflare` uruchamia workerd;
  - działa config z usuniętym `adapter`;
  - `astro:env/server` się rozwiązuje, ale czyta prawdziwy `.env`, więc testy zero-config muszą go mockować;
  - Container API potrzebuje renderera React nawet dla `.astro` (karty używają `Card` z `src/components/ui/`);
  - `npm run lint` wymaga shima `declare module "*.astro"`.
- Fixtury `/dev/offer-card` (`src/pages/dev/_offer-fixtures.ts`) mają już `fullOffer`, `unknownOffer` i `unsafeImagesOffer` (`http:` i `javascript:`), ale żadnej z nich nie ma elementu `null`, nie-obiektu ani wrogiego `large` przy poprawnym `thumbnail`.
- `context/foundation/ingestion/otodom_apify.md:298-299` zawiera wyglądające na prawdziwe telefon i imię prywatnego sprzedawcy. Repozytorium jest publiczne.

## Desired End State

- `npm test` przechodzi na świeżym klonie bez `.env` i bez sieci. Przechodzi też przy obecnym prawdziwym `.env` i nigdy nie łączy się z otodom.pl ani z Supabase.
- Job `ci` w `.github/workflows/ci.yml` uruchamia `npm test` jako wymagany krok.
- Każdy z tych strażników ma test, który zmienia się na czerwony po jego usunięciu:
  - nieznane nigdy nie staje się zerem, na wszystkich 7 polach liczbowych i ich walutach;
  - bramka sprzedaży mieszkania;
  - powody porażki fetcha;
  - route nie zapisuje niczego po odmowie, a przy sukcesie zapisuje wiersz bez danych sprzedawcy i z opisem zachowanym dosłownie;
  - żaden widok nie wstawia do `href`/`src` URL-a spoza https;
  - uszkodzony element zdjęć nie wywraca karty.
- `numericOrUnknown` uznaje string za podany tylko w zapisie dziesiętnym.
- Galeria pomija elementy niebędące obiektem.
- FR-005 w PRD mówi, który komunikat dostaje ogłoszenie łamiące obie bramki.
- `otodom_apify.md` nie zawiera już danych osobowych.
- §6.1, §6.2 i §6.6 w `test-plan.md` opisują wzorce, które ta zmiana wprowadziła. §4 i §5 odzwierciedlają Vitest i bramkę CI. CLAUDE.md i README mówią o `npm test`.

Weryfikacja: `npm test`, `npm run lint`, `npx astro check` i `npm run build` przechodzą lokalnie bez `.env` i z `.env`. Ręczna mutacja każdego strażnika (np. usunięcie `safeHttpsUrl` z `OfferCard`) daje czerwony test.

### Key Discoveries:

- Klient Supabase z `@supabase/ssr` wysyła żądania przez globalny `fetch` (`src/lib/supabase.ts:9`). Wystarczy więc zaślepić jeden `globalThis.fetch`, który rozróżnia host otodom i host Supabase z mocka `astro:env/server`, i route `POST /api/offers` testuje się end-to-end w procesie. Nie trzeba mockować `@/lib/supabase`, co test-plan wymienia jako anty-wzorzec.
- `new Response()` ma `url === ""`. `fetch.ts:348` sprawdza przekierowanie tylko przy niepustym `response.url`, więc test przekierowania musi ustawić `url` na obiekcie odpowiedzi, np. przez `Object.defineProperty`.
- Wynajmowany dom dostaje `not_for_sale`, bo bramka sprzedaży stoi przed bramką typu (`map.ts:216-217`). Decyzja z tej sesji: to zachowanie zostaje i zapisujemy je w PRD.
- Tablica ofert jest już odporna na `[null]` (`OfferBoardItem.astro:92`, `?.`). Galeria nie jest. Wzorzec do skopiowania leży obok.

## What We're NOT Doing

- **Filtrowanie wartości w `raw.images`**, gdzie dziś zostają nieprzefiltrowane URL-e. `raw` nie jest nigdzie renderowany. Zajmie się tym faza, która pierwsza go przeczyta (S-04 / rollout Phase 4). Zapis trafia do §6.6.
- **Sprawdzanie hosta `source_url`** (dowolny host https dostaje link „Otwórz oryginał na otodom.pl”). To wykracza poza schemat, którego dotyczy #7. Notujemy, nie naprawiamy.
- **Link do mapy S-08.** Jeszcze nie istnieje. Test renderu przyniesie plan S-08.
- **Testy kolejnych zapisujących** (re-fetch FR-009, fallback Apify). Dostaną ten sam test kanarkowy, gdy powstaną. Wzorzec opisze §6.1.
- **Prompt audytu (#6, połowa „prompt”).** To rollout Phase 4, po S-04.
- **Zapis nagranego żywego payloadu otodom.** Nigdy: to dane osób trzecich, a repozytorium jest publiczne.
- **Testy uruchamiane wewnątrz workerd** (`@cloudflare/vitest-pool-workers` wymaga Vitest 4). Nic w `src/` tego dziś nie potrzebuje.
- **Hook post-edit, coverage, tryb watch w CI, jsdom/happy-dom.** Hooki to lekcja 3. Pozostałe nie dają sygnału dla tych ryzyk.
- **Bramka wizualna.** Poprawka galerii nie zmienia wyglądu poprawnych danych, a uszkodzone wpisy renderują istniejący stan „Ogłoszenie nie zawiera zdjęć.”. Decyzja z tej sesji.
- **Aktualizacja kotwicy w `context/foundation/lessons.md:7`** (wskazuje `[id].astro` zamiast `OfferCard.astro`). Rejestr jest append-only. Ewentualna nowa lekcja idzie przez `/10x-lesson`.
- **Zmiany w `scripts/smoke.mjs`.** Kontrakt `src/pages/api/` się nie zmienia.

## Implementation Approach

Kolejność idzie po ryzyku i koszcie. Najpierw toolchain z najtańszym testem dowodzącym, że działa (`safeHttpsUrl` i strażnik zero-config). Potem mapper, bo jest czysty, tani i ma największy sygnał dla #1 i #6. Potem granica fetch → zapis, czyli test route'u, najdroższy w tej zmianie. Potem render (#7) razem z poprawką galerii. Na końcu dokumentacja i cookbook.

Wyrocznią każdej asercji jest PRD i `otodom_fetching.md` §7, nigdy bieżące wyjście mappera. Wartości oczekiwane pisze się ręcznie z wejścia fixtury i reguły z dokumentu.

Fixtury to budowniczy w TypeScripcie. Zwraca minimalny `ad` w kształtach z §7.1/§7.3/§7.4 i przyjmuje nadpisania. Każdy wariant niesie te same syntetyczne kanarki sprzedawcy.

Testy leżą w `tests/` w korzeniu i odwzorowują ścieżki `src/`. Dzięki temu `src/` zostaje wolne od plików testowych, a `astro check` i `eslint` i tak je obejmują (`tsconfig.json` ma `include: ["**/*"]`).

## Critical Implementation Details

- **Mock `astro:env/server`.** Domyślny mock z nieustawionymi `SUPABASE_URL`/`SUPABASE_KEY` żyje w pliku `setupFiles`. Test route'u potrzebuje skonfigurowanego klienta i nadpisuje go własnym `vi.mock` (np. `SUPABASE_URL: "https://supabase.test"`). W fazie 1 trzeba sprawdzić, że mock w pliku testu wygrywa z mockiem z setupu. Jeśli nie wygrywa, domyślny mock przenosi się do każdego pliku, który go potrzebuje. Strażnik zero-config z fazy 1 dowodzi, który wariant działa.
- **Zaślepka fetch w teście route'u** odpowiada według hosta:
  - otodom → HTML z `__NEXT_DATA__`;
  - Supabase `GET /rest/v1/offers` (sprawdzenie duplikatu po `source_url`) → `200 []`;
  - Supabase `POST /rest/v1/offers` → `201` z `{ id }`;
  - każde inne żądanie → błąd testu, żeby nic niezaplanowanego nie przeszło po cichu.

  Zaślepka nagrywa metodę, URL i body każdego żądania. Dokładny kształt nagłówków PostgREST, których oczekuje supabase-js (`maybeSingle`/`single`), implementujący ustala z biblioteki i zapisuje w komentarzu fixtury.
- **Asercje renderu to białe listy, nie czarne.** Test wyciąga z HTML wszystkie wartości atrybutów `href` i `src` i sprawdza, że każda zaczyna się od `https://` albo `/` (link wewnętrzny). Samo „nie zawiera `javascript:`” przepuściłoby `data:` i `http:`.

## Phase 1: Toolchain Vitest i bramka CI

### Overview

Vitest startuje bez workerd i bez sekretów. `npm test` działa lokalnie i w CI. Dwa pierwsze testy dowodzą, że toolchain widzi kod, a środowisko testowe jest naprawdę zero-config.

### Changes Required:

#### 1. Zależność i skrypt

**File**: `package.json`

**Intent**: Dodać `vitest` (^5.0.3) do `devDependencies`, na wyraźną zgodę użytkownika z 2026-09-30. Dodać skrypt `test`.

**Contract**: `"test": "vitest run"`. Żadnych innych nowych paczek: renderer React do Container API pochodzi z istniejącego `@astrojs/react`, a `astro:container` z `astro`.

#### 2. Konfiguracja Vitest

**File**: `vitest.config.ts` (nowy)

**Intent**: Podać Vitestowi konfigurację Vite projektu z `astro.config.mjs` bez adaptera Cloudflare. Komentarz wyjaśnia dlaczego: adapter uruchamia workerd wewnątrz serwera Vite Vitesta i pada na starcie. Integracja React, Tailwind i `env.schema` zostają z jednego źródła.

**Contract**: `include: ["tests/**/*.test.ts"]`, `setupFiles` wskazuje plik z punktu 3. Kształt zweryfikowany w research:

```ts
/// <reference types="vitest/config" />
import { getViteConfig } from "astro/config";
import astroConfig from "./astro.config.mjs";

// The Cloudflare adapter boots workerd inside Vitest's Vite server and fails there;
// tests run in Node, so they get the project's Astro config minus the adapter.
const { adapter: _adapter, ...withoutAdapter } = astroConfig;

export default getViteConfig(
  { test: { include: ["tests/**/*.test.ts"], setupFiles: ["tests/setup.ts"] } },
  { ...withoutAdapter, configFile: false },
);
```

#### 3. Domyślne środowisko zero-config

**File**: `tests/setup.ts` (nowy)

**Intent**: Każdy test domyślnie widzi aplikację bez skonfigurowanego Supabase, niezależnie od `.env` w katalogu roboczym i zmiennych w shellu. To odtwarza stan zero-config z CLAUDE.md i nie pozwala testowi po cichu uderzyć w prawdziwą bazę.

**Contract**: `vi.mock("astro:env/server", () => ({ SUPABASE_URL: undefined, SUPABASE_KEY: undefined, getSecret: () => undefined }))`. Zobacz „Critical Implementation Details” w sprawie nadpisywania w pojedynczym pliku.

#### 4. Shim modułów `.astro` dla lintu

**File**: `tests/astro-modules.d.ts` (nowy)

**Intent**: typescript-eslint nie zna typu importu `.astro` w pliku `.ts` i zgłasza `no-unsafe-argument` przy `renderToString(Component)`. Shim deklaruje moduł jako `AstroComponentFactory`.

**Contract**: `declare module "*.astro" { const component: import("astro/runtime/server/index.js").AstroComponentFactory; export default component; }`. Implementujący sprawdza, że `npx astro check` nie zgłasza konfliktu z własnym typowaniem `.astro`. Jeśli zgłasza, shim zostaje ograniczony do lintu.

#### 5. Pierwsze testy

**File**: `tests/lib/safe-url.test.ts`, `tests/setup.test.ts` (nowe)

**Intent**: Test jednostkowy `safeHttpsUrl` jako najtańszy dowód #7 na poziomie funkcji. Do tego strażnik zero-config: `createClient` z `@/lib/supabase` zwraca `null` pod domyślnym mockiem, także gdy w katalogu leży prawdziwy `.env`.

**Contract** (`safe-url`):
- *Zachowanie*: tylko absolutny URL `https:` wraca, znormalizowany przez parser. Wszystko inne daje `null`.
- *Łapana regresja*: podmiana na `startsWith("https")` albo usunięcie `try`.
- *Źródło*: research, sekcja #7, tabela sondy; `context/foundation/lessons.md:5-10`.
- *Brzegi*:
  - `javascript:alert(1)`, `JAVASCRIPT:alert(1)` i `" javascript:alert(1)"` → `null`;
  - `data:text/html,x`, `http://x.pl` i `//x.pl` → `null`;
  - `""`, `null`, `42`, `{}` i `"https//x"` → `null`;
  - `HTTPS://x.pl/a` → `https://x.pl/a`;
  - `" https://x.pl"` → `https://x.pl/`;
  - `https://x.pl/a b` → wynik zaczyna się od `https://`.
- *Anty-wzorzec, którego unikamy*: testowanie wyłącznie poprawnego URL-a.

**Contract** (`setup`): strażnik łapie regresję w postaci usunięcia albo zepsucia domyślnego mocka, po której testy zaczęłyby używać prawdziwego klienta.

#### 6. Bramka CI

**File**: `.github/workflows/ci.yml`

**Intent**: Job `ci` uruchamia testy jako wymagany krok po `npx astro check`, a przed `npm run build`. Krok nie dostaje sekretów.

**Contract**: nowy krok `- run: npm test` w jobie `ci`. Job `smoke` bez zmian.

### Success Criteria:

#### Automated Verification:

- `npm test` przechodzi (safe-url + strażnik zero-config)
- `npm test` przechodzi także przy obecnym `.env` z prawdziwymi wartościami
- `npm run lint` przechodzi
- `npx astro sync && npx astro check` przechodzi z 0 błędów
- `npm run build` przechodzi z `vitest.config.ts` w repo
- `.github/workflows/ci.yml` zawiera `npm test` w jobie `ci` przed `npm run build`

#### Manual Verification:

- Tymczasowe zastąpienie `safeHttpsUrl` wersją przepuszczającą `http:` daje czerwony `npm test` (mutacja cofnięta)

**Implementation Note**: Po przejściu weryfikacji automatycznej zatrzymaj się na ręczne potwierdzenie mutacji przed fazą 2.

---

## Phase 2: Strażnicy mappera (#1, #6)

### Overview

Budowniczy fixtur w kształtach z §7 z syntetycznymi kanarkami. Testy `mapAdToOffer` dowodzą czterech rzeczy:
- reguły „nieznane, nigdy zero” na każdym polu liczbowym i jego walucie;
- bramki sprzedaży mieszkania razem z przypadkami, których typowe ogłoszenie nigdy nie ćwiczy;
- odmowy zapisu pustego tekstu;
- białej listy danych sprzedawcy przy zachowaniu słów ogłoszeniodawcy.

Zaostrzamy `numericOrUnknown` do zapisu dziesiętnego i dopisujemy do FR-005 kolejność bramek.

### Changes Required:

#### 1. Budowniczy fixtur i kanarki

**File**: `tests/fixtures/otodom.ts` (nowy)

**Intent**: Ręcznie napisane fixtury z udokumentowanych kształtów, bez żadnych danych osób trzecich. Jedno źródło kanarków dla wszystkich testów #6 oraz dla redakcji `otodom_apify.md` w fazie 5.

**Contract**:
- Eksportowane stałe kanarków:
  - telefon `+48 600 000 001` (test szuka też zapisów `600000001` i `600 000 001`);
  - imię `Kanarek Testowy`;
  - id sprzedawcy `kanarek-seller-0001` i id użytkownika `kanarek-user-0001`;
  - ulica `ul. Kanarkowa`.
- Funkcja `flatSaleAd(overrides?)` zwraca sprzedaż mieszkania:
  - `adCategory: { name: "FLAT", type: "SELL" }`, `target: { OfferType: "sprzedaz", ProperType: "mieszkanie", seller_id, user_id }`;
  - `characteristics` z wpisami `{ key, value, localizedValue, currency? }`, przy czym enumy mają `localizedValue: ""`, a token siedzi w `value` (§7.1:378-385);
  - `owner: { name, phones }`, `contactDetails: { name, phones }` i `agency: { name }` z kanarkami;
  - `location` z `coordinates`, `reverseGeocoding` i `address.street.name`;
  - `images` z wpisami `thumbnail, small, medium, large, isExterior` (§7.4:470);
  - `description` jako HTML, który zawiera kanarkowy telefon i imię wpisane przez ogłoszeniodawcę.
- Warianty z §7:
  - `rentalFlat`: `{FLAT, RENT}`, `wynajem`, `rent: "1"`;
  - `saleHouse`: `{HOUSE, SELL}`, `sprzedaz`, `ProperType: "dom"`, **bez klucza `rent`**;
  - `rentalHouse`;
  - `typeDisagreement`: `{FLAT, RENT}` przy `sprzedaz`;
  - `categoryTrap`: `category: { name: [] }` albo `category` mówiące o mieszkaniu przy `adCategory: {HOUSE, SELL}` (§7.4:439).
- Nagłówek pliku mówi, że fixtury są syntetyczne, powstały z `otodom_fetching.md` §7 i nie wolno ich zastępować nagranym payloadem.

#### 2. Reguła „nieparsowalne” w `numericOrUnknown`

**File**: `src/lib/otodom/map.ts`

**Intent**: Fakt nigdy nie powstaje z interpretacji. String liczy się jako podany tylko w zapisie dziesiętnym (cyfry i opcjonalny ułamek po kropce). `"1e3"`, `"0x10"`, `"Infinity"`, `"+5"`, `"12,5"` i `"1 200"` dają nieznane. Decyzja z tej sesji: granicę ustala guardrail z PRD (`prd.md:46`), a nie semantyka `Number()`. Komentarz funkcji mówi, dlaczego tak jest.

**Contract**: sygnatura `numericOrUnknown(raw: unknown): number | null` bez zmian. String po `trim()` musi pasować do `/^\d+(?:\.\d+)?$/`, zanim trafi do `Number()`. Wejście typu `number` zachowuje się jak dotąd (skończone i > 0). `scripts/otodom-inspect.mjs` dalej ładuje moduł, bo nie dochodzą żadne importy.

#### 3. Testy mappera

**File**: `tests/lib/otodom/map.test.ts` (nowy)

**Intent / Contract**: cztery grupy.

**a) Nieznane nigdy nie jest zerem (#1)**
- *Zachowanie*: dla każdego z 7 kluczy (`price`, `price_per_m`, `m`, `rooms_num`, `building_floors_num`, `build_year`, `rent`) każde z wejść daje `null` w odpowiadającej kolumnie. Wejścia: brak klucza, `""`, `" "`, `"abc"`, `"0"`, `"-5"`, `"1e3"`, `"0x10"`, `"Infinity"`, `"12,5"`, `"1 200"`, `null`, `true`.
- Dla kluczy całkowitych dodatkowo `"2.5"` daje `null`.
- Wartości podane dają dokładnie liczbę wpisaną ręcznie w teście, np. `"599000"` → 599000, `"54.5"` → 54.5, `"3"` → 3.
- **Waluta**:
  - `rent: "0"` z `currency: "PLN"` daje `rent: null` i `rent_currency: null`;
  - nieznana `price` i nieznana `price_per_m` dają `price_currency: null`;
  - nieznana `price` przy podanej `price_per_m` daje walutę z `price_per_m`.
- *Łapana regresja*: `Number(x) || 0`; parsowanie tylko `rent`; waluta kopiowana bez kwoty; powrót do `Number()` dla stringów.
- *Źródło*: `prd.md:46`, `otodom_fetching.md:357-376`; research #1, „Verdict”.
- *Brzeg*: `"0"` od otodom (ID4CZQU), brak klucza `rent` na domu (ID4wZN2), `"1"` na wynajmie.
- *Anty-wzorzec, którego unikamy*: oczekiwania skopiowane z wyjścia mappera. Tu pisze się je ręcznie z reguły §7.1.

**b) Bramka sprzedaży mieszkania (#1)**
- *Zachowanie*:
  - `rentalFlat` → `not_for_sale`;
  - `saleHouse` → `not_a_flat` z `detail: "dom"`;
  - `rentalHouse` → `not_for_sale` (pierwsza bramka, decyzja z tej sesji, zapisywana w PRD);
  - `typeDisagreement` → `shape_changed`, **a nie** `not_for_sale`/`not_a_flat`;
  - `categoryTrap` → `not_a_flat`, bo wygrywa `adCategory`, a nie `category`;
  - brak `adCategory` albo `target` → `shape_changed`;
  - enum z `localizedValue: ""` i tokenem w `value` (np. `heating`) daje token, a nie `null`.
- Każda odmowa ma `ok: false` i nie zawiera pola `offer`.
- *Łapana regresja*: bramka przepięta na `category.name`; zamiana kolejności bramek; czytanie `localizedValue`.
- *Źródło*: `prd.md:84` (FR-005), `otodom_fetching.md` §7.4:451-484, §7.1:378-385.
- *Anty-wzorzec, którego unikamy*: tylko typowe ogłoszenie („skoro typowe przechodzi, brzegi też”).

**c) Żadnego pustego wiersza (#1)**
- *Zachowanie*: `title: "   "`, `description: "<p></p>"`, brak `id`, `id: "abc"`, brak `url` i `characteristics`, które nie są tablicą, dają `shape_changed`.
- *Łapana regresja*: zapis oferty bez tekstu. Baza nie ma `CHECK` na niepusty `title`/`description`, więc mapper jest jedynym strażnikiem.
- *Źródło*: `prd.md:118`; research #1, „Persistence”.

**d) Dane sprzedawcy nie trafiają do wiersza, słowa ogłoszeniodawcy zostają (#6)**
- *Zachowanie*:
  - bierzemy zmapowany wiersz dla `flatSaleAd()` i usuwamy z jego kopii `description` oraz `raw.description`;
  - `JSON.stringify` tej kopii nie zawiera żadnego zapisu kanarkowego telefonu, imienia, id sprzedawcy ani id użytkownika;
  - klucze `raw` to podzbiór `RAW_AD_KEYS` + `target` + `location`, zapisany w teście jawną listą z dokumentu, nie importem stałej;
  - `raw.target` ma dokładnie klucze `OfferType` i `ProperType`;
  - `raw.location` nie ma klucza `address`;
  - **jednocześnie** `description` zawiera kanarkowy telefon i imię dosłownie, a `raw.description` zawiera je w HTML-u;
  - `street_name` to `ul. Kanarkowa`, bo PRD tego nie zakazuje (research #6) i test utrwala to jako zamierzone.
- *Łapana regresja*: `raw` budowane przez kopiowanie całego `ad` albo przez usuwanie znanych pól; `target` kopiowany w całości; redagowanie opisu jako „naprawa” trafienia kanarka.
- *Źródło*: `prd.md:125-126`; `otodom_fetching.md:48-51, 387-393, 442`; CLAUDE.md „The advertiser's phone number and name never reach the database”.
- *Brzeg*: `agency: null` przy prywatnym ogłoszeniu (`otodom_fetching.md:390`), ten sam kanarek w polu kontaktowym i w opisie.
- *Anty-wzorzec, którego unikamy*: asercje tylko na obecność oczekiwanych pól; redagowanie opisu.

#### 4. Kolejność bramek w PRD

**File**: `context/foundation/prd.md` (FR-005)

**Intent**: Usunąć niejednoznaczność „naming which of the two it failed on” dla ogłoszenia, które łamie obie bramki. Najpierw sprawdzana jest transakcja, więc wynajem domu jest odrzucany z komunikatem o wynajmie. To poprawka PRD zgodna z regułą CLAUDE.md, a nie reguła wpisana do kodu.

**Contract**: jedno zdanie dopisane do FR-005, np. „When a listing fails both — a rental of a house — the message names the transaction, which is checked first.” Reszta FR-005 bez zmian.

### Success Criteria:

#### Automated Verification:

- `npm test` przechodzi, w tym wszystkie grupy a–d w `tests/lib/otodom/map.test.ts`
- `npm run lint` przechodzi
- `npx astro check` przechodzi z 0 błędów
- `grep -rn "1e3\|0x10" tests/lib/otodom/map.test.ts` pokazuje obie granice jako oczekiwane `null`

#### Manual Verification:

- Mutacje, każda cofnięta, dają czerwony test: (1) powrót do `Number()` bez regexu; (2) `rent_currency` bez warunku na kwotę; (3) bramka na `ad.category`; (4) `raw.target = ad.target`
- `npm run otodom:inspect -- <url żywej sprzedaży mieszkania>` dalej pokazuje podane liczby (zaostrzenie nie zjada prawdziwych wartości otodom)
- Zdanie w FR-005 czyta się jednoznacznie

**Implementation Note**: Zatrzymaj się na ręczne potwierdzenie mutacji i sprawdzenie `otodom:inspect` przed fazą 3.

---

## Phase 3: Granica fetch → zapis (#1, #6)

### Overview

Dowodzimy, że każdy sposób, w jaki strona otodom może nie dostarczyć ogłoszenia, kończy się nazwanym powodem porażki. Route zapisuje dokładnie jeden wiersz tylko po sukcesie. Wiersz faktycznie wysłany do Supabase nie niesie danych sprzedawcy i zachowuje opis. Sieć jest zaślepiona na krawędzi HTTP, bez mockowania modułów wewnętrznych.

### Changes Required:

#### 1. Budowniczy odpowiedzi HTTP

**File**: `tests/fixtures/http.ts` (nowy)

**Intent**: Pomocnik składa strony otodom z fixtury `ad` (HTML z `<script id="__NEXT_DATA__" type="application/json">` otaczającym `{ props: { pageProps: { ad } } }`) i ich zepsute warianty. Drugi pomocnik instaluje zaślepkę `globalThis.fetch`, która rozdziela żądania po hoście i nagrywa je.

**Contract**:
- `otodomPage(ad | pageProps)` zwraca `string` z HTML-em strony;
- `responseAt(body, { status, url })` zwraca `Response` z ustawionym `url`;
- `stubFetch(handler)` instaluje zaślepkę przez `vi.stubGlobal` i zwraca nagrane żądania `{ method, url, body }`;
- nieobsłużony host rzuca błąd testu.

#### 2. Testy fetcha i `ingestOffer`

**File**: `tests/lib/otodom/fetch.test.ts` (nowy)

**Intent / Contract**:
- *Zachowanie, czyli oczekiwane mapowanie na powód porażki*:
  - HTML bez `__NEXT_DATA__` → `shape_changed`;
  - `__NEXT_DATA__` z uciętym JSON-em → `shape_changed`;
  - JSON bez `props.pageProps` → `shape_changed`;
  - `pageProps` bez `ad` i bez flagi → `shape_changed`;
  - `ad.shouldShowExpiredAdPage: true` → `expired`, `pageProps.shouldShowExpiredAdPage: true` bez `ad` → `expired`;
  - 404 i 410 → `not_found` ze statusem;
  - 403 i 429 → `http_denied` ze statusem;
  - 500 i 503 → `upstream_error` ze statusem;
  - `response.url` na obcym hoście (`https://consent.example/`) → `http_denied`;
  - `response.url` na otodom, ale poza ścieżką oferty (`https://www.otodom.pl/pl/wyniki/...`) → `not_found`;
  - fetch rzuca `TypeError` → `network`;
  - przerwany `AbortSignal` → `timeout`;
  - poprawna strona → `ok` z tym samym `ad`.
- `ingestOffer` na poprawnej stronie zwraca `url` znormalizowany i `offer`. Przy obcym hoście i przy ścieżce niebędącej ofertą zaślepka fetch **nie jest wywołana ani razu**. Strona z `rentalFlat` przez `ingestOffer` daje `not_for_sale`.
- *Łapana regresja*: zamiana wygasłego ogłoszenia na pustą ofertę; 5xx zgłaszane jako `http_denied` (zły wyzwalacz fallbacku Apify); przekierowanie na stronę zgody przyjęte jako oferta.
- *Źródło*: `prd.md:118`; `otodom_fetching.md` §7.1, tabela porażek :316-325; research #1, „Failure path”.
- *Anty-wzorzec, którego unikamy*: żywe żądanie do otodom.pl i nagrany payload.

#### 3. Test route'u `POST /api/offers`

**File**: `tests/pages/api/offers.test.ts` (nowy)

**Intent**: Dowód na poziomie tego, co faktycznie wychodzi do bazy. Plik nadpisuje mock `astro:env/server` skonfigurowanym `SUPABASE_URL`/`SUPABASE_KEY` (wartości testowe, nie prawdziwe). Handler `POST` jest wywoływany z ręcznie złożonym kontekstem: `request` z `FormData { url }`, `locals.user`, `cookies` z metodą `set`, `redirect` zwracający `Response` 302.

**Contract**:
- *Zachowanie*:
  - odmowa (strona `rentalFlat`, `saleHouse`, bez `__NEXT_DATA__`, 403) daje przekierowanie na `/dashboard?error=…` z komunikatem przypisanym do powodu: „wynajmu”, „innego rodzaju nieruchomości”, „zmienić format”, „odmówił … (HTTP 403)”. Nagrane żądania **nie zawierają żadnego `POST` na `/rest/v1/offers`**;
  - sukces (`flatSaleAd()`) daje **dokładnie jeden** `POST` na `/rest/v1/offers` i przekierowanie na `/offers/<id z zaślepki>`;
  - body tego `POST` ma `source_url` równy znormalizowanemu URL-owi i `created_by` równy `locals.user.id`;
  - body z usuniętymi `description`/`raw.description` przechodzi to samo wyszukiwanie kanarków co w fazie 2 d;
  - `description` w body zawiera kanarkowy telefon i imię dosłownie.
- *Łapana regresja*: `insert` przesunięty przed sprawdzenie `result.ok`; route dopisujący do wiersza `raw: fetched.ad` albo inne pole z payloadu; zapis pustej oferty przy porażce fetcha.
- *Źródło*: `prd.md:84` (FR-005 „nothing is saved”), `prd.md:118`, `prd.md:125-126`; research #1 i #6, „Required context”.
- *Brzeg*: odmowa **po** udanym fetchu (bramka) oraz odmowa samego fetcha. Obie bez zapisu.
- *Anty-wzorzec, którego unikamy*: mockowanie `@/lib/supabase` albo `@/lib/otodom`, bo zaślepiamy tylko sieć; asercja samego statusu 302.

### Success Criteria:

#### Automated Verification:

- `npm test` przechodzi, w tym `tests/lib/otodom/fetch.test.ts` i `tests/pages/api/offers.test.ts`
- `npm test` przechodzi bez dostępu do sieci (zaślepka odrzuca każdy nieobsłużony host)
- `npm run lint` przechodzi
- `npx astro check` przechodzi z 0 błędów

#### Manual Verification:

- Mutacje, każda cofnięta, dają czerwony test: (1) `insert` przed `if (!result.ok)` w `src/pages/api/offers.ts`; (2) `raw: ad` dopisane do wstawianego wiersza; (3) usunięcie gałęzi `shouldShowExpiredAdPage` z `fetch.ts`

**Implementation Note**: Zatrzymaj się na ręczne potwierdzenie mutacji przed fazą 4.

---

## Phase 4: Strażnicy renderu (#7) i poprawka galerii

### Overview

Container API renderuje trzy widoki z zapisanym URL-em na wrogich i uszkodzonych wejściach. Galeria przestaje się wywracać na elemencie, który nie jest obiektem. Nowy stan danych dostaje fixturę na `/dev/offer-card`.

### Changes Required:

#### 1. Poprawka galerii

**File**: `src/components/offers/OfferGallery.astro`

**Intent**: Element `images`, który nie jest obiektem (`null`, liczba, string) albo nie ma URL-i, jest pomijany tak samo jak element z URL-em spoza https. Karta nie może zwrócić 500 z powodu wiersza, który każdy członek może zmienić PATCH-em. Wzorzec: `OfferBoardItem.astro:89-94`.

**Contract**: prop `images` przyjmuje dane z wiersza bazy jako niezaufane, czyli typ elementu szerszy niż `OfferImage`. Wynik filtrowania i markup bez zmian. Poprawne dane renderują się identycznie jak dziś.

#### 2. Fixtura uszkodzonych zdjęć

**File**: `src/pages/dev/_offer-fixtures.ts`, `src/pages/dev/offer-card.astro`

**Intent**: Nowy stan danych karty dostaje fixturę, zgodnie z CLAUDE.md `### UI`: `malformedImagesOffer` z `images: [null, 42, {}, { thumbnail: <https>, large: "javascript:alert(1)" }]`. Karta renderuje „Ogłoszenie nie zawiera zdjęć.”. Test renderu go używa, a kitchen sink pozwala odtworzyć go ręcznie.

**Contract**: nowy eksport obok `unsafeImagesOffer` (rzutowanie typu z komentarzem, że to celowo zepsuty wiersz). Nowa sekcja w `/dev/offer-card`. Komentarz nagłówka pliku (bez telefonów i nazwisk) dalej prawdziwy.

#### 3. Testy renderu

**File**: `tests/components/offers/render.test.ts` (nowy, albo po jednym pliku na komponent; wybiera implementujący)

**Intent**: Dowód, że widok jest bezpieczny niezależnie od mappera, bo powierzchnią ataku jest zapisany wiersz. Kontener tworzony przez `experimental_AstroContainer.create({ renderers: await loadRenderers([getContainerRenderer()]) })` z `astro:container` i `@astrojs/react/container-renderer`. Propsy budowane z fixtur `src/pages/dev/_offer-fixtures.ts` (`fullOffer`, `memberSaver`, `noLimits`) z nadpisanym jednym polem.

**Contract**:
- *Zachowanie*: dla każdego renderu wszystkie wartości `href`/`src` w HTML zaczynają się od `https://` albo `/`.
  - **`OfferCard`, `source_url`**: `javascript:alert(1)`, `JAVASCRIPT:alert(1)`, `" javascript:alert(1)"`, `data:text/html,x`, `http://www.otodom.pl/pl/oferta/x`, `//evil.example/x`, `null` i `42` (rzut). HTML **nie zawiera** tekstu „Otwórz oryginał”. `https://www.otodom.pl/pl/oferta/x` i `" https://www.otodom.pl/pl/oferta/x"` renderują link z `href` zaczynającym się od `https://www.otodom.pl/`.
  - **`OfferGallery`**:
    - `[{ thumbnail: js, large: https }]` i `[{ thumbnail: https, large: js }]` dają zero `<img>` i komunikat „Ogłoszenie nie zawiera zdjęć.”;
    - `[null]`, `[42]`, `[{}]` i `["https://x.pl/a.jpg"]` renderują się **bez wyjątku** z tym samym komunikatem;
    - mieszanka z jednym poprawnym wpisem daje dokładnie jeden `<img>` z jego `thumbnail` i jeden `<a>` z jego `large`.
  - **`OfferCard` z `images: [null]`**: render nie rzuca. To realny scenariusz 500.
  - **`OfferBoardItem`**:
    - `[null, <https>]` daje `src` poprawnego wpisu;
    - `[{ thumbnail: "javascript:…" }]`, `[{ thumbnail: "http://…" }]`, `[]` i `images: null` dają zero `<img>` i obecny placeholder;
    - jedyny `href` to `/offers/<id>`.
- *Łapana regresja*: usunięcie `safeHttpsUrl` z któregokolwiek z trzech miejsc; warunek „przynajmniej jeden URL poprawny” zamiast „oba”; wywrotka na uszkodzonym elemencie.
- *Źródło*: `context/foundation/lessons.md:5-10`; research #7, „Verdict” i poprawka 1; impl-review F1 (`context/archive/2026-09-22-paste-listing-to-card/reviews/impl-review.md:32-49`).
- *Brzeg*: wielkie litery w schemacie, wiodąca spacja, schemat względny `//`, poprawny `thumbnail` z wrogim `large`, element niebędący obiektem.
- *Anty-wzorzec, którego unikamy*: testowanie tylko poprawnego URL-a; testowanie tylko schematu bez kształtu wpisu; asercja „nie zawiera `javascript:`” zamiast białej listy.

### Success Criteria:

#### Automated Verification:

- `npm test` przechodzi, w tym testy renderu `OfferCard`, `OfferGallery` i `OfferBoardItem`
- `npm run lint` przechodzi (w tym `tokensOnlyConfig`, bez nowych wyjątków)
- `npx astro check` przechodzi z 0 błędów
- `npm run build` przechodzi

#### Manual Verification:

- Mutacje, każda cofnięta, dają czerwony test: (1) `href={offer.source_url}` zamiast `sourceUrl` w `OfferCard`; (2) usunięcie guardu elementu w galerii (test `[null]` pada wyjątkiem); (3) `thumbnail !== null || large !== null` w galerii
- `/dev/offer-card` pod `npm run dev` pokazuje nową sekcję z uszkodzonymi zdjęciami jako „Ogłoszenie nie zawiera zdjęć.”, a pozostałe sekcje wyglądają jak przed zmianą

**Implementation Note**: Zatrzymaj się na ręczne potwierdzenie przed fazą 5.

---

## Phase 5: Dokumentacja, cookbook i redakcja danych osobowych

### Overview

Kolejny agent wie, jak dodać test w tym projekcie. Reguły projektu przestają mówić, że testów nie ma. Dokument ingestii przestaje nieść dane prywatnej osoby.

### Changes Required:

#### 1. Reguły projektu

**File**: `CLAUDE.md`

**Intent**: Uzgodnić reguły ze stanem po zmianie. Każda reguła wskazuje plik referencyjny, a nie liczbę.

**Contract**:
- `## Testing`: pierwsze zdanie mówi, że `npm test` (Vitest, `vitest.config.ts`) uruchamia testy jednostkowe i renderu z `tests/`, bez sieci i bez sekretów, a `scripts/smoke.mjs` zostaje jedyną powierzchnią wymagającą żywego Supabase.
- Reguła „Do not add `vitest`…” zmienia się na „`jest`/`playwright`”, z notą, że vitest zatwierdzono 2026-09-30 (`testing-ingestion-guardrails`).
- Nowy punkt z plikami referencyjnymi:
  - `tests/fixtures/otodom.ts` dla fixtur ingestii (syntetyczne, nigdy nagrany payload);
  - `tests/pages/api/offers.test.ts` dla testu route'u zaślepionego na krawędzi HTTP;
  - `tests/components/offers/…` dla renderu przez Container API.
- `### The project runs with zero configuration`: `npm test` dochodzi do listy komend weryfikowanych bez `.env`.
- `## Commands`: CI uruchamia też `npm test`.

#### 2. README

**File**: `README.md`

**Intent**: Lista skryptów i opis jobu `ci` wymieniają `npm test`. Opis smoke przestaje sugerować, że to jedyny test.

**Contract**: wpis w liście skryptów (okolice :58) i w opisie jobów CI (okolice :219).

#### 3. Test-plan: stack, bramki, cookbook

**File**: `context/foundation/test-plan.md`

**Intent**: Zapisać stan po fazie 1 rolloutu.

**Contract**:
- **§4**:
  - wiersz unit + integration → `vitest` 5.0.3 przez `getViteConfig` bez adaptera (checked: 2026-09-30);
  - wiersz component render → Container API z rendererem React (experimental, checked: 2026-09-30);
  - wiersz API/provider mocking → zaślepka `globalThis.fetch` na krawędzi HTTP (`tests/fixtures/http.ts`).
- **§5**: wiersz „unit (`npm test`)” → required, wpięty w job `ci` (Phase 1).
- **§6.1**: jak dodać test reguły ingestii. Zawiera:
  - lokalizację `tests/lib/otodom/`;
  - fixtury z `tests/fixtures/otodom.ts` (syntetyczne, z kanarkami, wyrocznią jest `otodom_fetching.md` §7, nigdy wyjście mappera);
  - test referencyjny `tests/lib/otodom/map.test.ts`;
  - wzorzec „serialised-row canary search + description zachowany”;
  - zasadę, że każdy nowy zapisujący (re-fetch FR-009, fallback Apify z `sellerPhone`/`agencyName`) dostaje ten sam test kanarkowy na wierszu, który faktycznie wysyła;
  - route zaślepiony na krawędzi HTTP: `tests/pages/api/offers.test.ts`;
  - komendę uruchomienia `npm test -- tests/lib/otodom`.
- **§6.2**: jak dodać test renderu. Zawiera:
  - kontener z rendererem React;
  - propsy z `src/pages/dev/_offer-fixtures.ts`;
  - asercję typu biała lista na `href`/`src`;
  - wejścia uszkodzone (`null`, nie-obiekt, wrogi `large`);
  - test referencyjny;
  - komendę uruchomienia;
  - uwagę, że API jest eksperymentalne i może pęknąć przy aktualizacji minor/patch Astro.
- **§6.6**: notatki z fazy 1:
  - fixtury ręczne zamiast „recorded” z §3, bo nagrań nie ma i nie wolno ich commitować;
  - Vitest bez adaptera, więc import `cloudflare:*` w `src/` wymagałby osobnej konfiguracji;
  - mock `astro:env/server`;
  - granica „nieparsowalne” = zapis dziesiętny;
  - odroczone: `raw.images` nieprzefiltrowane (Phase 4/S-04), host `source_url`, render S-08.

#### 4. Redakcja danych osobowych w dokumencie ingestii

**File**: `context/foundation/ingestion/otodom_apify.md` (:298-299)

**Intent**: Zastąpić wyglądające na prawdziwe telefon i imię prywatnego sprzedawcy kanarkami z `tests/fixtures/otodom.ts`. Adnotacja mówi, że wartości zredagowano 2026-09-30 i że oryginalna odpowiedź zawierała prawdziwy numer i pełne imię i nazwisko. Wartość dowodowa sekcji 6.1 (pola istnieją i niosą dane osobowe) zostaje. Historii git nie przepisujemy, bo CLAUDE.md tego zabrania. To redukcja ekspozycji, a nie usunięcie.

**Contract**: dwie linie bloku kodu i jedno zdanie adnotacji. Reszta §6.1 bez zmian.

### Success Criteria:

#### Automated Verification:

- `npm test`, `npm run lint`, `npx astro check` i `npm run build` przechodzą
- `grep -rn "512228855\|Krupa" context/foundation src tests scripts` nic nie znajduje
- `grep -n "TBD — see §3 Phase 1" context/foundation/test-plan.md` nic nie znajduje
- `grep -n "npm test" CLAUDE.md README.md .github/workflows/ci.yml` trafia w każdym z trzech plików

#### Manual Verification:

- §6.1 i §6.2 wystarczą, żeby dodać nowy test ingestii albo renderu bez czytania tej rozmowy (ścieżka, nazwa, test referencyjny, komenda)
- Świeży klon bez `.env`: `npm ci && npm test` przechodzi

---

## Testing Strategy

### Unit Tests:

- `safeHttpsUrl`: schematy, wielkość liter, białe znaki, typy niebędące stringiem.
- `mapAdToOffer`: 7 pól liczbowych × wejścia brzegowe, waluty, bramka (5 wariantów), puste teksty, kanarki sprzedawcy razem z zachowanym opisem.
- `fetchOfferAd` / `ingestOffer`: każdy powód porażki, brak wywołania fetch przed normalizacją.

### Integration Tests:

- `POST /api/offers` w procesie, z jedną zaślepką `fetch` dla otodom i Supabase REST: brak `POST` przy odmowie, dokładnie jeden `POST` bez kanarków przy sukcesie.
- Render przez Container API: `OfferCard`, `OfferGallery`, `OfferBoardItem`.

### Manual Testing Steps:

1. Mutacje wymienione w kryteriach ręcznych każdej fazy. Każda daje czerwony test i zostaje cofnięta.
2. `npm run otodom:inspect -- <url żywej sprzedaży mieszkania>` po zaostrzeniu `numericOrUnknown`: podane liczby zostają podane.
3. `/dev/offer-card`: nowa sekcja z uszkodzonymi zdjęciami.

## Performance Considerations

Brak wpływu na runtime Workera. Zaostrzenie `numericOrUnknown` to jeden zakotwiczony regex na krótkim stringu. Pełny `npm test` powinien trwać kilka sekund (research: 4 pliki w 1,39 s). Do CI dochodzi jeden krok.

## Migration Notes

Nie dotyczy: żadnej migracji ani zmiany danych. Wiersze zapisane wcześniej z wartością typu `"1e3"` nie istnieją, bo otodom nigdy takiej nie wysłał. Istniejące wiersze z uszkodzonym `images` przestaną wywracać kartę.

## References

- Research: `context/changes/testing-ingestion-guardrails/research.md`
- Test-plan: `context/foundation/test-plan.md` (§2 Risk Response Guidance #1, #6, #7; §3 Phase 1)
- PRD: `context/foundation/prd.md:46, 84, 118, 125-126`
- Ingestion: `context/foundation/ingestion/otodom_fetching.md` §7.1 (:316-325, :357-393), §7.4 (:439-484)
- Lekcja: `context/foundation/lessons.md:5-10`
- Wzorzec null-safe: `src/components/offers/OfferBoardItem.astro:89-94`
- Poprzednia weryfikacja ręczna: `context/archive/2026-09-22-paste-listing-to-card/plan.md:437`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Toolchain Vitest i bramka CI

#### Automated

- [x] 1.1 `npm test` przechodzi (safe-url + strażnik zero-config) — fe8b7ee
- [x] 1.2 `npm test` przechodzi także przy obecnym `.env` z prawdziwymi wartościami — fe8b7ee
- [x] 1.3 `npm run lint` przechodzi — fe8b7ee
- [x] 1.4 `npx astro sync && npx astro check` przechodzi z 0 błędów — fe8b7ee
- [x] 1.5 `npm run build` przechodzi z `vitest.config.ts` w repo — fe8b7ee
- [x] 1.6 `.github/workflows/ci.yml` zawiera `npm test` w jobie `ci` przed `npm run build` — fe8b7ee

#### Manual

- [x] 1.7 Tymczasowe zastąpienie `safeHttpsUrl` wersją przepuszczającą `http:` daje czerwony `npm test` (mutacja cofnięta) — fe8b7ee

### Phase 2: Strażnicy mappera (#1, #6)

#### Automated

- [x] 2.1 `npm test` przechodzi, w tym wszystkie grupy a–d w `tests/lib/otodom/map.test.ts` — 4b9d931
- [x] 2.2 `npm run lint` przechodzi — 4b9d931
- [x] 2.3 `npx astro check` przechodzi z 0 błędów — 4b9d931
- [x] 2.4 `grep -rn "1e3\|0x10" tests/lib/otodom/map.test.ts` pokazuje obie granice jako oczekiwane `null` — 4b9d931

#### Manual

- [x] 2.5 Mutacje, każda cofnięta, dają czerwony test: (1) powrót do `Number()` bez regexu; (2) `rent_currency` bez warunku na kwotę; (3) bramka na `ad.category`; (4) `raw.target = ad.target` — 4b9d931
- [x] 2.6 `npm run otodom:inspect -- <url żywej sprzedaży mieszkania>` dalej pokazuje podane liczby (zaostrzenie nie zjada prawdziwych wartości otodom) — 4b9d931
- [x] 2.7 Zdanie w FR-005 czyta się jednoznacznie — 4b9d931

### Phase 3: Granica fetch → zapis (#1, #6)

#### Automated

- [x] 3.1 `npm test` przechodzi, w tym `tests/lib/otodom/fetch.test.ts` i `tests/pages/api/offers.test.ts` — 580d500
- [x] 3.2 `npm test` przechodzi bez dostępu do sieci (zaślepka odrzuca każdy nieobsłużony host) — 580d500
- [x] 3.3 `npm run lint` przechodzi — 580d500
- [x] 3.4 `npx astro check` przechodzi z 0 błędów — 580d500

#### Manual

- [x] 3.5 Mutacje, każda cofnięta, dają czerwony test: (1) `insert` przed `if (!result.ok)` w `src/pages/api/offers.ts`; (2) `raw: ad` dopisane do wstawianego wiersza; (3) usunięcie gałęzi `shouldShowExpiredAdPage` z `fetch.ts` — 580d500

### Phase 4: Strażnicy renderu (#7) i poprawka galerii

#### Automated

- [x] 4.1 `npm test` przechodzi, w tym testy renderu `OfferCard`, `OfferGallery` i `OfferBoardItem`
- [x] 4.2 `npm run lint` przechodzi (w tym `tokensOnlyConfig`, bez nowych wyjątków)
- [x] 4.3 `npx astro check` przechodzi z 0 błędów
- [x] 4.4 `npm run build` przechodzi

#### Manual

- [x] 4.5 Mutacje, każda cofnięta, dają czerwony test: (1) `href={offer.source_url}` zamiast `sourceUrl` w `OfferCard`; (2) usunięcie guardu elementu w galerii (test `[null]` pada wyjątkiem); (3) `thumbnail !== null || large !== null` w galerii
- [x] 4.6 `/dev/offer-card` pod `npm run dev` pokazuje nową sekcję z uszkodzonymi zdjęciami jako „Ogłoszenie nie zawiera zdjęć.”, a pozostałe sekcje wyglądają jak przed zmianą

### Phase 5: Dokumentacja, cookbook i redakcja danych osobowych

#### Automated

- [ ] 5.1 `npm test`, `npm run lint`, `npx astro check` i `npm run build` przechodzą
- [ ] 5.2 `grep -rn "512228855\|Krupa" context/foundation src tests scripts` nic nie znajduje
- [ ] 5.3 `grep -n "TBD — see §3 Phase 1" context/foundation/test-plan.md` nic nie znajduje
- [ ] 5.4 `grep -n "npm test" CLAUDE.md README.md .github/workflows/ci.yml` trafia w każdym z trzech plików

#### Manual

- [ ] 5.5 §6.1 i §6.2 wystarczą, żeby dodać nowy test ingestii albo renderu bez czytania tej rozmowy (ścieżka, nazwa, test referencyjny, komenda)
- [ ] 5.6 Świeży klon bez `.env`: `npm ci && npm test` przechodzi
