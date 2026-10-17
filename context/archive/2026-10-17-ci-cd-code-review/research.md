---
date: 2026-10-17T15:26:02+02:00
researcher: Claude Code (claude-opus-5-5) for Wiktor Ortel
git_commit: e78db5b22dcf8e513379f09a12c2a0322dbd7f23
branch: master
repository: 10xDevs4 (GitHub: Sigaretif/Vetpad)
topic: "AI code review w CI jako bramka merge'a PR-ów do master (ci-cd-code-review)"
tags: [research, ci, github-actions, code-reviewer, claude-agent-sdk, review-gate]
status: complete
last_updated: 2026-10-17
last_updated_by: Claude Code (claude-opus-5-5)
---

# Research: AI code review w CI jako bramka merge'a

**Date**: 2026-10-17T15:26:02+02:00
**Researcher**: Claude Code (claude-opus-5-5) for Wiktor Ortel
**Git Commit**: e78db5b22dcf8e513379f09a12c2a0322dbd7f23 (drzewo robocze z niezacommitowaną zmianą `CLAUDE.md` i nieśledzonymi plikami M5L3)
**Branch**: master
**Repository**: 10xDevs4 (remote `Sigaretif/Vetpad`, publiczne)

## Research Question

Co jest potrzebne, żeby zrealizować `context/changes/ci-cd-code-review/requirements.md`: workflow GHA na każdy PR do `master`, który przez composite action uruchamia agenta z `packages/code-reviewer` na tytule, opisie i diffie PR-a, ocenia sześć kryteriów w wersji dla Vetpad, publikuje komentarz z podsumowaniem, ustawia etykietę `ai-cr:passed`/`ai-cr:failed`, failuje check przy `verdict: fail` i pozwala ponowić review etykietą `ai-cr:review`. Punktem wyjścia są szablony `.claude/config-templates/m5l3-review.yml.template` i `m5l3-action.yml.template`.

## Summary

1. **Reviewer działa, ale jego wejście nie pasuje do szablonu akcji.** Szablon wymaga gotowego `dist/review.js`, który czyta `DIFF_FILE`, `PR_TITLE`, `PR_BODY` i klucz `LLM_PROVIDER_API_KEY` ze zmiennych środowiskowych (`m5l3-action.yml.template:4-5,51-59`). Obecne CLI robi co innego:
   - czyta diff ze stdin (`packages/code-reviewer/src/cli.ts:8-14`);
   - nie zna tytułu ani opisu PR-a (`src/prompts/user.ts:2-4`);
   - bierze klucz tylko z pliku `packages/code-reviewer/.env`, a środowisko ignoruje celowo (`src/env.ts:6-20`);
   - nie ma kroku build (`package.json` scripts: `review: tsx src/cli.ts`, tsconfig `noEmit: true`).
2. **Bundla `dist/review.js` nie da się zrobić wprost.** Agent SDK 0.3.301 uruchamia natywną binarkę Claude Code (~268 MB). Szuka jej przez `require.resolve` od `import.meta.url` w pakiecie `@anthropic-ai/claude-agent-sdk-linux-x64` (`optionalDependencies`). Po bundlowaniu ta ścieżka nie istnieje. Dlatego akcja musi zrobić `npm ci` w `packages/code-reviewer` (bez `--omit=optional`) i uruchomić `node src/cli.ts`, co zweryfikowano na Node 22.23 dzięki type stripping, albo `npx tsx src/cli.ts`.
3. **Prompt i schemat są generyczne.** Kryteria dla Vetpad z `requirements.md` nie trafiły nigdzie do kodu: `SYSTEM_PROMPT` ma 6 linii (`src/prompts/system.ts:3-8`), a opisy pól są generyczne (`src/review-schema.ts:12-55`). Agent działa w izolacji: `settingSources: []`, `tools: []` (`src/reviewer.ts:106-110`). Nie widzi więc `CLAUDE.md`, który ma 75 376 bajtów, a każdą regułę, którą ma stosować, musi dostać w prompcie.
4. **W szablonie workflow są dwie wady bramki:**
   - Etykieta niezwiązana z review (np. `bug`) tworzy run. Run wchodzi do grupy `concurrency` na poziomie workflow i z `cancel-in-progress: true` anuluje trwające review.
   - Job pominięty przez `if` raportuje **Success**, co w dokumentacji GitHuba to opisano jako „reports Success”. Nowy run na tym samym SHA po dodaniu dowolnej etykiety może więc „zazielenić” check o tej samej nazwie po werdykcie `fail`. To wniosek, nie przetestowano go.
