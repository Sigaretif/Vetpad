# Wspólna tablica ofert — plan implementacji

## Overview

`/dashboard` przestaje być samym formularzem „Nowa oferta” i staje się wspólną tablicą wszystkich zapisanych ofert (FR-006, roadmapa S-06). Każda pozycja to wiersz z miniaturą, tytułem, ceną, metrażem, lokalizacją i odznaką „Nie audytowano”. Kliknięcie prowadzi na kartę `/offers/<id>`. Formularz dodawania zostaje nad listą. Listę można sortować po dacie dodania (domyślnie, najnowsze na górze), cenie albo metrażu, w obu kierunkach. Oferta, która danej wartości nie podaje, jest zawsze na końcu. Nie ma paginacji, migracji ani nowych zależności. Zmiana przechodzi bramkę wizualną z własną stroną `/dev/board`.

## Current State Analysis

- `src/pages/dashboard.astro:1-19` renderuje w `AppLayout` jeden `Card` z `h1` „Nowa oferta” i wyspą `AddOfferForm` (`client:load`). Błąd dodawania wraca jako `?error=` z `src/pages/api/offers.ts:44`.
- Nawigacja już obiecuje tablicę: Topbar „Oferty” (`src/components/Topbar.astro:17`) i „← Wróć do ofert” na karcie (`src/pages/offers/[id].astro:48`) prowadzą na `/dashboard`. Plan-brief `ui-remaining-views` (archiwum 2026-09-23) odłożył tablicę właśnie na `/dashboard`.
- `public.offers` (`supabase/migrations/20260922202756_create_offers.sql`) ma politykę `offers_select_authenticated` (`:79-83`), a każdy zalogowany czyta każdy wiersz. Tablica nie potrzebuje migracji. Kolumny potrzebne na tablicy: `id`, `title`, `price`, `price_currency`, `area_m2`, `location_label`, `street_name`, `images`, `created_at`. `raw` i `description` to największe pola wiersza i tablica ich nie pobiera.
- Nie ma tabeli audytów (S-04) ani kolumny archiwizacji (S-10). Dziś każda oferta jest nieaudytowana i każda należy do tablicy.
- `src/middleware.ts:4` chroni `/dashboard`, a anonimowy dostaje 302 na `/auth/signin` (krok smoke `scripts/smoke.mjs:61`).
- `src/pages/offers/[id].astro:17-27` to wzorzec odczytu. `createClient()` → `null`, błąd zapytania i wyjątek dają „brak danych”, nigdy 500.
- Klocki do ponownego użycia:
  - `Unstated` (`src/components/offers/Unstated.astro`) z formułą „…: nie podano w ogłoszeniu”, wzorzec w `OfferCard.astro:34-40`,
  - `formatMoney` i `formatArea` (`src/lib/otodom/labels.ts:174`, `:188`),
  - `safeHttpsUrl` (`src/lib/safe-url.ts`),
  - `Card` (`src/components/ui/card.tsx`), `Badge` (`src/components/ui/badge.tsx`), `Alert` (`src/components/ui/alert.tsx`), `buttonVariants` (`src/components/ui/button.tsx`).
- Kitchen sinki: `/dev/offer-card` (`src/pages/dev/offer-card.astro:18-21`, fixtury w `src/pages/dev/_offer-fixtures.ts`: `fullOffer`, `unknownOffer`, `singleImageOffer`, `unsafeImagesOffer`, `longTitleOffer`) i `/dev/forms`. Zestawy zrzutów oraz mechanizmy `focus` (Tab) i `hover` (CDP) są w `scripts/ui-screenshots.mjs:31-78`.
- Lokalizacja: `location_label` pochodzi z `reverseGeocoding` (miasto, dzielnica, osiedle), a `street_name` z `location.address.street.name` (`src/lib/otodom/map.ts:154-171`). **Numeru budynku otodom nie podaje.** `location.address` ma wypełnione tylko `street.name` (`context/foundation/ingestion/otodom_fetching.md` §7.3), więc tablica pokazuje etykietę i ulicę, bez numeru.

## Desired End State

- Zalogowany członek zespołu na `/dashboard` widzi nagłówek „Oferty”, pod nim kartę „Nowa oferta” z formularzem, a pod nią sekcję „Zapisane oferty (N)” z kontrolką sortowania i listą wierszy.
- Każdy wiersz to jeden link na `/offers/<id>` i zawiera:
  - miniaturę (pierwsza, która przejdzie `safeHttpsUrl`, a przy braku neutralny prostokąt bez `<img>`),
  - tytuł,
  - cenę, metraż i lokalizację (etykieta i ulica); każda nieznana wartość czyta „nie podano w ogłoszeniu” przez `Unstated`, nigdy „0” ani pustkę,
  - odznakę „Nie audytowano”.
