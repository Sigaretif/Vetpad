# Evale agenta code review (promptfoo) — Plan Brief

> Full plan: `context/changes/code-review-evals/plan.md`
> Research: `context/changes/code-review-evals/research.md`

## What & Why

Pierwsza konfiguracja promptfoo, która mierzy ten sam prompt code review na trzech modelach: `claude-haiku-5-5`, `claude-sonnet-5-5` i `claude-opus-5-5`. Każdy przebieg idzie przez prawdziwe `reviewDiff()`. `CLAUDE.md` wymaga zestawu evali przed zmianą promptu lub modelu reviewera, a dziś takiego zestawu nie ma. Ten plan daje pierwszy punkt odniesienia.

## Starting Point

`packages/code-reviewer` eksportuje `reviewDiff` bez efektów ubocznych, z opcjami `model` i `pr`, i zwraca `{ review, meta }` z kosztem. Nie ma promptfoo ani fixture'ów z domeny. Szablon kursu zakłada OpenRouter i surowy prompt. `CLAUDE.md` dopuszcza dziś tylko jeden skrypt, który płaci providerowi (`review.yml`).

## Desired End State

W `packages/code-reviewer/evals/` uruchamiasz ręcznie `npm run eval` i dostajesz tabelę z trzema kolumnami modeli dla jednego diffu migracji React 16 → 19. Każda komórka pokazuje `is-json`, trzy oceny sędziego (po jednej na wadę), asercję `verdict === "fail"` i koszt. `npm run preflight` sprawdza za darmo, że promptfoo ładuje provider. Reguły projektu nazywają eval jako drugi wyjątek od zakazu płatnych wywołań.

## Key Decisions Made

| Decision                | Choice                                                                                                                                           | Why (1 sentence)                                                                           | Source            |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ | ----------------- |
| Provider                | Własny `file://provider.ts` wokół `reviewDiff`, klucz z `loadApiKey()`                                                                           | Eval mierzy kod, który biegnie w CI, a nie kopię promptu.                                  | Research / Plan   |
| Modele                  | Haiku 5.5, Sonnet 5.5, Opus 5.5, bez OpenRoutera                                                                                                 | Wybór użytkownika; jeden klucz Anthropic z `.env` pakietu.                                 | Plan              |
| Sędzia                  | `anthropic:messages:claude-opus-5-5`, klucz przez `--env-file ../.env`                                                                           | Najmocniejszy model wychwyci niuanse React 19.                                             | Plan              |
| Rubryka                 | Trzy `llm-rubric` z metrykami `flaw-default-props`, `flaw-effect-deps`, `flaw-xss`                                                               | Widać, którą wadę dany model przeoczył.                                                    | Plan              |
| Wady w diffie           | `defaultProps` na komponencie funkcyjnym (usunięte w React 19), `useEffect(…, [])` zamiast `[userId]`, XSS przez `dangerouslySetInnerHTML` z bio | Dwie psują działanie, jedna jest specyficzna dla React 19, XSS ćwiczy `securitySafety`.    | Plan (użytkownik) |
| Osadzenie               | Wyspa pod `src/components/members/`, `pr_title` przekazywany jak w CI, bez opisu PR                                                              | Ćwiczy wariant promptu z `<pr_title>` z CI.                                                | Plan              |
| Asercja statyczna       | `JSON.parse(output).verdict === "fail"` + gołe `is-json`                                                                                         | Bramka CI czyta tylko werdykt; kształt gwarantuje Zod w `reviewDiff`.                      | Plan              |
| Instalacja              | Osobny `evals/package.json`, promptfoo 0.124.1 przypięte                                                                                         | `npm ci` akcji CI reviewera zostaje bez zmian.                                             | Plan              |
| Reguła płatnych wywołań | Nazwany wyjątek w `CLAUDE.md` (`AGENTS.md` to symlink do niego, nie jest edytowany); `system.ts` i `requirements.md` bez zmian                   | Eval mierzy dzisiejszy prompt jako baseline; świadome odstępstwo od reguły synchronizacji. | Plan              |
| Limity                  | `REVIEW_DEFAULTS` bez zmian (≤ 0,5 USD na recenzję), `--no-cache`, bez `--repeat`                                                                | Te same limity co w CI; każdy przebieg to świeży pomiar.                                   | Plan              |

## Scope

**In scope:**

- `packages/code-reviewer/evals/`: `package.json`, lockfile, `.gitignore`, `tsconfig.json`, `provider.ts`, `preflight.mjs`, `promptfooconfig.yaml`, `fixtures/react19-migration.diff`, `README.md`
- Nazwany wyjątek w `CLAUDE.md` (`AGENTS.md` zostaje symlinkiem), akapit w `README.md`

**Out of scope:**

- Drugi przypadek (SQL injection), para kontrolna `pass`, `--repeat`
- Warianty promptu systemowego (`systemPrompt` w `ReviewOptions`)
- Zmiany w `system.ts`, `requirements.md`, `REVIEW_DEFAULTS` i akcji CI
- Uruchamianie evali w CI albo przez agenta

## Architecture / Approach

promptfoo → `file://provider.ts` (3 wpisy, różne `config.model`) → `reviewDiff(vars.diff, { apiKey: loadApiKey(), model, pr: { title: vars.pr_title } })` → `JSON.stringify(review)` + `cost` + `tokenUsage` → asercje (`is-json`, 3× `llm-rubric` sędziego Opus, `javascript` na werdykt). Prompt w YAML (`{{diff}}`) jest tylko nośnikiem. Prawdziwy prompt buduje pakiet.

## Phases at a Glance

| Phase                               | What it delivers                                                   | Key risk                                                                          |
| ----------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| 1. Pakiet evali i provider          | `evals/` z promptfoo, `provider.ts`, darmowy `preflight`           | Loader `tsx` promptfoo a importy `.ts` (preflight to rozstrzyga za darmo)         |
| 2. Przypadek testowy i konfiguracja | Diff z trzema wadami, `promptfooconfig.yaml`, Twój płatny przebieg | Diff z niezamierzonymi błędami albo zdradzającymi komentarzami zafałszuje rubryki |
| 3. Dokumentacja i reguła            | `evals/README.md`, wyjątek w `CLAUDE.md`, akapit w README          | Wyjątek sformułowany za szeroko                                                   |

**Prerequisites:** `ANTHROPIC_API_KEY` w `packages/code-reviewer/.env`, Node ≥ 22.22, `npm ci` w pakiecie reviewera.
**Estimated effort:** ~1 sesja w 3 fazach plus jeden płatny przebieg (< ok. 2 USD).

## Open Risks & Assumptions

- Opus na złożonym diffie może przekroczyć 0,5 USD. Wtedy komórka kończy się błędem `max_budget`. To wynik pomiaru, a podniesienie limitu jest osobną decyzją.
- AI review PR-a z tą zmianą może dać `fail` (twarda porażka nr 9 czytana szeroko). Wtedy merge zależy od Twojej decyzji.
- Sędzia Opus ocenia też recenzję Opusa (ta sama rodzina modeli).
- Jeden przypadek i jeden przebieg nie mierzą wariancji. To punkt startowy, nie werdykt o modelach.

## Success Criteria (Summary)

- `npm run preflight` przechodzi bez żadnego płatnego wywołania.
- Twój przebieg `npm run eval` pokazuje trzy kolumny modeli z metrykami `flaw-default-props`, `flaw-effect-deps`, `flaw-xss`, `verdict-fail` i kosztem, bez błędów providera.
- Reguły projektu jednoznacznie mówią, kto i jak uruchamia eval.
