---
date: 2026-10-01T23:05:04+02:00
researcher: Wiktor Ortel (Claude Code)
git_commit: e32edf2d43c1e93b6eeefa4ad10274cc14cff478
branch: master
repository: Sigaretif/Vetpad
topic: "Wyrocznia i mechanika testów jednostkowych dla stanów nieudanego odczytu oraz limitów zespołu (logika pokryta dziś tylko przez smoke)"
tags: [research, testing, read-failure, team-limits, offer-board, notes, members, criteria, stryker]
status: complete
last_updated: 2026-10-01
last_updated_by: Wiktor Ortel (Claude Code)
---

# Research: wyrocznia dla testów stanów nieudanego odczytu i limitów zespołu

**Date**: 2026-10-01T23:05:04+02:00
**Researcher**: Wiktor Ortel (Claude Code)
**Git Commit**: e32edf2d43c1e93b6eeefa4ad10274cc14cff478
**Branch**: master
**Repository**: Sigaretif/Vetpad

## Research Question

Z `change.md`: jakie zachowanie mają udowodnić testy jednostkowe dla dwóch ryzyk — (1) nieudany odczyt w `src/lib/notes.ts`, `src/lib/members.ts`, `src/lib/criteria.ts` pokazany jako pusty stan, (2) limit zespołu złamany przez fakt, którego ogłoszenie nie podaje (`src/lib/team-limits.ts`), plus sortowanie z nieznanymi wartościami na końcu (`src/lib/offer-board.ts`). Wyrocznia ma pochodzić ze źródeł (PRD, CLAUDE.md), nie z implementacji; gdzie źródła nie rozstrzygają — pytanie do użytkownika.

## Summary

- **Wyrocznia jest w większości rozstrzygnięta w źródłach.** PRD i CLAUDE.md dają regułę; zarchiwizowane plany czterech zmian (`team-search-criteria`, `shared-offer-board`, `member-notes`, `duplicate-listing-notice`) dają kontrakty funkcji z przykładami. Tabela w „Detailed Findings” przypisuje każdemu zachowaniu źródło.
- **Jedno założenie z `change.md` nie zgadza się z kodem.** Reguła „nieznane wartości na końcu” nie jest zaimplementowana w `src/lib/offer-board.ts`. W sprawdzonym kodzie jest w jednym miejscu: w zapytaniu `loadBoard` w `src/pages/dashboard.astro:26` (`nullsFirst: false`). `offer-board.ts` zawiera tylko mapę klucz→kolumna, parsowanie `?sort=&dir=` i budowanie linku. Test czystej funkcji nie udowodni kolejności wierszy. To decyzja zakresu dla planu (OQ-1).
- **Dziewięć punktów źródła nie rozstrzygają** (sekcja „Open Questions”). Trzy mają znaczenie dla asercji (OQ-1, OQ-2, OQ-3); pozostałe to przypadki nieosiągalne przez formularz i bazę albo kwestia zakresu Strykera.
- **Smoke nie sprawdza żadnego stanu błędu.** W sprawdzonych krokach `scripts/smoke.mjs` asercje dotyczą wyłącznie znaczników `ok` (`data-board-state`, `data-notes-state`, `data-criteria-state`, `data-limits-state`) i jednego znacznika `price_above`; nazwy autora ani kolejności wierszy nie sprawdza żaden krok (grep po `bodyIncludes`, plik nie był czytany w całości).
- **Żaden test w `tests/` nie importuje żadnej z 16 badanych funkcji.** Pokrycie pośrednie: `parseLimitsForm` przez trasę w `tests/pages/api/criteria.test.ts`, `limitBreaches`/`auditStatus`/`saverName` wykonują się w testach renderowania bez asercji na ich wynik.
- **Mechanika hermetyczna jest gotowa**: `stubFetch`, `jsonResponse`, `isTableRequest` w `tests/fixtures/http.ts`. Brakuje tylko udokumentowanych kształtów żądań odczytu (`offer_notes`, `members`, `team_criteria` GET, `member_requirements`).
- **Wynik bazowy Strykera z raportu z 2026-10-01** (`reports/mutation/mutation.html`): `team-limits.ts` 6,0% (5/83), `criteria.ts` 22,35% (59/264), `notes.ts` 0% (0/60), `members.ts` 0% (0/129), `offer-board.ts` 0% (0/48).

