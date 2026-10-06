# Pod-powody na granicy pobrania z otodom — Implementation Plan

## Overview

`fetchOfferAd` przestaje zwracać jeden powód `shape_changed` dla czterech różnych
źródeł i zaczyna oddawać dane do wpisu: status, lądowanie, `content-type`, długość
treści, obecność znacznika, nagłówki `cf-mitigated` i `retry-after`, a przy wyjątku
jego nazwę, komunikat, przyczynę i fazę. `POST /api/offers` loguje je przez
`logEvent`. Strona podana z kodem 200 bez danych ogłoszenia przestaje być dla członka
„zmienionym formatem", a rozpoznana blokada dostaje własny powód i komunikat.

To krok 2 z sekcji 6 raportu
`context/audits/observability/2026-10-05_verify-add-offer-from-otodom.md`; zamyka A4,
A6, A15 i nagłówkową resztę A3.

## Current State Analysis

- `src/lib/otodom/fetch.ts:63-65,70-72,76,85` zwraca `shape_changed` z czterech
  miejsc: brak `__NEXT_DATA__`, nieparsowalny JSON, brak `pageProps`, brak `ad`.
  Żadne nie niesie statusu, adresu lądowania, typu treści ani długości.
- Jeden `try` (`fetch.ts:37-61`) obejmuje `fetch()`, `new URL(response.url)` i
  `response.text()`. `catch` wiąże błąd tylko po to, by odróżnić `timeout` od
  `network`; nazwa, komunikat i przyczyna giną, a `network` wchłania każdy wyjątek
  z tego bloku.
- Lądowanie poza otodom to `http_denied` bez statusu i hosta (`fetch.ts:54`).
  Lądowanie na otodom poza ścieżką oferty to `not_found` (`fetch.ts:56`), które
  `INGEST_OUTCOME` mapuje na `refused`, czyli `info` (`src/pages/api/offers.ts:63`).
- `FetchOfferResult` niesie przy porażce tylko `reason` i `status?`
  (`src/lib/otodom/types.ts:12`). `ingestOffer` rozkłada wynik i dokłada `stage`
  (`src/lib/otodom/index.ts:32`), więc nowe pola przejdą bez zmiany logiki.
- Trasa loguje `stage`, `reason`, `status`, `detail` (`src/pages/api/offers.ts:147-153`).
  `failureMessage` i `INGEST_OUTCOME` są wyczerpujące po `IngestFailureReason`
  (`offers.ts:16-47,56-70`): nowy powód bez wpisu w obu nie przejdzie
  `npx astro check`.
- Reporter ma 19 pól (`src/lib/log.ts:9-29`), w tym `error_name`. Wartość wchodzi
  jako niepusty tekst ucięty do 300 znaków, skończona liczba albo boolean.
- `fetch.ts` ma wyłącznie importy typów, bo `scripts/otodom-inspect.mjs:11` ładuje
  go przez type stripping Node'a. Skrypt wypisuje dziś `reason` i `status`
  (`otodom-inspect.mjs:43-46`).
- Test prywatności trasy zakazuje w logu tekstów `otodom.pl`, `mieszkanie`,
  `warszawa` i słów sluga dla każdego scenariusza
  (`tests/pages/api/offers.test.ts:679-693`).
- Nikt nie zaobserwował strony anty-botowej otodom:
  `context/foundation/ingestion/otodom_fetching.md` §2 i §9.1 notują brak wyzwania
  i brak nagłówka `cf-mitigated`. Dokumentacja nie mówi też, dokąd otodom
  przekierowuje wygasłą ofertę.
- Runbook rozróżnia trzy wpisy (`context/foundation/deployment-runbook.md:164-168`)
  i każe przed wnioskiem wdrożyć Workera-sondę.

## Desired End State

Osoba czytająca Workers Logs odróżnia z jednego wpisu `offer_add`: rozpoznaną
blokadę (`challenged`), stronę 200 bez danych (`data_missing`), trzy rodzaje
zmienionego kształtu (`shape_changed` z `detail`), nieznane lądowanie na otodom
(`unexpected_landing`) i lądowanie poza otodom (`http_denied` z hostem). Każdy wpis
porażki z etapu `fetch` niesie to, co odpowiedź o sobie powiedziała. Wyjątek z
`fetch()` albo z czytania treści ma we wpisie nazwę, komunikat bez adresów, przyczynę
i fazę.