- Domyślna kolejność to `created_at` malejąco. Sortowanie przez `?sort=added|price|area&dir=asc|desc`. Brakująca cena lub metraż zawsze ląduje na końcu, w obu kierunkach. Remis rozstrzyga `id`. Nieznany `sort` albo `dir` wraca do wartości domyślnej, nigdy nie daje błędu.
- Brak ofert to pusty stan z zachętą do wklejenia adresu. Błąd odczytu to `Alert` „Nie udało się wczytać ofert”, który nie udaje pustej tablicy. Obie wersje mają status 200.
- `/dev/board` (tylko `astro dev`, gdzie indziej 404) pokazuje tablicę we wszystkich stanach. Zrzuty z `node scripts/ui-screenshots.mjs board context/changes/shared-offer-board/screenshots` są bramką.

Weryfikacja: `npm run lint`, `npx astro sync`, `npx astro check`, `npm run build`, smoke na podglądzie produkcyjnym (z nowymi krokami) i bramka zrzutów.

### Key Discoveries:

- `supabase-js` (`postgrest-js`) `order(column, { ascending, nullsFirst })` dopisuje do parametru `order` `col.asc.nullslast`. Wywołania można łączyć w łańcuch, a kolumna nie musi być w `select` (Context7, `/supabase/postgrest-js`, `PostgrestTransformBuilder.order`). Reguła „nieznane na końcu” to więc `nullsFirst: false` przy każdym kierunku plus drugie `.order("id")`, bez sortowania w aplikacji.
- Domyślnie Postgres przy `desc` stawia `null` na początku. Bez jawnego `nullsFirst: false` sortowanie „cena malejąco” pokazałoby oferty bez ceny jako najdroższe, czyli fakt, którego ogłoszenie nie podało (PRD, Guardrails).
- RLS bez polityki `select` zwraca pustą tablicę i HTTP 200 (CLAUDE.md, „two denial signatures”). Błąd zapytania, np. literówka w kolumnie, też kończy się na tablicy statusem 200. Sam status nie odróżnia więc działającej tablicy od zepsutej. Smoke sprawdza dlatego znacznik stanu w treści strony (`data-board-state`), a nie tylko 200.
- Top-level `return` we frontmatterze `.astro` wywraca `@typescript-eslint/no-misused-promises` (CLAUDE.md `### Framework`). Strona dev ustawia `Astro.response.status = 404` tak jak `/dev/offer-card`.
- Każdy URL z wiersza trafiający do `src`/`href` przechodzi przez `safeHttpsUrl` (lekcja w `context/foundation/lessons.md`, która wprost wymienia S-06). `id` to kolumna `uuid`, więc `href="/offers/<id>"` nie wymaga filtra.
- `Badge`, `Card` i `Alert` to komponenty React. Wyrenderowane w `.astro` bez dyrektywy `client:*` dają statyczny HTML bez JS, tak jak `Card` w `dashboard.astro` dziś.

## What We're NOT Doing

- **Nazwa członka, który zapisał ofertę.** Klucz publishable nie czyta `auth.users`, a nie ma tabeli profili. To zakres S-07 (duplicate-listing-notice), razem z „konto usunięte”.
- **Prawdziwy status audytu i tabela audytów.** Odznaka ma stały wynik z jednego punktu podmiany. Schemat audytu ustala S-04.
- **Archiwizacja i sekcja „ostatnio zarchiwizowane”.** To S-10. Tablica pokazuje wszystkie oferty.
- **Paginacja.** Przy trzech osobach i kilkudziesięciu ofertach jej nie ma. Wracamy do tematu, gdy lista urośnie do kilkuset.
- **Filtrowanie i wyszukiwanie** (po mieście, zakresie ceny), też względem kryteriów z S-03.
- **Wyświetlanie daty dodania w wierszu.** Data jest tylko kluczem sortowania.
- **Numer budynku.** otodom go nie podaje, więc nie zmieniamy mappera ani schematu.
- **Przeliczanie walut przy sortowaniu po cenie.** Sortujemy po liczbie `price`, bez względu na `price_currency`.
- **Wyspa React dla tablicy lub sortowania.** Sortowanie to linki i przeładowanie strony.
- Nowe zależności, migracje, trasy API, `prerender`.

