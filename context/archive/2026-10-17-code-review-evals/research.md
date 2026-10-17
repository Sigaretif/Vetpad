---
date: 2026-10-17T16:33:19+02:00
researcher: Claude (Opus 5.5) dla Wiktor Ortel
git_commit: dd5cc2fb76ad2a7b6b1be4a4c336f61f4c64da6c
branch: master
repository: Sigaretif/Vetpad
topic: "Gotowość packages/code-reviewer na evale i dopasowanie promptfoo do stacku"
tags: [research, code-reviewer, evals, promptfoo, claude-agent-sdk]
status: complete
last_updated: 2026-10-17
last_updated_by: Claude (Opus 5.5)
---

# Research: gotowość `packages/code-reviewer` na evale (promptfoo)

**Date**: 2026-10-17T16:33:19+02:00
**Researcher**: Claude (Opus 5.5) dla Wiktor Ortel
**Git Commit**: dd5cc2fb76ad2a7b6b1be4a4c336f61f4c64da6c
**Branch**: master
**Repository**: Sigaretif/Vetpad

## Research Question

Przeanalizuj obecny stan `packages/code-reviewer` pod kątem wprowadzenia evali – możliwość ponownego użycia promptów, importowalność agenta itp. Pierwszy wybór narzędzia to promptfoo; jeśli stack do niego pasuje, idź w tym kierunku, w przeciwnym razie przeanalizuj inne narzędzia open source. Użyj aktualnej dokumentacji.

## Summary

**promptfoo pasuje do stacku i jest rekomendowanym narzędziem.** Pakiet jest już przygotowany na eval: `reviewDiff` jest importowalny bez efektów ubocznych, przyjmuje klucz i parametry (`model`, `maxTurns`, `maxBudgetUsd`) jako argumenty i zwraca `{ review, meta }` z kosztem; błędy mają stabilne kody. promptfoo 0.124.1 (MIT, `node >=22.22.0`) ładuje provider `.ts` przez `tsx` (sprawdzone w źródle paczki), więc własny provider `file://…/provider.ts` może zaimportować `reviewDiff` z `src/index.ts` bez kroku budowania.

Rekomendowany kształt: **własny provider promptfoo opakowujący `reviewDiff`**, a nie wbudowany `anthropic:claude-agent-sdk` ani szablon kursu z surowym promptem przez OpenRouter — oba testowałyby kopię promptu/konfiguracji zamiast kodu, który biegnie w CI. Główne rozbieżności do rozstrzygnięcia w planie: (1) szablon kursu zakłada OpenRouter i trzy modele spoza Anthropic, a pakiet wymusza wyłącznie `ANTHROPIC_API_KEY` i Claude Agent SDK; (2) każdy przebieg evali jest płatny i według `CLAUDE.md:135` musi być uruchamiany ręcznie przez użytkownika; (3) brak zestawu przypadków — jedyny diff (`data/sample-1.diff`) jest spoza domeny Vetpad.

## Detailed Findings

### 1. Importowalność agenta