## Detailed Findings

### 1. Wyrocznia — `src/lib/team-limits.ts`

| # | Zachowanie do udowodnienia | Źródło | Status |
|---|---|---|---|
| L1 | Brak ceny, metrażu albo lokalizacji (`null`) nie łamie żadnego limitu | PRD FR-002 (`prd.md:75`: „an attribute the listing does not state never breaks a limit”), Guardrails (`prd.md:46`), `team-search-criteria/plan.md:5` | rozstrzygnięte |
| L2 | Cena w walucie innej niż PLN albo bez waluty jest dla znacznika nieznana: ani `price_above`, ani `price_below` | `team-search-criteria/plan.md:37`, kontrakt `:129` (`price_currency === "PLN"`) | rozstrzygnięte |
| L3 | Granice ceny włącznie: `price === priceMax` się mieści | `plan.md:129` (przykład wprost), `:268` | rozstrzygnięte |
| L4 | `price === priceMin` się mieści | tylko ogólne „granice włącznie” (`plan.md:129`, `plan-brief.md:22`); przykład jest wyłącznie dla `priceMax` | rozstrzygnięte przez regułę ogólną, bez własnego przykładu |
| L5 | `area_m2 === areaMin` nie łamie; łamie tylko `area_m2 < areaMin` | `plan.md:129` (ostre `<`), PRD „minimum square meters” (`prd.md:75`) | rozstrzygnięte |
| L6 | Nieustawiony limit (`null`) to „bez limitu”, nigdy 0 — nic nie łamie | `plan.md:20`, `plan-brief.md:23`, `:270` | rozstrzygnięte |
| L7 | Miasto: porównanie po normalizacji (małe litery, diakrytyki przez NFD, jawne `ł→l`, przycięcie) z każdym członem `location_label` po przecinku. „Warszawa” łamie „Ząbki, wołomiński, mazowieckie”, nie łamie „Stary Mokotów, Mokotów, Warszawa, mazowieckie” | `plan.md:53`, `:129` | rozstrzygnięte, z gotowymi przykładami |
| L8 | Limit „lodz” nie oznacza oferty z „Łódź” | `plan.md:269` | rozstrzygnięte |
| L9 | Łącznik czytany jak spacja: „Bielsko Biała” = „Bielsko-Biała” | `plan.md:402`; półpauza tylko w `reviews/impl-review.md:74` | łącznik rozstrzygnięty; półpauza zapisana jedynie w review |
| L10 | Wiele złamań na jednym wierszu jest możliwe | `plan.md:256` | rozstrzygnięte |
| L11 | Oferta poza limitem jest oznaczana, nigdy ukrywana | PRD FR-002 (`prd.md:75`) | rozstrzygnięte — ale to własność widoku (`OfferBoardItem.astro:27,79`), nie `limitBreaches` |
| L12 | Kolejność zwracanych złamań | `plan.md:129` mówi „w stałej kolejności” i jej nie nazywa; kolejność w unii typów (`:129`) i w liście etykiet (`:248`) jest różna | **nierozstrzygnięte → OQ-2** |
| L13 | Pusty albo złożony z samych spacji `location_label` | źródła mówią tylko o `null` | **nierozstrzygnięte → OQ-3** |
| L14 | Odwrócona para `priceMin > priceMax` oraz pusty limit miasta przekazane wprost do `limitBreaches` | nierozstrzygnięte; formularz i check tabeli nie dopuszczają takiego wiersza (`plan.md:71`, `:118`) | **→ OQ-6** |

Znany, zaakceptowany fałszywy alarm: oferta z samym powiatem albo gminą może dostać znacznik „inne miasto” (`team-search-criteria/plan-brief.md:64`). Test nie powinien tego „naprawiać” asercją.

### 2. Wyrocznia — `src/lib/offer-board.ts` i sortowanie tablicy

