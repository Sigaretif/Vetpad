<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Karta oferty jako widok wzorcowy

- **Plan**: context/changes/ui-offer-card/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3, 4
- **Date**: 2026-09-23
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 4 warnings, 2 observations

Kontrole automatyczne w tym przeglądzie: `npx astro sync`, `npx astro check` (0/0/0), `npm run build` — przechodzą; `npm run lint` — 0 błędów, 1 ostrzeżenie (F5); grepy z planu 1.2–1.4, 2.2, 2.3, 3.2, 3.3, 4.4 — czyste; `/dev/offer-card` na `npm run dev` → 200; reguła `.gitignore` łapie trzy pliki `*offer-real*`. **Smoke (3.4, 4.2) nie był powtórzony** — lokalny Supabase wyłączony; te punkty opierają się na znacznikach z commitów. Przegląd bezpieczeństwa i wzorców zrobiony w głównym kontekście (sub-agent przerwany limitem sesji).

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Findings

### F1 — Link w Banerze bez pierścienia fokusu z tokenu

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/Banner.astro:26-31
- **Detail**: Linki w banerze (m.in. „Zobacz instrukcję konfiguracji” w banerze braku konfiguracji na każdym ekranie) dostają tylko globalne `outline-ring/50` z `@layer base` — kolor tokenu na domyślnym `outline: auto 1px` przeglądarki. Każdy inny link w ramie i karcie ma 3-pikselowy `focus-visible:ring-ring/50` z `buttonVariants`/galerii. Niespójny i cieńszy fokus na jedynym linku, który widzi użytkownik w stanie zero-config. Kontrast `ring/50` na tłach banerów policzony w tym przeglądzie (mieszanie oklab): info 3,28:1, warning 3,44:1, error 3,55:1 — token wystarcza.
- **Fix**: W `<style>` Banera dodać `.banner :global(a:focus-visible) { outline: 3px solid color-mix(in oklab, var(--ring) 50%, transparent); outline-offset: 2px; border-radius: 2px; }` (bez hexów, zgodnie z kontraktem fazy 2) i dorzucić zrzut fokusu na linku banera do zestawu `gate` w `scripts/ui-screenshots.mjs`.
- **Decision**: FIXED — reguła `a:focus-visible` w `Banner.astro`; nowy zrzut `gate-focus-banner` w zestawie `gate` skryptu (zrzut do zrobienia z lokalnym Supabase)

### F2 — „Oferty” i „Wróć do ofert” prowadzą na formularz „Dashboard”, nie na listę

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/components/Topbar.astro:16-18, src/pages/offers/[id].astro:47-49
- **Detail**: Oba linki wskazują `/dashboard`, który dziś jest nagłówkiem „Dashboard”, powitaniem po angielsku i `AddOfferForm` (`src/pages/dashboard.astro:9-20`) — żadnej listy ofert. Wcześniej napisy brzmiały „Dashboard” / „← Wróć do dashboardu”, więc zgadzały się z celem. Nazwa pochodzi z planu (faza 3, punkt 2), więc to wada planu, nie dryf. PRD FR-006 czyni `/dashboard` wspólną tablicą ofert (S-06), więc napis uprzedza docelową funkcję; do czasu S-06 obiecuje listę, której nie ma.
- **Fix A ⭐ Recommended**: Zostawić napisy i dopisać do wpisu S-06 w `context/foundation/roadmap.md`, że slice zamienia `/dashboard` w listę, do której prowadzą „Oferty” i „Wróć do ofert”
  - Strength: Napis już pasuje do FR-006; zero zmian w kodzie i zrzutach bramki, a zależność ląduje tam, gdzie przeczyta ją `/10x-plan shared-offer-board`.
  - Tradeoff: Do czasu S-06 trzy osoby klikają „Oferty” i widzą formularz dodawania.
  - Confidence: HIGH — FR-006 jednoznacznie mówi o „shared dashboard”, a S-06 jest następny w kolejce kart.
  - Blind spot: S-06 może wybrać inną trasę niż `/dashboard` — wtedy linki trzeba przepiąć.
- **Fix B**: Tymczasowy napis zgodny z celem („Dodaj ofertę” w Topbarze, „← Dodaj kolejną ofertę” na karcie), zmieniany z powrotem w S-06
  - Strength: Napis mówi prawdę dziś.
  - Tradeoff: Dwie zmiany tekstu zamiast żadnej, nowe zrzuty bramki, a Topbar na stronie głównej dostaje etykietę akcji zamiast nawigacji.
  - Confidence: MED — poprawne, ale czysto przejściowe.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A — zależność dopisana do „Risk” w S-06 (`context/foundation/roadmap.md`); napisy bez zmian