5. **Bramka jeszcze nie istnieje po stronie repo.** `master` nie ma branch protection (404) ani rulesetów (`[]`). Domyślne uprawnienia `GITHUB_TOKEN` to `read`. Etykiety `ai-cr:*` nie istnieją. Repo jest publiczne, więc PR z forka nie dostaje sekretów i zawsze skończy się porażką checku.
6. **Decyzje dla użytkownika:**
   - **Koszt i reguła płatnych wywołań.** Automatyczny płatny run na każdy `opened`/`synchronize` stoi w napięciu z regułą „Nothing reaches the model provider on its own” (CLAUDE.md, Testing) i z notatką pamięci o płatnych wywołaniach.
   - **Nazwa sekretu.** Do wyboru: `ANTHROPIC_API_KEY` (dziś tylko w kroku build joba `ci`) albo osobny sekret.
   - **Czy wysyłać opis PR-a.**
   - **Kto włącza wymagany check.**

## Detailed Findings

### Pakiet `packages/code-reviewer` (stan po `review-agent-modules`)

- **Zmiana jest zaimplementowana i niezarchiwizowana.**
  - `context/changes/review-agent-modules/change.md:4` ma `status: implemented`.
  - Commity c270ed6 (p1), 889055d (p2) i e78db5b (epilog).
- **Publiczne API bez efektów ubocznych** (`src/index.ts:1-8`):
  - `reviewDiff(diff, { apiKey, model?, maxTurns?, maxBudgetUsd? })` zwraca `{ review, meta }` albo rzuca `ReviewerError` z jednym z 12 kodów (`src/errors.ts:16-28`).
  - Biblioteka nie czyta klucza sama (`src/reviewer.ts:14-16`). Robi to tylko CLI przez `loadApiKey()` (`src/cli.ts:29`).
- **Wyjście CLI:**
  - stdout dostaje wyłącznie JSON review (`src/cli.ts:33`).
  - Koszt i meta trafiają na stderr jedną linią `[code-reviewer] {...}` (`src/cli.ts:18-26`).
  - Przy błędzie `exitCode = 1` (`src/cli.ts:36-45`).
  - Ten kontrakt pasuje do szablonu akcji, który przekierowuje stdout do pliku.
- **Obrona przed obcym uwierzytelnieniem** (`src/reviewer.ts:27-54,122-128`):
  - Z env subprocessu usuwane są `ANTHROPIC_AUTH_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN`, Bedrock, Vertex, Foundry i `ANTHROPIC_BASE_URL`.
  - `CLAUDE_CONFIG_DIR` dostaje pusty katalog tymczasowy.
  - Run jest przerywany, jeśli `apiKeySource !== "ANTHROPIC_API_KEY"`.
  - W CI to nic nie zmienia, bo runner nie ma loginu Claude Code.
- **Domyślne ustawienia:** `claude-sonnet-5-5`, `maxTurns: 2`, `maxBudgetUsd: 0.5` (`src/config.ts:6-11`). Plan `review-agent-modules` świadomie ich nie zmieniał (`plan.md:44`) i nie zapisał, kto je wybrał.
- **Węższy kontrakt klucza.** Reguła „klucz tylko z `.env`” pochodzi sprzed tej zmiany (`plan.md:12,47`; `plan-brief.md:34`). W CI są dwa wyjścia:
  - (a) nowy entrypoint CI, który wywołuje `reviewDiff` z kluczem z env i nie używa `loadApiKey`;
  - (b) zapisanie `.env` przez akcję.

  Opcja (a) zostawia regułę lokalnego CLI nietkniętą. Bibliotekę zaprojektowano z myślą o takim wywołującym („CI gate”, `plan.md:70,94`).

