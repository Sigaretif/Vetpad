# Modularny agent code review — Implementation Plan

## Overview

`packages/code-reviewer/src/index.ts` robi dziś wszystko w jednym pliku: czyta klucz z `.env`, czyta diff ze stdin, buduje prompt, woła `query()` z Claude Agent SDK, interpretuje wynik i drukuje JSON. Rozbijamy go na moduły — kontrakt, prompty, konfiguracja, błędy, loader klucza, agent, CLI — tak, by reviewer był importowalny jako biblioteka (`reviewDiff(diff, options) → { review, meta }`) i nadawał się na przyszły provider promptfoo. Środowiska ewaluacji w tej zmianie nie konfigurujemy.

## Current State Analysis

- `packages/code-reviewer/src/index.ts:1-150` — jeden plik: `loadApiKey` (`:33-42`), `readStdin` (`:44-55`), `subprocessEnv` (`:57-66`), `logResult` (`:68-76`), `review` (`:78-136`), `main` (`:138-150`). Import pliku uruchamia `main()` — nie da się go zaimportować jako biblioteki.
- `packages/code-reviewer/src/review-schema.ts` trzyma `REVIEW_SCHEMA`, `REVIEW_JSON_SCHEMA` (draft-07), typ `Review` **oraz** `SYSTEM_PROMPT` (`:7-12`). Prompt użytkownika jest wpisany inline w wywołaniu `query` (`index.ts:84`).
- Izolacja przebiegu (do zachowania 1:1): `settingSources: []`, `tools: []`, `mcpServers: {}`, `strictMcpConfig: true`, `persistSession: false`, `cwd: PACKAGE_DIR`, `env` bez `FOREIGN_AUTH_VARS` z pustym `CLAUDE_CONFIG_DIR` (`mkdtempSync`, sprzątany w `finally`), strażnik `apiKeySource !== "ANTHROPIC_API_KEY"` przerywający bieg (`index.ts:105-111`), `maxTurns: 2`, `maxBudgetUsd: 0.5`, model `claude-sonnet-5-5`.
- Klucz czytany wyłącznie z `packages/code-reviewer/.env` przez `parseEnv`, nigdy z env powłoki ani z loginu Claude Code (`index.ts:31-42`, `.env.example`).
- Pakiet nie ma runnera testów; jedyna automatyczna weryfikacja to `npm run typecheck` (`tsc --noEmit`, `allowImportingTsExtensions`, `verbatimModuleSyntax`). Root wyklucza `packages/` z ESLint, tsconfig i Strykera (niezacommitowane zmiany w `eslint.config.js`, `tsconfig.json`, `stryker.config.json`).

## Desired End State

```
packages/code-reviewer/src/
  review-schema.ts     # tylko kontrakt: REVIEW_SCHEMA, REVIEW_JSON_SCHEMA, Review
  prompts/system.ts    # SYSTEM_PROMPT (bajt w bajt jak dziś)
  prompts/user.ts      # buildReviewPrompt(diff)
  config.ts            # PACKAGE_DIR, ENV_FILE, REVIEW_DEFAULTS { model, maxTurns, maxBudgetUsd }
  errors.ts            # ReviewerError { code, meta? }, ReviewerErrorCode
  env.ts               # loadApiKey(envFile = ENV_FILE)
  reviewer.ts          # reviewDiff(diff, options) → Promise<ReviewOutcome>
  index.ts             # publiczny barrel — import bez efektów ubocznych
  cli.ts               # stdin → reviewDiff → stdout; log kosztu na stderr
```

`git diff | npm run review` (i `npx tsx src/cli.ts`) zachowuje się jak dziś: JSON recenzji na stdout, linia `[code-reviewer] {...}` z kosztem na stderr, kod wyjścia 1 przy błędzie — teraz z kodem błędu w komunikacie. `import { reviewDiff } from "code-reviewer"` (albo `./src/index.ts`) niczego nie uruchamia.

### Key Discoveries:

- SDK `query()` w trybie jednorazowym **rzuca wyjątek już po wysłaniu wynikowej wiadomości z błędem** (raport z dokumentacji, `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:3297`). Obecna pętla (`index.ts:104-113`) nie ma `catch`, więc przy `error_max_budget_usd`/`error_max_turns` koszt nie trafia do logu, a komunikat jest ogólny.
- `SDKResultError.subtype` ∈ `error_during_execution | error_max_turns | error_max_budget_usd | error_max_structured_output_retries` (`sdk.d.ts:5796`); `SDKResultSuccess` może przyjść bez `structured_output` (`sdk.d.ts:5937`) — dziś kończy się to mylącym błędem zoda zamiast własnym.
- `Options.env` zastępuje `process.env`, nie łączy się z nim (`sdk.d.ts:1691`) — dlatego `subprocessEnv` rozpakowuje odziedziczone zmienne; ten wzorzec zostaje.
- zod 4.6 akceptuje zarówno `"draft-07"`, jak i `"draft-7"` (`node_modules/zod/v4/core/to-json-schema.d.ts:29`, `.js:26`) — `REVIEW_JSON_SCHEMA` zostaje bez zmian.

## What We're NOT Doing

- Nie konfigurujemy promptfoo (żadnego `promptfooconfig`, providera, datasetów ani skryptów eval).
- Nie dodajemy runnera testów ani testów jednostkowych, ani seamu `queryFn` do wstrzykiwania fałszywego `query` — decyzja z planowania: weryfikacja to typecheck, darmowe ścieżki CLI i jeden płatny bieg uruchamiany przez użytkownika.
- Nie zmieniamy treści `REVIEW_SCHEMA`, `SYSTEM_PROMPT` ani szablonu promptu użytkownika — tylko je przenosimy.
- Nie zmieniamy modelu, budżetu ani liczby tur domyślnie (`claude-sonnet-5-5`, `0.5` USD, `2`).
- Nie dodajemy runtime'owej kontroli `tools`/`mcp_servers` z wiadomości `init` ani ochrony przed `</diff>` w diffie — możliwe utwardzenia na później.
- Nie podłączamy pakietu do root CI ani ESLint (root nadal ignoruje `packages/`).
- Biblioteka nie czyta klucza sama i nie sięga po `process.env.ANTHROPIC_API_KEY`.

## Implementation Approach

Najpierw wydzielamy liście zależności (kontrakt, prompty, konfiguracja, błędy, loader), przepinając na nie istniejący `index.ts`, żeby po fazie 1 przebieg działał bez zmian w zachowaniu. W fazie 2 przenosimy logikę `query()` do `reviewer.ts` z nowym publicznym kontraktem i jawną obsługą błędów, CLI do `cli.ts`, a `index.ts` staje się barrelem. Biblioteka nie pisze na stdout/stderr — zwraca `meta`; logowanie kosztu z każdego biegu (sukces i porażka) należy do CLI.

## Critical Implementation Details

- **Kolejność w `reviewDiff`**: walidacja diffu i opcji (darmowa) → `mkdtempSync` → `query()`. Błąd `empty_diff`/`invalid_options` nie może utworzyć katalogu tymczasowego ani uruchomić podprocesu.
- **Wyjątek po wyniku**: w `catch` pętli wyjątek `ReviewerError` (strażnik `apiKeySource`) jest przepuszczany dalej; inny wyjątek, gdy wiadomość `result` już przyszła, jest pomijany i interpretowany jest zapamiętany wynik; gdy wyniku nie ma — `ReviewerError("execution", …, { cause })`. Katalog konfiguracyjny sprzątany w `finally` w każdym przypadku.

## Phase 1: Kontrakt, prompty i moduły pomocnicze

### Overview

Wydzielenie modułów bez logiki agenta. Po tej fazie `npm run review` działa dokładnie jak dziś, tylko importuje z nowych miejsc.

### Changes Required:

#### 1. Kontrakt bez promptów

**File**: `packages/code-reviewer/src/review-schema.ts`

**Intent**: Plik zostaje jedynym kontraktem wyniku; `SYSTEM_PROMPT` z niego wychodzi. Komentarz nagłówka mówi, że prompty są w `src/prompts/`, a schemat jest źródłem prawdy dla promptów, bramki CI i evali.

**Contract**: eksportuje `REVIEW_SCHEMA`, `REVIEW_JSON_SCHEMA` (draft-07, bez zmian), `type Review`; nie eksportuje `SYSTEM_PROMPT`. Definicja schematu bez zmian.

#### 2. Moduły promptów

**File**: `packages/code-reviewer/src/prompts/system.ts`, `packages/code-reviewer/src/prompts/user.ts`