### F3 — Wartości parametrów w Roboto `font-medium` przeważają nad etykietami i nagłówkami

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/offers/OfferParameters.astro:76
- **Detail**: Klasa się nie zmieniła — przed zmianą też było `font-medium text-white` (`27a4165`, `OfferParameters.astro:70`). Zmienił się font: systemowy fallback nie miał wagi 500 i renderował 400, Roboto Variable renderuje prawdziwe 500. Na zrzutach `before-offer-real.png` / `after-offer-real.png` dwadzieścia wierszy wartości czyta się pogrubione, wizualnie blisko `h3 Udogodnienia` (`font-semibold`), a hierarchię etykieta/wartość i tak niesie kolor (`text-muted-foreground` vs `text-foreground`). shadcn `TableCell` nie nadaje wagi komórkom danych.
- **Fix**: W `td` zamienić `"text-foreground font-medium"` na `"text-foreground"` i powtórzyć zrzut `gate-desktop` (oraz porównać z `before-offer-real.png`).
- **Decision**: FIXED — `font-medium` usunięte z komórek wartości; zrzut `gate-desktop` do powtórzenia

### F4 — Dodatki spoza planu nieopisane w planie ani w dokumentacji

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: scripts/ui-screenshots.mjs, .gitignore:30-31, context/changes/ui-offer-card/screenshots/
- **Detail**: Dodatki są łagodne i przejrzane: skrypt używa tylko opublikowanych danych z `supabase/seed.sql`, sprząta profil Chrome w `finally`, nie jest importowany z `src/`; reguła `.gitignore` działa. Ale żaden nie ma śladu w `plan.md`, a `CLAUDE.md`/`README.md` opisują `scripts/otodom-inspect.mjs` jako narzędzie debugowania (CLAUDE.md:101, README.md:200), a nowego skryptu nie — reguła „zmiana wyglądu karty przechodzi przez `/dev/offer-card`: zrzut każdego stanu” nie mówi, czym ten zrzut zrobić. Niezignorowane zrzuty (12 plików, ~8 MB z `*offer-real*` włącznie; pełnostronicowe `gate-desktop` 1440×10947 i `gate-mobile` 750×24322) wejdą do historii publicznego repo przy commicie.
- **Fix**: Dopisać w `plan.md` addendum „Poza planem” z trzema pozycjami, dodać linię o `scripts/ui-screenshots.mjs` obok `otodom-inspect` w `CLAUDE.md` („## Testing”) i w README, i świadomie zdecydować, które zrzuty idą do commita (np. tylko `gate-*`).
- **Decision**: FIXED — addendum „Poza planem” w `plan.md`, linia w `CLAUDE.md` („## Testing”), sekcja w `README.md`; do repo idą wszystkie zrzuty poza `*offer-real*` (decyzja użytkownika)

### F5 — Baner łamie `astro/prefer-class-list-directive` (nowe ostrzeżenie lintu)

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/Banner.astro:20
- **Detail**: `class={cn(...)}` daje jedyne ostrzeżenie `npm run lint`. Przed zmianą baner używał `class:list`, a reszta zmienionych plików pisze `class:list={cn(...)}` (`OfferParameters.astro:76`, `Topbar.astro:16`).
- **Fix**: `class:list={cn("banner border-b px-4 py-3 text-center text-sm", variantClasses[variant])}`.
- **Decision**: FIXED — `class:list={cn(...)}` w `Banner.astro`

### F6 — `badge.tsx` zachowuje wariant `link` na `text-primary`

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/ui/badge.tsx:17
- **Detail**: Plan ograniczył zmiany po `shadcn add` do importów, więc to zgodne z planem. Ale faza 2 przepięła wariant `link` w `button.tsx` na `text-link`, bo `primary` jako tekst ma ~2,5:1 — `Badge variant="link"` nadal ma ten problem. Dziś wariant nie jest używany (karta używa `outline`), więc to pułapka na S-04…S-09, nie usterka widoku. (`destructive: text-white` zostaje — identyczny w `button.tsx:14`, wzorzec shadcn.)
- **Fix**: W `badge.tsx` zamienić `link` na `text-link underline-offset-4 [a&]:hover:underline`, jak w `button.tsx:19`.
- **Decision**: FIXED — wariant `link` w `badge.tsx` na `text-link`

## Triage

- **Fixed**: F1, F2 (Fix A), F3, F4, F5, F6
- Po poprawkach: `npm run lint` — 0 problemów; `npx astro check` — 0/0/0; `npm run build` — przechodzi; `/dev/offer-card` → 200 z nową regułą fokusu Banera i komórkami wartości bez `font-medium`.
- Do zrobienia przez człowieka (wymaga lokalnego Supabase): `node scripts/ui-screenshots.mjs gate` — odświeżyć `gate-desktop`/`gate-mobile` (F3) i zrobić nowy `gate-focus-banner` (F1); `npm run build && npm run preview` + `npm run smoke` (3.4, 4.2 niepowtórzone w przeglądzie).