- **Prompt użytkownika:** `Oceń poniższy diff.\n\n<diff>\n${diff}\n</diff>` (`src/prompts/user.ts:3`).
  - Brak tytułu i opisu PR-a.
  - Brak ochrony przed `</diff>` w treści diffu. Ryzyko odłożono w `plan.md:39-47`.
- **Odłożone i niezweryfikowane ryzyko.** Ścieżka „SDK rzuca po wyniku błędu” (`max_budget`/`max_turns`, `src/reviewer.ts:131-138`) nie została uruchomiona (`plan-brief.md:72-75`). W CI to ona da `exitCode 1` bez werdyktu.

### Uruchomienie Agent SDK w CI

- **Wersje i binarka.**
  - Zainstalowane `@anthropic-ai/claude-agent-sdk@0.3.301` dołącza Claude Code 2.1.301 (`claudeCodeVersion` w jego `package.json`).
  - Binarka platformowa pochodzi z `optionalDependencies` (`@anthropic-ai/claude-agent-sdk-linux-x64`, `os: linux`, `cpu: x64`, `libc: glibc`).
  - `package-lock.json:99-107` rozwiązuje wariant linux-x64.
  - Lokalnie npm 10.9.8 zainstalował też wariant musl. W CI trzeba się więc liczyć z pobraniem ~2 × 268 MB, więc cache npm jest wskazany.
- **Brak binarki kończy run.** `sdk.mjs` rzuca wtedy `Native CLI binary for … not found. Reinstall … without --omit=optional, or set options.pathToClaudeCodeExecutable`. Dokumentacja: https://code.claude.com/docs/en/agent-sdk/typescript#installation.
- **Bundlowanie esbuildem** wymaga trzech rzeczy:
  - importu z `@anthropic-ai/claude-agent-sdk/core` (`#import-the-core-entry-when-you-bundle-the-agent-sdk`);
  - osobno zainstalowanej binarki;
  - `pathToClaudeCodeExecutable`.

  To zbędna komplikacja wobec `npm ci` + `node src/cli.ts`.

- **Node.**
  - Pakiet: `engines.node >=22` (`package.json`), bo `src/config.ts:3` używa `import.meta.dirname`.
  - Szablon akcji: Node 24 (`m5l3-action.yml.template:42-44`).
  - Joby CI: Node 22 (`.github/workflows/ci.yml:16,35`).

  Wszystkie trzy spełniają wymaganie.

- **Model w szablonie.** Domyślne `model: z-ai/glm-5.3` (`m5l3-action.yml.template:27-30`) to identyfikator OpenRouter. Reviewer przyjmuje tylko modele Anthropic.

### Szablony workflow i akcji wobec reguł M5L3

- **Przypięcie akcji jest poprawne.** Sprawdzono przez `gh api …/git/ref/tags/…`:
  - `actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1` to v7.0.1;
  - `actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1` to v7.1.0.

  Oba są lekkimi tagami na commit i oba to najnowsze wydania.

- **`ci.yml` łamie regułę przypinania.** Używa tagów pływających: `actions/checkout@v4` (`:13,:32`), `actions/setup-node@v4` (`:14,:33`), `supabase/setup-cli@v1` z `version: latest` (`:37-39`). Czy poprawiać to w tej zmianie, decyduje użytkownik.
- **Wartości wielolinijkowe idą przez pliki**, tak jak wymaga reguła:
  - diff: `$RUNNER_TEMP/pr.diff`;
  - review: `$RUNNER_TEMP/ai-review.json`;
  - komentarz: `comment.md` przez `--body-file`.

  Przez `$GITHUB_OUTPUT` idą tylko jednolinijkowe `verdict` i `review-file` (`m5l3-action.yml.template:55-59`). Limity wyjść: 1 MB na job i składnia heredoc opisane w https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands#multiline-strings.

