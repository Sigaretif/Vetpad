# Evale agenta code review (promptfoo) — plan implementacji

## Overview

Pierwsza konfiguracja promptfoo dla `packages/code-reviewer`. Mierzy ten sam prompt code review (`SYSTEM_PROMPT` i `buildReviewPrompt`) na trzech modelach: `claude-haiku-5-5`, `claude-sonnet-5-5` i `claude-opus-5-5`. Każdy przebieg idzie przez prawdziwe `reviewDiff()`, nie przez kopię promptu. Klucz pochodzi z `packages/code-reviewer/.env`, bez OpenRoutera. Przypadek testowy jest jeden: syntetyczny diff migrujący wyspę Vetpad z React 16 do React 19 z trzema podłożonymi wadami. Sędzia LLM (`claude-opus-5-5`) sprawdza osobno każdą wadę, a statyczna asercja JS wymaga `verdict === "fail"`.

## Current State Analysis

- `reviewDiff` jest importowalny bez efektów ubocznych przez barrel `packages/code-reviewer/src/index.ts:1-9` i przyjmuje `model` oraz `pr` w `ReviewOptions` (`src/reviewer.ts:14-22`). Zwraca `{ review, meta }`, gdzie `meta.costUsd` i `meta.usage` są dostępne także w `ReviewerError` po wysłaniu wyniku przez agenta (`src/errors.ts:30-40`).
- Klucz czyta tylko `loadApiKey()` z `packages/code-reviewer/.env` (`src/env.ts:8-20`). Biblioteka sama klucza nie czyta.
- Darmowe sprawdzenia przed `query()`: pusty diff → `empty_diff`, zły klucz lub opcje → `invalid_options` (`src/reviewer.ts:59-83`). To jedyne ścieżki providera, które da się sprawdzić bez płatnego wywołania.
- Wynik jest walidowany Zod (`REVIEW_SCHEMA`, `src/reviewer.ts:162-170`), więc sukces `reviewDiff` gwarantuje kształt JSON.
- Pakiet nie ma evali, promptfoo ani fixture'ów poza `data/sample-1.diff` (spoza domeny). Szablon kursu `.claude/config-templates/m5l3-promptfooconfig.yaml.template` zakłada OpenRouter, surowy prompt i dwa przypadki.
- Akcja CI reviewera instaluje pakiet przez `npm ci` razem z `devDependencies` (`.github/actions/ai-reviewer/action.yml:44-48`).
- `CLAUDE.md` § Testing („Nothing reaches the model provider on its own”) dopuszcza jeden wyjątek, `review.yml`, „and it covers nothing else”. Eval jest płatnym skryptem, więc potrzebuje nazwanego wyjątku. `AGENTS.md` to symlink do `CLAUDE.md` (`AGENTS.md -> CLAUDE.md`), więc edytuje się tylko `CLAUDE.md`. Zapis przez `AGENTS.md` albo zapis nowego pliku pod tą nazwą mógłby zamienić symlink w zwykły plik i rozjechać reguły.
- promptfoo 0.124.1 (MIT), `engines.node >=22.22.0`. Repo: `.nvmrc` 22.23.2. Plik `.ts` providera promptfoo ładuje przez własny `tsx`. `promptfoo eval --env-file <plik>` ładuje wskazany plik i nadpisuje nim zmienne powłoki.

## Desired End State

`packages/code-reviewer/evals/` to samodzielny pakiet (własny `package.json` i lockfile). Uruchamiasz go ręcznie: `cd packages/code-reviewer/evals && npm run eval`. Wynik to tabela z trzema kolumnami modeli dla jednego przypadku, a w każdej komórce:

- `is-json`,
- trzy rubryki sędziego, każda z nazwaną metryką (jedna na wadę),
- asercja `verdict === "fail"`,
- koszt przebiegu.

`npm run preflight` sprawdza za darmo, że promptfoo ładuje provider i że provider dociera do `reviewDiff`. `CLAUDE.md` (a przez symlink także `AGENTS.md`) nazywa eval jako drugi wyjątek od reguły płatnych wywołań. Prompt reviewera się nie zmienia.

### Key Discoveries:

- `src/reviewer.ts:59-83` — `resolveOptions` rzuca `empty_diff` przed utworzeniem katalogu tymczasowego i subprocessu. Na tym opiera się darmowy preflight.
- `src/errors.ts:14-15` — kody błędów są przeznaczone wprost dla „a future promptfoo provider”. Provider rozróżnia błędy po `code`, nigdy po treści komunikatu.
- `src/prompts/user.ts:19-28` — z `pr` prompt dostaje `<pr_title>`, jak w CI (`src/ci.ts`). Bez `pr` jest wariantem z CLI.
- `src/prompts/system.ts:24-36` — twarde porażki dotyczą aplikacji. Żadna z trzech wad React do nich nie należy, więc `fail` zależy od oceny poprawności i bezpieczeństwa przez model.
- `packages/code-reviewer/tsconfig.json:15` — `include: ["src"]`, więc pliki evali potrzebują własnego `tsconfig`, żeby były typecheckowane.

## What We're NOT Doing

- Bez OpenRoutera i modeli spoza Anthropic. Bez wbudowanego providera `anthropic:claude-agent-sdk` promptfoo, bo duplikowałby prompt, schemat i walidację.
- Bez drugiego przypadku z szablonu (SQL injection), bez pary kontrolnej z oczekiwanym `pass` i bez `--repeat`. To pierwsza konfiguracja z jednym przypadkiem.
- Bez porównywania wariantów promptu systemowego (`ReviewOptions` nie dostaje `systemPrompt`).
- Bez zmian w `src/prompts/system.ts` i w `context/changes/ci-cd-code-review/requirements.md`. To świadome odstępstwo od reguły synchronizacji kryteriów reviewera (decyzja użytkownika, 2026-10-17): eval ma najpierw zmierzyć dzisiejszy prompt jako punkt odniesienia. Twarda porażka nr 9 dotyczy aplikacji, a diff w `packages/code-reviewer/` prompt ocenia według ogólnego znaczenia kryteriów.
- Bez uruchamiania evali w CI i bez promptfoo w `devDependencies` pakietu reviewera (akcja CI zostaje bez zmian).
- Bez zmiany `REVIEW_DEFAULTS` (`maxTurns`, `maxBudgetUsd`). Eval biegnie z limitami takimi jak w CI.
- Bez asercji `is-json` z kopią JSON Schema. `reviewDiff` waliduje wynik Zod-em, więc wystarcza gołe `is-json`.
- Bez progów na ocenach liczbowych (np. `securitySafety`). Jedyna asercja statyczna to werdykt.
- Agent nie uruchamia `npm run eval`. Każdy płatny przebieg uruchamia użytkownik.

## Implementation Approach

Provider jest trzecim wywołującym `reviewDiff` na wzorze `src/cli.ts` i `src/ci.ts`: bierze klucz z `loadApiKey()`, a z danymi wejściowymi z `context.vars` (`diff`, `pr_title`) i modelem z `config.model` woła bibliotekę. Raportuje promptfoo wynik, koszt i tokeny. Prompt w YAML jest tylko nośnikiem `{{diff}}`, bo prawdziwy prompt buduje pakiet. promptfoo żyje w osobnym `evals/package.json`, a provider importuje `../src/index.ts`. Zależności agenta rozwiązują się wtedy z `packages/code-reviewer/node_modules`, więc obie instalacje są potrzebne. Sędzia `anthropic:messages:claude-opus-5-5` dostaje ten sam klucz przez `--env-file ../.env`.

## Critical Implementation Details

**Free before paid.** `npm run preflight` przechodzi przez loader promptfoo (`evaluate()` z API Node), z pustym diffem i bez żadnej asercji. Nie dociera więc ani do `query()`, ani do sędziego. Przechodzi, zanim użytkownik dostanie pierwszy płatny przebieg. Potwierdza też niezweryfikowany w researchu import `.ts` z rozszerzeniami `.ts` pod `tsx` promptfoo.

**Key source.** Recenzje dostają klucz wyłącznie z `loadApiKey()`. `--env-file ../.env` służy sędziemu: plik nadpisuje `ANTHROPIC_API_KEY` z powłoki, więc obie strony używają tego samego klucza z `.env` pakietu.

## Phase 1: Pakiet evali i provider

### Overview

Samodzielny katalog `packages/code-reviewer/evals/` z promptfoo, providerem opakowującym `reviewDiff` i darmowym preflightem, który dowodzi, że promptfoo ładuje provider.

### Changes Required:

#### 1. Pakiet evali

