# Faza 4 planu testów — ugruntowanie znalezisk i prywatność promptu (#4, #6) — plan implementacji

## Overview

Faza 4 rolloutu z `context/foundation/test-plan.md` zamyka ryzyka #4 (nieugruntowane znalezisko) i #6 po stronie promptu (dane sprzedającego lub notatki u dostawcy modelu). Testy z S-04 dowodzą już obu ochron, więc plan dokłada tylko to, czego brakuje: przypadek kontaktu wpisanego w tytuł, automatyczny dowód reguły lintu `auditNoNotesConfig` i dziennik mutantów. Kod pod `src/` się nie zmienia.

## Current State Analysis

Research (`context/changes/testing-audit-grounding-privacy/research.md`) nie znalazł luki w ochronie ani defektu w kodzie. Przebieg Strykera z 2026-10-12 na `src/lib/audit/grounding.ts`, `input.ts`, `prompt.ts` i `schema.ts` dał 507 mutantów: 502 zabite, 4 timeouty, 1 ocalały (`grounding.ts:73:10`, równoważny), 0 bez pokrycia.

Zostają trzy drobne luki:

- **L1 — kontakt w tytule.** Wytyczna z §2 planu testów mówi „a phone or name the advertiser typed into the title or description is kept verbatim". `TYPED_PHONE` i `TYPED_NAME` stoją tylko w opisie (`tests/fixtures/audit.ts:85`). Redakcja tytułu byłaby wykryta tylko wtedy, gdyby dotknęła tekstu fikstury, a `AUDIT_TITLE` nie ma nic, co wygląda jak kontakt.
- **L2 — reguła lintu.** `auditNoNotesConfig` (`eslint.config.js:121-137`) potwierdzono raz, ręcznie (`context/foundation/test-plan.md:771-775`). Żaden test nie uruchamia ESLinta na próbce, więc reguła usunięta przy refaktorze konfiguracji przejdzie niezauważona.
- **L3 — dziennik mutantów.** S-04 nie zostawiło zapisu wyników dla modułów audytu (`test-plan.md:1106-1109`).

## Desired End State

Wytyczna z §2 dla #6 jest dowiedziona dosłownie: kontakt wpisany w tytuł wychodzi do wejścia audytu i do promptu bez zmian, a kanarki z `raw` nadal nie. Import modułu notatek w kodzie audytu czerwieni `npm test`, nie tylko `npm run lint`. Folder zmiany zawiera `mutation.md` z decyzją dla każdego ocalałego i niepokrytego mutanta w czterech modułach, a §6.6 planu testów ma wpis fazy 4 z listą rzeczy otwartych.

Weryfikacja: `npm test`, `npm run lint` i `npx astro check` przechodzą; każdy nowy przypadek był raz czerwony na celowo zepsutym kodzie; `git diff --stat` nie pokazuje żadnego pliku pod `src/`.

### Key Discoveries:

- Test reguły lintu przez API ESLinta działa pod Vitest — sprawdzone sondą 2026-10-12 (usunięta). Import `@/lib/notes`, `../notes` i `../../lib/notes.ts` zapala `no-restricted-imports`; ten sam import w `src/lib/members.ts` i import `@/lib/footnotes` w pliku audytu nie zapalają.
- `lintText` działa tylko dla ścieżki pliku, który istnieje. Dla `src/lib/audit/probe.ts` lint z typami zwraca komunikat `fatal` z `ruleId: null`, zanim dojdzie do reguły.
- Pierwsze wywołanie ESLinta trwa ok. 5,4 s — powyżej domyślnego limitu 5 s na test w Vitest.
- Stryker znosi taki test: zawężony przebieg (`--mutate "src/lib/audit/prompt.ts:124-126"`) z sondą w `tests/` przeszedł przebieg próbny w piaskownicy, 3 z 3 mutantów zabite.
- `auditOfferRow({ title: … })` (`tests/fixtures/audit.ts:94`) to gotowy sposób na ogłoszenie z innym tytułem; `tests/lib/audit/input.test.ts:148-155` już go tak używa.
- Wzorce do skopiowania: `input.test.ts:514-520` i `prompt.test.ts:521-529` (kontakt w opisie), `input.test.ts:503-510` (kanarki z kontrolą źródła).
- `context/archive/2026-10-12-testing-audit-cost-durability/mutation.md` to wzór dziennika mutantów.