- **Brak wstrzyknięcia skryptu.**
  - Tytuł i opis idą jako `with:`, potem do `env:` akcji, a skrypt czyta je jako `$PR_TITLE`/`$PR_BODY` (`m5l3-action.yml.template:49-54`). To udokumentowana mitygacja „intermediate environment variable”.
  - Warunek na przyszłość: w `run:` akcji kompozytowej nigdy nie może stać `${{ inputs.* }}`.
- **Bramka czyta tylko pole werdyktu.**
  - Akcja wyciąga `verdict` z JSON i failuje, gdy nie jest `pass`/`fail` (`m5l3-action.yml.template:57`).
  - Krok „Gate on verdict” failuje, gdy werdykt to nie `pass` (`m5l3-review.yml.template:66-70`).
  - Brak werdyktu, np. błąd agenta albo brak klucza, też failuje bramkę, a komentarz i etykiety są wtedy pomijane (`:47`).
- **Diff jest poprawny.** `git diff "origin/$BASE_REF...HEAD"` przy `fetch-depth: 0` w zdarzeniu `pull_request` daje zmianę netto PR-a względem bazy (`m5l3-review.yml.template:30-38`), bo HEAD to merge commit `refs/pull/N/merge`.
  - Tańszy wariant to `fetch-depth: 2` + `git diff HEAD^1 HEAD`.
  - PR z konfliktem nie dostaje runu `pull_request` i check zostaje w stanie Pending.
- **Etykiety.**
  - Etykiety dodane przez `GITHUB_TOKEN` nie tworzą nowych runów: https://docs.github.com/en/actions/concepts/security/github_token#when-github_token-triggers-workflow-runs. Dlatego `ai-cr:passed`/`ai-cr:failed` i zdjęcie `ai-cr:review` nie wywołują pętli.
  - `gh label create --force` jest idempotentne, a kolor podaje się jako 6 znaków hex bez `#`.
  - `gh pr edit --remove-label` dla etykiety nieistniejącej w repo kończy się błędem. Szablon chroni się `--force` przed `--remove-label` oraz `|| true` dla `ai-cr:review` (gh v2.101.0, `pkg/cmd/pr/shared/editable_http.go:27-33,169-184`).
  - Usunięcie etykiety istniejącej, ale nieprzypiętej do PR-a, nie zostało przetestowane.
- **Wada 1: concurrency anuluje review.** `concurrency` stoi na poziomie workflow, a `if` na poziomie joba (`m5l3-review.yml.template:18-24`).
  - Run dla dowolnego `labeled` powstaje i wchodzi do grupy `ai-review-<PR>` przed oceną `if`, więc anuluje trwające review: https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency. Wysoka pewność, choć strona nie wspomina wprost pominiętych jobów.
  - Możliwe poprawki: `concurrency` na poziomie joba albo unikalna grupa (np. z `github.run_id`) dla etykiet innych niż `ai-cr:review`. Nie znaleziono dokumentu, który potwierdza, że pominięty job nie zajmuje grupy.
- **Wada 2: pominięty job może ominąć bramkę.** Job pominięty przez `if` „reports Success”: https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/collaborating-on-repositories-with-code-quality-features/troubleshooting-required-status-checks.
  - Po werdykcie `fail` dodanie dowolnej etykiety daje nowy run z pominiętym jobem `review` i checkiem Success o tej samej nazwie. To wniosek, nie przetestowano go.
  - Możliwe poprawki:
    - decyzja wewnątrz kroku zamiast `if` joba, np. przy obcej etykiecie odtworzyć wynik z obecnej etykiety `ai-cr:failed`;
    - osobny workflow albo job dla ponowienia;
    - zawężenie do `labeled` tylko przez `ai-cr:review` przy zachowaniu wyniku.
- **Uprawnienia.**
  - Szablon deklaruje `contents: read`, `pull-requests: write`, `issues: write` (`m5l3-review.yml.template:13-16`).
  - Ustawienie repo ma `default_workflow_permissions: read`, więc jawny blok jest konieczny.
  - `ci.yml` nie ma bloku `permissions:` ani `concurrency:`.