## Implementation Approach

Cała logika, która nie jest znacznikami, trafia do czystego modułu `src/lib/offer-board.ts`. Są to: parsowanie `sort`/`dir`, mapowanie klucza na kolumnę, lista kolumn zapytania, typ wiersza, budowanie linków sortowania i `auditStatus()`. Strona `/dashboard` wykonuje jedno zapytanie w stylu `loadOffer` z karty i przekazuje wynik (listę albo błąd) do komponentów Astro w `src/components/offers/`. `/dev/board` renderuje te same komponenty z fixtur, więc bramka wizualna widzi dokładnie produkcyjne znaczniki.

Fazy:

1. Tablica działa na `/dashboard` i smoke to sprawdza.
2. Kitchen sink, zestaw zrzutów i bramka.
3. Dokumentacja.

## Critical Implementation Details

- **Kolejność `null` jest częścią kontraktu produktu, nie szczegółem.** `nullsFirst: false` musi stać przy *każdym* `.order` na `price` i `area_m2`, także przy `ascending: true`, gdzie Postgres i tak stawia `null` na końcu. Jawna opcja nie zależy od domyślnego zachowania, a smoke nie ma danych, żeby tę regułę sprawdzić. Zweryfikuje ją ręczny krok w fazie 1.
- **Stan błędu musi być widoczny w znacznikach.** Kontener tablicy niesie `data-board-state="ok"` (lista lub pusto) albo `data-board-state="error"`. Smoke w CI (lokalny Supabase z migracjami, pusta tabela) sprawdza `ok`. To jedyny automatyczny sygnał, że zapytanie w ogóle przechodzi.

## Phase 1: Tablica na `/dashboard`

### Overview

Moduł logiki tablicy, komponenty wiersza, sortowania, odznaki i listy, nowy `/dashboard` oraz kroki smoke. Po tej fazie zespół ma działającą tablicę.

### Changes Required:

#### 1. Logika tablicy

**File**: `src/lib/offer-board.ts` (nowy)

**Intent**: Jedno miejsce na reguły tablicy, które inaczej rozproszyłyby się po `.astro`: które kolumny czytać, jak odczytać sortowanie z URL, jak zbudować link zmiany sortowania i jaki jest status audytu. Moduł jest czysty, jak `labels.ts`, bez importów runtime poza typami.

**Contract**:
- `type BoardSortKey = "added" | "price" | "area"`, `type BoardSortDir = "asc" | "desc"`, `interface BoardSort { key; dir }`.
- `BOARD_SORT_COLUMN: Record<BoardSortKey, "created_at" | "price" | "area_m2">`.
- Domyślny kierunek klucza: `added` → `desc`, `price` → `asc`, `area` → `desc`. Tablica bez parametrów to `{ key: "added", dir: "desc" }`.
- `parseBoardSort(params: URLSearchParams): BoardSort`:
  - nieznany lub brakujący `sort` → domyślne sortowanie,
  - poprawny `sort` z nieznanym lub brakującym `dir` → domyślny kierunek tego klucza,
  - nigdy nie rzuca.
- `boardSortHref(current: BoardSort, key: BoardSortKey): string`: dla aktywnego klucza link z odwróconym kierunkiem, dla innego klucza link z jego domyślnym kierunkiem. Format `/dashboard?sort=<key>&dir=<dir>`.
- `BOARD_COLUMNS`: string `select` z listą kolumn z Current State Analysis, bez `raw` i `description`.
- `type OfferBoardItem = Pick<OfferRow, "id" | "title" | "price" | "price_currency" | "area_m2" | "location_label" | "street_name" | "images" | "created_at">`.
- `type AuditStatus = "not_audited"` i `auditStatus(offer: OfferBoardItem): AuditStatus`, które dziś zawsze zwraca `"not_audited"`. Komentarz nazywa to punktem podmiany dla S-04 (grounded-listing-audit), który rozszerzy typ o stan audytowany i źródło danych.

#### 2. Odznaka statusu audytu

**File**: `src/components/offers/AuditStatusBadge.astro` (nowy)

**Intent**: Jedna prezentacja statusu audytu, na tablicy teraz i na karcie po S-04, żeby S-04 zmieniał etykietę w jednym miejscu.

**Contract**: Props `{ status: AuditStatus }`. Renderuje `Badge` (wariant `outline`) z etykietą z mapy `Record<AuditStatus, string>`, gdzie `not_audited` → „Nie audytowano”. Kolory tylko z wariantów `Badge`.

#### 3. Wiersz tablicy