**File**: `packages/code-reviewer/evals/package.json` (+ `package-lock.json`)

**Intent**: Trzyma promptfoo poza `npm ci` akcji CI reviewera. Daje skrypty: `eval` (płatny, tylko dla użytkownika), `preflight` (darmowy) i `typecheck`.

**Contract**: `private: true`, `type: "module"`, `engines.node: ">=22.22.0"`, `devDependencies: { "promptfoo": "0.124.1" }` (dokładna wersja). Skrypty ustawiają `PROMPTFOO_DISABLE_TELEMETRY=1`, `PROMPTFOO_DISABLE_SHARING=1` i `PROMPTFOO_DISABLE_UPDATE=1`:

- `eval` uruchamia `promptfoo eval -c promptfooconfig.yaml --env-file ../.env --no-cache`;
- `preflight` uruchamia `node preflight.mjs`;
- `typecheck` uruchamia jawnie `../node_modules/.bin/tsc -p tsconfig.json`, czyli `typescript` z pakietu nadrzędnego. `npm run` w `evals/` dodaje do `PATH` tylko `evals/node_modules/.bin`, więc gołe `tsc` może nie istnieć albo wziąć inną wersję.

JSON nie ma komentarzy, więc to, że najpierw trzeba uruchomić `npm ci` w `packages/code-reviewer`, mówi README evali (Faza 3).

#### 2. Ignorowane wyjścia

**File**: `packages/code-reviewer/evals/.gitignore`

**Intent**: Lokalne wyniki i instalacja nie trafiają do publicznego repo.

**Contract**: `node_modules/`, `.promptfoo/`, `output/`, `results*.json`, `*.html` z eksportu wyników.

#### 3. Provider promptfoo

**File**: `packages/code-reviewer/evals/provider.ts`

**Intent**: Uruchamia prawdziwego agenta dla jednego modelu i oddaje promptfoo wynik, koszt i tokeny. Błąd wraca razem z kosztem, więc nieudany przebieg nie gubi wydatku.

**Contract**: domyślny eksport klasy zgodnej z `ApiProvider` promptfoo (typy z `promptfoo` przez `import type`; jeśli nazwa typu w 0.124.1 jest inna, weź eksportowany odpowiednik).

- Konstruktor bierze `ProviderOptions`. Brak `config.model` jako niepustego stringa to błąd konfiguracji rzucony od razu.
- `id()` zwraca `code-reviewer:<model>`.
- `callApi(prompt, context)`:
  - bierze `diff` z `context.vars.diff` i `pr_title` z `context.vars.pr_title`; `prompt` jest ignorowany, bo prompt buduje pakiet;
  - woła `loadApiKey()` i `reviewDiff(diff, { apiKey, model, pr: pr_title ? { title: pr_title } : undefined })`;
  - przy sukcesie zwraca `output: JSON.stringify(review)`, `cost: meta.costUsd`, `tokenUsage` z `meta.usage` (`prompt` = `input_tokens` + `cache_creation_input_tokens` + `cache_read_input_tokens`, `completion` = `output_tokens`, `total` = suma) oraz `metadata: { model, subtype, numTurns }`;
  - przy `ReviewerError` zwraca `error: "<code>: <message>"`, `cost`/`tokenUsage` z `error.meta`, jeśli jest, i `metadata.code`;
  - przy innym wyjątku zwraca `error` z komunikatem.

Import tylko z `../src/index.ts` (barrel), nigdy z plików wewnętrznych. Provider nic nie loguje.

#### 4. Typecheck evali

**File**: `packages/code-reviewer/evals/tsconfig.json`

**Intent**: Pliki evali są typecheckowane jak `src/`, z tymi samymi ustawieniami.

**Contract**: `extends: "../tsconfig.json"`, `include: ["provider.ts"]`.

#### 5. Darmowy preflight

**File**: `packages/code-reviewer/evals/preflight.mjs`

**Intent**: Bez płatnego wywołania dowodzi, że loader promptfoo ładuje `provider.ts` (z importami `.ts` pod `tsx`) i że provider dociera do `reviewDiff`.

**Contract**:

- Woła `evaluate()` z API Node promptfoo z suite'em: `providers: [{ id: "file://provider.ts", config: { model: "claude-haiku-5-5" } }]`, `prompts: ["{{diff}}"]`, jeden test z `vars: { diff: "", pr_title: "preflight" }` i **bez `assert`**. Zapis wyników jest wyłączony, jeśli API na to pozwala.
- Kończy się kodem 0 tylko wtedy, gdy jedyny wynik ma błąd zaczynający się od `empty_diff:`. W każdym innym przypadku kończy się kodem 1 i wypisuje, co dostał.
- Komentarz w pliku: brak asercji oznacza zero wywołań sędziego, a `empty_diff` pada przed `query()` (`src/reviewer.ts:59-61`).
- Gdy `.env` nie istnieje, wynik to `missing_api_key:`. To też jest darmowe, ale preflight wymaga `empty_diff`, więc wypisuje wtedy, że trzeba utworzyć `.env`.

### Success Criteria:

#### Automated Verification:

- Instalacja przechodzi: `cd packages/code-reviewer && npm ci && cd evals && npm ci`
- Typecheck evali przechodzi: `cd packages/code-reviewer/evals && npm run typecheck`
- Typecheck pakietu reviewera bez zmian przechodzi: `cd packages/code-reviewer && npm run typecheck`
- Darmowy preflight przechodzi i zgłasza `empty_diff`: `cd packages/code-reviewer/evals && npm run preflight`
- `git status` nie pokazuje `node_modules/` ani wyjść promptfoo z `packages/code-reviewer/evals/`
- `packages/code-reviewer/package.json`, `package-lock.json` i `.github/actions/ai-reviewer/action.yml` są bez zmian: `git diff --stat` ich nie wymienia

#### Manual Verification:

- Przegląd `provider.ts`: klucz pochodzi tylko z `loadApiKey()`, błąd wraca z kosztem, nic nie jest logowane

**Implementation Note**: Po przejściu weryfikacji automatycznej zatrzymaj się i poczekaj na potwierdzenie przeglądu przed Fazą 2.

---

## Phase 2: Przypadek testowy i konfiguracja

### Overview

Syntetyczny diff migracji z trzema wadami i `promptfooconfig.yaml`, który zestawia trzy modele na tym przypadku, z sędzią Opus i asercją werdyktu.

### Changes Required:

#### 1. Diff migracji React 16 → 19

**File**: `packages/code-reviewer/evals/fixtures/react19-migration.diff`

**Intent**: Realistyczny, raczej złożony unified diff w formacie `git diff`. Migruje wyspę Vetpad z komponentu klasowego React 16 na komponent funkcyjny z hookami w React 19. Zawiera dokładnie trzy podłożone wady, a poza nimi nie ma oczywistych innych błędów, żeby rubryki mierzyły to, co zamierzone.

**Contract**:

- Hunk w `package.json`: `react` i `react-dom` z `^16.14.0` na `^19.x`, `@types/react`/`@types/react-dom` odpowiednio.
- Plik wyspy pod `src/components/members/` (np. `MemberProfile.tsx`), przepisany z `class … extends React.Component` na funkcję z `useState`/`useEffect`. Komponent ma prop `userId`, pobiera profil członka (`fetch`), pokazuje etykietę roli i bio wpisane przez członka.
- Wada 1, React 19: wersja klasowa ma `static defaultProps = { role: "członek zespołu" }`. Wersja funkcyjna zostawia `MemberProfile.defaultProps = { role: … }`, które React 19 usunął dla komponentów funkcyjnych. Wartość domyślna ginie: bez propa `role` etykieta roli renderuje się pusta, bez fallbacku.
- Wada 2: wersja klasowa ma `componentDidMount` i `componentDidUpdate`, który porównuje `prevProps.userId` i pobiera dane ponownie. Wersja funkcyjna ma `useEffect(…, [])` zamiast `[userId]`, więc po zmianie propa komponent nie pobiera danych i pokazuje profil poprzedniego członka.
- Wada 3, XSS: wersja klasowa renderuje bio jako tekst (`{bio}`). Wersja funkcyjna renderuje je przez `dangerouslySetInnerHTML={{ __html: bio }}`, np. z komentarzem, że chodzi o zachowanie formatowania. Tekst od użytkownika trafia do HTML bez sanityzacji.
- Żaden komentarz w diffie nie zdradza, że to wady. Diff jest syntetyczny i nie zawiera danych prawdziwych osób (repo jest publiczne).

#### 2. Konfiguracja promptfoo