Kontrakt powodów:

| Sytuacja                                           | `reason`              | `detail`                | Wynik / poziom   | Komunikat dla członka       |
| -------------------------------------------------- | --------------------- | ----------------------- | ---------------- | --------------------------- |
| Nagłówek `cf-mitigated` niepusty, dowolny status   | `challenged`          | —                       | `failed` / error | nowy, o blokadzie           |
| 404 / 410                                          | `not_found`           | —                       | `refused` / info | bez zmian                   |
| ≥ 500                                              | `upstream_error`      | —                       | `failed` / error | bez zmian                   |
| Inny status spoza 2xx                              | `http_denied`         | —                       | `failed` / error | bez zmian, z „(HTTP n)"     |
| Lądowanie poza otodom                              | `http_denied`         | —                       | `failed` / error | bez zmian, bez „(HTTP 200)" |
| Lądowanie na otodom pod `/wyniki` lub `/pl/wyniki` | `not_found`           | —                       | `refused` / info | bez zmian                   |
| Lądowanie na otodom pod inną ścieżką poza ofertą   | `unexpected_landing`  | —                       | `failed` / error | zdanie `not_found`          |
| 2xx, brak `__NEXT_DATA__`                          | `data_missing`        | —                       | `failed` / error | nowy, neutralny             |
| Nieparsowalny JSON                                 | `shape_changed`       | `next_data_unparseable` | `failed` / error | „zmienić format"            |
| Brak `pageProps`                                   | `shape_changed`       | `page_props_missing`    | `failed` / error | „zmienić format"            |
| Brak `ad` bez flagi wygaśnięcia                    | `shape_changed`       | `ad_missing`            | `failed` / error | „zmienić format"            |
| Wyjątek z `fetch()`                                | `timeout` / `network` | —                       | `failed` / error | bez zmian                   |
| Wyjątek z `response.text()`                        | `timeout` / `network` | —                       | `failed` / error | bez zmian                   |

Wiersze są w kolejności sprawdzania: pierwszy pasujący wygrywa.

Weryfikacja: `npm test`, `npx astro check`, `npm run lint` i `npm run build`
przechodzą; testy trasy porównują cały wpis przez `toStrictEqual` dla każdego wiersza
tabeli; tabela nieobecności nie znajduje w logu adresu oferty, słów jej sluga, query
stringa ani treści strony.

### Key Discoveries:

- `responseAt()` w `tests/fixtures/http.ts:79-86` zostawia `response.url` puste,
  chyba że test poda adres. Wpisy istniejących scenariuszy nie dostaną więc
  `landed_host`, dopóki fixture go nie poda — w produkcji `response.url` jest zawsze
  ustawione.
- `ingestOffer` rozkłada wynik pobrania (`src/lib/otodom/index.ts:32`), więc typ
  `IngestResult` wystarczy rozszerzyć o nowe pole.
- `INGEST_OUTCOME` jest tabelą po powodzie, nie po sytuacji. Poziom zależny od
  ścieżki lądowania wymaga osobnego powodu (`unexpected_landing`), nie warunku w
  trasie.
- `report()` w trasie rozkłada pola wywołującego (`offers.ts:78-80`), a reporter
  buduje wpis ze swojej listy. Pole spoza listy nie trafi do logu, cokolwiek trasa
  poda — dlatego faza 1 idzie pierwsza.
- `dbFields()` (`offers.ts:91-93`) jest wzorem jawnego mapowania danych na klucze
  wpisu w miejscu wywołania.
- `tests/lib/otodom/fetch.test.ts:81-84` i `:185-193` porównują cały wynik przez
  `toEqual`, więc każde nowe pole wyniku jest tam widoczne od razu.

## What We're NOT Doing

- Rozpoznawanie blokady po treści strony: żadnych słów kluczowych, progów długości
  ani heurystyki po `content-type`. Rozpoznana jest wyłącznie odpowiedź z nagłówkiem
  `cf-mitigated`.
- Czytanie treści odpowiedzi spoza 2xx. Wpis dla 403/429 niesie status i nagłówki,
  bez `body_length` i `marker_present`.
