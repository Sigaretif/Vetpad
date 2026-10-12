# Faza 4 planu testów — ugruntowanie znalezisk i prywatność promptu (#4, #6) — Plan Brief

> Full plan: `context/changes/testing-audit-grounding-privacy/plan.md`
> Research: `context/changes/testing-audit-grounding-privacy/research.md`

## What & Why

Faza 4 rolloutu z `context/foundation/test-plan.md` ma dowieść, że żadne znalezisko bez dosłownego cytatu nie trafia do zapisu (#4) i że do dostawcy modelu nie trafiają dane sprzedającego ani notatki (#6, strona promptu). Testy z S-04 już to dowodzą, więc plan domyka trzy drobne luki i zostawia zapis wyniku, zamiast pisać drugi raz to samo.

## Starting Point

Obie ochrony mają testy na czterech etapach, z kontrolą źródła. Stryker na czterech modułach audytu: 507 mutantów, 502 zabite, 4 timeouty, 1 ocalały (równoważny). Brakuje przypadku kontaktu wpisanego w tytuł, automatycznego dowodu reguły lintu `auditNoNotesConfig` i dziennika mutantów.

## Desired End State

Wytyczna z §2 dla #6 jest dowiedziona dosłownie, także dla tytułu. Import modułu notatek w kodzie audytu czerwieni `npm test`, a nie tylko `npm run lint`. Folder zmiany ma `mutation.md`, a §6.6 planu testów — wpis fazy 4 z listą rzeczy otwartych. Kod pod `src/` jest taki sam jak przed zmianą.

## Key Decisions Made

| Decision                           | Choice                                                                   | Why (1 sentence)                                                                               | Source   |
| ---------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- | -------- |
| Kontakt w tytule (L1)              | Po jednym przypadku w `input.test.ts` i `prompt.test.ts`                 | Zamyka wytyczną na warstwie, na której stoi ochrona; trasa i bramka cytatów zostają bez zmian. | Plan     |
| Reguła lintu (L2)                  | Test Vitest przez API ESLinta, w `npm test`                              | Usunięcie reguły ma czerwienić CI, nie zależeć od jednorazowej ręcznej próby.                  | Plan     |
| Ścieżki w teście lintu             | Tylko pliki, które istnieją                                              | Lint z typami kończy wymyśloną ścieżkę błędem krytycznym, zanim dojdzie do reguły.             | Plan     |
| Cytat urwany w połowie i `</opis>` | Wpis „Open" w §6.6, bez testów i bez zmian w kodzie i PRD                | Faza testowa nie przesądza pytania produktowego (FR-011).                                      | Plan     |
| Złoty zestaw                       | Poza planem, wpis „Open" w §6.6                                          | Każde ogłoszenie to płatny audyt, który uruchamia tylko użytkownik.                            | Plan     |
| Warstwa dowodu dla #4              | Jednostkowa, bez nowych przypadków                                       | Ochrona stoi na jednej czystej funkcji i jednym czytniku kształtu, a mutanty są zabite.        | Research |
| Dziennik mutantów (L3)             | `mutation.md` w folderze zmiany, na wzór fazy 3                          | Raport Strykera jest lokalny i nadpisywany.                                                    | Research |
| Dowód „raz czerwony"               | Każdy nowy przypadek czerwony na celowo zepsutym kodzie, potem cofnięcie | Test, który nigdy nie był czerwony, niczego nie dowodzi.                                       | Plan     |

## Scope

**In scope:**

- Dwa przypadki kontaktu w tytule (`tests/lib/audit/input.test.ts`, `tests/lib/audit/prompt.test.ts`)
- Nowy `tests/eslint.config.test.ts`
- Przebieg Strykera na czterech modułach i `mutation.md`
- `context/foundation/test-plan.md` (§6.5, §6.6, §8) i jedno zdanie w `CLAUDE.md`

**Out of scope:**

- Kontakt w tytule w teście trasy i w bramce cytatów
- Testy trzech siostrzanych reguł `*NoNotesConfig`
- Testy przypinające cytat urwany w połowie i znacznik `</opis>`; zmiany w `prd.md`
- Złoty zestaw i każde żądanie, na które dostawca modelu by odpowiedział
- Zmiany w `src/`, `eslint.config.js`, migracjach, `scripts/` i w §3 planu testów

## Architecture / Approach

Najpierw testy, potem Stryker, żeby dziennik opisywał stan końcowy. Nowe przypadki kopiują kształt sąsiednich: dowód nieobecności ma kontrolę obecności w źródle, a przypadek zapalający regułę stoi obok takiego, który jej nie zapala. Test lintu używa klasy `ESLint` z konfiguracją projektu, lintuje próbkę pod ścieżką istniejącego pliku, nic nie zapisuje na dysk i sprawdza w każdym przypadku brak komunikatu `fatal`.

## Phases at a Glance

| Phase                     | What it delivers                                                          | Key risk                                                                                   |
| ------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 1. Nowe przypadki testów  | Kontakt w tytule na dwóch etapach i test reguły lintu, każdy raz czerwony | Test lintu zielony, mimo że lint się nie odbył — stąd asercja braku `fatal` i limit czasu. |
| 2. Stryker i dokumentacja | `mutation.md`, wpis fazy 4 w §6.6, poprawki §6.5, zdanie w `CLAUDE.md`    | Liczba timeoutów może się różnić między przebiegami; zapisujemy stan faktyczny.            |

**Prerequisites:** S-04 w `master` (jest); lokalne `npm test` zielone. Supabase i klucz dostawcy nie są potrzebne.
**Estimated effort:** ~1 sesja, 2 fazy.

## Open Risks & Assumptions

- `npm test` wydłuża się o ok. 5–6 s na zimny start ESLinta.
- Test lintu jest związany ze ścieżkami `src/lib/audit/input.ts`, `src/pages/api/audits.ts` i `src/lib/members.ts`; przeniesienie pliku czerwieni go głośno, co jest zamierzone.
- Zakładamy, że przebieg Strykera powtórzy wynik z researchu (kod pod `src/` się nie zmienia); inny wynik jest zapisywany z wyjaśnieniem.
- Jakość znalezisk — czy model wskazuje to, co ważne — pozostaje nietestowana do czasu złotego zestawu.

## Success Criteria (Summary)

- Kontakt wpisany w tytuł jest dowiedziony jako zachowany dosłownie, a kanarki z `raw` jako nieobecne — w tych samych przypadkach.
- Usunięcie albo osłabienie reguły `auditNoNotesConfig` czerwieni `npm test`.
- Każdy ocalały mutant w czterech modułach audytu ma zapisaną decyzję, a rzeczy otwarte stoją w §6.6.
