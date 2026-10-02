---
change_id: testing-read-failure-states
title: Unit tests for read-failure states and team limits covered only by smoke
status: archived
created: 2026-10-01
updated: 2026-10-02
archived_at: 2026-10-02T12:42:57Z
---

## Notes

Testy jednostkowe dla logiki, którą dziś pokrywa wyłącznie scripts/smoke.mjs — poza fazami z context/foundation/test-plan.md §3 (fazy 3 i 4 czekają na S-04). Dwa ryzyka. (1) Nieudany odczyt pokazany jako pusty stan: błąd odczytu w src/lib/notes.ts, src/lib/members.ts i src/lib/criteria.ts nie może wyglądać jak „brak notatek”, „osoba z usuniętym kontem” ani „brak limitów” (CLAUDE.md, ## Structure) — lokalny Supabase nie zwróci błędu na żądanie, więc smoke tego nie złapie; warstwa: testy hermetyczne ze stubFetch z tests/fixtures/http.ts, bez mockowania @/lib/*. (2) Limity zespołu łamane przez fakt, którego ogłoszenie nie podaje: src/lib/team-limits.ts — limit łamie tylko podany fakt, cena w innej walucie niż PLN, brak ceny, metrażu lub lokalizacji nie łamią niczego (PRD, Guardrails, FR-002); do tego sortowanie z nieznanymi wartościami na końcu w src/lib/offer-board.ts; warstwa: testy jednostkowe czystych funkcji. Poza zakresem: src/pages/api/notes.ts, requirements.ts i auth/signin.ts jako całość (cienkie okablowanie, bramką jest RLS, właściwą warstwą zostaje smoke), src/lib/otodom/labels.ts, config-status.ts, uuid.ts, format.ts, utils.ts. Wyrocznia pochodzi z PRD i CLAUDE.md, nie z implementacji; gdzie źródła nie rozstrzygają oczekiwanego zachowania — pytanie do mnie, nie zgadywanie. Wymaganie dla planu: każda faza testowa kończy się krokiem weryfikacji Strykerem zawężonym do modułu tej fazy (npx stryker run --mutate "<plik>"), z zapisanym w planie wynikiem wyjściowym z 2026-10-01 jako punktem odniesienia (team-limits.ts 6,0%, criteria.ts 22,4%, notes.ts 0%), a każdy ocalały mutant dostaje decyzję: asercja,mutant równoważny albo świadomie pominięty — bez gonienia wyniku i bez progu liczbowego jako kryterium ukończenia. Ostatnia faza aktualizuje cookbook w test-plan.md §6.
