<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Notatki członków obok ogłoszenia

- **Plan**: context/changes/member-notes/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3, 4
- **Date**: 2026-09-26
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 2 warnings, 8 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | WARNING |

## Findings

### F1 — Nieaktualny formularz „nowej notatki” po cichu nadpisuje notatkę członka

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/notes.ts (upsert), src/components/offers/NoteEditor.tsx
- **Detail**: Trasa zawsze robi upsert na (offer_id, author_id), więc nie odróżnia „utwórz” od „edytuj”. Członek, który otworzył kartę w dwóch kartach przeglądarki lub na dwóch urządzeniach (w obu pusty formularz albo ta sama wersja notatki), zapisuje w jednej, potem w drugiej — drugi zapis zastępuje pierwszy bez ostrzeżenia. Dotyczy tylko własnej notatki (nie jest to problem autoryzacji), ale to utrata danych, której plan nie omawia.
- **Fix A**: Optymistyczna współbieżność — ukryte pole z wczytanym `updated_at` (puste dla nowej); pusta wartość → `insert`, inaczej `update … eq("updated_at", loaded)`; konflikt (23505 albo 0 wierszy) → `?error=` z osobnym komunikatem „Notatka zmieniła się w innym oknie…”.
  - Strength: Zamyka lost update u źródła; RLS i klucz unikalny już dają potrzebne sygnały (23505 przy insercie).
  - Tradeoff: Nowa gałąź w trasie, nowy komunikat, nowy krok smoke i stan w `/dev/forms`; tekst drugiego zapisu nadal przepada (redirect z `?error=`, plan to akceptuje).
  - Confidence: MED — wzorzec prosty, ale zmienia kontrakt `/api/notes` (CLAUDE.md: smoke musi to odzwierciedlić).
  - Blind spot: Porównanie `timestamptz` przez PostgREST przy zaokrągleniu mikrosekund.
- **Fix B ⭐ Recommended**: Zapisać w planie jako zaakceptowane ryzyko (notatka jest jednoosobowa, trzech członków, edycja w wielu oknach rzadka) i wrócić przy S-11.
  - Strength: Zero zmian w kodzie tuż przed wdrożeniem; ryzyko dotyczy wyłącznie autora i jego własnej świadomej akcji.
  - Tradeoff: Rzadka, ale cicha utrata tekstu zostaje.
  - Confidence: HIGH — skala zespołu z PRD.
  - Blind spot: Nie wiemy, jak często członkowie pracują na dwóch urządzeniach.
- **Decision**: FIXED (Fix B) — zaakceptowane ryzyko dopisane do „What We're NOT Doing” w plan.md, powrót przy S-11

### F2 — Autor może przez PostgREST sfałszować `created_at`/`updated_at` i zmienić `id` własnej notatki

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260926202537_create_offer_notes.sql (wyzwalacz `offer_notes_before_update`)
- **Detail**: Wyzwalacz działa tylko `before update`. Insert (także bezpośredni `POST` z kluczem publishable) przyjmuje `created_at`/`updated_at`/`id` od klienta, a update nie zamraża `id`. Członek może np. ustawić „edytowano 2099” — notatka stoi na górze listy (sort po `updated_at desc`) z fałszywą datą, dopóki nie zapisze jej przez aplikację. Nie dotyka cudzych notatek; `offers.created_at` ma tę samą ekspozycję (istniejący wzorzec).
- **Fix**: Nowa migracja (`supabase migration new offer_notes_server_timestamps`; ta wypchnięta zostaje nietknięta): wyzwalacz `before insert or update` — na insercie `created_at = updated_at = now()`, na update dodatkowo `new.id := old.id`; potem `db push` za zgodą i krok smoke, który sprawdza, że PATCH `offer_id`/`author_id` przez autora niczego nie zmienia.
  - Strength: Daty „edytowano” stają się faktem z bazy, nie deklaracją klienta; zamyka też O6 (brak testu wyzwalacza).
  - Tradeoff: Druga migracja i drugi `db push` na produkcję.
  - Confidence: HIGH — wzorzec wyzwalacza już jest w tej samej migracji.
  - Blind spot: `offers.created_at` zostaje z tą samą luką (poza zakresem S-05).
- **Decision**: FIXED — migracja `20260927133501_offer_notes_server_timestamps.sql` (wyzwalacz insertu z datami z bazy, `id` zamrożone przy update), kroki smoke „author's patch of the note's identity…” / „note keeps its offer, author, id and database-set dates” (break-check: czerwony na starym wyzwalaczu), CLAUDE.md i README; `db push` na produkcję za zgodą 2026-09-27

### F3 — Smoke zapisuje dane, ale nie odmawia pracy na hostowanym Supabase

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: scripts/smoke.mjs (konfiguracja, blok notatek)
- **Detail**: Smoke od teraz tworzy i usuwa ofertę. Dziś jest bezpieczny w praktyce (`.env` wskazuje 127.0.0.1, kont seedowych nie ma na produkcji), ale nic go nie zatrzyma, gdy ktoś ustawi `SMOKE_EMAIL`/`SUPABASE_URL` na prawdziwe konto — a CLAUDE.md mówi „never runs against production”.
- **Fix**: Na starcie odmówić, gdy host `SUPABASE_URL` nie jest `localhost`/`127.0.0.1`, chyba że ustawiono jawne `SMOKE_ALLOW_REMOTE=1`.
- **Decision**: FIXED — strażnik hosta na początku `scripts/smoke.mjs` (`SMOKE_ALLOW_REMOTE=1` jako jawne obejście), zdanie w README; sprawdzone: host zdalny → exit 1, lokalny → smoke zielony