**Intent**: Prompt systemowy i szablon wiadomości z diffem w osobnych modułach, żeby przyszłe evale mogły je importować i wersjonować niezależnie od agenta.

**Contract**: `system.ts` eksportuje `SYSTEM_PROMPT` — tekst bajt w bajt identyczny z obecnym. `user.ts` eksportuje `buildReviewPrompt(diff: string): string` zwracające dokładnie `` `Oceń poniższy diff.\n\n<diff>\n${diff}\n</diff>` ``.

#### 3. Konfiguracja i wartości domyślne

**File**: `packages/code-reviewer/src/config.ts`

**Intent**: Jedno miejsce na stałe dziś rozsiane po `index.ts`.

**Contract**: `PACKAGE_DIR`, `ENV_FILE`, `REVIEW_DEFAULTS = { model: "claude-sonnet-5-5", maxTurns: 2, maxBudgetUsd: 0.5 }` (readonly). Komentarz przy `maxBudgetUsd` zachowuje informację o `error_max_budget_usd`.

#### 4. Błędy z kodem

**File**: `packages/code-reviewer/src/errors.ts`

**Intent**: Wołający (CLI, przyszły provider promptfoo, bramka CI) odróżnia przyczyny porażki po kodzie, nie po tekście, i nie gubi kosztu nieudanego biegu.

**Contract**: `type ReviewerErrorCode = "missing_api_key" | "empty_diff" | "invalid_options" | "auth_source" | "no_result" | "execution" | "max_turns" | "max_budget" | "structured_output_retries" | "model_error" | "no_structured_output" | "schema_mismatch"`; `class ReviewerError extends Error { readonly code; readonly meta?: ReviewMeta }` z konstruktorem `(code, message, { meta?, cause? })`. Typ `ReviewMeta` definiowany tutaj (lub w `reviewer.ts` i importowany jako `import type`): `{ model: string; subtype: SDKResultMessage["subtype"]; costUsd: number; numTurns: number; usage: …; modelUsage: … }`.

#### 5. Loader klucza

**File**: `packages/code-reviewer/src/env.ts`

**Intent**: Zasada „klucz tylko z `.env` pakietu, nigdy z powłoki ani loginu” zostaje w jednym module, którego używa CLI i którego użyje przyszły provider.

**Contract**: `loadApiKey(envFile: string = ENV_FILE): string`; brak pliku lub pusty klucz → `ReviewerError("missing_api_key", …)` z tymi samymi komunikatami co dziś.

#### 6. Przepięcie obecnego wejścia

**File**: `packages/code-reviewer/src/index.ts`

**Intent**: Tymczasowo nadal CLI, ale korzysta z modułów 1–5 zamiast lokalnych definicji; zachowanie bez zmian.

**Contract**: usunięte lokalne `MODEL`, `MAX_TURNS`, `MAX_BUDGET_USD`, `PACKAGE_DIR`, `ENV_FILE`, `ReviewerError`, `loadApiKey`; prompt z `buildReviewPrompt`.

### Success Criteria:

#### Automated Verification:

- Typecheck przechodzi: `cd packages/code-reviewer && npm run typecheck`
- `SYSTEM_PROMPT` ma ten sam SHA-256 przed i po przeniesieniu (hash policzony przez `npx tsx --eval` przed zmianą i po niej)
- `review-schema.ts` nie zawiera już `SYSTEM_PROMPT`: `grep -c SYSTEM_PROMPT src/review-schema.ts` zwraca 0
- Brak klucza zgłaszany kodem: `loadApiKey("/nonexistent/.env")` wywołane przez `npx tsx --eval` rzuca `ReviewerError` z `code === "missing_api_key"`
- Pusty diff kończy CLI przed wywołaniem API: `npm run review < /dev/null` wychodzi z kodem 1 i komunikatem o pustym diffie

**Implementation Note**: Faza 1 nie wymaga płatnego biegu — zachowanie przebiegu `query()` się nie zmienia. Po automatycznej weryfikacji można przejść do fazy 2.

---

## Phase 2: Agent, publiczne API i CLI

### Overview

Logika `query()` przechodzi do reużywalnego `reviewer.ts` z kontraktem `{ review, meta }` i błędami z kodem; `index.ts` staje się barrelem bez efektów ubocznych, a CLI przechodzi do `cli.ts`.