## What We're NOT Doing

- **Kontakt w tytule w teście trasy i w bramce cytatów.** Szew trasa–prompt jest dowiedziony dla opisu (`tests/pages/api/audits.test.ts:1229-1231`), a research odradza dublowanie go; §2 nie mówi nic o cytacie zapisanym z kontaktem.
- **Testy trzech siostrzanych reguł** (`refetchNoNotesConfig`, `archiveNoNotesConfig`, `deleteNoNotesConfig`). Chronią inny niezmiennik niż #6; odnotowane jako otwarte w §6.6.
- **Cytat urwany w połowie zdania** („ma hipoteki" z „nie ma hipoteki") — pytanie produktowe do FR-011. Bez testu przypinającego, bez zmiany bramki, bez zmiany w `prd.md`; wpis „Open" w §6.6.
- **Znacznik zamykający w treści ogłoszenia** (`</opis>` w opisie) — obserwacja poza #4 i #6. Bez testu, wpis „Open" w §6.6.
- **Złoty zestaw.** Każde ogłoszenie to płatny audyt; uruchamia go użytkownik, gdy zechce. Wpis „Open" w §6.6.
- **Jakiekolwiek żądanie, na które dostawca modelu by odpowiedział.**
- **Zmiana statusu fazy w §3 planu testów.** Wiersz prowadzi orkiestrator `/10x-test-plan`.
- **Zmiany w `src/`, `eslint.config.js`, migracjach i `scripts/`** — poza tymczasowym zepsuciem dla dowodu „raz czerwony", cofniętym przed commitem.

## Implementation Approach

Najpierw testy, potem przebieg Strykera, żeby dziennik opisywał stan końcowy. Nowe przypadki stoją obok istniejących i kopiują ich kształt: każdy dowód nieobecności ma kontrolę obecności w źródle, każdy przypadek zapalający regułę stoi obok takiego, który jej nie zapala. Każdy nowy przypadek jest raz czerwony na celowo zepsutym kodzie — tak jak w fazie 3 — bo test, który nigdy nie był czerwony, niczego nie dowodzi.

## Critical Implementation Details

**Test reguły lintu.** Próbka kodu jest lintowana pod ścieżką pliku, który istnieje, i nic nie jest zapisywane na dysk. Każdy przypadek — także kontrolny — sprawdza, że wynik nie zawiera komunikatu `fatal`: inaczej „brak komunikatu reguły" przechodzi także wtedy, gdy lint w ogóle się nie odbył. Test dostaje własny limit czasu, bo pierwsze wywołanie przekracza domyślne 5 s.

**Dowód „raz czerwony" dla L1.** Zepsucie musi być redakcją wzorca numeru telefonu, nie dowolną zmianą tytułu: zmiana, która rusza także `AUDIT_TITLE`, czerwieni istniejące testy i nie pokazuje, że nowy przypadek cokolwiek dodaje.

## Phase 1: Nowe przypadki testów

### Overview

Dwa przypadki dla kontaktu wpisanego w tytuł i jeden nowy plik testu dla reguły lintu. Każdy raz czerwony na zepsutym kodzie.

### Changes Required:

#### 1. Kontakt w tytule — wejście audytu

**File**: `tests/lib/audit/input.test.ts`

**Intent**: Dowieść, że numer telefonu i nazwisko wpisane przez ogłoszeniodawcę w tytuł przechodzą przez `readAuditOffer` i `buildAuditInput` bez zmian. Przypadek stoi obok istniejącego „keeps a phone number and a name the advertiser typed into the description, verbatim" (`:514`), w tym samym `describe` z tagiem `(#6)`.