**File**: `src/components/offers/OfferBoardItem.astro` (nowy)

**Intent**: Jedna oferta na tablicy. Cały wiersz jest jednym linkiem do karty, więc jest jeden cel Tab na ofertę. Nieznane fakty są pokazane jako nieznane.

**Contract**:
- Props `{ offer: OfferBoardItem }`.
- Korzeń to `<a href="/offers/<id>">` z widocznym pierścieniem `focus-visible` (jak `buttonVariants`: `ring-ring/50`, 3 px) i stanem `hover` z tokenu (`hover:bg-accent` lub równoważny token roli). W środku jest `Card` w wersji zwartej.
- Miniatura:
  - pierwszy `images[].thumbnail`, dla którego `safeHttpsUrl` nie zwraca `null`; `images` spoza tablicy traktowane jak pusta lista (jak `OfferCard.astro:22`),
  - `<img alt="" loading="lazy">` o stałym wymiarze i `object-cover`; `alt=""`, bo tytuł obok niesie nazwę linku,
  - brak bezpiecznej miniatury → element o tym samym wymiarze z tłem `bg-muted`, bez `<img>`.
- Tytuł: `wrap-anywhere`, obcięty do dwóch linii.
- Cena: `formatMoney(price, price_currency)` albo `<Unstated>Cena: nie podano w ogłoszeniu</Unstated>`.
- Metraż: `formatArea(area_m2)` albo `<Unstated>Metraż: nie podano w ogłoszeniu</Unstated>`.
- Lokalizacja: niepuste z `location_label` i `street_name` połączone „, ”. Oba `null` → `<Unstated>Lokalizacja: nie podano w ogłoszeniu</Unstated>`.
- `AuditStatusBadge` ze statusem `auditStatus(offer)`.

#### 4. Kontrolka sortowania

**File**: `src/components/offers/BoardSort.astro` (nowy)

**Intent**: Zmiana sortowania bez JS: trzy linki, aktywny oznaczony wizualnie i dla czytnika ekranu.

**Contract**:
- Props `{ sort: BoardSort }`. Renderuje `<nav aria-label="Sortowanie ofert">` z linkami „Data dodania”, „Cena”, „Metraż”, każdy z `href` z `boardSortHref`.
- Aktywny link ma `aria-current="true"`, strzałkę ↑/↓ (`aria-hidden`) i tekst `sr-only` „rosnąco”/„malejąco”.
- Style z `buttonVariants` (np. `ghost`, rozmiar `sm`, aktywny wyróżniony tokenem), bez literałów koloru.

#### 5. Lista z trzema stanami

**File**: `src/components/offers/OfferBoard.astro` (nowy)

**Intent**: Sekcja „Zapisane oferty”, która rozróżnia listę, pusto i błąd odczytu. Pustej tablicy nie wolno pomylić z zepsutym zapytaniem.

**Contract**:
- Props `{ result: { ok: true; offers: OfferBoardItem[] } | { ok: false }; sort: BoardSort }`.
- Korzeń `<section aria-labelledby=…>` z `data-board-state="ok"` dla `ok: true` i `data-board-state="error"` dla `ok: false`.
- Nagłówek `h2` „Zapisane oferty (N)” przy `ok`, samo „Zapisane oferty” przy błędzie.
- `ok` z ofertami: `BoardSort` i lista `<ul>` z `OfferBoardItem`.
- `ok` bez ofert: komunikat „Nie ma jeszcze zapisanych ofert. Wklej adres ogłoszenia z otodom.pl w formularzu powyżej.” w `text-muted-foreground`, bez `BoardSort`.
- `ok: false`: `Alert` `destructive` „Nie udało się wczytać ofert. Odśwież stronę za chwilę.”, bez `BoardSort` i bez komunikatu pustego stanu.

#### 6. Strona `/dashboard`

**File**: `src/pages/dashboard.astro`

**Intent**: Strona tablicy. Odczytuje sortowanie, wykonuje jedno zapytanie i renderuje formularz oraz tablicę. Żaden stan (zero-config, błąd, wyjątek) nie daje 500.

**Contract**:
- `title` to „Oferty — Vetpad”, a widoczny `h1` „Oferty” na górze `main`.
- Karta „Nowa oferta” jak dziś, z nagłówkiem zdegradowanym do `h2`. `AddOfferForm serverError={error} client:load` bez zmian.
- Pod nią `OfferBoard`.
- `loadBoard(sort)` na wzór `loadOffer` z `src/pages/offers/[id].astro:17-27`:
  - `createClient()` → `null` daje `{ ok: false }`,
  - `supabase.from("offers").select(BOARD_COLUMNS).order(BOARD_SORT_COLUMN[key], { ascending: dir === "asc", nullsFirst: false }).order("id", { ascending: true })`,
  - `error` lub wyjątek daje `{ ok: false }`,
  - `data` daje `{ ok: true, offers: data as OfferBoardItem[] }`.