- `packages/code-reviewer/src/index.ts:1-9` — barrel bez efektów ubocznych („Importing it runs nothing”); eksportuje `reviewDiff`, `ReviewerError`, `REVIEW_SCHEMA`, `REVIEW_JSON_SCHEMA`, `SYSTEM_PROMPT`, `buildReviewPrompt`, `REVIEW_DEFAULTS`, `PR_BODY_MAX_CHARS`, `loadApiKey`.
- `packages/code-reviewer/package.json:10-12` — `exports: { ".": "./src/index.ts" }`; brak builda, źródła TS.
- `packages/code-reviewer/src/reviewer.ts:14-22` — `ReviewOptions { apiKey, model?, maxTurns?, maxBudgetUsd?, pr? }`; klucz zawsze przekazywany przez wywołującego (`:15`), więc provider evali decyduje, skąd go wziąć (np. `loadApiKey()` z `.env` pakietu, `src/env.ts:8-20`).
- `packages/code-reviewer/src/reviewer.ts:96-171` — `reviewDiff` nic nie loguje; zwraca `{ review, meta }` (`meta`: `model`, `subtype`, `costUsd`, `numTurns`, `usage`, `modelUsage` — `src/errors.ts:5-12`), a po wysłaniu wyniku przez agenta błąd niesie `meta` (`src/errors.ts:30-40`). Provider może więc zwrócić promptfoo `cost` i `tokenUsage` także dla nieudanego przebiegu z wynikiem.
- `packages/code-reviewer/src/errors.ts:14-28` — 12 kodów `ReviewerErrorCode`; komentarz `:14-15` wprost wymienia „a future promptfoo provider” jako konsumenta.
- `packages/code-reviewer/src/reviewer.ts:103-120` — izolacja przebiegu (`settingSources: []`, `tools: []`, brak MCP, `persistSession: false`) i `outputFormat` z `REVIEW_JSON_SCHEMA`; walidacja Zod `:162-170`.
- Ograniczenie: brak szwu do wstrzyknięcia sztucznego `query` (decyzja `context/changes/review-agent-modules/plan.md:42`), więc provider nie da się przetestować bez płatnego wywołania — tylko darmowe ścieżki (`empty_diff`, `invalid_options`) przed `query()` (`src/reviewer.ts:59-83`).

### 2. Ponowne użycie promptów

- `packages/code-reviewer/src/prompts/system.ts:8` — `SYSTEM_PROMPT` jako eksportowana stała; `:1-7` deklaruje go jako „baseline the evals measure later prompt or model changes against” (to samo w `CLAUDE.md:136`).
- `packages/code-reviewer/src/prompts/user.ts:19-28` — `buildReviewPrompt(diff, pr?)`; bez `pr` daje dokładnie tekst CLI (`:21`), z `pr` dodaje `<pr_title>`/`<pr_description>` (opis przycinany do `PR_BODY_MAX_CHARS` = 4000, `src/config.ts:14`).
- Wniosek: przez provider wołający `reviewDiff` oba prompty są ćwiczone z prawdziwego kodu. Prompt w YAML promptfoo może być atrapą (np. `"{{diff}}"`), a provider czyta `context.vars`. **Porównanie wariantów promptu systemowego wymaga zmiany w pakiecie**: `reviewDiff` nie przyjmuje dziś `systemPrompt` w `ReviewOptions` (`src/reviewer.ts:14-22`, użycie stałej `:107`). Porównanie modeli działa bez zmian (`model` jest opcją).

### 3. promptfoo — dopasowanie do stacku (źródła pierwotne, sprawdzone 2026-10-17)