- Logowanie treści strony, payloadu `ad`, query stringa albo ścieżki strony oferty.
- Dane o odpowiedzi we wpisach `started`, `saved` i `duplicate`.
- Dryf mappera (A13, A14), odczyty karty i tablicy (A8, A9, P2), pozostałe trasy
  (P3, P6–P8), czasy trwania (P9), klient (P10), przejście na Apify.
- Zmiana `scripts/smoke.mjs`: kontrakt `POST /api/offers` (302 i cele przekierowań)
  się nie zmienia, a smoke nie sięga otodom.pl.
- Bramka wizualna: żaden widok się nie zmienia. Nowe zdania trafiają do istniejącego
  alertu `?error=` na `/dashboard`.
- Parser HTML, nowa zależność, zmiana w `package.json`.

## Implementation Approach

Kolejność idzie od ujścia do źródła, żeby żadna faza nie zostawiała pola, które
nie ma dokąd trafić. Najpierw reporter dostaje klucze. Potem granica pobrania zwraca
nowe powody i dane; ponieważ typ powodu się rozszerza, trasa dostaje w tej samej
fazie wpisy w obu tabelach wyczerpujących i nowe zdania. Dopiero trzecia faza każe
trasie zalogować dane. Czwarta aktualizuje dokumenty i narzędzie diagnostyczne.

Fazy 2 i 3 zaczynają się od czerwonych testów na krawędzi HTTP
(`context/foundation/test-plan.md` §6.9): `stubFetch` podaje odpowiedź, test czyta
wynik albo konsolę, nic w `src/` nie jest mockowane. Fixture'y są pisane ręcznie.

## Critical Implementation Details

**Kolejność sprawdzeń po nagłówkach.** `cf-mitigated` jest sprawdzany przed statusem,
więc 403 z tym nagłówkiem to `challenged`, nie `http_denied`. Status jest w danych
zawsze, gdy przyszły nagłówki, i nie decyduje o tekście: komunikat `http_denied`
pokazuje „(HTTP n)" tylko dla n ≥ 400, inaczej lądowanie poza otodom dostałoby
„(HTTP 200)".

**Dwa wąskie `try`.** Pierwszy obejmuje wyłącznie `await fetch(...)`, drugi wyłącznie
`await response.text()`. Odczyt nagłówków, statusu i adresu lądowania stoi między
nimi, poza `try`. Adres lądowania, którego nie da się sparsować (`URL.canParse`),
jest `unexpected_landing` bez hosta — `src/` nie ma dziś żadnego `throw` i tak ma
zostać.

**Komunikat błędu bez adresów.** Runtime potrafi zacytować adres żądania w
`error.message`, a slug i query string nie mogą trafić do logu. Wycinanie odbywa się
w `fetch.ts`, zanim moduł odda dane, tym samym wzorcem dla komunikatu i przyczyny.

## Phase 1: Pola reportera

### Overview

Biała lista reportera dostaje jedenaście kluczy, bez których wpis z fazy 3 byłby
cicho obcinany.

### Changes Required:

#### 1. Przypadek w teście reportera

**File**: `tests/lib/log.test.ts`

**Intent**: Dowieść, że wpis z etapu pobrania przechodzi przez reporter w całości, i
że `false` oraz zero są wartościami, a nie brakiem.

**Contract**: Jeden nowy `it` na wzór przypadku `auth_check` (`log.test.ts:38-68`):
wpis ze wszystkimi jedenastoma nowymi kluczami, w tym `marker_present: false` i
`body_length: 0`, porównany przez `toStrictEqual` z obiektem napisanym ręcznie.

#### 2. Klucze na liście

**File**: `src/lib/log.ts`

**Intent**: Dopuścić do logu dane o odpowiedzi otodom i o wyjątku pobrania.

**Contract**: `FIELDS` zyskuje `landed_host`, `landed_path`, `landed_listing`,
`content_type`, `body_length`, `marker_present`, `cf_mitigated`, `retry_after`,
`error_message`, `error_cause`, `phase`. `error_name` już jest. Reguły wartości
i limit 300 znaków bez zmian.

### Test contract

- Najpierw czerwony: nowy przypadek nie przechodzi, bo reporter pomija klucze spoza
  listy.
- Przypadek „leaves out a key that is not on the list" (`log.test.ts:77-85`) zostaje
  bez zmian i nadal przechodzi.

