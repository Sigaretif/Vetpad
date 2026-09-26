<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Wspólna tablica ofert

- **Plan**: context/changes/shared-offer-board/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3
- **Date**: 2026-09-26
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

Automatyczne kryteria wszystkich faz powtórzone przy review: `npm run lint`, `npx astro sync && npx astro check` (0 błędów), `npm run build`, smoke na świeżym podglądzie produkcyjnym (wszystkie kroki), `ls` ścieżek z CLAUDE.md — PASS. Kroki ręczne 1.5–1.8, 2.6–2.9, 3.3 potwierdzone przez użytkownika w sesji implementacji. Sortowanie po cenie bez przeliczania walut jest w „What We're NOT Doing”, więc nie jest findingiem.

## Findings

### F1 — Stałe `id="board-heading"` w `OfferBoard`

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/offers/OfferBoard.astro:21
- **Detail**: `OfferBoard` ma na sztywno `id="board-heading"` i `aria-labelledby="board-heading"`. `/dev/board` renderuje go trzy razy (default, empty, error), więc strona ma trzy identyczne id, a każde `aria-labelledby` wskazuje pierwszy nagłówek. Produkcja ma dziś jedną tablicę, ale S-10 (archiwum) planuje drugą sekcję obok — wtedy kolizja trafi na `/dashboard`.
- **Fix**: Dodać prop `headingId` (domyślnie `"board-heading"`) i przekazać różne id z trzech instancji na `/dev/board`.
- **Decision**: FIXED — prop `headingId` (domyślnie `board-heading`) w `OfferBoard.astro`; `/dev/board` przekazuje `board-heading-empty` i `board-heading-error`

### F2 — „Cena: nie podano w ogłoszeniu” pogrubiona, „Metraż: nie podano” nie

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/offers/OfferBoardItem.astro:53
- **Detail**: `font-semibold` siedzi na `<span>` otaczającym oba warianty ceny, więc nieznana cena dziedziczy pogrubienie, a nieznany metraż i lokalizacja nie. Widać to na zrzucie `board-desktop.png` w sekcji „wszystko nieznane”. Trzy komunikaty „nie podano” wyglądają nierówno.
- **Fix**: Przenieść `font-semibold` tylko na gałąź ze znaną ceną (`<span class="font-semibold">{formatMoney(...)}</span>`), a `Unstated` renderować bez pogrubienia; odświeżyć zrzuty bramki.
- **Decision**: FIXED — `font-semibold` tylko na znanej cenie; zrzuty bramki powtórzone po triażu

### F3 — Wybór miniatury parsuje URL każdego zdjęcia każdej oferty

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/offers/OfferBoardItem.astro:22-25
- **Detail**: `images.map(safeHttpsUrl).find(...)` nie jest leniwe — `new URL` biegnie po wszystkich zdjęciach każdego wiersza, choć potrzebne jest pierwsze bezpieczne. Przy kilkudziesięciu ofertach z ~30 zdjęciami to setki parsowań na render na Workers Free (10 ms CPU). Plan akceptuje brak paginacji, ale ten koszt da się usunąć bez zmiany zachowania.
- **Fix**: Pętla `for` po `images`, która zwraca pierwszy wynik `safeHttpsUrl(...) !== null` i przerywa.
- **Decision**: FIXED — pętla `for` z wyjściem na pierwszej bezpiecznej miniaturze

### F4 — Baza nie broni „nieznane, nigdy zero” dla `price`/`area_m2`

- **Severity**: 💡 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260922202756_create_offers.sql (poza diffem; widoczne przez OfferBoardItem.astro:53-60)
- **Detail**: Mapper (`numericOrUnknown`) nigdy nie zapisuje `≤ 0`, ale tabela nie ma `check (price > 0)`, a polityka `update` pozwala każdemu członkowi zmienić kolumnę przez PostgREST. Zapisane `0` pokaże „0 zł” na tablicy i karcie i ustawi ofertę jako najtańszą przy sortowaniu — dokładnie fakt, którego guardrail PRD zabrania. Problem istniał przed tą zmianą (karta), tablica dokłada tylko sortowanie.
- **Fix**: Osobna zmiana z migracją `check (price is null or price > 0)` (i to samo dla `area_m2`, `price_per_m`), z `db push` na zgodę użytkownika.
  - Strength: Reguła trafia tam, gdzie jest powierzchnia ataku (wiersz w bazie), jak w lekcji o `safeHttpsUrl`.
  - Tradeoff: Migracja na hostowanym projekcie i własny cykl plan → implement; poza zakresem S-06.
  - Confidence: MED — nie sprawdzono, czy w hostowanej bazie są już wiersze z `0`, które zablokują `check`.
  - Blind spot: Stan danych produkcyjnych.
- **Decision**: FIXED — w tej zmianie (wybór użytkownika, poszerza zakres planu, który zakładał „brak migracji”): `supabase/migrations/20260926155042_offers_numeric_facts_positive.sql` zamienia zapisane `<= 0` na `null` (cenę i czynsz razem z walutą) i dodaje `check (col is null or col > 0)` na wszystkich siedmiu kolumnach, które mapper przepuszcza przez `numericOrUnknown` (`price`, `price_per_m`, `rent`, `area_m2`, `rooms`, `floors_total`, `build_year`), nie tylko na trzech z findingu. Zastosowana lokalnie (`supabase migration up`); `rent = 0` odrzucone przez `offers_rent_positive`. Hostowany projekt wymaga `npx supabase db push` (dry-run i zgoda użytkownika) przed wdrożeniem.

## Triage

- Fixed: F1, F2, F3, F4 (4)
- Po triażu (2026-09-26): lint, `astro check` (0 błędów), build, smoke na świeżym podglądzie produkcyjnym — PASS; zrzuty bramki `board` powtórzone (5/5), bo F2 zmienił widok.
