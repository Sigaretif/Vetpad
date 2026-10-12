# Faza 3 planu testów — koszt i trwałość audytu (#2, #3) — plan implementacji

## Overview

Faza 3 rolloutu z `context/foundation/test-plan.md` dokłada wąskie dowody dla ryzyk #2 (Denial of Wallet) i #3 (utracony opłacony wynik) tam, gdzie testy z S-04 ich nie dają: sześć luk wskazanych przez zawężony przebieg Strykera z 2026-10-12. Równolegle poprawia plan testów, żeby obiecywał tylko to, co jest dowiedzione. Kod pod `src/` i migracje się nie zmieniają.

## Current State Analysis

Ścieżki obu ryzyk istnieją i są przypięte testami z S-04 (`context/changes/testing-audit-cost-durability/research.md`). Przebieg Strykera na `src/pages/api/audits.ts`, `src/lib/audit/store.ts:1-243` i `src/lib/audit/provider.ts` (731 mutantów: 599 zabitych, 89 przeżyło, 42 bez pokrycia) wskazał gałęzie bez dowodu:

- **G1** — `catch` po przejęciu wiersza (`src/pages/api/audits.ts:250-254`) nie ma żadnego pokrycia. To gałąź, która ma nie zostawić próby w stanie `running`.
- **G2** — `catch` przed przejęciem (`audits.ts:354-360`) nie ma scenariusza „0 wywołań dostawcy".
- **G3** — trasa przechodzi do przejęcia tylko po kodzie `23505` (`src/lib/audit/store.ts:96`), a żaden test na prawdziwej bazie nie sprawdza, że baza odpowiada nim na drugi insert. Test trasy wpisuje ten kod ręcznie (`tests/pages/api/audits.test.ts:835`).
- **G4** — odczyt startu próby z odpowiedzi przejęcia (`store.ts:67-72`): zbadany jest tylko pusty wynik `[]`, 12 mutantów przeżywa.
- **G6** — `unmarked()` dla `claim_lost` (`audits.ts:91`): wpis `attempt_taken_over` nie ma asercji.
- **G7** — `had_limits` przy częściowo ustawionych limitach (`audits.ts:242`): fixture ma wszystkie limity albo żadnego.

Plan testów w dwóch miejscach obiecuje więcej, niż produkt daje: §2 wymienia „pętlę" jako coś, przed czym testy chronią (kolejne audyty tej samej oferty nie mają limitu — `scripts/audit-state.sql:304-323`), i mówi o wyniku „odzyskiwalnym" (kod wybrał jawny błąd — `store.ts:192-193`).

## Desired End State

Każda z sześciu luk ma test, który staje się czerwony po zepsuciu chronionej linii. Plan testów opisuje stan faktyczny: #2 chroni przed jednoczesnością i żądaniem bez sesji, #3 kończy się jawnym błędem po dwóch zapisach, a brak limitu kolejnych audytów stoi w §7 jako świadoma decyzja. `npm test` i `npm run test:db` przechodzą; ponowny przebieg Strykera nie zostawia ocalałego ani niepokrytego mutanta w liniach G1, G2 (`:354-360`), G4, G6 i G7 bez zapisanej decyzji.

### Key Discoveries:

- Wszystkie trzy ścieżki wyjątków są osiągalne z krawędzi, bez mockowania `@/lib/*` — sprawdzone jednorazowym testem 2026-10-12 (usunięty):
  - konsola rzucająca przy wpisie `started` (`audits.ts:200`, wewnątrz `try`) → `unexpected`, 0 wywołań dostawcy, zapis `{"run_state":"failed","run_failure":"unexpected"}`, jeden wpis `error` ze `stage: "unexpected"`, `error_name`, polami `KNOWN` i `duration_ms: 0`;
  - `crypto.subtle.digest`, które odrzuca (`src/lib/audit/input.ts:348`, wołane w `audits.ts:179`, przed przejęciem) → `unexpected`, 0 wywołań, sześć odczytów i żadnego `POST offer_audits`, wpis niesie tylko `user_id`, `offer_id`, `error_name`;
  - `cookies.set` rzucające przy odświeżeniu sesji dochodzi do `catch` w `audits.ts:319`, ale zostawia dwa nieobsłużone odrzucenia obietnicy z klienta Supabase, które Vitest liczy jako błąd przebiegu.