### Success Criteria:

#### Automated Verification:

- Test reportera przechodzi: `npm test -- tests/lib/log.test.ts`
- Cały zestaw przechodzi: `npm test`
- Lint przechodzi: `npm run lint`
- Typy przechodzą: `npx astro sync && npx astro check`

---

## Phase 2: Granica pobrania

### Overview

`fetchOfferAd` zwraca powody z tabeli w „Desired End State" razem z danymi do wpisu.
Trasa dostaje trzy nowe powody w obu tabelach wyczerpujących i dwa nowe zdania,
ale jeszcze nie loguje danych.

### Changes Required:

#### 1. Fixture'y odpowiedzi

**File**: `tests/fixtures/http.ts`

**Intent**: Pozwolić testowi podać nagłówki odpowiedzi i odpowiedź, której treści nie
da się przeczytać, oraz dać syntetyczną stronę wyzwania.

**Contract**: `responseAt` przyjmuje opcjonalne `headers` (nadpisują domyślny
`Content-Type`). Nowy eksport budujący `Response`, którego `text()` odrzuca
(strumień kończący się błędem). Nowa stała ze stroną wyzwania napisaną ręcznie, bez
`__NEXT_DATA__`, z kanarkiem w treści, którego żaden wpis nie może zawierać.

#### 2. Testy granicy pobrania

**File**: `tests/lib/otodom/fetch.test.ts`

**Intent**: Zapisać kontrakt powodów i danych jako czerwone testy, zanim zmieni się
moduł.

**Contract**: Szczegóły w „Test contract" niżej. Istniejące porównania całego wyniku
(`:81-84`, `:185-193`, `:197-204`) są przepisane ręcznie na nowy kształt.

#### 3. Typ wyniku

**File**: `src/lib/otodom/types.ts`

**Intent**: Nazwać nowe powody i kształt danych do wpisu.

**Contract**: `FetchFailureReason` zyskuje `challenged`, `data_missing`,
`unexpected_landing`. Nowy `FetchEvidence` z polami opcjonalnymi: `landedHost`,
`landedPath`, `landedListing`, `contentType`, `bodyLength`, `markerPresent`,
`cfMitigated`, `retryAfter`, `errorName`, `errorMessage`, `errorCause`, `phase`
(`"headers" | "body"`). Gałąź porażki `FetchOfferResult` zyskuje `detail?: string`
i `evidence: FetchEvidence`. Plik zostaje samymi deklaracjami typów.

#### 4. Moduł pobrania

**File**: `src/lib/otodom/fetch.ts`

**Intent**: Rozdzielić źródła porażki, zebrać dane o odpowiedzi i o wyjątku, zawęzić
`try` do pojedynczych wywołań I/O.

**Contract**: Kolejność sprawdzeń i powody według tabeli w „Desired End State".
Dane:

- `status` — zawsze, gdy przyszły nagłówki;
- `contentType`, `cfMitigated`, `retryAfter` — wartości nagłówków, gdy niepuste;
- `landedHost` — gdy `response.url` jest niepuste i parsowalne;
- `landedPath` — sama ścieżka, bez query i fragmentu, tylko gdy lądowanie nie jest
  stroną oferty na otodom;
- `landedListing` — token `ID…` kończący slug, tylko gdy lądowanie jest stroną
  oferty na otodom;
- `bodyLength`, `markerPresent` — tylko gdy treść została przeczytana;
- `errorName`, `errorMessage`, `errorCause`, `phase` — tylko z `catch`; komunikat
  i przyczyna z adresami zastąpionymi przez `<url>`.

Rozpoznana ścieżka wyników: `/wyniki` lub `/pl/wyniki`, sama albo z dalszymi
segmentami. Moduł zachowuje wyłącznie importy typów; wzorce i tokeny są lokalne, jak
`OTODOM_HOSTS` dziś.

```ts
// adresy w komunikacie błędu: slug i query string nie mogą wyjść z modułu
message.replace(/https?:\/\/\S+/g, "<url>");
```

#### 5. Wynik ingestii

**File**: `src/lib/otodom/index.ts`

**Intent**: Przepuścić dane z pobrania do wywołującego.

**Contract**: Gałąź porażki `IngestResult` zyskuje `evidence?: FetchEvidence`;
obecne dla `stage: "fetch"`, nieobecne dla `url` i `map`.