**Contract**: Ogłoszenie budowane przez `auditOfferRow({ title: … })` z tytułem zawierającym `TYPED_NAME` i `TYPED_PHONE`. Asercje: `input.title` jest dokładnie tym tytułem; w tym samym przypadku żaden wpis `FORBIDDEN_IN_AUDIT` nie występuje w serializowanym wejściu, z kontrolą, że źródła je zawierają. Fikstura `tests/fixtures/audit.ts` nie zmienia się — tytuł powstaje w teście.

#### 2. Kontakt w tytule — prompt

**File**: `tests/lib/audit/prompt.test.ts`

**Intent**: Dowieść tego samego o jeden etap dalej: tytuł z kontaktem trafia do bloku `tytul` wiadomości dosłownie i nie trafia do instrukcji. Przypadek stoi obok „keeps a phone number and a name the advertiser typed into the description, verbatim" (`:521`).

**Contract**: Prompt zbudowany z tego samego ogłoszenia co w zmianie 1. Asercje: `blockBody(user, "tytul")` to dokładnie tytuł między znakami nowej linii; numer występuje w wiadomości po jednym razie na każdy tekst, który go niesie (tytuł i opis), i ani razu w `system`; żaden wpis `FORBIDDEN_IN_AUDIT` nie występuje w żadnej z dwóch części.

#### 3. Reguła lintu `auditNoNotesConfig`

**File**: `tests/eslint.config.test.ts` (nowy)

**Intent**: Dowieść w `npm test`, że konfiguracja z `eslint.config.js` odrzuca import modułu notatek w kodzie audytu — jedynym kodzie, który rozmawia z dostawcą modelu — i że nie odrzuca go gdzie indziej. Tag `(#6)`.

**Contract**: Klasa `ESLint` z pakietu `eslint` (już w `devDependencies`), z konfiguracją projektu, bez nadpisań; jedna instancja na plik testu.

