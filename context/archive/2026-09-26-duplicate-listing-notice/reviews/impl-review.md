<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Komunikat o duplikacie z autorem zapisu

- **Plan**: context/changes/duplicate-listing-notice/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3
- **Date**: 2026-09-26
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 6 observations

Faza 3 przejrzana w całości; jej jedyny otwarty punkt (3.6, sprawdzenie na produkcji) da się wykonać dopiero po wdrożeniu Workera. Świadome odstępstwo zatwierdzone przez użytkownika w trakcie implementacji: „osoba z usuniętym kontem” zamiast „konto usunięte” (PRD i `lessons.md` poprawione razem z UI) — nie jest traktowane jako dryf.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Findings

### F1 — Przełącznik `savedBy` zduplikowany w banerze i karcie

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/offers/DuplicateNotice.astro:18, src/components/offers/OfferCard.astro:23
- **Detail**: Dwa identyczne `switch` po `saver.kind`, łącznie z tekstem z PRD („osobę z usuniętym kontem”) i regułą „`unknown` nikogo nie nazywa”. CLAUDE.md każe S-05 i S-10 korzystać z `src/lib/members.ts`, więc następny slice skopiuje przełącznik trzeci raz, a zmiana brzmienia (jak ta dzisiejsza) musi trafić w każdą kopię. Repo ma wzorzec „jedno miejsce na etykietę” (`AuditStatusBadge.astro`).
- **Fix**: Wyeksportować `saverName(saver: Saver): string | null` (z wyczerpującym `never`) z `src/lib/members.ts` i użyć go w obu komponentach.
- **Decision**: FIXED — `saverName` w `src/lib/members.ts`, oba komponenty go używają

### F2 — Wyzwalacz e-maila: brak warunku `when` i brak upsertu w gałęzi UPDATE

- **Severity**: 💡 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260926185936_create_members.sql:44, :60
- **Detail**: `after update of email` odpala się przy każdym UPDATE, który wymienia `email` w SET, także bez zmiany wartości (zbędny zapis). Gałąź UPDATE robi zwykły `update`, więc brakujący wiersz `members` nie odrodzi się przy zmianie e-maila i członek zostanie `unknown` na stałe. Oba przypadki są dziś nieszkodliwe (uzupełnienie + wyzwalacz insert pokrywają każde znane konto). Migracja jest już na hostowanym projekcie, więc poprawka to nowa migracja, nie edycja tej.
- **Fix A ⭐ Recommended**: Odłożyć — zanotować w follow-upach i dołączyć do najbliższej migracji (np. S-05 albo osobnej zmiany z `revoke execute` na `offers_freeze_created_by`).
  - Strength: Żadnej dodatkowej migracji ani `db push` teraz; oba przypadki nie mają dziś realnego skutku.
  - Tradeoff: Znana drobna wada zostaje w schemacie do następnej migracji.
  - Confidence: HIGH — uzupełnienie i wyzwalacz insert pokrywają każde konto; zweryfikowane w fazie 1.
  - Blind spot: Nie sprawdzono, czy Supabase Auth kiedykolwiek usuwa i odtwarza konto z tym samym id.
- **Fix B**: Nowa migracja teraz: `create or replace function` z upsertem w obu gałęziach + odtworzenie wyzwalacza z `when (old.email is distinct from new.email)`.
  - Strength: Schemat od razu bez znanych wad, zanim S-05/S-10 zaczną z niego korzystać.
  - Tradeoff: Druga migracja w tym slice'ie i kolejny `db push` za zgodą przed git-land.
  - Confidence: HIGH — mała, idempotentna zmiana.
  - Blind spot: None significant.
- **Decision**: FIXED (Fix B) — migracja `20260926194251_members_sync_upsert_on_email_change.sql`, wypchnięta na hostowany projekt za zgodą

### F3 — Strażnik `saver === null` pokazałby „nie znaleziono” z kodem 200

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/offers/[id].astro:43, :54
- **Detail**: `saver` jest `null`, gdy nie ma oferty, a render sprawdza `offer === null || saver === null`. Strażnik służy tylko zawężeniu typu; gdyby `saver` był kiedyś `null` przy istniejącej ofercie, strona pokazałaby `OfferNotFound` ze statusem 200. Dziś niemożliwe (`resolveSaver` zawsze zwraca wartość).
- **Fix**: `const saver: Saver = offer ? await resolveSaver(…) : { kind: "unknown" }` i render warunkowany wyłącznie `offer === null`.
- **Decision**: FIXED — `saver` domyślnie `{ kind: "unknown" }`, render zależny tylko od `offer`

### F4 — Kitchen sink nie ma banera `member` ze zwykłym adresem

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/pages/dev/offer-card.astro:55
- **Detail**: Baner `member` używa `longEmailSaver` (test zawijania), a `memberSaver` nie występuje w żadnym banerze. Macierz 7 stanów nazywa „default” wariantem `member` — typowego banera z krótkim adresem nie widać na zrzucie.
- **Fix**: Dodać piąty `DuplicateNotice` z `memberSaver` (długi adres zostaje jako test zawijania) i powtórzyć zrzuty `gate` przed commitem.
- **Decision**: FIXED — piąty `DuplicateNotice` z `memberSaver`; zrzuty `gate` powtórzone

### F5 — Dwa kolejne zapytania na widok karty; uwaga dla S-05

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architecture
- **Location**: src/pages/offers/[id].astro:43
- **Detail**: Oferta, potem `members` (pomijane dla `self`/`deleted`). Osadzony select jest niemożliwy, bo `offers.created_by` wskazuje na `auth.users`, nie na `members`. Przy trzech członkach bez znaczenia; S-05 doda autora do każdej notatki i musi je pobierać jednym `.in("id", ids)`, nie zapytaniem na notatkę.
- **Fix**: Bez zmian w kodzie; dopisać uwagę o batchowaniu przy `resolveSaver` w `src/lib/members.ts` (albo zapisać jako lekcję).
- **Decision**: FIXED — uwaga o batchowaniu w komentarzu `resolveSaver`

### F6 — `formatTimestamp` w module ingestii otodom

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architecture
- **Location**: src/lib/otodom/labels.ts:203
- **Detail**: Formatuje kolumnę aplikacji (`created_at`), nie dane portalu, a leży w `src/lib/otodom/`. Plan tak to umieścił; S-05/S-10 będą importować daty notatek i archiwizacji z `@/lib/otodom/labels`.
- **Fix**: Zostawić; przenieść do ogólnego modułu formatowania, gdy S-05 będzie go potrzebować.
- **Decision**: FIXED (przeniesione teraz) — `formatTimestamp` w nowym `src/lib/format.ts`; `labels.ts` wrócił do stanu sprzed zmiany

### F7 — Stare brzmienie „konto usunięte” w dokumentach planu i starej migracji

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/changes/duplicate-listing-notice/plan.md:11, plan-brief.md:15, supabase/migrations/20260923153747_offers_keep_after_author_deleted.sql:8
- **Detail**: Implementacja, PRD, `lessons.md` i CLAUDE.md mówią „osoba z usuniętym kontem”; plan, brief i komentarz w zastosowanej już migracji nadal „konto usunięte”. Bloki faz planu są tylko do odczytu, a zastosowanej migracji się nie edytuje.
- **Fix**: Dopisać w `change.md` (## Notes) jedną linię o zatwierdzonej zmianie brzmienia; migrację zostawić jako historię.
- **Decision**: FIXED — adnotacja w `change.md` (## Notes); migracja zostawiona jako historia