#### 7. Smoke

**File**: `scripts/smoke.mjs`

**Intent**: Smoke sprawdza, że tablica przyjmuje każdy wariant sortowania bez 500 i że zapytanie naprawdę przechodzi. Sam status 200 nie odróżnia zepsutego zapytania od pustej tablicy.

**Contract**:
- `request()` zwraca dodatkowo `body` (tekst odpowiedzi).
- Nowe oczekiwanie `bodyIncludes`, porównywane w pętli sprawdzającej obok `location`/`errorCode`.
- Nagłówek skryptu opisuje nowe kroki.
- Nowe kroki w sekcji zalogowanej, po „dashboard renders for signed-in user”:
  - „board reads offers without error”: `GET /dashboard` → 200, `bodyIncludes: 'data-board-state="ok"'`,
  - „board sorts by price ascending”: `GET /dashboard?sort=price&dir=asc` → 200, `bodyIncludes: 'data-board-state="ok"'`,
  - „board sorts by area descending”: `GET /dashboard?sort=area&dir=desc` → 200, `bodyIncludes: 'data-board-state="ok"'`,
  - „board ignores an unknown sort”: `GET /dashboard?sort=bogus&dir=sideways` → 200, `bodyIncludes: 'data-board-state="ok"'`.

### Success Criteria:

#### Automated Verification:

- Lint przechodzi (w tym `tokensOnlyConfig`, bez nowych wyjątków): `npm run lint`
- Typy przechodzą: `npx astro sync && npx astro check`
- Build przechodzi: `npm run build`
- Smoke przechodzi na podglądzie produkcyjnym z lokalnym Supabase, z czterema nowymi krokami tablicy: `BASE_URL=http://localhost:4321 npm run smoke`

#### Manual Verification:

- Na `npm run dev` z lokalnym Supabase i co najmniej trzema zapisanymi ofertami `/dashboard` pokazuje formularz i listę, a kliknięcie wiersza otwiera właściwą kartę
- Oferta bez ceny (lub z ręcznie wyzerowaną na `null` ceną w lokalnej bazie) jest na końcu przy „Cena ↑” i przy „Cena ↓”, a jej wiersz czyta „Cena: nie podano w ogłoszeniu”
- Świeżo wklejona oferta pojawia się na górze po powrocie przez „← Wróć do ofert”
- Tab przechodzi po linkach sortowania i wierszach z widocznym pierścieniem fokusu

**Implementation Note**: Po automatycznej weryfikacji tej fazy zatrzymaj się na ręczne potwierdzenie przed fazą 2.

---

## Phase 2: Bramka wizualna — `/dev/board`

### Overview

Kitchen sink tablicy, krok 404 w smoke, zestaw zrzutów i przejście bramki na macierzy 7 stanów.

### Macierz 7 stanów

| Stan | Gdzie na `/dev/board` | Uwagi |
| --- | --- | --- |
| default | Lista z pełnymi fixturami, sortowanie domyślne | Wiersz z miniaturą, ceną, metrażem, lokalizacją, odznaką |
| hover | Wymuszony `:hover` na pierwszym wierszu | Zrzut `board-hover-row` |
| focus | Fokus z klawiatury na wierszu i na linku sortowania | Zrzuty `board-focus-row`, `board-focus-sort` |
| disabled | nie dotyczy | Tablica nie ma wyłączanych kontrolek. Stan wyłączony formularza „Nowa oferta” pokrywa `/dev/forms` |
| error | Sekcja „Błąd odczytu” (`result: { ok: false }`) | `Alert` destructive, bez sortowania i bez pustego stanu |
| empty | Sekcja „Brak ofert” (`offers: []`) | Komunikat zachęty, bez sortowania |
| loading | nie dotyczy | Lista jest renderowana na serwerze razem ze stroną, a tablica nie pobiera niczego po stronie klienta. Stan wysyłki formularza pokrywa `/dev/forms` |

