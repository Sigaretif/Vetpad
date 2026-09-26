<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Notatki członków obok ogłoszenia

- **Plan**: context/changes/member-notes/plan.md
- **Mode**: Deep
- **Date**: 2026-09-26
- **Verdict**: REVISE → SOUND (po triage)
- **Findings**: 0 critical, 3 warnings, 4 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | WARNING |

## Grounding

10/10 paths ✓, 5/5 symbols ✓, brief↔plan ✓, Progress 28/28 ✓. Sprawdzone na lokalnym stosie (w transakcjach z ROLLBACK): kaskada i `set null` omijają RLS i odpalają wyzwalacz BEFORE UPDATE; upsert działa z planowanymi politykami (polityka `select` jest konieczna); `'\S'` działa w Postgres; PATCH/DELETE zablokowane przez RLS dają 200 i `[]`; zablokowany INSERT daje 403 z `code` `42501`.

## Findings

### F1 — Nowe linie wysyłane jako CRLF łamią limit 5000 znaków

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 2 — trasa zapisu; Phase 1 — check `char_length`
- **Detail**: `maxlength` textarea liczy nową linię jako 1 znak (wartość API), a formularz wysyła ją jako CRLF. Pole na granicy limitu z N nowymi liniami przychodzi z długością 5000+N, więc odrzucają je `noteError` i `check` w bazie, a wpisany tekst przepada przy przekierowaniu.
- **Fix**: Trasa zamienia `\r\n` na `\n` przed walidacją i zapisem; przypadek curl w 2.3.
- **Decision**: FIXED

### F2 — Na /dev/offer-card powtarza się `id="notatki"`

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 3 — OfferNotes, kitchen sink; Phase 4 — FOCUS.noteEdit
- **Detail**: Pięć instancji `OfferView` w kitchen sinku daje zdublowane id sekcji i nagłówka (`aria-labelledby`), a `FOCUS.noteEdit` nie ma jednoznacznego celu.
- **Fix**: Prop `anchorId` w `OfferNotes` (domyślnie `notatki`), `notesAnchorId` w `OfferView`, unikalne wartości w kitchen sinku, `FOCUS.noteEdit` na pierwszy stan.
- **Decision**: FIXED

### F3 — Scenariusze usunięcia konta kasują konto używane przez smoke i zrzuty

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 (1.6), Phase 3 (3.7), Manual Testing krok 5
- **Detail**: Kroki usuwały `sigaretif1`, na którym opierają się dalsze kroki ręczne, smoke i zrzuty.
- **Fix**: Usuwamy `sigaretif3` (po zapisaniu przez nie notatki), a potem uruchamiamy `npx supabase db reset`.
- **Decision**: FIXED

### F4 — Helper REST w smoke ma czytać `body.code`, a nie `error_code`

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 4 — Smoke
- **Detail**: `supabaseSignup` czyta `error_code` (kształt Auth API, `scripts/smoke.mjs:70`), a PostgREST zwraca `{"code":"42501"}` z 403.
- **Fix**: Kontrakt helpera mapuje `code` na `errorCode`; krok oczekuje 403 i `42501`.
- **Decision**: FIXED

### F5 — Upsert z trasy zapisu zależy od polityki `select`

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 — Migracja
- **Detail**: `ON CONFLICT DO UPDATE` sprawdza politykę SELECT na istniejącym i nowym wierszu; bez niej upsert pada z `new row violates row-level security policy`. Późniejsze zawężenie `select` zepsułoby zapis z mylącym błędem.
- **Fix**: Zdanie w komentarzu migracji przy `offer_notes_select_authenticated`.
- **Decision**: FIXED

### F6 — `src/lib/notes.ts` importuje klienta Supabase wyłącznie jako typ

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 — Moduł notatek
- **Detail**: Wyspa importuje `notes.ts`; import wartości z `@/lib/supabase` wciągnąłby `astro:env/server` do paczki przeglądarki.
- **Fix**: Warunek `import type` zapisany w kontrakcie.
- **Decision**: FIXED

### F7 — Brak zarządzania fokusem przy przełączaniu podglądu i edycji

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 3 — NoteEditor
- **Detail**: „Edytuj” i „Anuluj” podmieniają DOM, a fokus spada na `body`.
- **Fix**: „Edytuj” przenosi fokus na „Zalety”, „Anuluj” wraca na „Edytuj”; w kontrakcie i w 3.4.
- **Decision**: FIXED