- `tests/pages/api/audits.test.ts:891-931` to gotowa tabela `claim_failed` — G4 dopisuje do niej wiersze.
- `tests/pages/api/audits.test.ts:1612-1635` to wzorzec dla G6 (ta sama sytuacja z błędem bazy zamiast zera wierszy), a `:1059` dla G7.
- `scripts/audit-state.sql:140-165` (blokada, wiersz `running`) i `:273-302` (zakończony audyt) to dwa miejsca, w których wiersz jest w stanie potrzebnym dla G3. DDL w Postgresie jest transakcyjne, więc zepsucie klucza w kopii skryptu znika z `ROLLBACK`.
- `context/archive/2026-10-01-testing-read-failure-states/mutation.md` to precedens zapisu decyzji o mutantach w folderze zmiany.

## What We're NOT Doing

- **G5 — dwa żądania naraz w teście trasy.** Zaślepka musiałaby sama udawać `VP001`, więc test przeszedłby przy zepsutej blokadzie. Blokady dowodzi baza, połówkę trasy — istniejący test `busy`; szew zamyka G3.
- **Gałąź `getSession`, które rzuca** (`audits.ts:133`, `:317-321`). Jedyna krawędź, która ją wywołuje, zostawia nieobsłużone odrzucenia; test nie tłumi błędów. Odnotowane w §6.6 jako otwarte.
- **Klasyfikacja błędów dostawcy** (`src/lib/audit/provider.ts:149-254`, 53 mutanty). Wpływa na zdanie dla członka, nie na liczbę wywołań. Odnotowane w §6.6.
- **Limit kolejnych audytów tej samej oferty** i **odzyskiwanie opłaconego wyniku** — to stan produktu, nie luka testu. Plan testów nazywa oba; żadna zmiana w `src/`, w migracjach ani w PRD.
- Gałęzie `catch` w `store.ts` na wypadek klienta, który rzuca, mutanty równoważne na poziomie trasy i teksty `select` — osądzone w researchu jako nie-luki; trafiają do `mutation.md` z tą decyzją.
- Żadnej zmiany w `scripts/smoke.mjs`, w CI ani w `CLAUDE.md`: powierzchnia `src/pages/api/` się nie zmienia, a oba pliki testów już biegną w istniejących krokach.
- Żadne żądanie do dostawcy modelu. Każdy nowy przypadek biegnie na zaślepce `fetch`.

## Implementation Approach

Dowód stoi na warstwie, która nie może skłamać (§6.4 planu testów): kolejność trasy — test trasy zaślepiony na krawędzi HTTP; odpowiedź bazy — `scripts/audit-state.sql`. Każdy nowy przypadek podaje liczbę wywołań dostawcy w nazwie i w asercji, a oczekiwane wpisy logu i ciała zapisów są wypisane ręcznie. Wyrocznią jest kontrakt trasy z nagłówka `src/pages/api/audits.ts` i nagłówek `supabase/migrations/20261007073300_create_offer_audits.sql`, nie bieżące wyjście kodu. Faza 3 planu kończy się przebiegiem Strykera, który potwierdza, że nowe przypadki zabijają wskazane mutanty, i dopiero wtedy opisuje wynik w planie testów.

## Critical Implementation Details

**Konsola w G1 rzuca tylko przy wpisie `started`.** Wpis wyjścia (`audits.ts:366`) idzie przez tę samą konsolę w `.then`, poza jakimkolwiek `catch`: wyjątek tam odrzuca obietnicę `work`, strumień nie dostaje ostatniej linii i test wisi. Warunek rzutu to `outcome === "started"`, nic szerszego.

## Faza 1: Przypadki w teście trasy

### Overview

Pięć luk (G1, G2, G4, G6, G7) dostaje przypadki w `tests/pages/api/audits.test.ts`, w istniejących blokach `describe` albo w jednym nowym.

### Changes Required:

#### 1. Wyjątek po przejęciu wiersza (G1)

**File**: `tests/pages/api/audits.test.ts`

**Intent**: Dowieść, że wyjątek po przejęciu nie zostawia próby `running` i nie płaci. Dwa przypadki: zapis „nieudana" trafia w wiersz; zapisu nie da się wykonać (błąd bazy).