Stany dodatkowe na tej samej stronie:
- wszystko nieznane (cena, metraż, lokalizacja „nie podano”, placeholder zamiast miniatury),
- niebezpieczne miniatury (`http:`/`javascript:` odrzucone, placeholder),
- długi tytuł bez spacji,
- tylko ulica bez etykiety lokalizacji,
- aktywne sortowanie po cenie rosnąco i po metrażu malejąco (sama kontrolka `BoardSort`).

### Changes Required:

#### 1. Fixtury tablicy

**File**: `src/pages/dev/_offer-fixtures.ts`

**Intent**: Stany wiersza z tych samych ofert co kitchen sink karty, plus brakujący przypadek „tylko ulica”.

**Contract**: Nowy eksport fixtury ze `street_name` ustawionym i `location_label: null`. Wiersze tablicy powstają z istniejących fixtur `OfferRow` (typ `OfferBoardItem` to ich `Pick`, więc fixtury pasują bez konwersji). Istniejące eksporty bez zmian.

#### 2. Kitchen sink

**File**: `src/pages/dev/board.astro` (nowy)

**Intent**: Wszystkie stany tablicy z fixtur na jednej stronie, renderowane produkcyjnymi komponentami.

**Contract**:
- Wzorzec `src/pages/dev/offer-card.astro:18-21`: `import.meta.env.DEV`, poza dev `Astro.response.status = 404` i nic nie jest renderowane.
- W `AppLayout` sekcje z podpisami (styl podpisów jak `offer-card.astro`):
  - lista pełna (sortowanie domyślne),
  - `BoardSort` z aktywną „Cena ↑” i z „Metraż ↓”,
  - pusto,
  - błąd odczytu,
  - wiersze: wszystko nieznane, niebezpieczne miniatury, długi tytuł, tylko ulica.
- Każda sekcja ma `data-state="<nazwa>"`, żeby selektory zrzutów trafiały w konkretny stan.

#### 3. Smoke — strona dev nieobecna w buildzie

**File**: `scripts/smoke.mjs`

**Intent**: `/dev/board` nie może trafić na produkcję.

**Contract**: Krok „dev board kitchen sink is absent from the build”: `GET /dev/board` → 404, obok kroków `/dev/offer-card` i `/dev/forms`. Nagłówek skryptu wymienia trzecią stronę.

#### 4. Zestaw zrzutów

**File**: `scripts/ui-screenshots.mjs`

**Intent**: Powtarzalne zrzuty bramki tablicy.

**Contract**:
- Stała `BOARD_KITCHEN_SINK = "/dev/board"` i cele `FOCUS`:
  - `boardRow`: pierwszy link wiersza w sekcji `data-state="default"`,
  - `boardSort`: pierwszy link w `nav[aria-label="Sortowanie ofert"]` tej sekcji.
- Zestaw `board`:
  - `board-desktop` (cała strona),
  - `board-mobile` (`MOBILE`),
  - `board-focus-row`, `board-focus-sort`,
  - `board-hover-row` (`hover` na pierwszym wierszu sekcji `default`).
- `USAGE` wymienia nowy zestaw.

#### 5. Zrzuty bramki

**File**: `context/changes/shared-offer-board/screenshots/` (nowy katalog)

**Intent**: Dowód bramki dla każdego stanu macierzy. Stan „po triażu” powtarza się po `/10x-impl-review`, jeśli triaż zmienił widok.

**Contract**: PNG z `node scripts/ui-screenshots.mjs board context/changes/shared-offer-board/screenshots`. Zrzuty pokazują tylko fixtury, bez prawdziwych ogłoszeń, więc nic nie wymaga `*offer-real*`.

### Success Criteria:

#### Automated Verification:

- Lint przechodzi: `npm run lint`
- Typy przechodzą: `npx astro sync && npx astro check`
- Build przechodzi: `npm run build`
- Smoke przechodzi na podglądzie produkcyjnym, w tym `/dev/board` → 404: `BASE_URL=http://localhost:4321 npm run smoke`
- Zestaw zrzutów zapisuje wszystkie ujęcia (kod wyjścia 0): `node scripts/ui-screenshots.mjs board context/changes/shared-offer-board/screenshots`

#### Manual Verification:

- Zrzuty pokazują każdy stan z macierzy. „nie podano w ogłoszeniu” jest czytelne, placeholder miniatury nie wygląda jak zepsuty obrazek, a długi tytuł nie rozpycha wiersza
- Pierścień fokusu na wierszu i na linku sortowania jest widoczny na tle `background` i `card`
- Na 375 px wiersz zawija się bez poziomego przewijania strony
- Stan błędu i stan pusty różnią się na pierwszy rzut oka