#### 6. Tabele powodów w trasie

**File**: `src/pages/api/offers.ts`

**Intent**: Utrzymać wyczerpującość obu tabel i dać członkowi zdania, które nie
twierdzą więcej, niż kod wie.

**Contract**: `INGEST_OUTCOME`: `challenged`, `data_missing`, `unexpected_landing`
→ `failed`. `failureMessage`:

- `challenged` — „otodom.pl zablokował pobranie ogłoszenia — odpowiedział stroną
  zabezpieczającą przed automatami. Nic nie zostało zapisane — spróbuj ponownie
  później.";
- `data_missing` — „otodom.pl przysłał stronę bez danych ogłoszenia — mógł
  zablokować pobranie albo zmienić format strony. Nic nie zostało zapisane.";
- `unexpected_landing` — zdanie `not_found`;
- `http_denied` — „(HTTP n)" tylko dla n ≥ 400.

#### 7. Istniejące wiersze testu trasy

**File**: `tests/pages/api/offers.test.ts`

**Intent**: Utrzymać zestaw zielony po zmianie powodów, bez wyprzedzania fazy 3.

**Contract**: W tabeli `REFUSALS` (`:131-210`) wiersz „a page without
`__NEXT_DATA__`" oczekuje powodu `data_missing` i fragmentu nowego zdania; wiersz
„a redirect off otodom" oczekuje `status: 200` we wpisie i zdania bez „(HTTP".
Pozostałe wiersze bez zmian.

### Test contract

`tests/lib/otodom/fetch.test.ts`, każdy wynik porównany w całości z obiektem
napisanym ręcznie:

- Cztery źródła dawnego `shape_changed`, każde z własnym powodem albo `detail`, z
  `bodyLength` równym długości fixture'a i właściwym `markerPresent`.
- `cf-mitigated` przy 200, 403 i 503 daje `challenged`; obok stoi ta sama odpowiedź
  bez nagłówka z powodem ze statusu. `retry-after` przy 429 jest w danych.
- Lądowanie: poza otodom (z query stringiem — `landedPath` bez niego), na
  `/pl/wyniki/…`, na `/wyniki`, na nieznanej ścieżce otodom, na innej ofercie
  (sukces bez zmian), na innej ofercie z zepsutą treścią (`landedListing`, brak
  `landedPath`), ścieżka zaczynająca się od `/pl/wynikiX` (to `unexpected_landing`).
- Wyjątek z `fetch()`: `phase: "headers"`, nazwa i komunikat; komunikat cytujący
  adres oferty z query stringiem wychodzi z `<url>`; błąd z `cause` niesie
  `errorCause`.
- Wyjątek z `response.text()`: `phase: "body"`, a dane o odpowiedzi (status,
  `contentType`) są obecne. Przerwany sygnał w tej fazie to `timeout`.
- Porażka nadal nie niesie `ad` (`failure()` w `:32-38` zostaje).

### Success Criteria:

#### Automated Verification:

- Testy granicy pobrania przechodzą: `npm test -- tests/lib/otodom/fetch.test.ts`
- Testy trasy przechodzą: `npm test -- tests/pages/api/offers.test.ts`
- Cały zestaw przechodzi: `npm test`
- Typy przechodzą, obie tabele wyczerpujące: `npx astro sync && npx astro check`
- Lint przechodzi: `npm run lint`
- `fetch.ts` i `types.ts` mają wyłącznie importy typów: `grep -n "^import" src/lib/otodom/fetch.ts src/lib/otodom/types.ts`
- Skrypt diagnostyczny ładuje moduł: `node scripts/otodom-inspect.mjs --help`

#### Manual Verification:

- Trzy nowe zdania dla członka przeczytane w całości i zaakceptowane

---

## Phase 3: Wpis trasy

### Overview

`POST /api/offers` loguje dane z granicy pobrania przy każdej porażce etapu `fetch`.
Test prywatności dostaje scenariusz dla każdego nowego rodzaju wpisu.

### Changes Required:

#### 1. Testy wpisów

**File**: `tests/pages/api/offers.test.ts`

**Intent**: Zapisać cały wpis dla każdego nowego wiersza kontraktu i dowieść, czego
w nim nie ma.