### F4 — Błąd zapisu znika, gdy zawiedzie też odczyt notatek

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/offers/OfferNotes.astro (gałąź `error`)
- **Detail**: Przy `notes.state === "error"` `serverError` z `?error=` nie jest nigdzie pokazywany — członek widzi tylko „Nie udało się wczytać notatek.”, nie wie, że zapis się nie udał.
- **Fix**: W gałęzi błędu wyrenderować też `ServerError`/`Alert` z `serverError`, gdy jest.
- **Decision**: FIXED — `ServerError` z `serverError` w gałęzi błędu `OfferNotes.astro` (bez edytora); stan 4 na `/dev/offer-card` pokazuje błąd odczytu po nieudanym zapisie

### F5 — Walidacja pustej notatki w JS i w Postgresie rozjeżdża się dla rzadkich białych znaków

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/notes.ts (`noteError`), src/pages/api/notes.ts
- **Detail**: `trim()` nie usuwa U+001C–U+001F ani U+0085, a `\S` w Postgresie traktuje je jako białe (sprawdzone lokalnie). Notatka z samych takich znaków przechodzi `noteError`, łamie `offer_notes_not_blank` (23514) i członek dostaje ogólne „Nie udało się zapisać notatki”. Tylko spreparowane wejście.
- **Fix**: W trasie mapować 23514 na komunikat „Wpisz coś w co najmniej jednym polu notatki.”.
- **Decision**: FIXED — `/api/notes` mapuje 23514 na `NOTE_BLANK` (eksportowany z `src/lib/notes.ts`); sprawdzone curlem z U+001F

### F6 — Kitchen sink kopiuje komunikat walidacji zamiast go importować

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/dev/forms.astro (`noteBlankMessage`)
- **Detail**: Tekst „Wpisz coś…” jest skopiowany z nieeksportowanego `NOTE_BLANK` w `src/lib/notes.ts`; zmiana komunikatu nie dotrze do bramki wizualnej.
- **Fix**: W kitchen sinku użyć `noteError({ pros: "", cons: "", observations: "" })`.
- **Decision**: FIXED — `/dev/forms` importuje `NOTE_BLANK` z `@/lib/notes` zamiast kopii

### F7 — Błędy notatki lądują w formularzu „Dodaj ofertę” na tablicy

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/api/notes.ts (`fail`), src/pages/dashboard.astro
- **Detail**: `/dashboard?error=` jest renderowane jako `serverError` formularza dodawania oferty, więc „Nie znaleziono oferty, do której należy notatka.” wygląda jak błąd dodawania oferty. Zgodne z planem; tekst jest zrozumiały, a ścieżka osiągalna tylko przez ręcznie spreparowane żądanie albo usuniętą w międzyczasie ofertę.
- **Fix**: Zostawić; przy następnej zmianie tablicy dać jej osobny slot na komunikaty stron.
- **Decision**: SKIPPED — zgodne z planem; osobny slot komunikatów tablicy przy następnej zmianie `/dashboard`

### F8 — `?error=` na karcie pokazuje dowolny tekst jako błąd serwera

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/offers/[id].astro (`noteError` z `searchParams`)
- **Detail**: Link `/offers/<id>?error=<tekst>` otwiera edytor z tym tekstem w czerwonym alercie (escapowane — nie XSS). Wymaga znajomości uuid oferty, więc realnie tylko ktoś z zespołu; `/dashboard` i `/auth/signin` działają tak samo (konwencja z CLAUDE.md).
- **Fix**: Zostawić — zmiana na kody błędów to odejście od konwencji całej aplikacji, decyzja poza tym slice'em.
- **Decision**: SKIPPED — konwencja `?error=` całej aplikacji (CLAUDE.md), poza zakresem slice'a

### F9 — Karta wykonuje cztery zapytania do Supabase jedno po drugim

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/offers/[id].astro
- **Detail**: Oferta → `resolveSaver` → `loadNotes` → `resolveAuthors` sekwencyjnie; `resolveSaver` i `loadNotes` są niezależne. Przy trzech członkach pomijalne (plan, Performance Considerations).
- **Fix**: `Promise.all([resolveSaver(...), loadNotes(...)])`.
- **Decision**: FIXED — `resolveSaver` i `loadNotes` w `Promise.all` w `src/pages/offers/[id].astro`; sprawdzone: autor zapisu, notatki z dwóch kont, 404

### F10 — 4.6 odhaczone przed wdrożeniem Workera

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: context/changes/member-notes/plan.md (Progress 4.6)
- **Detail**: „Na hostowanym projekcie dwa konta widzą nawzajem swoje notatki…” zostało odhaczone na polecenie użytkownika, zanim Worker z notatkami trafił na produkcję — migracja jest wypchnięta, ale UI jeszcze nie działa na hostowanym projekcie, więc brak obserwowalnego dowodu.
- **Fix**: Po `/git-ship`/`/git-land` i wdrożeniu przejść scenariusz na produkcji dwoma kontami przed `/10x-archive`.
- **Decision**: ACCEPTED — użytkownik akceptuje odhaczenie 4.6 przed wdrożeniem Workera (2026-09-27)