| # | Zachowanie | Źródło | Status |
|---|---|---|---|
| S1 | Bez parametrów: `{ key: "added", dir: "desc" }` | `shared-offer-board/plan.md:91` | rozstrzygnięte |
| S2 | Domyślny kierunek klucza: `added→desc`, `price→asc`, `area→desc` | `plan.md:91` | rozstrzygnięte |
| S3 | Nieznany lub brakujący `sort` → domyślne sortowanie; poprawny `sort` z nieznanym lub brakującym `dir` → domyślny kierunek tego klucza; nigdy nie rzuca | `plan.md:92-95`, `:31`, `:377` | rozstrzygnięte |
| S4 | Link sortowania: aktywny klucz odwraca kierunek, inny klucz startuje od swojego domyślnego; format `/dashboard?sort=<key>&dir=<dir>` | `plan.md:96` | rozstrzygnięte |
| S5 | Brakująca cena lub metraż ląduje na końcu w obu kierunkach; remis rozstrzyga `id` | PRD Guardrails (`prd.md:46`), `plan.md:31`, `:71`, `:165` | rozstrzygnięte jako reguła produktu — **ale miejsce implementacji to strona, nie moduł → OQ-1** |
| S6 | Nieznany `sort` z poprawnym `dir` (`sort=bogus&dir=asc`) | „domyślne sortowanie” czyta się jako `{added, desc}`, bez osobnego zdania | wynika z S3; wielkość liter (`sort=PRICE`) i puste wartości nierozstrzygnięte → OQ-7 |

Stan faktyczny dla S5: `src/pages/dashboard.astro:23-27` buduje zapytanie `.order(BOARD_SORT_COLUMN[key], { ascending: dir === "asc", nullsFirst: false }).order("id", { ascending: true })`. `src/lib/offer-board.ts:15-24` trzyma tylko mapę kolumn i komentarz odsyłający do strony. Widok nie sortuje ponownie (`OfferBoard.astro:58`). Plan tej funkcji sam odnotował lukę: „smoke nie ma danych, żeby tę regułę sprawdzić. Zweryfikuje ją ręczny krok” (`shared-offer-board/plan.md:71`).

### 3. Wyrocznia — nieudany odczyt (`notes.ts`, `members.ts`, `criteria.ts`)