**Implementation Note**: Po automatycznej weryfikacji tej fazy zatrzymaj się na ręczne potwierdzenie przed fazą 3.

---

## Phase 3: Dokumentacja

### Overview

README, CLAUDE.md i roadmapa opisują tablicę, jej kitchen sink i nowe kroki smoke.

### Changes Required:

#### 1. README

**File**: `README.md`

**Intent**: Tabela tras i opisy narzędzi odpowiadają nowemu stanowi.

**Contract**:
- Wiersz `/dashboard` w tabeli tras (`README.md:148`): chroniona tablica wszystkich zapisanych ofert, z sortowaniem `?sort=added|price|area&dir=asc|desc` i formularzem dodawania.
- Akapit smoke (`:181`, `:188`): kroki tablicy, w tym sprawdzenie `data-board-state="ok"`, oraz `/dev/board` → 404.
- Akapit `ui-screenshots.mjs` (`:208`): zestaw `board`.

#### 2. CLAUDE.md

**File**: `CLAUDE.md`

**Intent**: Następne slice'y (S-04 podmienia status, S-10 dodaje archiwum) wiedzą, gdzie żyje tablica i przez co przechodzi zmiana jej wyglądu.

**Contract**:
- W `### UI`, obok punktów o `/dev/offer-card` i `/dev/forms`, nowy punkt: zmiana wyglądu tablicy przechodzi przez `/dev/board` (`src/pages/dev/board.astro`), a nowy stan tablicy dostaje tam sekcję. Obowiązuje ta sama reguła dev-only/404, sprawdzana przez `scripts/smoke.mjs`.
- W `## Structure`: `src/pages/dashboard.astro` to tablica, a `src/lib/offer-board.ts` jest referencją dla sortowania i dla `auditStatus()`, czyli punktu, który podmienia S-04.

#### 3. Roadmapa

**File**: `context/foundation/roadmap.md`

**Intent**: Bez zmian statusu w tej fazie, bo status prowadzą `/10x-plan`, `/10x-implement` i `/10x-archive`. Dopisujemy tylko fakty, które odblokowują następne slice'y.

**Contract**: W wierszu S-10 tabeli Backlog Handoff notatka: tablica na `/dashboard`, stan archiwum dostaje sekcję na `/dev/board`. W wierszu S-04: status audytu podmienia się w `auditStatus()` (`src/lib/offer-board.ts`) i w `AuditStatusBadge.astro`.

### Success Criteria:

#### Automated Verification:

- Lint przechodzi: `npm run lint`
- Ścieżki podane w CLAUDE.md istnieją: `ls src/pages/dev/board.astro src/lib/offer-board.ts src/pages/dashboard.astro`

#### Manual Verification:

- README, CLAUDE.md i roadmapa opisują tablicę zgodnie z tym, co działa na `/dashboard` i `/dev/board`

---

## Testing Strategy

### Unit Tests:

Repo nie ma runnera testów jednostkowych, a CLAUDE.md zabrania dodawania `vitest`/`jest` bez zgody. `parseBoardSort` i `boardSortHref` są sprawdzane przez kroki smoke (nieznane parametry → 200 i `ok`) oraz przez ręczne klikanie sortowania.

### Integration Tests:

- `scripts/smoke.mjs` na podglądzie produkcyjnym z lokalnym Supabase (w CI tabela `offers` jest pusta): tablica renderuje się ze stanem `ok` dla domyślnego, cenowego, metrażowego i nieznanego sortowania, a `/dev/board` → 404.
- Smoke nigdy nie dotyka otodom.pl. Te kroki czytają tylko bazę.

### Manual Testing Steps:

1. `npm run dev` z lokalnym Supabase i zalogowanie jako `sigaretif1@vetpad.local`. Na `/dashboard` pusty stan przy pustej bazie.
2. Wklejenie trzech ofert. Każda pojawia się na górze po powrocie z karty.
3. W lokalnej bazie `update offers set price = null where id = '<jedna>'`. „Cena ↑” i „Cena ↓” zostawiają ją na końcu z „Cena: nie podano w ogłoszeniu”.
4. Zatrzymanie lokalnego Supabase przy działającym `astro dev`. `/dashboard` (z sesją w ciasteczku) pokazuje stan błędu albo przekierowanie na logowanie, nigdy 500.
5. `/dashboard?sort=bogus&dir=x` to domyślna kolejność.
6. Tab po stronie: linki sortowania, potem wiersze, każdy z widocznym fokusem.

## Performance Considerations