**File**: `packages/code-reviewer/evals/promptfooconfig.yaml`

**Intent**: Przerobiony szablon `m5l3-promptfooconfig.yaml.template`: ten sam prompt na trzech modelach przez `reviewDiff`, jeden przypadek, sędzia Opus.

**Contract**:

- Komentarz nagłówka: skąd pochodzi (szablon M5L3), jak uruchomić (`npm run eval`, płatne, tylko przez użytkownika), szacunek kosztu (3 recenzje × ≤ 0,5 USD + 9 ocen sędziego).
- `description`.
- `sharing: false`.
- `providers`: trzy wpisy `id: file://provider.ts` z `label` `haiku-5-5` / `sonnet-5-5` / `opus-5-5` i `config.model` `claude-haiku-5-5` / `claude-sonnet-5-5` / `claude-opus-5-5`.
- `prompts: ["{{diff}}"]` z komentarzem, że to nośnik, a prawdziwy prompt buduje pakiet.
- `defaultTest.options.provider: anthropic:messages:claude-opus-5-5`.
- Jeden test z `description`, `vars.diff: file://fixtures/react19-migration.diff` i `vars.pr_title` (neutralny tytuł, np. „Migracja MemberProfile na React 19”, bez opisu PR). Asercje:
  1. `type: is-json`;
  2. trzy `llm-rubric`, każda z `metric` (`flaw-default-props`, `flaw-effect-deps`, `flaw-xss`). Każda zalicza tylko recenzję, która wskazuje tę jedną wadę i wyjaśnia jej skutek: utracona wartość domyślna roli w React 19 / brak ponownego pobrania po zmianie `userId` / XSS z bio przez `dangerouslySetInnerHTML`. Wzmianka o linii bez skutku nie wystarcza. Inne uwagi recenzji, w tym reguły Vetpad (np. brak testu albo fixture'a `/dev`), nie wpływają na ocenę. Recenzja jest JSON-em, a `summary` jest po polsku;
  3. `type: javascript`, `value: JSON.parse(output).verdict === "fail"`, `metric: verdict-fail`.

### Success Criteria:

#### Automated Verification:

- Konfiguracja przechodzi walidację: `cd packages/code-reviewer/evals && npx promptfoo validate -c promptfooconfig.yaml`
- Diff jest poprawnym unified diffem, który `git apply --check` przyjmuje na pustym katalogu z plikiem `package.json` w wersji „przed” (albo pliki są oznaczone jako nowe)
- Preflight dalej przechodzi: `cd packages/code-reviewer/evals && npm run preflight`

#### Manual Verification:

- Przegląd diffu: dokładnie trzy podłożone wady, bez komentarzy, które je zdradzają, bez innych oczywistych błędów, bez danych prawdziwych osób
- Użytkownik uruchamia jeden płatny przebieg `cd packages/code-reviewer/evals && npm run eval`, a potem `npx promptfoo view`. Tabela pokazuje trzy kolumny modeli z wynikami czterech metryk (`flaw-default-props`, `flaw-effect-deps`, `flaw-xss`, `verdict-fail`) i kosztem każdego przebiegu, bez błędów providera ani sędziego

**Implementation Note**: Agent nie uruchamia `npm run eval`. Po weryfikacji automatycznej zatrzymaj się, podaj użytkownikowi polecenie i co ono dowodzi, i poczekaj na wynik jego przebiegu. Błąd znaleziony w płatnym przebiegu odtwórz najpierw darmowo (preflight albo typecheck), dopiero potem poproś o powtórkę.

---

## Phase 3: Dokumentacja i reguła

### Overview

Instrukcja uruchomienia evali i nazwany wyjątek w regułach projektu, żeby następny agent nie uznał evali za naruszenie reguły płatnych wywołań.

### Changes Required:

#### 1. README evali

**File**: `packages/code-reviewer/evals/README.md`

**Intent**: Jedno miejsce z instrukcją i zasadami dla użytkownika.

**Contract**: sekcje:

- wymagania: Node ≥ 22.22, `npm ci` w pakiecie i w `evals/`, `ANTHROPIC_API_KEY` w `packages/code-reviewer/.env`;
- `npm run preflight` (darmowy);
- `npm run eval` (płatny, szacunek kosztu, tylko ręcznie przez użytkownika);
- `npx promptfoo view`;
- co mierzy przypadek: trzy wady i metryki;
- telemetria i udostępnianie wyłączone;
- reguła `CLAUDE.md`: zestaw evali przed zmianą promptu lub modelu reviewera;
- jak dodać przypadek: nowy plik w `fixtures/`, syntetyczny, bez danych prawdziwych osób.

#### 2. Wyjątek w regułach projektu

**File**: `CLAUDE.md` (tylko ten plik; `AGENTS.md` to symlink do niego, którego nie wolno edytować ani nadpisywać)

**Intent**: W bullecie „**Nothing reaches the model provider on its own.**” (§ Testing) zdanie „One exception is named, and it covers nothing else” staje się dwoma nazwanymi wyjątkami.

**Contract**: drugi wyjątek, w stylu pliku i ze ścieżką referencyjną:

- `packages/code-reviewer/evals/` (`npm run eval`) wysyła diff fixture'a do providera z kluczem z `packages/code-reviewer/.env`, przez `reviewDiff` i sędziego `llm-rubric`;
- uruchamia go wyłącznie użytkownik, ręcznie: nigdy CI, nigdy agent bez polecenia dla tego jednego przebiegu;
- agent sprawdza go tylko przez `npm run preflight`, który nie dociera do providera.

W tym samym bullecie albo przy wpisie o `packages/code-reviewer/src/prompts/system.ts` jako baseline dopisz, że zestawem evali, przed którym zmienia się prompt lub model reviewera (`## 10xDevs…` → Hard rules), jest `packages/code-reviewer/evals/promptfooconfig.yaml`. `packages/code-reviewer/src/prompts/system.ts` i `context/changes/ci-cd-code-review/requirements.md` zostają bez zmian, zgodnie z odstępstwem opisanym w „What We're NOT Doing”.

#### 3. Wzmianka w README repo

**File**: `README.md` (sekcja `## CI`, po bulletach AI Code Review)

**Intent**: Czytelnik README wie, że evale reviewera istnieją, są ręczne i płatne, i nie biegną w CI.

**Contract**: jeden krótki akapit z odnośnikiem do `packages/code-reviewer/evals/README.md`.

### Success Criteria:

#### Automated Verification:

- `AGENTS.md` nadal jest symlinkiem do `CLAUDE.md`: `test -L AGENTS.md && [ "$(readlink AGENTS.md)" = CLAUDE.md ]`
- `packages/code-reviewer/src/prompts/system.ts` i `context/changes/ci-cd-code-review/requirements.md` są bez zmian: `git diff --stat` ich nie wymienia
- Bramki aplikacji przechodzą bez zmian: `npm run lint` i `npx astro check`

#### Manual Verification:

- Przegląd treści: wyjątek w `CLAUDE.md` jest jednoznaczny (kto uruchamia, czym, z jakim kluczem, nigdy w CI), a README evali pozwala uruchomić eval komuś spoza tej rozmowy

**Implementation Note**: Po weryfikacji automatycznej poczekaj na potwierdzenie przeglądu treści.

---

## Testing Strategy

### Unit Tests:

- Brak. Pakiet reviewera nie ma testów jednostkowych ani szwu do zaślepienia `query()` (`context/changes/review-agent-modules/plan.md:42`), a pakiet evali to konfiguracja i cienki adapter.

### Integration Tests:

- `npm run preflight`: promptfoo ładuje `provider.ts`, provider woła `reviewDiff`, a wynik `empty_diff` wraca jako błąd providera. Zero wywołań recenzenta i sędziego.

### Manual Testing Steps:

1. `cd packages/code-reviewer && npm ci && cd evals && npm ci && npm run preflight` przechodzi.
2. Użytkownik uruchamia `npm run eval` (płatne) i `npx promptfoo view`.
3. W tabeli: trzy kolumny modeli, cztery metryki na komórkę, koszt każdego przebiegu. Wynik zapisany jako pierwszy punkt odniesienia promptu reviewera.

## Performance Considerations

Koszt jednego przebiegu: 3 recenzje × ≤ 0,5 USD (`REVIEW_DEFAULTS.maxBudgetUsd`) plus 9 wywołań sędziego Opus, łącznie mniej niż ok. 2 USD. `--no-cache` sprawia, że każdy przebieg to nowy pomiar i nowy koszt. Domyślna współbieżność promptfoo uruchamia trzy recenzje równolegle.

## Migration Notes

Nie dotyczy: nowy, niezależny katalog. Akcja CI, pakiet reviewera i aplikacja są bez zmian.

## References

- Research: `context/changes/code-review-evals/research.md`
- Szablon: `.claude/config-templates/m5l3-promptfooconfig.yaml.template`, prompt kursu: `.claude/prompts/m5l3-promptfoo.md`
- Wywołujący na tym samym wzorze: `packages/code-reviewer/src/cli.ts`, `packages/code-reviewer/src/ci.ts`
- `packages/code-reviewer/src/reviewer.ts:14-22`, `:59-83`, `:96-171`
- `packages/code-reviewer/src/errors.ts:5-40`
- Poprzednie zmiany: `context/changes/review-agent-modules/plan.md`, `context/changes/ci-cd-code-review/plan.md`
- Dokumentacja promptfoo: custom provider (https://www.promptfoo.dev/docs/providers/custom-api/), sędzia (https://www.promptfoo.dev/docs/configuration/expected-outputs/model-graded/), `--env-file` (https://www.promptfoo.dev/docs/usage/command-line/)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Pakiet evali i provider

#### Automated

- [x] 1.1 Instalacja przechodzi: `cd packages/code-reviewer && npm ci && cd evals && npm ci` — 231b6aa
- [x] 1.2 Typecheck evali przechodzi: `cd packages/code-reviewer/evals && npm run typecheck` — 231b6aa
- [x] 1.3 Typecheck pakietu reviewera bez zmian przechodzi: `cd packages/code-reviewer && npm run typecheck` — 231b6aa
- [x] 1.4 Darmowy preflight przechodzi i zgłasza `empty_diff`: `cd packages/code-reviewer/evals && npm run preflight` — 231b6aa
- [x] 1.5 `git status` nie pokazuje `node_modules/` ani wyjść promptfoo z `packages/code-reviewer/evals/` — 231b6aa
- [x] 1.6 `packages/code-reviewer/package.json`, `package-lock.json` i `.github/actions/ai-reviewer/action.yml` są bez zmian: `git diff --stat` ich nie wymienia — 231b6aa

#### Manual

- [x] 1.7 Przegląd `provider.ts`: klucz pochodzi tylko z `loadApiKey()`, błąd wraca z kosztem, nic nie jest logowane — 231b6aa

### Phase 2: Przypadek testowy i konfiguracja

#### Automated

- [x] 2.1 Konfiguracja przechodzi walidację: `cd packages/code-reviewer/evals && npx promptfoo validate -c promptfooconfig.yaml`
- [x] 2.2 Diff jest poprawnym unified diffem, który `git apply --check` przyjmuje na pustym katalogu z plikiem `package.json` w wersji „przed” (albo pliki są oznaczone jako nowe)
- [x] 2.3 Preflight dalej przechodzi: `cd packages/code-reviewer/evals && npm run preflight`

#### Manual

- [x] 2.4 Przegląd diffu: dokładnie trzy podłożone wady, bez komentarzy, które je zdradzają, bez innych oczywistych błędów, bez danych prawdziwych osób
- [x] 2.5 Użytkownik uruchamia jeden płatny przebieg `cd packages/code-reviewer/evals && npm run eval`, a potem `npx promptfoo view`. Tabela pokazuje trzy kolumny modeli z wynikami czterech metryk (`flaw-default-props`, `flaw-effect-deps`, `flaw-xss`, `verdict-fail`) i kosztem każdego przebiegu, bez błędów providera ani sędziego

### Phase 3: Dokumentacja i reguła

#### Automated

- [ ] 3.1 `AGENTS.md` nadal jest symlinkiem do `CLAUDE.md`: `test -L AGENTS.md && [ "$(readlink AGENTS.md)" = CLAUDE.md ]`
- [ ] 3.2 `packages/code-reviewer/src/prompts/system.ts` i `context/changes/ci-cd-code-review/requirements.md` są bez zmian: `git diff --stat` ich nie wymienia
- [ ] 3.3 Bramki aplikacji przechodzą bez zmian: `npm run lint` i `npx astro check`

#### Manual

- [ ] 3.4 Przegląd treści: wyjątek w `CLAUDE.md` jest jednoznaczny (kto uruchamia, czym, z jakim kluczem, nigdy w CI), a README evali pozwala uruchomić eval komuś spoza tej rozmowy