- **PR z forka.**
  - Brak sekretów i `GITHUB_TOKEN` tylko do odczytu: https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflows-in-forked-repositories.
  - Agent dostaje pusty klucz, werdyktu nie ma i bramka failuje.
  - `pull_request_target` z checkoutem kodu PR-a byłby niebezpieczny. checkout v7.0.0 blokuje checkout PR-a z forka w tym zdarzeniu.

### Stan repozytorium GitHub (odczyt przez `gh`, 2026-10-17)

- **Repo:** `Sigaretif/Vetpad`, **PUBLIC**, gałąź domyślna `master`.
- **Sekrety:** `ANTHROPIC_API_KEY`, `SUPABASE_KEY`, `SUPABASE_URL`. Zmiennych repo brak.
- **Etykiety:** 21, w tym brak `ai-cr:passed`, `ai-cr:failed` i `ai-cr:review`.
- **Ochrona `master`:** branch protection zwraca 404 „Branch not protected”, rulesety `[]`. Żaden check nie jest dziś wymagany. „Bramka merge'a” zadziała dopiero po dodaniu przez użytkownika rulesetu albo branch protection z wymaganym checkiem joba review.
- **Actions:** `allowed_actions: all`, `sha_pinning_required: false`, `default_workflow_permissions: read`, `can_approve_pull_request_reviews: false`.

### Wpływ na resztę projektu

- **Bramki projektu nie widzą `packages/` ani `.github/`:**
  - `tsconfig.json:3-4` wyklucza `packages`;
  - `eslint.config.js:210-214` ignoruje `packages/**` i `.claude/**`;
  - `vitest.config.ts:10` zbiera tylko `tests/**/*.test.ts`;
  - `stryker.config.json:6-27` ignoruje `.github` i `packages`;
  - root `package.json` nie ma `workspaces`.

  Dodanie akcji ani zmiany w reviewerze nie ruszą więc `npm run lint`, `npx astro check`, `npm test` ani Stryker.

- **Drobne zastrzeżenia:**
  - lint-staged (`package.json:69-77`) uruchamia `eslint --fix` i `vitest related --run` także na stagowanych `packages/**/*.ts`. Nie sprawdzono, czy `vitest related` bez powiązanych testów kończy się kodem ≠ 0.
  - `.prettierignore` nie wyklucza `packages/` ani `.github/`.
- **`dist/` jest ignorowany** przez nieanchorowany wpis w root `.gitignore:2`.
- **`AGENTS.md` to symlink do `CLAUDE.md`**, więc zmiana reguł dotyczy jednego pliku.
- **Dokumenty, które się zdezaktualizują przy użyciu `ANTHROPIC_API_KEY` w nowym workflow:**
  - `CLAUDE.md:25`: sekret trafia do joba `ci` „into the `ci` job's build step only”;
  - `context/foundation/deployment-runbook.md:358-366`: „six places … `ci` job's build step only”;
  - `README.md:262-266`: „GitHub Actions runs two jobs”.
  - Osobny sekret dla reviewera oddziela go od tych reguł, bo te mówią o kluczu providera audytu z FR-010.
- **Napięcie z regułą płatnych wywołań:**
  - `CLAUDE.md` (Testing): „Nothing reaches the model provider on its own. No test, script, smoke step or agent action sends a request the provider would answer.”
  - Pamięć użytkownika: płatne wywołania uruchamia użytkownik.

  Review w CI to płatne wywołanie wyzwalane otwarciem PR-a lub pushem, w tym przez `/git-ship`. Reguła mówi o audycie i testach, nie o CI review, ale nowa ścieżka potrzebuje jawnego wyjątku zapisanego w `CLAUDE.md`. Budżet na run ogranicza `maxBudgetUsd: 0.5` (`src/config.ts:10`).

### Kryteria z `requirements.md` → kod