Jedno zapytanie na render z `select` bez `raw` i `description`. `images` jest pobierane w całości, żeby wybrać pierwszą bezpieczną miniaturę; przy kilkudziesięciu ofertach to pomijalne. Sortowanie robi Postgres. Po stronie Workera nie ma przetwarzania zależnego od CPU. Miniatury ładują się `loading="lazy"` prosto z CDN otodom (hotlink, jak na karcie).

## Migration Notes

Brak migracji. Tablica używa istniejącej polityki `offers_select_authenticated`. Wdrożenie to zwykły push na `master` (Workers Builds). Nie jest potrzebny `supabase db push`.

## References

- Roadmapa: `context/foundation/roadmap.md` — S-06 (shared-offer-board), issue #17
- PRD: `context/foundation/prd.md` — FR-006, Guardrails („unknown, never zero”), Non-Functional Requirements
- Lekcje: `context/foundation/lessons.md` — `safeHttpsUrl`, tokeny ról
- Wzorzec odczytu: `src/pages/offers/[id].astro:17-34`
- Wzorzec kitchen sinka: `src/pages/dev/offer-card.astro:18-21`, `scripts/ui-screenshots.mjs:31-78`
- Prezentacja nieznanego: `src/components/offers/Unstated.astro`, `src/components/offers/OfferCard.astro:34-40`
- `postgrest-js` `order()` z `nullsFirst` (Context7 `/supabase/postgrest-js`)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Tablica na `/dashboard`

#### Automated

- [x] 1.1 Lint przechodzi (w tym `tokensOnlyConfig`, bez nowych wyjątków): `npm run lint` — 8b0a42a
- [x] 1.2 Typy przechodzą: `npx astro sync && npx astro check` — 8b0a42a
- [x] 1.3 Build przechodzi: `npm run build` — 8b0a42a
- [x] 1.4 Smoke przechodzi na podglądzie produkcyjnym z lokalnym Supabase, z czterema nowymi krokami tablicy: `BASE_URL=http://localhost:4321 npm run smoke` — 8b0a42a

#### Manual

- [x] 1.5 Na `npm run dev` z lokalnym Supabase i co najmniej trzema zapisanymi ofertami `/dashboard` pokazuje formularz i listę, a kliknięcie wiersza otwiera właściwą kartę — 8b0a42a
- [x] 1.6 Oferta bez ceny (lub z ręcznie wyzerowaną na `null` ceną w lokalnej bazie) jest na końcu przy „Cena ↑” i przy „Cena ↓”, a jej wiersz czyta „Cena: nie podano w ogłoszeniu” — 8b0a42a
- [x] 1.7 Świeżo wklejona oferta pojawia się na górze po powrocie przez „← Wróć do ofert” — 8b0a42a
- [x] 1.8 Tab przechodzi po linkach sortowania i wierszach z widocznym pierścieniem fokusu — 8b0a42a

### Phase 2: Bramka wizualna — `/dev/board`

#### Automated

- [x] 2.1 Lint przechodzi: `npm run lint`
- [x] 2.2 Typy przechodzą: `npx astro sync && npx astro check`
- [x] 2.3 Build przechodzi: `npm run build`
- [x] 2.4 Smoke przechodzi na podglądzie produkcyjnym, w tym `/dev/board` → 404: `BASE_URL=http://localhost:4321 npm run smoke`
- [x] 2.5 Zestaw zrzutów zapisuje wszystkie ujęcia (kod wyjścia 0): `node scripts/ui-screenshots.mjs board context/changes/shared-offer-board/screenshots`

#### Manual

- [x] 2.6 Zrzuty pokazują każdy stan z macierzy. „nie podano w ogłoszeniu” jest czytelne, placeholder miniatury nie wygląda jak zepsuty obrazek, a długi tytuł nie rozpycha wiersza
- [x] 2.7 Pierścień fokusu na wierszu i na linku sortowania jest widoczny na tle `background` i `card`
- [x] 2.8 Na 375 px wiersz zawija się bez poziomego przewijania strony
- [x] 2.9 Stan błędu i stan pusty różnią się na pierwszy rzut oka

### Phase 3: Dokumentacja

#### Automated

- [ ] 3.1 Lint przechodzi: `npm run lint`
- [ ] 3.2 Ścieżki podane w CLAUDE.md istnieją: `ls src/pages/dev/board.astro src/lib/offer-board.ts src/pages/dashboard.astro`

#### Manual

- [ ] 3.3 README, CLAUDE.md i roadmapa opisują tablicę zgodnie z tym, co działa na `/dashboard` i `/dev/board`