| # | Zachowanie | Źródło | Status |
|---|---|---|---|
| R1 | `loadNotes`: brak klienta, błąd zapytania albo wyjątek → `{ state: "error" }`, nigdy puste `ok`; nigdy nie rzuca | CLAUDE.md `## Structure` („a failed read is its own state, never "no notes"”), `member-notes/plan.md:152`, `:62` | rozstrzygnięte |
| R2 | Powód reguły R1: pusty formularz wysłany upsertem nadpisałby istniejącą notatkę członka | `member-notes/plan.md:62` | rozstrzygnięte — wiąże R1 z guardrailem PRD o notatkach (`prd.md:45`) |
| R3 | Odczyt notatek udany, odczyt `members` nieudany → stan zostaje `ok`, notatka jest pokazana, autor `unknown` | brak jednego zdania; wynika z `member-notes/plan.md:138` (błąd → `unknown`, nigdy nie rzuca) razem z `:62` | wniosek z dwóch zdań źródła, nie cytat |
| R4 | `resolveSaver`: `null` → `deleted`; `createdBy === viewerId` → `self` bez zapytania; wiersz z niepustym e-mailem → `member`; błąd, wyjątek, brak wiersza, `email === null` → `unknown`; nigdy nie rzuca | `duplicate-listing-notice/plan.md:115`, `:56`; CLAUDE.md `## Structure` | rozstrzygnięte |
| R5 | `resolveAuthors`: wynik w kolejności wejścia; te same cztery warianty; jedno zapytanie `.in("id", ids)` dla unikalnych id; brak id do odczytu → żadnego zapytania | `member-notes/plan.md:138` | rozstrzygnięte |
| R6 | `unknown` nikogo nie nazywa i nigdy nie jest pokazany jako usunięte konto: `saverName`/`authorName` → `null` | CLAUDE.md `## Structure`, `duplicate-listing-notice/plan.md:56`, `member-notes/plan.md:139`, `:62` | rozstrzygnięte |
| R7 | Brzmienie dla `deleted`: „osobę z usuniętym kontem” (biernik), „Osoba z usuniętym kontem” (mianownik nagłówka notatki) | PRD NFR (`prd.md:128`) | rozstrzygnięte. Plany `duplicate-listing-notice` z „konto usunięte” są nieaktualne w tym jednym punkcie (`change.md:18` tej zmiany) |
| R8 | Brzmienie dla `self`: „Ciebie” / „Ty”; nagłówek dla `unknown`: „Notatka członka zespołu” | `member-notes/plan.md:139`, `:24`, `:218` — PRD tego nie ustala | kopia interfejsu, nie reguła produktu |
| R9 | `loadCriteria`: brak klienta, błąd zapytania, brak wiersza singletonu albo wyjątek → `{ state: "error" }`; nigdy nie rzuca | CLAUDE.md `## Structure` („never "no limits"”), `team-search-criteria/plan.md:120`, `:21` | rozstrzygnięte |
| R10 | Nieudany odczyt `member_requirements` przy udanym `team_criteria` → `error` | tylko ogólne „błąd zapytania → error” (`plan.md:120`), `plan-brief.md:47` | rozstrzygnięte przez regułę ogólną |
| R11 | `loadTeamLimits`: nieudany odczyt → `{ ok: false }`, nigdy „brak limitów”, który ukryłby każde złamanie | CLAUDE.md `## Structure` (`data-limits-state`: „failed read is never shown as "no breaches"”), `plan.md:22`, `:121` | reguła rozstrzygnięta; lista warunków porażki dla tej funkcji nie jest w planie wyliczona |
| R12 | `limitsChangedBy`: `updated_by` null z datą `updated_at` = usunięte konto; null bez daty = limity nigdy nie ustawione | migracja `supabase/migrations/20260927144141_create_team_criteria.sql:20-21`; `plan.md:177` („albo nic, gdy nikt jeszcze nie zmieniał”) | rozstrzygnięte w migracji referencyjnej |
| R13 | Wiersz `team_criteria` z wartością nieczytelną jako limit (`0`, ujemna, tekst nieliczbowy, puste miasto) | plan mówi tylko, że nieustawiony limit to nigdy 0 (`plan.md:20`); wynik „→ stan błędu” opisuje wyłącznie review jako obserwację implementacji (`reviews/impl-review.md:53`), a decyzją było zaostrzenie bazy, żeby taki wiersz nie mógł istnieć (`plan.md:401`) | **nierozstrzygnięte → OQ-4** |
| R14 | `null` w kolumnie autora przy braku klienta: `deleted` czy `unknown` | kontrakt (`duplicate-listing-notice/plan.md:115`) stawia `null → deleted` pierwsze; `:56` wymienia „brak klienta” pod `unknown` bez tego zastrzeżenia | **nierozstrzygnięte → OQ-5** |

Jak stany błędu wyglądają dla członka (do ewentualnych asercji renderowania, nie do testów `src/lib`):

- Notatki: `data-notes-state="error"`, „Nie udało się wczytać notatek.”, bez edytora (`OfferNotes.astro:41,60-64`).
- Kryteria: `data-criteria-state="error"`, „Nie udało się wczytać kryteriów.”, bez formularzy (`CriteriaView.astro:73,165-169`).
- Limity na tablicy: `data-limits-state="error"` zawsze; widoczny komunikat „Nie udało się wczytać limitów zespołu — oferty nie są z nimi porównane.” tylko przy udanym odczycie tablicy z co najmniej jedną ofertą (`OfferBoard.astro:32,52-56`).
- Autor `unknown`: „Zapisane {data}” bez nazwy (`OfferCard.astro:49-55`), „Notatka członka zespołu” (`NoteCard.tsx:28`), „Wymagania członka zespołu” (`RequirementsCard.tsx:29`), baner bez autora (`DuplicateNotice.astro:21-26`), „Ostatnio zmienione {czas}” bez „przez” (`CriteriaView.astro:95-99`).

### 4. Mechanika testu hermetycznego

