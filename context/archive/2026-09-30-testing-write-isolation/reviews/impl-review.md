<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Izolacja zapisów (test-plan Faza 2, ryzyko #5)

- **Plan**: context/changes/testing-write-isolation/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3, 4, 5, 6
- **Date**: 2026-10-01
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 3 warnings, 6 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Kryteria automatyczne, uruchomione 2026-10-01 na `073bd8a`: `npx astro sync && npm run lint` czysty; `npx astro check` 0 błędów; `npm test` 238/238; `npm run test:db` dwa razy pod rząd kod 0; `BASE_URL=http://localhost:4321 npm run smoke` na podglądzie produkcyjnym — 115 kroków PASS; po przebiegach 0 ofert, 0 notatek, 0 wymagań, 3 konta z seeda; `git diff --stat b33fd20..HEAD -- src supabase` pusty. CI: przebieg 36920290186 na `fb20ba9` zielony w obu jobach, z krokiem „Check account deletion against the local database”. Pozycje ręczne: wszystkie `[x]`; 2.5–2.9, 3.5–3.7 i 1.5 opisane w §6.6, 4.6 i 5.6 wykonane i zaobserwowane w sesji implementacji.

## Findings

### F1 — test-plan §6.6 i §4 opisują ryzyko CI, które jest już rozstrzygnięte

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/foundation/test-plan.md:584-587, :99
- **Detail**: §6.6 „Open” mówi, że job `smoke` nie biegł jeszcze w CI z nowym krokiem i że zapasowy `docker exec` nie jest podpięty; §4 mówi, że job „assumes the runner image ships `psql`”. Przebieg 36920290186 (`fb20ba9`) jest zielony z tym krokiem, a wiersz 5.7 jest `[x]`. Czytelnik może podpiąć zapasowy wariant bez potrzeby. W tej samej liście „Open” brakuje też pozycji: skrypt SQL nie asertuje `updated_at` osieroconej notatki, choć `offer_notes_before_update` celowo je zachowuje (`supabase/migrations/20260926202537_create_offer_notes.sql:74-77`).
- **Fix**: W §6.6 przenieść punkt o `psql` z „Open” do stanu faktycznego (runner ma `psql`, przebieg i data), poprawić zdanie w §4 i dopisać do „Open” niezaasertowane `updated_at` osieroconej notatki.
- **Decision**: FIXED — §6.6 i §4 zaktualizowane po zielonym CI (fb20ba9); do „Open” dopisane niezaasertowane `updated_at` osieroconej notatki

### F2 — Pętla kroków smoke pomija sprzątanie, gdy krok rzuci synchronicznie albo nie zwróci obietnicy

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: scripts/smoke.mjs:1215, :474
- **Detail**: `await run().catch(...)` zakłada, że każdy krok zwraca obietnicę. Krok zwracający zwykłą wartość albo rzucający synchronicznie daje `TypeError` poza `catch`, przerywa pętlę i pomija sprzątanie (oferty-fixtury i limity zostają). `restoreLimits()` zwraca zwykły obiekt, gdy `limitsBefore === null`; dziś ratuje to wyłącznie opakowanie w asynchroniczny `withSnapshot` (`:1129`). Linia pętli jest sprzed tej zmiany, ale zmiana dołożyła kroki i fixtury, które od niej zależą. Pokrewne: przy `runUnobserved` (`:455-459`) nieudany odczyt „przed” odrzuca wynik samego kroku, więc raport nie mówi, czy przywrócenie limitów się udało.
- **Fix**: Zamienić wywołanie na `await Promise.resolve().then(run).catch(...)`.
- **Decision**: FIXED — pętla woła krok przez `Promise.resolve().then(run).catch(...)`

### F3 — `member_requirements` nie ma kroku kontrolnego, którego wymaga §6.3

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: scripts/smoke.mjs:510, :751-776; context/foundation/test-plan.md:356-357
- **Detail**: §6.3 mówi: „When a new table gets its own observed read, give it a control step of its own.” `observedRequirements` jest własnym odczytem dla `member_requirements`, a oba kroki kontrolne są na `offer_notes`. `observedRequirements` czytający niepusty, ale niewłaściwy wiersz przeszedłby każdy krok „same” z Fazy 3; dowiodło tego tylko jednorazowe celowe psucie (3.5/3.6), nie każdy przebieg. Plan żądał kontroli wyłącznie dla notatek (Faza 1.3), więc to rozjazd dokumentu z kodem, nie planu z kodem.
- **Fix A ⭐ Recommended**: Dodać krok kontrolny dla wymagań: autor edytuje `body` własnych wymagań, obserwowane są te wymagania, oczekiwanie `snapshot: "changed"`.
  - Strength: Kod spełnia regułę, którą sam cookbook stawia S-09–S-11; wzorzec jest gotowy w `:751-776`.
  - Tradeoff: Jeden krok więcej i `revisionDelta: 1` do uwzględnienia; kontrola musi zmienić `body`, bo zapis tej samej treści nie rusza `updated_at` (`supabase/migrations/20260928074737_tighten_team_criteria_checks.sql:74-76`).
  - Confidence: HIGH — istniejący krok edycji wymagań przez trasę da się opakować.
  - Blind spot: Nie sprawdzono, czy któryś istniejący krok edycji już obserwuje własny wiersz i wystarczy zmienić mu oczekiwanie.
- **Fix B**: Zawęzić regułę w §6.3 do tabel, których odczyt nie ma jeszcze żadnego dowodu „changed”, i zapisać w §6.6, że wymagania dowiodło celowe psucie.
  - Strength: Zero zmian w kodzie.
  - Tradeoff: Reguła słabnie akurat przed slice'ami, które mają jej użyć.
  - Confidence: MEDIUM — uczciwe, ale zostawia lukę.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A — krok „control: requirements save edits them, bumps the revision and is reported as changed” (`snapshot: "changed"`); §6.3, nagłówek smoke i README go nazywają

### F4 — Dwa kroki odmowy biegną w odwrotnym kierunku niż kontrakt, a plan tego nie odnotowuje

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: scripts/smoke.mjs:812-816, :1057-1064
- **Detail**: Plan (2.1, 3.1): drugi członek atakuje wiersz pierwszego. Kod: `DELETE` bez `Prefer` i odmówiony `DELETE` wymagań wykonuje pierwszy członek na wierszu drugiego. Powód jest w komentarzach kodu i w §6.3 Pitfalls (każda odmowa ma własny wiersz do stracenia). Kierunek „drugi nie usuwa wymagań pierwszego” pokrywa szeroki `DELETE` (`:1047-1050`, `rows: 1`, wiersz pierwszego „same”), a dla notatek krok „another member cannot delete the note”. Intencja FR-012/FR-002 zachowana.
- **Fix**: Dopisać jedno zdanie do §6.6 (dostarczone odwrócone kierunki i dlaczego); planu nie zmieniać.
- **Decision**: FIXED — odwrócone kierunki opisane w §6.6; plan bez zmian

### F5 — Limity „sprzed przebiegu” są czytane po pierwszej próbie zapisu do `team_criteria`

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: scripts/smoke.mjs:590, :896
- **Detail**: „anon cannot change the team limits” wysyła `PATCH` z `city: "smoke: anon"` przed krokiem „team limits before the run are read”. W regresji, którą ten krok ma łapać, sprzątanie „przywróciłoby” zabrudzoną wartość do lokalnych limitów. Kolejność jest sprzed tej zmiany.
- **Fix**: Przenieść krok odczytu limitów przed pierwszą próbę zapisu do `team_criteria`.
- **Decision**: FIXED — „team limits before the run are read” przeniesiony przed „anon cannot change the team limits”

### F6 — Strażnik „tylko lokalna baza” w `test:db` jest słabszy, niż mówią nagłówek skryptu i dokumentacja

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: package.json:12; scripts/account-deletion.sql:11, :18-27
- **Detail**: Jedynym strażnikiem jest obecność kont z seeda, nie adres hosta; `DB_URL` to ogólna nazwa zmiennej, więc eksport z innego projektu przekieruje skrypt po cichu. Nagłówek („refuses a database that is not the local one”) i README to zawyżają. Skutek ogranicza `ROLLBACK` — nie znaleziono ścieżki, na której skrypt zatwierdza cokolwiek. Dodatkowo `${DB_URL:-…}` działa tylko w powłoce POSIX.
- **Fix A ⭐ Recommended**: Przeredagować nagłówek skryptu, README i §6.3 tak, by mówiły prawdę: skrypt odmawia bazy bez kont z seeda, a przed skutkami chroni `ROLLBACK`.
  - Strength: Dokumentacja zgodna z kodem, bez nowej logiki.
  - Tradeoff: Strażnik zostaje taki, jaki jest.
  - Confidence: HIGH — ryzyko realne jest małe (brak zatwierdzenia).
  - Blind spot: None significant.
- **Fix B**: Dodać sprawdzenie hosta w skrypcie npm (odmowa adresu innego niż `localhost`/`127.0.0.1` bez jawnego przełącznika), na wzór smoke.
  - Strength: Strażnik równy temu w `scripts/smoke.mjs`.
  - Tradeoff: Logika w jednolinijkowym skrypcie npm albo dodatkowy plik; sprawdzenie w SQL (`inet_server_addr()`) nie zadziała za mapowaniem portu Dockera.
  - Confidence: MEDIUM — wymaga ustalenia, gdzie ta logika ma żyć.
  - Blind spot: Zachowanie w CI, gdzie `DB_URL` pochodzi z `supabase status`.
- **Decision**: FIXED via Fix A — nagłówek skryptu, README i §6.3 mówią: sprawdzenie dotyczy seeda, nie hosta; chroni `ROLLBACK`

### F7 — Trzy sprawdzenia nie mogą zawieść, a jedna asercja ma wyrocznię w implementacji

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: scripts/account-deletion.sql:210-212; scripts/smoke.mjs:866-870; tests/pages/api/criteria.test.ts:143-149
- **Detail**: (a) `member_requirements where author_id is null` — `author_id` jest kluczem głównym, więc sprawdzenie jest martwe. (b) Krok „note keeps its offer, author, id and database-set dates” opakowuje czysty odczyt w `withSnapshot`; połowa „same” nie może zawieść (plan o to prosił). (c) Po `toEqual` z czterema kluczami asercje `Object.keys`, pętla `forbidden` i `not.toContain(USER_ID)` są redundantne; sama asercja wartości (`"800 000"` → `800000`, `"45,5"` → `45.5`) testuje `parseLimitsForm`, poza #5, bez nazwanej wyroczni.
- **Fix**: Usunąć martwe sprawdzenie w SQL albo opisać je jako strażnika przyszłej zmiany schematu; resztę zostawić — nieszkodliwa redundancja.
- **Decision**: FIXED — martwe sprawdzenie `author_id is null` usunięte z `scripts/account-deletion.sql`; pozostałe dwa punkty zostawione zgodnie z poprawką

### F8 — Dokumentacja mówi „every write”, a `CLAUDE.md` niesie liczbę

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: CLAUDE.md:110; README.md:187; context/foundation/test-plan.md:325
- **Detail**: „judges every write … by whole rows” i „every write step sends `prefer: "return=representation"` and asserts `rows`” — kroki tworzące fixtury, `saveOtherRequirements`, usunięcie drugiej oferty i sprzątanie nie są opakowane w `withSnapshot`, a sfałszowane inserty i insert anonima są oceniane po `42501` bez `return=representation`. `CLAUDE.md:110` mówi „its two control steps”, wbrew własnej konwencji pliku („never a count”) i kontraktowi Fazy 6 („bez liczb”).
- **Fix**: Zawęzić sformułowania do „każda próba zapisu na cudzym wierszu” i zamienić „its two control steps” na „its control steps”.
- **Decision**: FIXED — sformułowania zawężone w `CLAUDE.md`, `README.md` i §6.3; „its control steps” bez liczby

### F9 — Zmiany spoza planu w zakresie: aktualizacja toolkitu, §2 test-planu, dodatkowe reguły w `CLAUDE.md`

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: commit 97ff2fa (.claude/, CLAUDE.md, context/foundation/test-plan.md §2); CLAUDE.md:9, :111, :112
- **Detail**: Commit Fazy 1 niesie niezwiązaną aktualizację toolkitu (`.claude/skills/10x-tdd/`, `.claude/prompts/`, manifest, sekcja „Module 3, Lesson 2” w `CLAUDE.md`) oraz przeredagowane wiersze #5 w §2 test-planu, których kontrakt Fazy 6 nie wymienia (§8 to odnotowuje). Faza 6 dodała do `CLAUDE.md` trzy reguły ponad kontrakt: `test:db` w zdaniu o zerowej konfiguracji, „nowa kolumna wskazująca `auth.users` dostaje przypadek w skrypcie SQL” i odsyłacz do §6.3. Wszystkie zgodne z kodem i zgłoszone użytkownikowi przy bramce Fazy 6. Commity są już na `origin/master`; historii się nie przepisuje.
- **Fix**: Przyjąć do wiadomości; brak zmiany w kodzie.
- **Decision**: ACCEPTED — użytkownik przyjął zbundlowany toolkit, zmiany §2 i dodatkowe reguły `CLAUDE.md`; historia bez zmian

## Triage

Zamknięte 2026-10-01. Po poprawkach: `npm run lint` czysty, `npm test` 238/238, `npm run test:db` kod 0, smoke na podglądzie produkcyjnym 115 kroków PASS, w lokalnej bazie nie zostaje żadna fixtura.