**Contract**: Szczegóły w „Test contract" niżej. Lista `FORBIDDEN` (`:679-693`)
rozdziela się na listę wspólną i listę ścisłą; scenariusz, w którym host lądowania
jest tematem, wskazuje listę wspólną jawnie, w swoim wierszu.

#### 2. Dane we wpisie

**File**: `src/pages/api/offers.ts`

**Intent**: Zalogować to, co moduł pobrania oddał, przez jawne mapowanie na klucze
reportera.

**Contract**: Pomocnik obok `dbFields` mapuje `FetchEvidence` na `landed_host`,
`landed_path`, `landed_listing`, `content_type`, `body_length`, `marker_present`,
`cf_mitigated`, `retry_after`, `error_name`, `error_message`, `error_cause`, `phase`.
Wpis porażki ingestii (`:147-153`) go dokłada. Żadne inne wyjście trasy się nie
zmienia; liczba wpisów na żądanie bez zmian.

### Test contract

Cały wpis ręcznie, `toStrictEqual`, identyfikatory jako literały:

- `challenged` przy 403 z `cf-mitigated: challenge`: `status`, `cf_mitigated`,
  `content_type`; poziom error; zdanie o blokadzie.
- `data_missing`: `status: 200`, `body_length`, `marker_present: false`.
- `shape_changed` z `detail: "next_data_unparseable"`: `marker_present: true`.
- `unexpected_landing`: `landed_host`, `landed_path`; poziom error; zdanie
  `not_found`. Obok: lądowanie na `/pl/wyniki/…` jako `not_found` na info, z
  `landed_host` i `landed_path`.
- Lądowanie poza otodom: `landed_host`, `landed_path` bez query stringa.
- `network` z fazy `headers`: `error_name`, `error_message`, `phase`.
- `timeout` z fazy `body`: `phase: "body"` i `status`.

Tabela nieobecności (`:702-789`) zyskuje scenariusze etapu `fetch`:

- strona wyzwania z kanarkiem w treści — kanarka nie ma w logu;
- lądowanie poza otodom z query stringiem niosącym adres oferty;
- błąd sieci, którego komunikat cytuje pełny adres z `utm_source`;
- przekierowanie na inną ofertę zakończone `data_missing` — słów sluga lądowania
  nie ma w logu, token `ID…` jest;
- lądowanie na ścieżce wyników.

Lista wspólna (każdy scenariusz): kanarki sprzedawcy, adres członka, tytuł,
„Failing row", `utm_source`, `olx.pl`, pełny adres oferty, `/oferta/`, słowa sluga
oferty jako całość. Lista ścisła dokłada `otodom.pl`, `mieszkanie`, `warszawa` i
obowiązuje każdy scenariusz bez adresu lądowania. Fixture ścieżki wyników nie
zawiera słów ze sluga oferty.

Dowód jednorazowy z §6.9: przekazać treść strony z trasy i dopisać jej klucz do
reportera — scenariusze muszą zczerwienieć; potem cofnąć.

### Success Criteria:

#### Automated Verification:

- Testy trasy przechodzą: `npm test -- tests/pages/api/offers.test.ts`
- Cały zestaw przechodzi: `npm test`
- Typy przechodzą: `npx astro sync && npx astro check`
- Lint przechodzi: `npm run lint`
- Build przechodzi: `npm run build`

#### Manual Verification:

- Stryker zawężony do trzech plików uruchomiony, każdy ocalały mutant osądzony: `npx stryker run --mutate "src/lib/otodom/fetch.ts,src/lib/log.ts,src/pages/api/offers.ts"`
- Dowód celowego wycieku z §6.9 wykonany i cofnięty

---

## Phase 4: Runbook i narzędzia

### Overview

Dokumenty opisują log, który po fazie 3 istnieje, a skrypt diagnostyczny pokazuje
te same dane co wpis.

### Changes Required:

#### 1. Runbook

**File**: `context/foundation/deployment-runbook.md`

**Intent**: Dać czytelnikowi logu rozróżnienie, od którego zależy decyzja o Apify.