### Changes Required:

#### 1. Moduł agenta

**File**: `packages/code-reviewer/src/reviewer.ts`

**Intent**: Jedyny moduł, który woła `query()`. Zachowuje całą izolację przebiegu i strażnika `apiKeySource`, dokłada walidację wejścia, obsługę wyjątku rzucanego przez SDK po wyniku z błędem i mapowanie każdego zakończenia na `ReviewerError` z kodem i `meta`.

**Contract**:

- `interface ReviewOptions { apiKey: string; model?: string; maxTurns?: number; maxBudgetUsd?: number }` — brakujące pola z `REVIEW_DEFAULTS`.
- `interface ReviewOutcome { review: Review; meta: ReviewMeta }`.
- `reviewDiff(diff: string, options: ReviewOptions): Promise<ReviewOutcome>`.
- Walidacja przed jakimkolwiek I/O: pusty/biały diff → `empty_diff`; pusty `apiKey`, `maxTurns` nie będący dodatnią liczbą całkowitą, `maxBudgetUsd` nie będący dodatnią skończoną liczbą → `invalid_options`.
- Mapowanie zakończeń: brak wiadomości `result` → `no_result`; `error_max_turns` → `max_turns`; `error_max_budget_usd` → `max_budget`; `error_max_structured_output_retries` → `structured_output_retries`; `error_during_execution` → `execution`; `success` z `is_error` → `model_error`; `success` bez `structured_output` → `no_structured_output`; niezgodność z `REVIEW_SCHEMA.safeParse` → `schema_mismatch`; init z innym `apiKeySource` → `auth_source` (z `abortController.abort()` jak dziś). Każdy błąd po otrzymaniu wyniku niesie `meta`.
- `subprocessEnv` i `FOREIGN_AUTH_VARS` przenoszone bez zmian; `CLAUDE_AGENT_SDK_CLIENT_APP` zostaje.
- Moduł nie pisze na stdout/stderr.

#### 2. Publiczny barrel

**File**: `packages/code-reviewer/src/index.ts`

**Intent**: Punkt wejścia biblioteki dla przyszłego providera promptfoo; import nie uruchamia niczego.

**Contract**: re-eksportuje `reviewDiff`, typy `ReviewOptions`, `ReviewOutcome`, `ReviewMeta`, `ReviewerError`, `type ReviewerErrorCode`, `REVIEW_SCHEMA`, `REVIEW_JSON_SCHEMA`, `type Review`, `SYSTEM_PROMPT`, `buildReviewPrompt`, `REVIEW_DEFAULTS`, `loadApiKey`. Żadnego kodu na poziomie modułu poza eksportami.

#### 3. CLI

**File**: `packages/code-reviewer/src/cli.ts`

**Intent**: Cienka powłoka: klucz z `loadApiKey()`, diff ze stdin (sprawdzenie TTY zostaje tutaj), `reviewDiff`, JSON recenzji na stdout. Realizuje „Track cost per run”: loguje `meta` na stderr zarówno po sukcesie, jak i z `ReviewerError.meta` po porażce.

**Contract**: stdout — tylko `JSON.stringify(review, null, 2)`; stderr — `[code-reviewer] {"subtype",…,"num_turns","total_cost_usd","usage"}` (te same klucze co dziś `logResult`) oraz `[code-reviewer] error (<code>): <message>`; kod wyjścia 1 przy każdym błędzie. Nagłówek z przykładem użycia: `git diff | npx tsx src/cli.ts`.

#### 4. Manifest pakietu

**File**: `packages/code-reviewer/package.json`

**Intent**: Skrypt CLI wskazuje na nowy plik, a pakiet wystawia barrel jako swoje wejście.

**Contract**: `"scripts.review": "tsx src/cli.ts"`; `"exports": { ".": "./src/index.ts" }`. Zależności bez zmian.

### Success Criteria:

#### Automated Verification:

- Typecheck przechodzi: `cd packages/code-reviewer && npm run typecheck`
- Import barrela nie ma efektów ubocznych: `npx tsx --eval` importujący `./src/index.ts` wypisuje posortowaną listę eksportów z sekcji „Publiczny barrel” i nic więcej, kod wyjścia 0, bez podprocesu SDK
- Pusty diff odrzucany przed API: `npm run review < /dev/null` wychodzi z kodem 1 i `error (empty_diff)` na stderr, stdout pusty
- Złe opcje odrzucane przed API: `reviewDiff("x", { apiKey: "x", maxBudgetUsd: 0 })` przez `npx tsx --eval` rzuca `ReviewerError` z `code === "invalid_options"` i nie tworzy katalogu `code-reviewer-*` w `os.tmpdir()`
- `query(` występuje tylko w `src/reviewer.ts`: `grep -rl "query(" src` zwraca jeden plik
- Żaden moduł nie czyta klucza z env powłoki: `grep -rn "process.env.ANTHROPIC" src` nic nie znajduje

#### Manual Verification:

- Płatny bieg uruchomiony przez użytkownika: `cd packages/code-reviewer && npm run review < data/sample-1.diff` drukuje na stdout JSON zgodny z `REVIEW_SCHEMA`, na stderr linię `[code-reviewer]` z `subtype: "success"` i `total_cost_usd`, kod wyjścia 0
- `npm run review` uruchomione w terminalu bez przekierowania kończy się komunikatem o braku diffu na stdin

**Implementation Note**: Agent nie uruchamia płatnego biegu sam — wskazuje go użytkownikowi i czeka na potwierdzenie.

---

## Testing Strategy

### Unit Tests:

- Brak — decyzja z planowania (bez runnera testów i bez seamu `queryFn`).

### Integration Tests:

- Darmowe ścieżki przez `npx tsx --eval` i `npm run review` z kryteriów automatycznych (brak klucza, pusty diff, złe opcje, import barrela).

### Manual Testing Steps:

1. Użytkownik uruchamia `npm run review < data/sample-1.diff` (jeden płatny bieg, ~≤0,5 USD) i sprawdza stdout/stderr.
2. Użytkownik uruchamia `npm run review` w terminalu bez stdin i widzi komunikat o braku diffu.

## Performance Considerations

Bez zmian — ten sam model, budżet i liczba tur.

## Migration Notes

`npm run review` wskazuje na `src/cli.ts`; bezpośrednie wywołanie `npx tsx src/index.ts` przestaje uruchamiać recenzję (teraz to barrel). Nikt poza skryptem pakietu go nie woła.

## References

- Obecne wejście: `packages/code-reviewer/src/index.ts:1-150`
- Kontrakt: `packages/code-reviewer/src/review-schema.ts`
- API SDK: `packages/code-reviewer/node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` (`query` :3297, `Options` :1552, `SDKResultError` :5794, `SDKResultSuccess` :5857, `ApiKeySource` :135); https://code.claude.com/docs/en/agent-sdk/typescript
- Kontekst lekcji: `CLAUDE.md` § „10xDevs AI Toolkit - Module 5, Lesson 2”

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Kontrakt, prompty i moduły pomocnicze

#### Automated

- [x] 1.1 Typecheck przechodzi: `cd packages/code-reviewer && npm run typecheck` — c270ed6
- [x] 1.2 `SYSTEM_PROMPT` ma ten sam SHA-256 przed i po przeniesieniu — c270ed6
- [x] 1.3 `review-schema.ts` nie zawiera już `SYSTEM_PROMPT` — c270ed6
- [x] 1.4 Brak klucza zgłaszany kodem `missing_api_key` — c270ed6
- [x] 1.5 Pusty diff kończy CLI przed wywołaniem API — c270ed6

### Phase 2: Agent, publiczne API i CLI

#### Automated

- [x] 2.1 Typecheck przechodzi: `cd packages/code-reviewer && npm run typecheck` — 889055d
- [x] 2.2 Import barrela nie ma efektów ubocznych — 889055d
- [x] 2.3 Pusty diff odrzucany przed API z `error (empty_diff)` — 889055d
- [x] 2.4 Złe opcje odrzucane przed API z `invalid_options` — 889055d
- [x] 2.5 `query(` występuje tylko w `src/reviewer.ts` — 889055d
- [x] 2.6 Żaden moduł nie czyta klucza z env powłoki — 889055d

#### Manual

- [x] 2.7 Płatny bieg na `data/sample-1.diff` uruchomiony przez użytkownika daje JSON zgodny z `REVIEW_SCHEMA` i log kosztu — 889055d
- [x] 2.8 `npm run review` bez stdin kończy się komunikatem o braku diffu — 889055d