- **Sześć kryteriów mapuje się 1:1 na pola `REVIEW_SCHEMA`** (`src/review-schema.ts:12-55`): `implementationCorrectness`, `idiomaticity`, `complexity`, `testRiskCoverage`, `documentation`, `securitySafety`, plus `verdict` i `summary`. Kontrakt mówi „schemat najpierw, potem prompty, bramka CI, evale” (`src/review-schema.ts:5-6`).
- **Treść specyficzną dla Vetpad trzeba przenieść do promptu systemowego** i ewentualnie do opisów pól, bo agent nie widzi repo. Chodzi o:
  - czytanie braków w diffie;
  - zakaz ponownego sprawdzania tego, co pilnuje lint/check/test;
  - zakres plików;
  - 9 „hard failures”, z których każdy wymusza 1 i `fail`.

  `CLAUDE.md` w całości (75 376 B) to istotny koszt tokenów przy każdym runie. Wymagania zakładają, że reviewer widzi tylko tytuł, opis i diff, więc reguły idą w prompt.

- **Wejście:** tytuł i opis PR-a muszą trafić do `buildReviewPrompt`.
  - Wymagania oznaczają opis jako „?? cost tradeoff”.
  - Tytuł i opis to niezaufany tekst, który może próbować sterować werdyktem (prompt injection). Prompt powinien je oznaczyć jako dane, tak jak diff.
- **Rozmiar diffu.** Nie ma limitu ani filtra plików. Lockfile'y, np. root `package-lock.json` przy zmianie zależności, mogą zjeść budżet. Wariant do rozważenia to pathspec `':(exclude)*package-lock.json'` w kroku diffu.

### Sąsiednie narzędzia M5L3

- **`/10x-impl-review-ci` nie jest dostarczony do repo.** W `.claude/skills/` go brak, choć router w `CLAUDE.md` go wymienia. Kopia znaleziona w scratchpadzie innej sesji:
  - używa `anthropics/claude-code-action`, sekretu `ANTHROPIC_API_KEY` i etykiety `impl-review`;
  - ustawia własny status `impl-review-ci/verdict`;
  - commituje raport z `[skip ci]`.

  Jeśli zostanie włączony obok `review.yml`, powstaną dwie bramki i podwójny koszt. Trzeba wtedy zdecydować, która jest wymagana.

- **Szablon promptfoo nie używa reviewera jako providera.** Woła modele przez OpenRouter (`OPENROUTER_API_KEY`) z `prompts/review.txt` (`m5l3-promptfooconfig.yaml.template:11-28`). Asercje zakładają JSON z polami `verdict` i `securitySafety`. Entrypoint CI powinien zachować:
  - czysty JSON `REVIEW_SCHEMA` na stdout;
  - eksporty `reviewDiff`, `SYSTEM_PROMPT`, `buildReviewPrompt` bez efektów ubocznych;

  tak, żeby przyszły provider promptfoo albo eval mógł użyć tego samego promptu. Reguła `CLAUDE.md` M5L3 wymaga uruchomienia evali przed zmianą promptu lub modelu. Dziś zestawu evali nie ma, więc pierwsza zmiana promptu w tej zmianie odbywa się bez punktu odniesienia.

## Code References

- `packages/code-reviewer/src/cli.ts:8-14,28-45` — stdin → `reviewDiff` → stdout JSON, meta na stderr, `exitCode 1`
- `packages/code-reviewer/src/env.ts:6-20` — klucz tylko z `.env`
- `packages/code-reviewer/src/reviewer.ts:27-54,94-169` — izolacja, obrona przed obcym uwierzytelnieniem, mapowanie wyników na `ReviewerError`
- `packages/code-reviewer/src/config.ts:6-11` — model, tury i budżet
- `packages/code-reviewer/src/prompts/system.ts:3-8`, `src/prompts/user.ts:2-4` — generyczny prompt, sam diff
- `packages/code-reviewer/src/review-schema.ts:5-6,11-61` — kontrakt
- `packages/code-reviewer/package-lock.json:99-107` — binarka linux-x64
- `.claude/config-templates/m5l3-review.yml.template:7-70` — workflow
- `.claude/config-templates/m5l3-action.yml.template:9-59` — akcja kompozytowa
- `.github/workflows/ci.yml:3-27` — triggery, tagi pływające, sekrety tylko w kroku build
- `eslint.config.js:210-214`, `tsconfig.json:3-4`, `stryker.config.json:6-27` — wykluczenia `packages/`
- `CLAUDE.md:25` — „six places”, build step only
- `context/foundation/deployment-runbook.md:358-366` — sekret providera

