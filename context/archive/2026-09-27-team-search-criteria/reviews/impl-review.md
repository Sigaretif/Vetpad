<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Kryteria wyszukiwania zespołu

- **Plan**: context/changes/team-search-criteria/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3, 4, 5
- **Date**: 2026-09-28
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 2 warnings, 6 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Success criteria (uruchomione 2026-09-28)

| Polecenie | Wynik |
|---|---|
| `npm run lint` | PASS (exit 0) |
| `npx astro sync` | PASS (exit 0) |
| `npx astro check` | PASS — 82 pliki, 0 błędów / 0 ostrzeżeń / 0 podpowiedzi |
| `npm run build` | PASS (exit 0) |
| `npm run smoke` (podgląd produkcyjny + lokalny Supabase) | PASS — „All smoke steps passed” |
| `node scripts/ui-screenshots.mjs criteria\|forms\|board <scratchpad>` | PASS — 5 / 11 / 8 zrzutów, exit 0 (do scratchpadu, żeby nie nadpisać zacommitowanych) |

Manual: wszystkie pozycje odhaczone. 1.3–1.7 i 2.2–2.4 mają pokrycie w smoke (RLS z dwóch kont, licznik, przekierowania). 5.6 (`db push` za zgodą) nie da się potwierdzić z diffu — przyjęte na słowo commita d478393.

## Findings

### F1 — Plan nie odnotowuje odstępstw wprowadzonych w trakcie

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/changes/team-search-criteria/plan.md:137, 145, 292; src/pages/criteria.astro:12
- **Detail**: Od p3 (dd04810) trasy przekierowują błąd na `/criteria?error=…&form=limits#limity` / `&form=requirements#wymagania` (src/pages/api/criteria.ts:34-35, src/pages/api/requirements.ts:137-138), a strona i widok rozdzielają komunikat po `form` — spójnie route → page → view → smoke, udokumentowane w CLAUDE.md i README. Plan wciąż opisuje `?error=…#limity` (137, 145, 292); jedyny ślad to treść commita. Podobnie nieodnotowane, choć uzasadnione: `inputMode` w `src/components/form/FormField.tsx` (plik spoza planu), kontrolowane ukryte pole `intent` w `TeamLimitsForm.tsx` (Firefox), `resolveAuthors` zamiast `resolveSaver` w `loadCriteria`, podpis „Ostatnio zmienione przez X” zamiast „ostatnio zmienił(a) X”, brak osobnego zrzutu fokusu pola wymagań (odsyła do `forms-focus-note-field`, ten sam `TextareaField`). Komentarz w src/pages/criteria.astro:12 pisze `?form=`, a URL niesie `&form=`.
- **Fix**: Dopisać w plan.md (137, 145, 292) `&form=<limits|requirements>` i krótki blok „Odstępstwa w implementacji” z pozostałymi punktami; poprawić komentarz w criteria.astro:12 na `&form=`.
- **Decision**: FIXED — plan.md: kontrakty tras (137, 145) i kroki smoke (292) z `&form=`, nowa sekcja „Odstępstwa w implementacji” przed `## Progress` (łącznie z migracją z F2); komentarz w `src/pages/criteria.astro:12` poprawiony na `&form=`.

### F2 — Baza przyjmuje limity, których aplikacja nie odczyta, a wtedy znika formularz, który mógłby je naprawić

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260927144141_create_team_criteria.sql:46-53; src/lib/criteria.ts:173-191; src/components/criteria/TeamLimitsForm.tsx:29-36
- **Detail**: `parseLimitsForm` ma docblock „Mirrors every check on the table, so a limit this accepts is never rejected by the database” — kierunek odwrotny nie jest pilnowany. `btrim(city) <> ''` usuwa tylko spacje, a `readLimits` odrzuca miasto z samym tabulatorem/NBSP (`city.trim() === ""`); `price_* < 'Infinity'` przepuszcza np. `1e400`, który `JSON.parse` zamienia w `Infinity` i `limitNumber` odrzuca; ceny ułamkowe i metraż z >2 miejscami baza przyjmuje, a `initialValues` wypełni nimi formularz, którego `parseLimitsForm` nie przepuści. Każdy członek może to wpisać jednym PATCH-em przez Data API (lekcja: „the stored row, not the ingest, is the attack surface”). Skutek: `loadCriteria` → `error`, `/criteria` bez formularzy, tablica „oferty nie są porównane” — i nikt nie naprawi wiersza z UI.
- **Fix A ⭐ Recommended**: Nowa migracja zaostrzająca checki do reguł parsera: `price_min = trunc(price_min)` i `price_max = trunc(price_max)` z górną granicą (np. `< 1e12`), `area_min = round(area_min, 2)` z górną granicą, miasto odrzucane, gdy składa się wyłącznie z białych znaków (regex `^[[:space:]  ]*$`).
  - Strength: Zamyka niespójność u źródła — wiersz, który baza przyjmie, zawsze da się odczytać i edytować; zgodne z wzorcem „baza jest jedyną bramką”.
  - Tradeoff: Nowa migracja do `db push` za zgodą; trzeba dobrać granice górne i dopilnować, by obecny wiersz na hostowanym projekcie je spełniał.
  - Confidence: HIGH — checki są lokalne dla jednej tabeli, parser już definiuje reguły.
  - Blind spot: Nie sprawdziliśmy, czy klasa `[[:space:]]` w Postgresie łapie U+00A0 / U+202F bez jawnego wypisania.