- **Klient.** `createClient(requestHeaders: Headers, cookies: AstroCookies)` zwraca `null`, gdy brak `SUPABASE_URL` albo `SUPABASE_KEY` (`src/lib/supabase.ts:5-8`). `tests/setup.ts:6-10` mockuje `astro:env/server` w stanie zero-config; plik testu nadpisuje to własnym `vi.mock` z `SUPABASE_TEST_URL`/`SUPABASE_TEST_KEY` (`tests/pages/api/criteria.test.ts:9-12`). Żaden istniejący test nie woła `createClient` wprost — trasy robią to same. Test funkcji z `src/lib` musi zbudować klienta sam: `createClient(new Headers(), { set: vi.fn() } as unknown as AstroCookies)`. Importowanie `@/lib/supabase` w teście nie jest mockowaniem `@/lib/*`.
- **Gałąź „brak klienta”** nie wymaga zaślepki: funkcje przyjmują `supabase: null` jako argument.
- **Zaślepka.** `stubFetch(handler)` + `afterEach(restoreFetch)`; żądanie nieobsłużone przez handler wywala test (`tests/fixtures/http.ts:38-72`). `isTableRequest(request, table, method)` i `jsonResponse(value, status)` wystarczą (`:149-157`). `RecordedRequest` nie zapisuje nagłówków (`:14-18`).
- **Jak postgrest-js 2.116.0 zamienia odpowiedź na wynik** (`node_modules/@supabase/postgrest-js/dist/index.mjs`):
  - Status nie-2xx z ciałem JSON → `error` ustawione, bez ponowień — poza statusami 503 i 520 (`:77`, `:179-183`, `:511-524`). Odpowiedź `500` z `{ code, message }` to najtańszy sposób na błąd odczytu.
  - Statusy 503 i 520 oraz odrzucony `fetch` dla metody GET są ponawiane do 3 razy z odstępami 1 s, 2 s, 4 s (`:71`, `:196-235`). Test takiej gałęzi bez fałszywych zegarów trwa około 7 s; nagłówek `tests/fixtures/http.ts:129-130` już to odnotowuje.
  - Po wyczerpaniu ponowień odrzucony `fetch` staje się zwykłym wynikiem z `error`, nie wyjątkiem (`:416`, gdy nie ustawiono `throwOnError`). Gałęzi `catch` w badanych funkcjach nie wywoła więc sama sieć — wywoła ją odpowiedź `200` o nieoczekiwanym kształcie (puste ciało daje `data` bez tablicy, na której kod woła `.map`/iterację).
  - `maybeSingle()` z więcej niż jednym wierszem → `error` z kodem `PGRST116` (`:493-500`); `200 []` → `data: null` bez błędu (`:509`). To jest sygnatura „brak wiersza singletonu” (R9) i „brak wiersza w `members`” (R4).
  - Status 404 z ciałem-tablicą jest zamieniany na `data: []` bez błędu (`:513-519`) — nie nadaje się na zaślepkę błędu.
- **Dane do testów czystych funkcji**: `src/pages/dev/_offer-fixtures.ts` ma `noLimits` (`:211`), `boardLimits` (`:217`), `failedLimits` (`:240`). Wartości oczekiwane trzeba pisać ręcznie z reguły, nie brać z wyniku funkcji.

### 5. Stan pokrycia

- `tests/`: grep po 16 nazwach (`loadNotes`, `noteError`, `resolveSaver`, `resolveAuthors`, `saverName`, `authorName`, `loadCriteria`, `loadTeamLimits`, `parseLimitsForm`, `requirementsError`, `limitBreaches`, `normalizePlace`, `parseBoardSort`, `boardSortHref`, `BOARD_SORT_COLUMN`, `auditStatus`) nie zwrócił żadnego trafienia.
- Pośrednio: `tests/pages/api/criteria.test.ts:100-108,137-150` przechodzi przez `parseLimitsForm`; `tests/components/offers/render.test.ts:65-76` i `offer-board-item.test.ts:26` renderują z `memberSaver` i `noLimits`, więc `saverName`, `limitBreaches` i `auditStatus` wykonują się bez asercji na wynik.
- `scripts/smoke.mjs` (grep i zakresy 546-566, 640-662, 704-760, 990-1010, 1085-1125): `:646-661` trzy warianty sortowania — tylko status 200 i `data-board-state="ok"`; `:733-735` notatka widoczna i `data-notes-state="ok"`; `:1003-1005` `data-criteria-state="ok"`; `:1100-1105` `data-limits-state="ok"` i `data-limit-breach="price_above"` na jednej ofercie. Brak kroku szukającego `="error"`.

### 6. Wynik bazowy Strykera (raport z 2026-10-01, `reports/mutation/mutation.html`)