**Contract**: Lista w „Ingestion starts failing (otodom)" (`:164-168`) obejmuje
`challenged`, `http_denied` (ze statusem albo z `landed_host`), `data_missing`,
`unexpected_landing`, trzy wartości `detail` dla `shape_changed` z etapu `fetch`
oraz `shape_changed` z etapu `map`, z polami do odczytania przy każdym. Akapit o
sondzie zostaje jako potwierdzenie przed decyzją, ze zdaniem, że `challenged` i
powtarzalne `data_missing` są sygnałem do jej uruchomienia. „Symptoms that lie"
zyskuje wiersz: członek czyta o stronie bez danych, przyczyną bywa blokada podana
z kodem 200, akcja — czytać `body_length`, `content_type` i `cf_mitigated` wpisu.

#### 2. Dokument ingestii

**File**: `context/foundation/ingestion/otodom_fetching.md`

**Intent**: Uzgodnić tabelę warunków z tym, co kod robi.

**Contract**: Tabela w §7.1 („Checks worth having in that function") zyskuje wiersze
dla nagłówka `cf-mitigated`, dla lądowania na ścieżce wyników kontra nieznanej
ścieżce i dla rozdzielenia braku znacznika od zepsutego JSON-a. Wiersz §11
„`__NEXT_DATA__` regex finds nothing" przestaje radzić logowanie surowej treści.

#### 3. Skrypt diagnostyczny

**File**: `scripts/otodom-inspect.mjs`

**Intent**: Pokazać przy porażce to samo, co trafiłoby do wpisu.

**Contract**: Linia „Fetch failed" (`:43-46`) wypisuje też `detail` i dane wyniku.
Kody wyjścia i tekst `USAGE` bez zmian poza opisem tej linii.

#### 4. Wzorzec w planie testów

**File**: `context/foundation/test-plan.md`

**Intent**: Zapisać, że lista zakazanych tekstów ma dwie warstwy i dlaczego.

**Contract**: §6.9, punkt „One table of scenarios for the absence check": zdanie o
liście wspólnej i ścisłej oraz o scenariuszu, w którym adres lądowania jest tematem.
Wpis w §8 „Freshness Ledger" z datą i identyfikatorem zmiany.

### Success Criteria:

#### Automated Verification:

- Cały zestaw przechodzi: `npm test`
- Lint przechodzi: `npm run lint`
- Skrypt diagnostyczny ładuje się i wypisuje pomoc: `node scripts/otodom-inspect.mjs --help`
- Runbook nazywa każdy nowy powód: `grep -c "challenged\|data_missing\|unexpected_landing" context/foundation/deployment-runbook.md`

#### Manual Verification:

- Runbook przeczytany: z samej sekcji „Ingestion starts failing" da się zaklasyfikować każdy wiersz kontraktu powodów
- `npm run otodom:inspect -- <adres żywej oferty>` nadal wypisuje trzy sekcje
- `npm run otodom:inspect -- <adres nieistniejącej oferty>` wypisuje powód ze statusem i danymi

---

## Testing Strategy

### Unit Tests:

- `tests/lib/log.test.ts` — nowe klucze przechodzą, `false` i zero zostają.
- `tests/lib/otodom/fetch.test.ts` — każdy wiersz kontraktu powodów, każdy obok
  sąsiada, który daje inny powód; cały wynik ręcznie.

### Integration Tests:

- `tests/pages/api/offers.test.ts` — sieć stubowana na krawędzi HTTP; cały wpis
  i zdanie dla członka dla każdego nowego powodu; tabela nieobecności z nowymi
  scenariuszami etapu `fetch`.
- Stryker zawężony do `src/lib/otodom/fetch.ts`, `src/lib/log.ts`,
  `src/pages/api/offers.ts` — lokalnie, nigdy w CI, wynik nie jest celem.

### Manual Testing Steps:

1. Przeczytać trzy nowe zdania w `failureMessage`.
2. Uruchomić Strykera i osądzić ocalałe mutanty.
3. Uruchomić `otodom:inspect` na żywej i na nieistniejącej ofercie.
4. Przeczytać sekcję runbooka z kontraktem powodów obok.

## Performance Considerations

Żadnego nowego przebiegu po treści strony: `bodyLength` to `html.length`, a
obecność znacznika wynika z dopasowania, które kod robi już dziś. Treść odpowiedzi
spoza 2xx nadal nie jest czytana. Liczba wpisów na żądanie się nie zmienia, więc
limit 200 tys. zdarzeń dziennie w Workers Logs pozostaje daleko.

## Migration Notes

Brak migracji bazy. Po wdrożeniu wpisy, które dziś mają `reason: "shape_changed"`
ze `stage: "fetch"` i bez `detail`, przestają powstawać: brak znacznika to
`data_missing`. Zapytanie do logów zbudowane na starym kształcie trzeba poprawić
według runbooka.

## References

- Raport weryfikacyjny: `context/audits/observability/2026-10-05_verify-add-offer-from-otodom.md` (sekcje 5 i 6)
- Raport pierwotny: `context/audits/observability/2026-10-05_add-offer-from-otodom.md` (sekcja 5: A3, A4, A6, A15)
- Poprzedni krok: `context/archive/2026-10-05-offers-outcome-logging/plan.md`
- Wzorzec testu wpisu: `context/foundation/test-plan.md` §6.9
- Wzorzec mapowania danych na klucze wpisu: `src/pages/api/offers.ts:91-93`
- Wzorzec przypadku reportera: `tests/lib/log.test.ts:38-68`
- Tabela warunków pobrania: `context/foundation/ingestion/otodom_fetching.md` §7.1, §9.1

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Pola reportera

#### Automated

- [x] 1.1 Test reportera przechodzi: `npm test -- tests/lib/log.test.ts` — 830721a
- [x] 1.2 Cały zestaw przechodzi: `npm test` — 830721a
- [x] 1.3 Lint przechodzi: `npm run lint` — 830721a
- [x] 1.4 Typy przechodzą: `npx astro sync && npx astro check` — 830721a

### Phase 2: Granica pobrania

#### Automated

- [x] 2.1 Testy granicy pobrania przechodzą: `npm test -- tests/lib/otodom/fetch.test.ts`
- [x] 2.2 Testy trasy przechodzą: `npm test -- tests/pages/api/offers.test.ts`
- [x] 2.3 Cały zestaw przechodzi: `npm test`
- [x] 2.4 Typy przechodzą, obie tabele wyczerpujące: `npx astro sync && npx astro check`
- [x] 2.5 Lint przechodzi: `npm run lint`
- [x] 2.6 `fetch.ts` i `types.ts` mają wyłącznie importy typów: `grep -n "^import" src/lib/otodom/fetch.ts src/lib/otodom/types.ts`
- [x] 2.7 Skrypt diagnostyczny ładuje moduł: `node scripts/otodom-inspect.mjs --help`

#### Manual

- [x] 2.8 Trzy nowe zdania dla członka przeczytane w całości i zaakceptowane

### Phase 3: Wpis trasy

#### Automated

- [ ] 3.1 Testy trasy przechodzą: `npm test -- tests/pages/api/offers.test.ts`
- [ ] 3.2 Cały zestaw przechodzi: `npm test`
- [ ] 3.3 Typy przechodzą: `npx astro sync && npx astro check`
- [ ] 3.4 Lint przechodzi: `npm run lint`
- [ ] 3.5 Build przechodzi: `npm run build`

#### Manual

- [ ] 3.6 Stryker zawężony do trzech plików uruchomiony, każdy ocalały mutant osądzony: `npx stryker run --mutate "src/lib/otodom/fetch.ts,src/lib/log.ts,src/pages/api/offers.ts"`
- [ ] 3.7 Dowód celowego wycieku z §6.9 wykonany i cofnięty

### Phase 4: Runbook i narzędzia

#### Automated

- [ ] 4.1 Cały zestaw przechodzi: `npm test`
- [ ] 4.2 Lint przechodzi: `npm run lint`
- [ ] 4.3 Skrypt diagnostyczny ładuje się i wypisuje pomoc: `node scripts/otodom-inspect.mjs --help`
- [ ] 4.4 Runbook nazywa każdy nowy powód: `grep -c "challenged\|data_missing\|unexpected_landing" context/foundation/deployment-runbook.md`

#### Manual

- [ ] 4.5 Runbook przeczytany: z samej sekcji „Ingestion starts failing" da się zaklasyfikować każdy wiersz kontraktu powodów
- [ ] 4.6 `npm run otodom:inspect -- <adres żywej oferty>` nadal wypisuje trzy sekcje
- [ ] 4.7 `npm run otodom:inspect -- <adres nieistniejącej oferty>` wypisuje powód ze statusem i danymi