- Zapala: próbka z importem modułu notatek pod ścieżką `src/lib/audit/input.ts` (alias `@/lib/notes`, względny `../notes`, z rozszerzeniem `../notes.ts`) i pod `src/pages/api/audits.ts` (alias i `../../lib/notes.ts`). Oczekiwany komunikat ma `ruleId: "no-restricted-imports"`, wagę błędu i tekst reguły audytu („The audit must not import the notes module"), żeby nie pomylić go z regułą siostrzaną.
- Nie zapala: ten sam import pod `src/lib/members.ts`; import `@/lib/footnotes` pod `src/lib/audit/input.ts`.
- Zasięg: dla każdego pliku, który stoi dziś w `src/lib/audit/` (lista z katalogu, nie spisana ręcznie), i dla `src/pages/api/audits.ts` wyliczona konfiguracja (`calculateConfigForFile`) niesie regułę z komunikatem audytu. To łapie blok, który nadpisał opcje reguły dla jednego z plików — flat config zastępuje opcje, nie łączy ich (`eslint.config.js:118-120`).
- Każdy przypadek sprawdza brak komunikatu `fatal`. Asercje filtrują po `ruleId`, bo próbka może zapalić inne reguły.

### Success Criteria:

#### Automated Verification:

- Nowe przypadki przechodzą: `npm test -- tests/lib/audit tests/eslint.config.test.ts`
- Cały zestaw przechodzi: `npm test`
- `npm run lint`, `npx astro sync` i `npx astro check` przechodzą
- Każdy nowy przypadek był raz czerwony i wrócił do zielonego: redakcja wzorca numeru telefonu w tytule w `readAuditOffer` (zmiana 1) i w `buildAuditPrompt` (zmiana 2) przy zielonych testach istniejących; `auditNoNotesConfig` usunięte z eksportu `eslint.config.js` oraz wyrażenie reguły zawężone tak, by nie łapało aliasu (zmiana 3)
- Po cofnięciu zepsuć `git status --short` nie pokazuje żadnego pliku pod `src/` ani `eslint.config.js`

**Implementation Note**: Faza nie ma kroków ręcznych. Po przejściu weryfikacji automatycznej przejdź do fazy 2. Bloki faz używają zwykłych punktów — pola `- [ ]` dla tych pozycji stoją w sekcji `## Progress` na dole planu.

---

## Phase 2: Stryker i dokumentacja

### Overview

Ponowny przebieg Strykera na czterech modułach audytu, dziennik mutantów w folderze zmiany i aktualizacja planu testów oraz `CLAUDE.md`.

### Changes Required:

#### 1. Przebieg Strykera

**File**: brak zmian w repozytorium (`reports/` jest git-ignorowane)

**Intent**: Potwierdzić wynik z researchu na stanie końcowym testów i ustalić pozycje czterech timeoutów, których reporter tekstowy nie podał.

**Contract**: `npx stryker run --mutate "src/lib/audit/grounding.ts,src/lib/audit/input.ts,src/lib/audit/prompt.ts,src/lib/audit/schema.ts"`, z reporterem `json` dodanym w wierszu poleceń dla tego jednego przebiegu (`stryker.config.json` się nie zmienia). Kryterium to brak mutanta bez decyzji, nie próg liczbowy. Wynik inny niż w researchu jest zapisywany taki, jaki jest, z wyjaśnieniem różnicy.

#### 2. Dziennik mutantów

**File**: `context/changes/testing-audit-grounding-privacy/mutation.md` (nowy)

**Intent**: Zostawić w repozytorium liczby i decyzje, bo raport jest lokalny i nadpisywany przy każdym przebiegu.

**Contract**: Układ jak w `context/archive/2026-10-12-testing-audit-cost-durability/mutation.md`: legenda decyzji, polecenie przebiegu, tabela wyniku na plik, decyzja z powodem dla każdego ocalałego i niepokrytego mutanta (`grounding.ts:73:10` — równoważny, z uzasadnieniem z researchu), pozycje timeoutów, sekcja „Poza tym przebiegiem" (`provider.ts`; reguła lintu, której Stryker nie mutuje, bo `eslint.config.js` nie jest w `mutate`).

#### 3. Plan testów

**File**: `context/foundation/test-plan.md`

**Intent**: Opisać stan faktyczny po fazie 4 i zapisać, co zostaje otwarte.

**Contract**:

- §6.5, punkt „The other half, always": kontakt wpisany w tytuł obok opisu.
- §6.5, punkt „Notes have no way in": zdanie o jednorazowej ręcznej próbie zastąpione wskazaniem `tests/eslint.config.test.ts`.
- §6.5, „Run": polecenie Strykera obejmuje cztery moduły.
- §6.6: nowy wpis „**Phase 4 — Audit grounding and prompt privacy**" (`testing-audit-grounding-privacy`, data), po angielsku jak sąsiednie. Zawiera: że testy z S-04 dowodziły już obu ochron; co dołożono; liczby Strykera ze wskazaniem `mutation.md`; listę zepsuć z dowodu „raz czerwony"; zdanie, że żaden test ani krok nie wysłał żądania, na które dostawca by odpowiedział; listę „Open": cytat urwany w połowie zdania ze wskazaniem FR-011 jako miejsca decyzji, znacznik zamykający w treści ogłoszenia, nieuruchomiony złoty zestaw, trzy siostrzane reguły `*NoNotesConfig` bez testu.
- §8: wpis „Cookbook (§6) last changed".
- §3 bez zmian.

#### 4. Reguły projektu

**File**: `CLAUDE.md`

**Intent**: Wskazać wzorzec dla następnego testu reguły lintu, razem z pułapką, która nie wynika z samego pliku.

**Contract**: Jedno zdanie w `## Testing`, w punkcie „A test lives under `tests/`…": `tests/eslint.config.test.ts` jako wzorzec testu reguły lintu — próbka lintowana pod ścieżką istniejącego pliku, bo lint z typami kończy ścieżkę spoza projektu błędem krytycznym przed regułą, i każdy przypadek zapalający obok takiego, który nie zapala.

### Success Criteria:

#### Automated Verification:

- Przebieg Strykera na czterech modułach kończy się, a każdy ocalały i niepokryty mutant ma decyzję z powodem w `mutation.md`
- `npm test`, `npm run lint`, `npx astro sync` i `npx astro check` przechodzą
- Zmienione pliki Markdown przechodzą `npx prettier --check`
- `git diff --stat` nie pokazuje żadnego pliku pod `src/`, `supabase/` ani `scripts/`, ani `eslint.config.js`, ani `stryker.config.json`

#### Manual Verification:

- Użytkownik czyta wpis fazy 4 w §6.6 i `mutation.md` i potwierdza, że lista „Open" mówi to, co zdecydował

**Implementation Note**: Po przejściu weryfikacji automatycznej zatrzymaj się i poczekaj na potwierdzenie kroku ręcznego. Bloki faz używają zwykłych punktów — pola `- [ ]` dla tych pozycji stoją w sekcji `## Progress` na dole planu.

---

## Testing Strategy

### Unit Tests:

- Kontakt w tytule zostaje dosłownie w wejściu audytu i w bloku `tytul` promptu; kanarki z `raw` nadal nieobecne, z kontrolą obecności w źródle.
- Reguła lintu: pięć zapisów importu notatek w dwóch plikach audytu zapala regułę; dwa przypadki kontrolne nie; każdy plik pod `src/lib/audit/` niesie regułę w wyliczonej konfiguracji.

### Integration Tests:

- Brak nowych. Test trasy (`tests/pages/api/audits.test.ts`) dowodzi szwu trasa–prompt i trasa–bramka i się nie zmienia.

### Manual Testing Steps:

1. Przeczytać wpis fazy 4 w §6.6 `context/foundation/test-plan.md`.
2. Przeczytać `context/changes/testing-audit-grounding-privacy/mutation.md`.

## Performance Considerations

`npm test` wydłuża się o ok. 5–6 s (zimny start ESLinta z lintem z typami). Test reguły lintu nie importuje nic spod `src/`, więc w Strykerze biegnie tylko w przebiegu próbnym, nie na każdym mutancie.

## Migration Notes

Nie dotyczy: brak zmian w bazie i w kodzie aplikacji.

## References

- Related research: `context/changes/testing-audit-grounding-privacy/research.md`
- Wzór dziennika mutantów: `context/archive/2026-10-12-testing-audit-cost-durability/mutation.md`
- Wzorce przypadków: `tests/lib/audit/input.test.ts:503-520`, `tests/lib/audit/prompt.test.ts:504-529`
- Reguła: `eslint.config.js:112-137`
- Wytyczna: `context/foundation/test-plan.md` §2 (#4, #6), §6.5

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Nowe przypadki testów

#### Automated

- [x] 1.1 Nowe przypadki przechodzą: `npm test -- tests/lib/audit tests/eslint.config.test.ts`
- [x] 1.2 Cały zestaw przechodzi: `npm test`
- [x] 1.3 `npm run lint`, `npx astro sync` i `npx astro check` przechodzą
- [x] 1.4 Każdy nowy przypadek był raz czerwony i wrócił do zielonego
- [x] 1.5 Po cofnięciu zepsuć `git status --short` nie pokazuje żadnego pliku pod `src/` ani `eslint.config.js`

### Phase 2: Stryker i dokumentacja

#### Automated

- [ ] 2.1 Przebieg Strykera na czterech modułach kończy się, a każdy ocalały i niepokryty mutant ma decyzję z powodem w `mutation.md`
- [ ] 2.2 `npm test`, `npm run lint`, `npx astro sync` i `npx astro check` przechodzą
- [ ] 2.3 Zmienione pliki Markdown przechodzą `npx prettier --check`
- [ ] 2.4 `git diff --stat` nie pokazuje żadnego pliku pod `src/`, `supabase/` ani `scripts/`, ani `eslint.config.js`, ani `stryker.config.json`

#### Manual

- [ ] 2.5 Użytkownik czyta wpis fazy 4 w §6.6 i `mutation.md` i potwierdza, że lista „Open" mówi to, co zdecydował