| Moduł | Wynik | Zabite | Ocalałe | Bez pokrycia | Razem |
|---|---|---|---|---|---|
| `src/lib/team-limits.ts` | 6,0% | 5 | 35 | 43 | 83 |
| `src/lib/criteria.ts` | 22,35% | 59 | 42 | 163 | 264 |
| `src/lib/notes.ts` | 0% | 0 | 0 | 60 | 60 |
| `src/lib/members.ts` | 0% | 0 | 3 | 126 | 129 |
| `src/lib/offer-board.ts` | 0% | 0 | 13 | 35 | 48 |

- `criteria.ts`: 59/264 = 22,35%; `change.md` podaje 22,4% — ta sama liczba po zaokrągleniu.
- Podział `criteria.ts` po wierszach: w części walidacji formularza (wiersze 1–150: `parseNumber`, `parseLimitsForm`, `requirementsError`) 59 zabitych, 41 ocalałych, 26 bez pokrycia; w części odczytu (wiersze 151–285: `limitNumber`, `readLimits`, `loadCriteria`, `loadTeamLimits`) 0 zabitych, 1 ocalały, 137 bez pokrycia. Całe obecne 22,35% pochodzi z części, której ryzyko (1) nie dotyczy.
- `notes.ts`: 40 mutantów w odczycie (wiersze 1–99), 20 w `noteError` i stałych (wiersze 100–113).
- `members.ts`: 103 mutanty w `resolveSaver`/`resolveAuthors`/`readEmails` (wiersze 1–85), 26 w `saverName`/`authorName`.
- `team-limits.ts`: 12 mutantów w `normalizePlace`, 71 w `limitBreaches`.
- Stryker przyjmuje zakres wierszy (`--mutate "src/lib/criteria.ts:151-285"`, CLAUDE.md `## Testing`), więc faza może mierzyć samą część odczytu.

## Code References

- `src/lib/team-limits.ts:19-28` — `normalizePlace`; `:37-59` — `limitBreaches`
- `src/lib/offer-board.ts:20-24` — `BOARD_SORT_COLUMN`; `:47-52` — `parseBoardSort`; `:55-58` — `boardSortHref`
- `src/pages/dashboard.astro:20-33` — `loadBoard`, jedyne miejsce z `nullsFirst: false`
- `src/lib/notes.ts:55-98` — `loadNotes`
- `src/lib/members.ts:26-42` — `resolveSaver`; `:51-64` — `resolveAuthors`; `:67-84` — `readEmails`; `:90-126` — `saverName`, `authorName`
- `src/lib/criteria.ts:179-197` — `limitNumber`, `readLimits`; `:214-269` — `loadCriteria`; `:275-285` — `loadTeamLimits`
- `src/lib/supabase.ts:5-20` — `createClient`
- `tests/fixtures/http.ts:38-72,149-157` — zaślepka i pomocniki
- `tests/pages/api/criteria.test.ts:9-12,29-43` — wzorzec nadpisania `astro:env/server` i handlera
- `supabase/migrations/20260927144141_create_team_criteria.sql:18-21` — znaczenie `updated_by`/`updated_at`

## Architecture Insights

- Wszystkie funkcje odczytu przyjmują klienta jako argument i zwracają unię ze stanem błędu; żadna nie rzuca. Testuje się je bez kontekstu Astro.
- `team-limits.ts` i `offer-board.ts` nie mają importów wykonywalnych — testy bez zaślepek i bez `vi.mock`.
- Reguła „nieznane na końcu” jest własnością zapytania SQL. Zaślepka może udowodnić wyłącznie, że zapytanie o to prosi (parametr `order` w zapisanym URL); że Postgres faktycznie tak sortuje, udowodni tylko prawdziwa baza.
- Żadne z dwóch ryzyk nie ma wiersza w `test-plan.md` §2. Najbliższy tag cookbooka to `(#1)` — „an unknown shown as a value in a view” (`test-plan.md:129-133`). §6 nie ma dziś podsekcji dla testu funkcji odczytu; §6.6 to notatki per faza.

## Historical Context (from prior changes)