## Architecture Insights

- **Podział odpowiedzialności z szablonów pasuje do pakietu:**
  - workflow: zdarzenia, diff, komentarz, etykiety, bramka;
  - akcja: środowisko Node, uruchomienie agenta, wyciągnięcie werdyktu;
  - pakiet: prompt, model, schemat.

  Brakuje tylko cienkiego entrypointu CI w pakiecie, który czyta `DIFF_FILE`, `PR_TITLE`, `PR_BODY` i klucz z env, a potem woła `reviewDiff`. `cli.ts` zostaje narzędziem lokalnym z regułą `.env`.

- **Akcja lokalna `./.github/actions/ai-reviewer`** wymaga checkoutu repo, który workflow i tak robi. Akcja wskaże pakiet przez `$GITHUB_WORKSPACE/packages/code-reviewer`, a nie przez `$GITHUB_ACTION_PATH/dist`.
- **Werdykt jest jedynym wejściem bramki.** Zapewnia to walidacja w akcji i `REVIEW_SCHEMA.safeParse` w `reviewer.ts:160-167`. Komentarz bierze `summary` z pliku, nigdy z wyjścia kroku.

## Historical Context (from prior changes)

- `context/changes/review-agent-modules/plan.md:5,70,94,102,156` — biblioteka zaprojektowana dla „CI gate” i „promptfoo provider”; `ReviewerError` z kodami, żeby CI i evale rozróżniały przyczyny.
- `context/changes/review-agent-modules/plan-brief.md:34-36` — wstrzykiwany klucz („library is I/O-free”); decyzja użytkownika z 2026-10-16: bez test runnera, jeden płatny run uruchomiony przez użytkownika.
- `context/changes/review-agent-modules/plan.md:39-47` — odłożone: promptfoo, testy, ochrona przed `</diff>`, podpięcie pakietu do root CI.
- `context/archive/**`, `context/foundation/**` — brak wzmianek o reviewerze. Grep: code review, reviewer, m5l2, promptfoo, code-reviewer, agent sdk.

## Related Research

Nie dotyczy. `review-agent-modules` nie ma `research.md`.

## Open Questions

Decyzje użytkownika, potrzebne przed `/10x-plan`:

1. **Płatny run na każdy PR.** Czy automatyczne review przy `opened`/`synchronize` jest akceptowanym wyjątkiem od reguły „Nothing reaches the model provider on its own”? Wyjątek trzeba zapisać w `CLAUDE.md`. Alternatywa: tylko na żądanie etykietą `ai-cr:review`, kosztem wymagania „every new pull request”. Ile kosztuje run: dziś do 0,5 USD.
2. **Sekret.** Ponownie użyć `ANTHROPIC_API_KEY` (aktualizacja `CLAUDE.md:25`, runbooka, README) czy osobny sekret, np. `CODE_REVIEWER_ANTHROPIC_API_KEY`, z osobnym limitem wydatków w konsoli Anthropic?
3. **Opis PR-a w wejściu**, oznaczony w wymaganiach jako „?? cost tradeoff”. Tak czy nie?
4. **Model reviewera:** `claude-sonnet-5-5` z `config.ts` czy inny. Zmiana modelu według reguł M5L3 wymaga evali, których jeszcze nie ma.
5. **Ponowienie i bramka:** jak naprawić dwie wady szablonu (concurrency i pominięty job jako Success).
6. **Włączenie bramki:** ruleset lub branch protection z wymaganym checkiem to krok użytkownika w ustawieniach repo. Czy w tej zmianie przypiąć też akcje w `ci.yml` do SHA?
7. **PR z forków:** przy publicznym repo zawsze czerwone. Akceptujemy?

Luki w dowodach:

- obejście bramki pominiętym jobem nie zostało przetestowane;
- zachowanie `gh pr edit --remove-label` dla etykiety nieprzypiętej do PR-a nie zostało przetestowane;
- ścieżka `max_budget`/`max_turns` reviewera nigdy nie została uruchomiona.