**Contract**: Nowy `describe` oznaczony `(#2, #3)`. Krawędź: konsola rzucająca przy wpisie `started`. Przypadek pierwszy: ostatnia linia `failed`/`unexpected` z fragmentem zdania dla członka, 0 wywołań dostawcy, dokładnie jeden zapis `failed` o ciele `{ run_state: "failed", run_failure: "unexpected" }` z filtrem `expectOwnAttemptOnly`, żadnego zapisu `completed`, a log to jeden wpis `error`: `outcome: "failed"`, `stage: "unexpected"`, `reason: "unexpected"`, `KNOWN`, `error_name` klasy rzuconego błędu, `duration_ms: 0` — bez wpisu `started`. Przypadek drugi (`fail` odpowiada błędem bazy): ta sama odpowiedź, a wpis niesie dodatkowo `detail: "attempt_not_marked"` i pola `db_*`. Obok kontrola: to samo żądanie z konsolą, która nie rzuca, dochodzi do dostawcy raz.

#### 2. Wyjątek przed przejęciem (G2)

**File**: `tests/pages/api/audits.test.ts`

**Intent**: Dowieść, że wyjątek przed przejęciem kończy się odpowiedzią `unexpected` bez przejęcia wiersza i bez wywołania dostawcy.

**Contract**: Przypadek w `describe` „what can be checked for free is checked before the claim (#2)". Krawędź: `crypto.subtle.digest`, które odrzuca; szpieg jest zdejmowany po teście. Oczekiwane: ostatnia linia `failed`/`unexpected`, 0 wywołań dostawcy, `tablesAsked` równe pierwszym sześciu pozycjom `READS_AND_CLAIM` (bez `POST offer_audits`), żadnego zapisu do `offer_audits`, log to jeden wpis `error` z `outcome: "failed"`, `stage: "unexpected"`, `reason: "unexpected"`, `user_id`, `offer_id`, `error_name` — bez `model`, `effort`, `criteria_revision`, `listing_chars`.

#### 3. Odpowiedź przejęcia bez czytelnego startu (G4)

**File**: `tests/pages/api/audits.test.ts`

**Intent**: Dowieść, że przejęcie, na które baza odpowiada czymś innym niż jeden wiersz z niepustym tekstowym `run_started_at`, nie jest przejęciem i nie prowadzi do płatnego wywołania.

**Contract**: Nowe wiersze tabeli `it.each` w `:891`. Dla insertu (status 201) i dla przejęcia po `23505` (status 200): `run_started_at` jako pusty tekst, jako nie-tekst (liczba, `null`), dwa wiersze w odpowiedzi, element tablicy niebędący obiektem. Każdy: `claim_failed`, 0 wywołań dostawcy, żadnego zapisu `completed` ani `failed`, wpis z `detail: "insert"` lub `"takeover"` i samym `db_status`.

#### 4. Zapis „nieudana", który nie trafił w wiersz (G6)

**File**: `tests/pages/api/audits.test.ts`

**Intent**: Dowieść, że gdy po nieudanym wywołaniu modelu wiersz należy już do innej próby, wpis w logu mówi o przejęciu, a nie o błędzie zapisu.

**Contract**: Przypadek obok `:1612`. Dostawca odpowiada `500`, zapis `failed` odpowiada `200` z `[]`. Oczekiwane: `provider_unavailable`, 1 wywołanie dostawcy, jeden zapis `failed`, a ostatni wpis niesie `detail: "attempt_taken_over"` i żadnego pola `db_*`.

#### 5. `had_limits` przy jednym ustawionym limicie (G7)

**File**: `tests/pages/api/audits.test.ts`

**Intent**: Dowieść, że zapisany wynik mówi prawdę o limitach, gdy zespół ustawił tylko część z nich.

**Contract**: Przypadek obok `:1059`. Wiersz `team_criteria` z jednym limitem (np. samo `city`) i trzema `null`. Oczekiwane: 1 wywołanie dostawcy, ciało zapisu `completed` ma `had_limits: true`.

### Success Criteria:

#### Automated Verification:

- Test trasy przechodzi: `npm test -- tests/pages/api/audits.test.ts`
- Cały zestaw przechodzi bez nieobsłużonych błędów: `npm test`
- Lint przechodzi: `npm run lint`
- Typy przechodzą: `npx astro sync && npx astro check`
- Każdy nowy przypadek podaje liczbę wywołań dostawcy w nazwie i w asercji `providerCalls(stub.requests)`
- Po każdym nowym przypadku `restoreFetch` nie zgłasza nieplanowanego żądania, a szpiedzy konsoli i `crypto.subtle.digest` nie przeciekają do następnych testów (zestaw przechodzi także przy `npx vitest run tests/pages/api/audits.test.ts --sequence.shuffle`)

#### Manual Verification:

- Przegląd diffu: oczekiwane wpisy logu i ciała zapisów są wypisane ręcznie, nie skopiowane z wyjścia kodu

**Implementation Note**: Po zakończeniu tej fazy i przejściu weryfikacji automatycznej zatrzymaj się na potwierdzenie człowieka, zanim przejdziesz dalej. Bloki faz używają zwykłych punktów — pola wyboru dla tych pozycji są w sekcji `## Progress` na końcu planu.

---

## Faza 2: Szew `23505` w bazie

### Overview

`scripts/audit-state.sql` dostaje sprawdzenie, że prawdziwa baza odpowiada `23505` na drugi insert dla oferty, która ma już wiersz audytu — kodem, od którego zależy przejście trasy do przejęcia.

### Changes Required:

#### 1. Drugi insert dla oferty z wierszem audytu (G3)

**File**: `scripts/audit-state.sql`

**Intent**: Zamknąć szew między trasą a bazą: `store.ts:96` idzie do przejęcia wyłącznie po `23505`, więc inny kod z bazy zamieniłby drugie kliknięcie w `claim_failed` zamiast w `busy`.

**Contract**: Sprawdzenie w dwóch stanach wiersza, każde w bloku `DO` zgodnym z konwencją pliku (`audit-state: [<nazwa>] …`, wewnątrz jednej transakcji): przy próbie w toku (po bloku blokady, `:140-165`) i przy zakończonym audycie (po bloku `:273-302`, przed ponownym uruchomieniem). W każdym: insert `(offer_id, run_state: 'running')` jako starter i jako drugi członek dostaje `23505`, a wiersz porównany jako całość (`to_jsonb`) jest taki sam jak przed. Komentarz nad blokiem mówi, po co trasie ten kod. Nagłówek pliku dostaje jedno zdanie o szwie.

### Success Criteria:

#### Automated Verification:

- Skrypty przechodzą na lokalnej bazie: `npm run test:db`
- Sprawdzenie staje się czerwone na zepsutym systemie: kopia skryptu w katalogu roboczym poza repozytorium, z `alter table public.offer_audits drop constraint offer_audits_pkey` dopisanym wewnątrz transakcji przed nowym blokiem, kończy się kodem różnym od zera i komunikatem z nazwą nowego sprawdzenia; `ROLLBACK` zostawia bazę bez zmian
- Po tej próbie `npm run test:db` znów przechodzi

#### Manual Verification:

- Nowe bloki stoją tam, gdzie wiersz jest w stanie, którego potrzebują, i nie zmieniają wiersza dla sprawdzeń po nich

**Implementation Note**: Ta faza wymaga działającego lokalnego Supabase (`npx supabase start`). Po przejściu weryfikacji automatycznej zatrzymaj się na potwierdzenie człowieka.

---

## Faza 3: Stryker i plan testów

### Overview

Zawężony przebieg Strykera potwierdza, że nowe przypadki zabijają wskazane mutanty; każdy pozostały ma zapisaną decyzję. Plan testów zostaje doprowadzony do stanu faktycznego.

### Changes Required:

#### 1. Przebieg mutacyjny i decyzje

**File**: `context/changes/testing-audit-cost-durability/mutation.md` (nowy)

**Intent**: Zapisać wynik przebiegu przed (z researchu) i po oraz decyzję dla każdego ocalałego i niepokrytego mutanta w zakresie, na wzór `context/archive/2026-10-01-testing-read-failure-states/mutation.md`. Wynik nie jest celem.

**Contract**: Przebieg `npx stryker run --mutate "src/pages/api/audits.ts,src/lib/audit/store.ts:1-243"`. Tabela: plik, zakres linii, przed, po, zabite / ocalałe / bez pokrycia. Decyzje według rodzajów: równoważny, świadomie pominięty (z powodem), poza zakresem fazy. Mutanty w `audits.ts:250-253`, `:354-360` (bez `:133` i `:317-321`), `:91`, `:242` i `store.ts:67-72` są zabite; jeśli któryś przeżył, wraca do fazy 1 albo dostaje uzasadnienie równoważności.

#### 2. Mapa ryzyk

**File**: `context/foundation/test-plan.md` (§2)

**Intent**: Sformułowania #2 i #3 mają mówić to, co testy dowodzą.

**Contract**: W wierszu ryzyka #2 „a loop" znika z listy sposobów wielokrotnego wywołania; w „What would prove protection" dla #2 dochodzi zdanie, że kolejne audyty tej samej oferty nie są ograniczane (odsyłacz do §7). Dla #3 „the result is recoverable or the failure is explicit" staje się: zapis jest próbowany dwa razy, a porażka po nim jest jawna (`save_failed`, próba oznaczona jako nieudana, członek czyta, że ponowienie to nowe płatne zapytanie); opłacona odpowiedź nie jest odzyskiwalna. Status wiersza fazy 3 w §3 zostaje orkiestratorowi (`/10x-test-plan`).

#### 3. Czego świadomie nie testujemy

**File**: `context/foundation/test-plan.md` (§7)

**Intent**: Nazwać brak limitu kolejnych audytów jako decyzję, nie przeoczenie.

**Contract**: Nowy punkt: liczba audytów tej samej oferty jeden po drugim nie jest ograniczana — blokada chroni przed dwoma naraz; źródło: PRD (zaufany zespół, każdy audyt to celowe działanie), decyzja użytkownika 2026-10-12; warunek ponownej oceny: rachunek od dostawcy niezgodny z liczbą celowych audytów.

#### 4. Książka kucharska i wpis fazy

**File**: `context/foundation/test-plan.md` (§6.4, §6.6, §8)

**Intent**: Zostawić następnemu autorowi wzorzec wyjątku wywołanego z krawędzi i zapis tego, co faza dostarczyła i zostawiła otwarte.

**Contract**: §6.4 — punkt o wyjątku z krawędzi (konsola przy wpisie `started` dla gałęzi po przejęciu, `crypto.subtle.digest` dla gałęzi przed nim, z pułapką z „Critical Implementation Details"), punkt o szwie `23505` w `scripts/audit-state.sql`, a linia **Run** obejmuje `src/lib/audit/store.ts:1-243`. §6.6 — wpis „Phase 3 — Audit cost and durability" (`testing-audit-cost-durability`, data): brak defektu albo znaleziony defekt, co dostarczono według ryzyka, liczby Strykera z odsyłaczem do `mutation.md`, każda próba czerwona na zepsutym systemie, oraz **Open**: gałąź `getSession` (`audits.ts:133`, `:317-321`) z obserwacją dwóch nieobsłużonych odrzuceń przy `cookies.set`, które rzuca; klasyfikacja błędów dostawcy (`provider.ts:149-254`, 43 ocalałe i 10 bez pokrycia); G5 z powodem pominięcia. §8 — data zmiany §2, §6 i §7.

### Success Criteria:

#### Automated Verification:

- Przebieg Strykera kończy się bez błędu: `npx stryker run --mutate "src/pages/api/audits.ts,src/lib/audit/store.ts:1-243"`
- Raport nie pokazuje ocalałego ani niepokrytego mutanta w `audits.ts:250-253`, `:354-360`, `:91`, `:242` i `store.ts:67-72` bez wpisu w `mutation.md`
- `npm test` przechodzi
- `npm run lint` przechodzi (formatowanie Markdown włącznie, jeśli lint je obejmuje)
- `context/foundation/test-plan.md` nie zawiera już „a loop" w wierszu #2 ani „recoverable or" w wierszu #3

#### Manual Verification:

- Decyzje w `mutation.md` są do obrony: żaden mutant nie jest nazwany równoważnym bez wskazania, dlaczego zachowanie trasy jest to samo
- §2 i §7 planu testów czytają się zgodnie z decyzjami z 2026-10-12

**Implementation Note**: Po przejściu weryfikacji automatycznej zatrzymaj się na potwierdzenie człowieka. Wyjście ze zmiany (`/git-ship` albo `/git-land`) wybiera użytkownik.

---

## Testing Strategy

### Unit Tests:

- Brak nowych testów jednostkowych: luki leżą w kolejności trasy i w odpowiedzi bazy.

### Integration Tests:

- `tests/pages/api/audits.test.ts`: G1 (dwa przypadki i kontrola), G2, G4 (wiersze tabeli dla insertu i przejęcia), G6, G7 — sieć zaślepiona na krawędzi HTTP, konsola i `crypto.subtle.digest` jako krawędzie platformy.
- `scripts/audit-state.sql`: G3 w dwóch stanach wiersza, dla obu członków.

### Manual Testing Steps:

1. Przeczytać diff `tests/pages/api/audits.test.ts` pod kątem ręcznie wypisanych oczekiwań.
2. Przeczytać `mutation.md` i §2, §6.6, §7 planu testów.

## Performance Considerations

Zawężony przebieg Strykera trwa kilka minut lokalnie i nie wchodzi do CI ani do `npm test`.

## Migration Notes

Nie dotyczy: żadnych migracji ani zmian danych. Kopia skryptu z zepsutym kluczem biegnie w transakcji zakończonej `ROLLBACK` i tylko na lokalnej bazie.

## References

- Research: `context/changes/testing-audit-cost-durability/research.md`
- Książka kucharska płatnego wywołania: `context/foundation/test-plan.md` §6.4
- Test wzorcowy: `tests/pages/api/audits.test.ts:834-932`, `:1612-1635`, `:1059`
- Skrypt stanu audytu: `scripts/audit-state.sql:140-165`, `:273-323`
- Precedens zapisu mutantów: `context/archive/2026-10-01-testing-read-failure-states/mutation.md`
- Trasa: `src/pages/api/audits.ts:129-255`, `:296-379`; zapis: `src/lib/audit/store.ts:61-117`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Przypadki w teście trasy

#### Automated

- [x] 1.1 Test trasy przechodzi: `npm test -- tests/pages/api/audits.test.ts` — 8bef784
- [x] 1.2 Cały zestaw przechodzi bez nieobsłużonych błędów: `npm test` — 8bef784
- [x] 1.3 Lint przechodzi: `npm run lint` — 8bef784
- [x] 1.4 Typy przechodzą: `npx astro sync && npx astro check` — 8bef784
- [x] 1.5 Każdy nowy przypadek podaje liczbę wywołań dostawcy w nazwie i w asercji — 8bef784
- [x] 1.6 Brak nieplanowanych żądań i przeciekających szpiegów, także przy losowej kolejności — 8bef784

#### Manual

- [x] 1.7 Przegląd diffu: oczekiwania wypisane ręcznie, nie skopiowane z wyjścia kodu — 8bef784

### Phase 2: Szew `23505` w bazie

#### Automated

- [x] 2.1 Skrypty przechodzą na lokalnej bazie: `npm run test:db` — cdb5be3
- [x] 2.2 Sprawdzenie staje się czerwone na kopii skryptu z usuniętym kluczem, a `ROLLBACK` zostawia bazę bez zmian — cdb5be3
- [x] 2.3 Po tej próbie `npm run test:db` znów przechodzi — cdb5be3

#### Manual

- [x] 2.4 Nowe bloki stoją we właściwym stanie wiersza i nie zmieniają go dla sprawdzeń po nich — cdb5be3

### Phase 3: Stryker i plan testów

#### Automated

- [x] 3.1 Przebieg Strykera kończy się bez błędu — 3db2033
- [x] 3.2 Żaden mutant we wskazanych liniach nie zostaje bez zabicia lub wpisu w `mutation.md` — 3db2033
- [x] 3.3 `npm test` przechodzi — 3db2033
- [x] 3.4 `npm run lint` przechodzi — 3db2033
- [x] 3.5 Plan testów nie zawiera już „a loop" w wierszu #2 ani „recoverable or" w wierszu #3 — 3db2033

#### Manual

- [x] 3.6 Decyzje w `mutation.md` są do obrony — 3db2033
- [x] 3.7 §2 i §7 planu testów czytają się zgodnie z decyzjami z 2026-10-12 — 3db2033