- Wersja 0.124.1, licencja MIT, `engines.node: ">=22.22.0"` (zweryfikowane w `package.json` z tarballa npm). Repo: `.nvmrc` 22.23.2, akcja reviewera Node 24 (`.github/actions/ai-reviewer/action.yml:38-42`) — spełniają. `packages/code-reviewer/package.json:7-9` deklaruje `>=22`, czyli luźniej niż promptfoo.
- Ładowanie TS: `ensureTypescriptLoader` w `dist/src/esm-*.js` promptfoo dla ścieżek pasujących do `/\.[cm]?ts$/` wykonuje `import("tsx")`; `tsx ^4.23.11` jest zależnością promptfoo. Importy z rozszerzeniem `.ts` (styl pakietu, `allowImportingTsExtensions`) **powinny** działać pod tsx — niezweryfikowane uruchomieniem; do potwierdzenia darmowym przebiegiem (provider zwracający błąd przed `query()`).
- Własny provider: klasa z `id()` i `callApi(prompt, context)`, zwraca `ProviderResponse` (`output`, `error`, `cost`, `tokenUsage`, `metadata`); `config` z YAML trafia do konstruktora, `context.vars` do `callApi` — https://www.promptfoo.dev/docs/providers/custom-api/
- Wbudowany `anthropic:claude-agent-sdk` istnieje (https://www.promptfoo.dev/docs/providers/claude-agent-sdk/), ale zduplikowałby prompt, schemat, walidację Zod i mapowanie błędów z `reviewDiff`, domyślnie używa `effort: high` i własnej przypiętej wersji SDK (`optionalDependencies` promptfoo: `@anthropic-ai/claude-agent-sdk` 0.3.283 wobec `^0.3.301` w pakiecie, `package.json:18`). Odrzucony jako źródło prawdy dla evali.
- Asercje dostępne dla tego kontraktu: `is-json` z JSON Schema w `value` (można podać `REVIEW_JSON_SCHEMA`), `javascript` (np. `verdict === "fail"`, progi na ocenach), `llm-rubric` z graderem Anthropic (`defaultTest.options.provider: anthropic:messages:<model>`), `cost` (próg albo `metric` z `weight: 0`), nazwane metryki i `derivedMetrics` — https://www.promptfoo.dev/docs/configuration/expected-outputs/. Asercja w pliku `.ts` — niezweryfikowane (dokumentacja pokazuje `.js`/`.mjs`).
- Przypadki z plików: `tests: file://…/*.yaml`, `vars: { diff: file://cases/x.diff }` ładuje treść pliku — https://www.promptfoo.dev/docs/configuration/test-cases/
- Porównanie modeli: dwa wpisy providera z tym samym `file://` id, innym `label` i `config.model` → kolumny obok siebie z kosztem.
- Powtórzenia i cache: `--repeat N`, cache w `~/.promptfoo/cache` (TTL 14 dni); czy wyniki własnego providera są cache'owane automatycznie — niezweryfikowane, więc przy mierzeniu wariancji `--no-cache` — https://www.promptfoo.dev/docs/configuration/caching/
- CI/kod wyjścia: `promptfoo eval` kończy się kodem 100 przy nieudanym teście (lub pass rate poniżej `PROMPTFOO_PASS_RATE_THRESHOLD`), 1 przy innym błędzie — https://www.promptfoo.dev/docs/usage/command-line/. `promptfoo/promptfoo-action` nie jest potrzebny.
- Prywatność: telemetria domyślnie włączona (zdarzenia, bez promptów) — `PROMPTFOO_DISABLE_TELEMETRY=1`; udostępnianie wyników przez `share`/logowanie do chmury — wyłączyć jawnie (`sharing: false` / `PROMPTFOO_DISABLE_SHARING=true`), bo dokumentacja nie gwarantuje wprost, że goły `eval` nic nie wysyła — https://www.promptfoo.dev/docs/configuration/telemetry/, https://www.promptfoo.dev/docs/usage/sharing/

### 4. Integracja z repo

- Root nie zna pakietu: brak `workspaces` w głównym `package.json`; `tsconfig.json:4` wyklucza `packages`; `eslint.config.js:213-214` `globalIgnores(["packages/**"])`; `vitest.config.ts:10` tylko `tests/**/*.test.ts`; `stryker.config.json:18` ignoruje `packages`. Eval ląduje więc w obrębie pakietu (własne `devDependencies`, skrypt w `packages/code-reviewer/package.json`).
- `packages/code-reviewer/tsconfig.json:15` — `include: ["src"]`; pliki evali poza `src/` nie byłyby typecheckowane, chyba że rozszerzy się `include`.
- `.gitignore` (root i `packages/code-reviewer/.gitignore:1-2`) nie zawiera wyjść promptfoo (np. `results.json`, `.promptfoo/`).
- Akcja CI instaluje pakiet `npm ci` w `packages/code-reviewer` (`action.yml:44-48`) — dodanie `promptfoo` do `devDependencies` powiększy instalację w każdym przebiegu review, bo `npm ci` instaluje devDependencies. Do rozważenia w planie (np. osobny `package.json` dla evali albo `--omit=dev` — ale `--omit=optional` jest zakazane, `action.yml:46`).

### 5. Reguły płatnych wywołań

- `CLAUDE.md:135` — „Nothing reaches the model provider on its own”: jedyny wyjątek to `review.yml`, „and it covers nothing else”. Każdy przebieg evali (provider + `llm-rubric`) jest płatny, więc uruchamia go użytkownik; agent wysyła żądanie sam tylko na wyraźne polecenie dla jednego wywołania.
- `CLAUDE.md:179` — „Run the eval set before changing the review prompt or model”; `CLAUDE.md:159` — fixed case set.
- `REVIEW_DEFAULTS.maxBudgetUsd = 0.5` na przebieg (`src/config.ts:6-11`); koszt evali ≈ liczba przypadków × providerów × powtórzeń × ≤0,5 USD + koszt gradera — przy 3 przypadkach × 2 modelach × 1 powtórzeniu górna granica samych review to 3 USD.
- Klucz: `ANTHROPIC_API_KEY` w `packages/code-reviewer/.env` (`.env.example:1-4`); szablon kursu wymaga `OPENROUTER_API_KEY`, którego repo nie ma nigdzie poza notatką w `context/changes/ci-cd-code-review/research.md:210`.

### 6. Zestaw przypadków

- Jedyny diff: `packages/code-reviewer/data/sample-1.diff` (28 linii, `src/lib/discount.ts`: koszyk z `parseInt` bez walidacji, `JSON.parse` bez walidacji, `!` na parametrze) — nie dotyczy domeny Vetpad i nie ćwiczy żadnej z dziewięciu twardych porażek (`src/prompts/system.ts:24-36`).
- Szablon kursu (`.claude/config-templates/m5l3-promptfooconfig.yaml.template`, 43 linie) zakłada dwa diffy (`react19-migration.diff` z trzema podłożonymi wadami, `sql-injection.diff`); żaden nie istnieje w repo. `.claude/prompts/m5l3-promptfoo.md:9` opisuje przypadek migracji React 16 → 19+ z trzema wadami, sędzię LLM i asercję `verdict === "fail"`.
- Naturalni kandydaci na przypadki to twarde porażki z promptu (np. tabela bez RLS, `service_role`, notatki w audycie, `rent: "0"` jako 0 zł) oraz para kontrolna — diff poprawny, oczekiwany `pass` — żeby eval nie nagradzał recenzenta odrzucającego wszystko.

### 7. Alternatywy (gdyby promptfoo odpadło)

- **vitest-evals** 0.17.0 (Sentry, Apache-2.0, wrzesień 2026) — `describeEval` na Vitest; pasuje do TS, pre-1.0 — https://github.com/getsentry/vitest-evals
- **evalite** 0.19.0 (Vitest + lokalny UI) — TS-native, pre-1.0, ostatnia zmiana luty 2026 — https://github.com/mattpocock/evalite
- **autoevals** (Braintrust, MIT) — biblioteka scorerów, nie runner — https://github.com/braintrustdata/autoevals
- deepeval, inspect_ai — dojrzałe, ale Python; słabe dopasowanie.
- Żadna z nich nie daje porównania modeli obok siebie i gradera LLM z YAML-a tak gotowo jak promptfoo, którego wymaga też kurs (`CLAUDE.md:171`).

## Code References

- `packages/code-reviewer/src/index.ts:1-9` — publiczny barrel
- `packages/code-reviewer/src/reviewer.ts:14-22` — `ReviewOptions`
- `packages/code-reviewer/src/reviewer.ts:59-83` — darmowe sprawdzenia przed `query()`
- `packages/code-reviewer/src/reviewer.ts:96-171` — `reviewDiff`
- `packages/code-reviewer/src/errors.ts:5-40` — `ReviewMeta`, kody, `ReviewerError`
- `packages/code-reviewer/src/review-schema.ts:11-61` — `REVIEW_SCHEMA`, `REVIEW_JSON_SCHEMA`
- `packages/code-reviewer/src/prompts/system.ts:8-142` — `SYSTEM_PROMPT` (twarde porażki `:24-36`)
- `packages/code-reviewer/src/prompts/user.ts:19-28` — `buildReviewPrompt`
- `packages/code-reviewer/src/config.ts:6-14` — `REVIEW_DEFAULTS`, `PR_BODY_MAX_CHARS`
- `packages/code-reviewer/src/env.ts:8-20` — `loadApiKey`
- `.github/actions/ai-reviewer/action.yml:38-65` — instalacja i uruchomienie w CI
- `.claude/config-templates/m5l3-promptfooconfig.yaml.template:1-43` — szablon kursu

## Architecture Insights

- Kontrakt w jednym miejscu: `REVIEW_SCHEMA` → `REVIEW_JSON_SCHEMA` → prompt → bramka CI; eval powinien czytać ten sam schemat (asercja `is-json`) zamiast własnej kopii (`src/review-schema.ts:1-6`).
- Biblioteka nie loguje i nie czyta klucza — to wywołujący (CLI, CI, provider evali) decyduje o źródle klucza i o raportowaniu `meta`. Provider evali jest trzecim wywołującym na tym samym wzorze co `src/cli.ts` i `src/ci.ts`.
- Pakiet jest celowo samodzielny względem roota (ignorowany przez root TS/ESLint/Vitest/Stryker), więc evale mieszczą się w nim bez dotykania bramek aplikacji.

## Historical Context (from prior changes)

- `context/changes/review-agent-modules/change.md:12` — agent miał być reużywalny „so that we can run promptfoo evals on it in the future”, bez konfiguracji evali w tamtej zmianie.
- `context/changes/review-agent-modules/plan.md:41-42` — promptfoo i szew `queryFn` świadomie poza zakresem; `plan-brief.md:21` — `{review, meta}` po to, by provider promptfoo raportował koszt bez parsowania logów.
- `context/changes/ci-cd-code-review/plan.md:76` — promptfoo i zestaw evali jako następny krok M5L3; prompt z tamtej zmiany to punkt odniesienia; `plan.md:119` — `buildReviewPrompt` eksportowany, by eval budował ten sam prompt.
- `context/changes/ci-cd-code-review/research.md:210-214` — już tam zauważono, że szablon używa OpenRouter i surowego promptu, a przepisanie promptu poszło bez baseline'u (supported: oba fakty nadal prawdziwe na `dd5cc2f`).
- `context/changes/ci-cd-code-review/research.md:255-271` — otwarte: model reviewera (zmiana wymaga evali), nigdy nieprzećwiczona ścieżka `max_budget`/`max_turns` (nadal prawdziwe; eval z niskim `maxBudgetUsd` mógłby ją przećwiczyć, płatnie).

## Related Research

- `context/changes/ci-cd-code-review/research.md`
- `context/changes/review-agent-modules/` nie ma `research.md` (tylko `change.md`, `plan.md`, `plan-brief.md`).

## Open Questions

Decyzje dla `/10x-plan` (nie rozstrzygnięte w researchu):

1. **Provider: `reviewDiff` czy szablon kursu (OpenRouter, trzy modele spoza Anthropic)?** Rekomendacja researchu: `reviewDiff` przez własny provider — eval mierzy kod z CI. Szablon wymagałby nowego klucza `OPENROUTER_API_KEY` i pomijałby Agent SDK, `outputFormat` i walidację Zod.
2. **Które modele porównać?** Domyślny to `claude-sonnet-5-5` (`src/config.ts:7`); np. obok `claude-opus-5-5` lub `claude-haiku-5-5`. Wpływa na koszt.
3. **Czy dodać `systemPrompt` do `ReviewOptions`**, żeby porównywać warianty promptu bez kopiowania pakietu?
4. **Model gradera `llm-rubric`** i czy grader to ten sam klucz `ANTHROPIC_API_KEY`.
5. **Zestaw przypadków**: ile diffów, które twarde porażki, czy para kontrolna `pass`; diffy syntetyczne, w repo publicznym.
6. **Gdzie żyje promptfoo** — `devDependencies` pakietu (powiększa `npm ci` w akcji CI) czy osobny katalog/`package.json` dla evali.
7. **Czy eval kiedykolwiek biegnie w CI**, skoro `CLAUDE.md:135` dopuszcza jeden wyjątek (`review.yml`); domyślnie evale są ręczne, płatne i uruchamiane przez użytkownika.

Niezweryfikowane (do potwierdzenia darmowym przebiegiem przed pierwszym płatnym): import `.ts` z rozszerzeniami `.ts` pod loaderem tsx promptfoo; asercja w pliku `.ts`; automatyczne cache'owanie wyników własnego providera.
