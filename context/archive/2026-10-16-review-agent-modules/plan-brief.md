# Modularny agent code review — Plan Brief

> Full plan: `context/changes/review-agent-modules/plan.md`

## What & Why

Jednoplikowy reviewer w `packages/code-reviewer/src/index.ts` rozbijamy na moduły, żeby agent oparty na `query()` z Claude Agent SDK był importowalny jako biblioteka. Ma to umożliwić przyszłe ewaluacje promptfoo bez zmiany kodu agenta. `review-schema.ts` zostaje jedynym kontraktem, a prompty dostają własne moduły.

## Starting Point

Działający CLI: diff na stdin, JSON na stdout, izolowany przebieg `query()` (bez narzędzi, ustawień, MCP i loginu, z limitem 0,5 USD), klucz tylko z `.env` pakietu. Import pliku uruchamia `main()`, a `SYSTEM_PROMPT` siedzi w pliku schematu. Wyjątek, który SDK rzuca po wyniku z błędem, gubi dziś koszt i przyczynę.

## Desired End State

`import { reviewDiff } from "code-reviewer"` zwraca `{ review, meta }` (koszt, tury, usage, model) albo rzuca `ReviewerError` z `code` i `meta`. Import niczego nie uruchamia. `git diff | npm run review` działa jak dziś, z kodem błędu w komunikacie i logiem kosztu także po porażce.

## Key Decisions Made

| Decision            | Choice                                                                                                             | Why (1 sentence)                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| Wynik reviewera     | `{ review, meta }`                                                                                                 | Provider promptfoo poda koszt i tokeny bez parsowania logów („Track cost per run”).                   |
| Klucz i ustawienia  | Wstrzykiwane `{ apiKey, model?, maxTurns?, maxBudgetUsd? }`, wartości domyślne w `config.ts`, loader `.env` osobno | Biblioteka bez I/O, evale mogą porównywać modele, a zasada „klucz tylko z `.env`” zostaje w loaderze. |
| Sygnalizacja błędów | `ReviewerError` z `code` (12 kodów) i opcjonalnym `meta`                                                           | CI i evale odróżnią przyczyny, a koszt nieudanego biegu nie ginie.                                    |
| Weryfikacja         | Typecheck, darmowe ścieżki CLI, jeden płatny bieg uruchamiany przez użytkownika                                    | Wybór użytkownika: bez nowej zależności testowej i bez seamu `queryFn`.                               |
| Wejście pakietu     | `index.ts` jako barrel, CLI w `cli.ts`, `exports` w `package.json`                                                 | Import nie może mieć efektów ubocznych.                                                               |
| Logowanie           | Biblioteka nie pisze na stdout/stderr, loguje CLI                                                                  | Provider eval sam decyduje, co zrobić z `meta`.                                                       |

## Scope

**In scope:**

- `src/prompts/system.ts` i `src/prompts/user.ts` (treść bajt w bajt bez zmian)
- `config.ts`, `errors.ts`, `env.ts`, `reviewer.ts`, `cli.ts`, barrel `index.ts`
- Obsługa wyjątku SDK po wyniku i mapowanie każdego `subtype` na kod
- Walidacja diffu i opcji przed jakimkolwiek I/O
- `package.json`: `exports` i skrypt `review`

**Out of scope:**

- Konfiguracja promptfoo
- Runner testów, testy jednostkowe, seam `queryFn`
- Zmiana schematu, promptów, modelu, budżetu i liczby tur
- Runtime'owa kontrola `tools`/`mcp_servers` z `init` oraz ochrona przed `</diff>`
- Root CI i ESLint dla `packages/`

## Architecture / Approach

`cli.ts` → `env.loadApiKey()` + stdin → `reviewer.reviewDiff(diff, { apiKey })` → `query()` z `SYSTEM_PROMPT`, `buildReviewPrompt(diff)` i `REVIEW_JSON_SCHEMA` → wynik walidowany przez `REVIEW_SCHEMA` → `{ review, meta }`. `index.ts` re-eksportuje bibliotekę dla przyszłego providera promptfoo. Najpierw wydzielamy liście zależności, potem przenosimy agenta.

## Phases at a Glance

| Phase                                    | What it delivers                                                                 | Key risk                                                                 |
| ---------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 1. Kontrakt, prompty i moduły pomocnicze | Schemat bez promptów, `prompts/`, `config`, `errors`, `env`; CLI działa jak dziś | Niezauważona zmiana tekstu promptu (pilnuje tego porównanie SHA-256)     |
| 2. Agent, publiczne API i CLI            | `reviewDiff → { review, meta }`, barrel, `cli.ts`, `exports`                     | Ścieżka „wyjątek po wyniku” sprawdzona tylko typecheckiem i dokumentacją |

**Prerequisites:** zainstalowane `node_modules` pakietu, `.env` z kluczem do płatnego biegu (uruchamia go użytkownik).
**Estimated effort:** ~1 sesja, 2 fazy.

## Open Risks & Assumptions

- Zachowanie „SDK rzuca po wyniku z błędem” znamy z dokumentacji, nie z własnego testu. Bez testów jednostkowych ścieżki `max_budget`/`max_turns` nie zostaną uruchomione w tej zmianie.
- Zakładamy, że nikt poza skryptem `review` nie woła `npx tsx src/index.ts`.

## Success Criteria (Summary)

- `npm run review < data/sample-1.diff` daje ten sam kształt wyniku co dziś i loguje koszt.
- Reviewer da się zaimportować bez efektów ubocznych i zwraca `{ review, meta }` albo `ReviewerError` z kodem.
- Prompty i schemat żyją w osobnych modułach, a schemat pozostaje jedynym kontraktem.