- `context/archive/2026-09-27-team-search-criteria/plan.md:357` — czyste funkcje `parseLimitsForm`, `requirementsError`, `limitBreaches`, `normalizePlace` świadomie zostawione fixture'om na `/dev/*` i smoke, bo repo nie miało runnera.
- `context/archive/2026-09-26-shared-offer-board/plan.md:364`, `:71` — to samo dla `parseBoardSort`/`boardSortHref`; reguła `nullsFirst` zweryfikowana tylko ręcznie.
- `context/archive/2026-09-26-member-notes/plan.md:401` i `2026-09-26-duplicate-listing-notice/plan.md:258` — gałęzie `resolveAuthors`, `authorName`, `noteError`, `resolveSaver` sprawdzane tylko przez kitchen sinki i scenariusze ręczne.
- `context/archive/2026-09-27-team-search-criteria/reviews/impl-review.md:53,64` — wiersz z nieczytelną wartością blokował `/criteria` stanem błędu; naprawą było zaostrzenie checków tabeli.
- `context/archive/2026-09-26-shared-offer-board/reviews/impl-review.md:68` — check `col is null or col > 0` na `price` i `area_m2`: zapisane 0 nie może istnieć.
- Dwie zmiany `2026-09-30-testing-*` nie wymieniają żadnego z pięciu modułów jako celu ani jako odroczonego (grep po nazwach modułów i funkcji).

## Related Research

Żadna z czterech zmian funkcjonalnych nie ma `research.md` ani `frame.md`. Badania faz testowych: `context/archive/2026-09-30-testing-ingestion-guardrails/`, `context/archive/2026-09-30-testing-write-isolation/`.

## Open Questions

Decyzje użytkownika — plan ma je zadać, nie zgadywać.

- **OQ-1 (zakres, istotne). Gdzie testować „nieznane na końcu”?** Reguła żyje w `dashboard.astro:26`, poza `src/lib`. Możliwości: (a) przenieść `loadBoard` do `src/lib` i w teście hermetycznym sprawdzić parametr `order` zapisanego żądania — zmiana kodu produkcyjnego, dowodzi tylko treści zapytania; (b) krok w `scripts/smoke.mjs` z ofertami bez ceny i metrażu, porównujący pozycje wierszy w obu kierunkach — dowodzi faktycznej kolejności, wymaga rozszerzenia fixture'ów smoke; (c) oba; (d) poza zakresem tej zmiany, testowane są tylko `parseBoardSort` i `boardSortHref`.
- **OQ-2 (istotne). Kolejność złamań.** Źródła mówią „stała kolejność” i jej nie nazywają. Test może sprawdzać zbiór (kolejność nietestowana) albo konkretną kolejność — wtedy trzeba ją zapisać w PRD albo CLAUDE.md.
- **OQ-3 (istotne). Pusty `location_label`.** Czy etykieta pusta albo z samych spacji i przecinków jest „lokalizacją niepodaną” (nic nie łamie)? Wynikałoby to z FR-002, ale żadne źródło nie mówi tego o innej wartości niż `null`.
- **OQ-4. Nieczytelna wartość w wierszu `team_criteria`.** Czy testować, że `0`, wartość ujemna, tekst nieliczbowy albo puste miasto dają stan błędu (nigdy „brak limitu”)? Reguła nie jest zapisana w źródle; baza takiego wiersza nie dopuszcza, więc scenariusz osiągalny jest tylko przez zaślepkę.
- **OQ-5. `null` autora bez klienta** — `deleted` (fakt z wiersza) czy `unknown`? Dwa zdania tego samego planu czytają się różnie.
- **OQ-6. Przypadki nieosiągalne w `limitBreaches`** (odwrócony zakres cen, pusty limit miasta, limit z przecinkiem): testować czy świadomie pominąć mutanty.
- **OQ-7. `parseBoardSort` dla `sort=PRICE`, pustych wartości i powtórzonych parametrów** — źródła milczą.
- **OQ-8 (zakres Strykera). Walidatory w tych samych plikach.** `parseLimitsForm`, `requirementsError` (`criteria.ts:1-150`) i `noteError` (`notes.ts:100-113`) nie należą do ryzyka (1), a stanowią 126 z 264 i 20 z 60 mutantów. Faza może mierzyć zakres wierszy odczytu albo objąć walidatory testami.
- **OQ-9. Teksty interfejsu („Ty”, „Ciebie”, „Notatka członka zespołu”)** — PRD ustala tylko „osoba z usuniętym kontem”. Czy asercje mają wiązać resztę kopii, czy tylko to, że `unknown` zwraca `null`, a `deleted` tekst z PRD?