- **Fix B**: Renderować „Wyczyść limity” także w stanie błędu odczytu `/criteria`.
  - Strength: Zmiana tylko w widoku; każdy stan zepsutego wiersza da się naprawić z UI.
  - Tradeoff: Łamie zasadę planu „stan error nie renderuje formularzy”; akcja czyszcząca na danych, których nie pokazaliśmy, i wymaga nowego stanu na `/dev/criteria` i `/dev/forms`.
  - Confidence: MED — prosta zmiana, ale kłóci się z decyzją z planu.
  - Blind spot: Nie leczy przyczyny — wiersz dalej może trafić w nieczytelny stan.
- **Decision**: FIXED (Fix A) — migracja `supabase/migrations/20260928074737_tighten_team_criteria_checks.sql` (te same nazwy constraintów; biały znak wg JS `trim()`, ceny całkowite ≤ `Number.MAX_SAFE_INTEGER`, metraż ≤ 2 miejsc i ta sama granica); `parseLimitsForm` liczy długość miasta w punktach kodowych (`Array.from`), `parseNumber` ogranicza metraż do `Number.MAX_SAFE_INTEGER`; krok smoke „member cannot store a limit the form would refuse” (400 23514). Sprawdzone lokalnie w psql (11 odrzuceń, 8 akceptacji), lint/check/build/smoke PASS. `db push` na hostowany projekt wykonany 2026-09-29 za zgodą użytkownika (dry-run: tylko ta migracja; `migration list --linked` — local = remote).

### F3 — Miasto wpisane z przecinkiem albo inną pisownią łącznika oznacza każdą ofertę

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/team-limits.ts:18-26, 38-45; src/lib/criteria.ts:102-104
- **Detail**: Limit porównywany jest w całości z każdym członem `location_label` po przecinku. „Warszawa, mazowieckie” nigdy nie równa się żadnemu członowi, więc każda oferta z lokalizacją dostaje „Inne miasto niż…”; „Bielsko Biała” vs „Bielsko-Biała” z etykiety — to samo. Znacznik to tylko ostrzeżenie (oferta nie znika), ale fałszywy na całej tablicy.
- **Fix**: `parseLimitsForm` odrzuca przecinek w mieście z osobnym komunikatem, a `normalizePlace` traktuje `-` jak spację.
- **Decision**: FIXED — `parseLimitsForm` odrzuca przecinek w mieście („Wpisz samo miasto, bez przecinka…”), check `team_criteria_city_not_blank` w migracji z F2 dostał `position(',' in city) = 0`, `normalizePlace` czyta łącznik/półpauzę jak spację. Sprawdzone w psql i Node; lint/check/build/smoke PASS.

### F4 — Smoke nie sprawdza, że triggery neutralizują podrobiony PATCH

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: scripts/smoke.mjs
- **Detail**: Notatki mają kroki `patchNoteIdentity` / „note keeps its offer, author, id and database-set dates”. Dla nowych tabel brak odpowiednika: PATCH `updated_by`/`updated_at` na `team_criteria` i `author_id`/`created_at` na `member_requirements`. Triggery wyglądają poprawnie (migracja 100-117, 160-161, 179-181) i zostały sprawdzone ręcznie w 1.5, ale nie ma bramki w CI.
- **Fix**: Dodać dwa kroki PATCH-potem-odczyt na wzór kroków notatek.
- **Decision**: FIXED — cztery kroki w `scripts/smoke.mjs`: PATCH podpisu/daty/id limitów przez członka (200, rewizja +0) i odczyt, że podpis i data zostały z triggera; PATCH autora i dat własnych wymagań (200, rewizja +0) i odczyt, że autor i daty są bazy. Nagłówek smoke opisuje oba. Smoke PASS.

### F5 — Nieaktualny formularz limitów po cichu cofa zmianę innego członka i podbija rewizję

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/criteria.ts:72-82; src/components/criteria/TeamLimitsForm.tsx:62
- **Detail**: Formularz wysyła zawsze cztery pola. A otwiera `/criteria`, B zmienia cenę do, A zmienia tylko miasto — cena B wraca do starej, podpisana przez A, a licznik rośnie (S-09 oznaczy audyty jako nieaktualne). Plan świadomie to wyklucza („Wykrywanie konfliktu jednoczesnej edycji limitów — wygrywa późniejszy zapis, zmiana jest podpisana”), więc to nie dryf — odnotowane, bo skutek obejmuje też pola, których A nie ruszał.
- **Fix**: Bez zmian teraz; wrócić przy S-09, jeśli zespół zobaczy fałszywe „nieaktualne” audyty (ukryte `updated_at` + `.eq("updated_at", …)`).
- **Decision**: ACCEPTED — zgodne z „What We're NOT Doing” planu (wygrywa późniejszy zapis, zmiana jest podpisana). Wrócić przy S-09, jeśli zespół zobaczy fałszywe „nieaktualne” audyty: ukryte `updated_at` w formularzu + `.eq("updated_at", …)` i osobny komunikat o konflikcie.

### F6 — Zapis identycznych wymagań przesuwa ich datę edycji

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260927144141_create_team_criteria.sql:173-184
- **Detail**: Trigger `before update` wymagań zawsze ustawia `updated_at := now()`, więc zapis tego samego tekstu zmienia „edytowano”, choć licznik słusznie stoi. Limity celowo zachowują datę przy zapisie bez zmian; notatki zachowują się jak wymagania.
- **Fix**: W nowej migracji: `updated_at := now()` tylko gdy `new.body is distinct from old.body`, inaczej `old.updated_at` — albo zostawić, jeśli parytet z notatkami jest ważniejszy.
- **Decision**: FIXED — `create or replace function public.member_requirements_before_update()` w migracji 20260928074737: `updated_at := now()` tylko przy zmianie `body`, inaczej `old.updated_at`; autor i `created_at` dalej zamrożone, `revoke execute` powtórzony. Sprawdzone lokalnie w psql (ten sam tekst — data bez zmian, edycja — nowa data).

### F7 — Trasa wysyła `updated_by`, który trigger i tak nadpisuje

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/api/criteria.ts:79
- **Detail**: `updated_by: user.id` w payloadzie jest bez znaczenia (trigger ustawia go z `auth.uid()` albo zostawia stary przy zapisie bez zmian) i sugeruje, że podpis pochodzi od klienta — wbrew docblockowi trasy (24-26). Plan to przewidział („trigger i tak go ustawia”), ale kod myli czytelnika.
- **Fix**: Usunąć `updated_by` z `.update({...})`.
- **Decision**: FIXED — `updated_by` usunięty z payloadu `.update()` w `src/pages/api/criteria.ts`; podpis ustawia wyłącznie trigger, jak mówi docblock trasy.

### F8 — Karty cudzych wymagań mają ten sam poziom nagłówka co sekcja, w której są

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/criteria/CriteriaView.astro:147; src/components/criteria/RequirementsCard.tsx:26
- **Detail**: `<h3>` „Wymagania pozostałych członków” zawiera karty z `<h3>` (nazwa autora), więc dla czytnika ekranu karty są rodzeństwem nagłówka listy, nie jej dziećmi.
- **Fix**: Nagłówek listy jako `<h3>`, a karta dostaje prop `headingLevel` (domyślnie 3, tu 4) — albo nagłówek listy zamienić na etykietę bez roli nagłówka.
- **Decision**: FIXED — `RequirementsCard` dostał prop `headingLevel?: 3 | 4` (domyślnie 3), `CriteriaView` renderuje karty cudzych wymagań z `headingLevel={4}`. Bramka wizualna powtórzona: `node scripts/ui-screenshots.mjs criteria context/changes/team-search-criteria/screenshots` — exit 0, pięć zrzutów bajt w bajt identycznych z zacommitowanymi (wygląd bez zmian).

## Triage summary (2026-09-28)

| Decyzja | Ustalenia |
|---|---|
| Fixed | F1, F2 (Fix A), F3, F4, F6, F7, F8 |
| Accepted | F5 |

Po triage: `npm run lint`, `npx astro sync`, `npx astro check`, `npm run build` PASS; `npm run smoke` na podglądzie produkcyjnym PASS (93 kroki, w tym 5 nowych); zestaw zrzutów `criteria` exit 0, obraz bez zmian. Migracja `20260928074737_tighten_team_criteria_checks.sql` zastosowana lokalnie (`migration up` + psql dla części dopisanych w triage), `db push` na hostowany projekt wykonany 2026-09-29 za zgodą użytkownika (w firmowej sieci porty poolera 5432/6543 nie odpowiadały; z innej sieci przeszło).
