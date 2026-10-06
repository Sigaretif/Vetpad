<!-- PLAN-REVIEW-REPORT -->

# Plan Review: Ugruntowany audyt AI zapisanego ogłoszenia (S-04)

- **Plan**: context/changes/grounded-listing-audit/plan.md
- **Mode**: Deep
- **Date**: 2026-10-06
- **Verdict**: REVISE (po poprawkach z triage: SOUND)
- **Findings**: 1 critical, 5 warnings, 3 observations

## Verdicts

| Dimension             | Verdict |
| --------------------- | ------- |
| End-State Alignment   | PASS    |
| Lean Execution        | PASS    |
| Architectural Fitness | WARNING |
| Blind Spots           | WARNING |
| Plan Completeness     | FAIL    |

Werdykty opisują plan sprzed triage. Wszystkie dziewięć znalezisk zostało poprawionych w
planie, więc po triage plan jest SOUND.

## Grounding

Grounding: 22/22 paths ✓, 6/6 symbols ✓, brief↔plan ✓, Progress↔fazy ✓ (7 faz, 45 wierszy).

Weryfikacja w kodzie: jeden pod-agent sprawdził middleware, wzorce wyzwalaczy, smoke i CI,
promień zmian oraz twierdzenia o SDK Anthropic (Context7). Żadne żądanie nie trafiło do
dostawcy modelu. Dwie rzeczy pozostają niepotwierdzone do instalacji SDK i plan każe je
wtedy sprawdzić: czy `jsonSchemaOutputFormat` gubi `enum` oraz kiedy SDK czyta globalny
`fetch`.

## Findings

### F1 — Kroki smoke przeczą kolejności wyjść trasy, gdy nie ma klucza

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Faza 4 (§4 trasa, §7 smoke, kryterium 4.4), Faza 5 (§2, §6, kryterium 5.3)
- **Detail**: Trasa sprawdzała klucz dostawcy przed identyfikatorem i ofertą, a smoke
  oczekiwał `invalid_offer` i `offer_not_found` „bez klucza dostawcy w środowisku". Zadanie
  `smoke` w CI nie ma klucza (`.github/workflows/ci.yml:44-48`), więc trasa odpowiedziałaby
  tam `unconfigured_provider` na oba żądania, a lokalnie, z kluczem w `.dev.vars`, inaczej
  niż w CI. To samo w fazie 5: smoke oczekiwał `data-audit-state="none"`, a plan nie mówił,
  kiedy wygrywa `unavailable`. Krok RLS z fazy 1 zostawia też na ofercie-fixturze próbę
  `running`, a plan nie ustalał, na której fixturze sprawdza się kartę.
- **Fix**: Kolejność wyjść: sesja → Supabase → identyfikator → oferta → klucz dostawcy →
  kryteria → ustawienia → przejęcie. `data-audit-state` opisuje tylko dane audytu, a
  dostępność klucza idzie do osobnego `data-audit-available`. Smoke sprawdza kartę na
  fixturze, na której nie wstawia próby.
- **Decision**: FIXED

### F2 — Płatnych kroków fazy 4 nie ma czym uruchomić

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Completeness
- **Location**: Faza 4 — kryteria 4.6 i 4.7; budżet płatnych wywołań
- **Detail**: Kroki 4.6 i 4.7 to prawdziwe audyty „pod npm run preview", a budżet mówił, że
  płatny audyt uruchamia użytkownik „kliknięciem" i że agent nie wysyła żądania ani
  `curl`-em, ani skryptem. Przycisk (`AuditRunner`) i sekcja karty powstają dopiero w
  fazie 5, więc w fazie 4 nie było w co kliknąć.
- **Fix A ⭐ Recommended**: Faza 4 nazywa mechanizm: agent podaje fragment do konsoli
  DevTools, a użytkownik uruchamia go sam w zalogowanej karcie podglądu.
  - Strength: SDK w workerd i blokada współbieżności są dowiedzione przed budową widoku;
    dwa żądania są naprawdę równoczesne i idą ścieżką multipart ze sprawdzaniem Origin,
    której smoke nie ćwiczy (`scripts/smoke.mjs:150-169`).
  - Tradeoff: Jednorazowy fragment kodu wklejany ręcznie.
  - Confidence: HIGH — trasa przyjmuje zwykły POST formularza.
  - Blind spot: None significant.
- **Fix B**: Przenieść 4.6 i 4.7 do fazy 5 i połączyć płatny krok nr 1 z nr 3.
  - Strength: Jeden płatny audyt mniej (3 zamiast 4).
  - Tradeoff: Pierwsze prawdziwe wywołanie dostawcy pada po zbudowaniu całego widoku.
  - Confidence: MEDIUM — zależy od tego, czy SDK zadziała w workerd bez niespodzianek.
  - Blind spot: Sonnet nadal potrzebuje osobnego audytu.
- **Decision**: FIXED (Fix A) — nowy punkt 8 w fazie 4, reguła budżetu i kroki ręczne 1–2
  zaktualizowane; liczba płatnych audytów bez zmian (4 + 2 rezerwy).

### F3 — Ponowienie po zerwanym strumieniu może zapłacić za wynik, który już jest

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Faza 5 §3 (AuditRunner), tabela przejść w fazie 1, progi czasu
- **Detail**: Wyspa po zerwanym strumieniu i po 180 s od razu oferowała ponowienie. Worker
  po rozłączeniu pracuje jeszcze do 30 s (`waitUntil`) i może w tym czasie zapisać wynik, a
  przejęcie wiersza w stanie `completed` jest dozwolone od razu. Przykład: sieć zrywa się w 40. sekundzie, audyt zapisuje się w 60., członek klika ponowienie w 70. i kupuje drugi
  audyt, choć świeży wynik leży w bazie. To scenariusz ryzyka #3 z test-planu.
- **Fix**: Ponowienie z wyspy tylko po jawnej linii `failed`. Zerwany strumień i limit
  180 s przeładowują kartę na `#audyt`, a stan pokazuje serwer: wynik, „w toku" albo
  „przerwana" z przyciskiem.
  - Strength: Źródłem prawdy jest wiersz w bazie, tak jak dla drugiego oglądającego.
  - Tradeoff: Po zerwaniu w trakcie pracy członek widzi „w toku" z linkiem odświeżenia
    zamiast licznika na żywo.
  - Confidence: HIGH — stany `running` i `interrupted` plan już miał.
  - Blind spot: „Przerwana" liczy się zegarem Workera, a przejęcie zegarem bazy; przy
    175 s widok może zaproponować ponowienie, które dostanie `busy`.
- **Decision**: FIXED

### F4 — Wyspa zamieni awarię Auth na przejście do logowania

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architectural Fitness
- **Location**: Faza 5 §3 (AuditRunner), macierz stanów w §5
- **Detail**: „Odpowiedź przekierowana albo o innym typie treści prowadzi na
  `/auth/signin`". Przy awarii Auth middleware robi `next("/503")`
  (`src/middleware.ts:75-77`): `fetch` widzi 503, `text/html`, `redirected === false`.
  Wyjątek w trasie daje stronę 500, też HTML. Oba przypadki wyspa uznałaby za brak sesji,
  wbrew regule z `CLAUDE.md`, że awaria Auth nigdy nie staje się przekierowaniem na
  logowanie.
- **Fix**: Brak sesji to wyłącznie `response.redirected`. Status inny niż 200 albo inny typ
  treści bez przekierowania to komunikat w sekcji i link odświeżenia karty, bez nawigacji.
  Macierz stanów dostaje ten przypadek w wierszu `error`.
- **Decision**: FIXED

### F5 — Kontrakt dostawcy ma luki, których testy na zaślepce nie pokażą

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Faza 4 §2 (provider.ts), §6 (testy), „Klient SDK" w Critical Implementation Details
- **Detail**: Z dokumentacji SDK (Context7): `jsonSchemaOutputFormat` domyślnie
  przekształca schemat, a w odczytanym źródle `enum` nie jest wśród obsługiwanych słów
  (niepewne do instalacji); klasyfikacja błędów nie miała gałęzi domyślnej ani 402
  `billing_error`, 404, 413; błąd może przyjść w strumieniu po statusie 200;
  `APIConnectionTimeoutError` dziedziczy po `APIConnectionError`; konstruktor SDK sam sięga
  po `ANTHROPIC_API_KEY` ze środowiska; twierdzenie, że SDK czyta globalny `fetch` przy
  tworzeniu klienta, nie zostało potwierdzone.
- **Fix**: Test porównuje schemat w ciele zarejestrowanego żądania z `AUDIT_OUTPUT_SCHEMA`
  (albo `{ transform: false }`). Klasyfikacja dostaje 402 → `provider_credit`, gałąź
  domyślną → `provider_rejected` i przypadek błędu w strumieniu. Fabryka zwraca `null`
  przed konstruktorem i zawsze podaje `apiKey` jawnie.
- **Decision**: FIXED

### F6 — Pomiar CPU pada dopiero na produkcji, w ostatniej fazie

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Critical Implementation Details („CPU strumienia"), Faza 4 §5–§6, Faza 7 §4
- **Detail**: Plan pilnował parsowania częściowego JSON-u, a odczytane źródło SDK pokazuje,
  że `MessageStream` przy `text_delta` tylko skleja tekst. Zostaje inny koszt: jeden
  `JSON.parse` na każde zdarzenie strumienia, także dla myślenia, którego na
  `claude-opus-5-5` nie da się wyłączyć. Szacunek recenzenta, niezmierzony: około 10 µs na
  zdarzenie, czyli tysiąc zdarzeń to cały limit 10 ms. Przekroczenie wyszłoby dopiero jako
  `1102` w płatnym audycie nr 4.
- **Fix**: Trasa loguje liczbę zdarzeń strumienia (`stream_events`). Płatny audyt nr 1 daje
  tę liczbę w fazie 4, a agent odtwarza tyle zdarzeń z fixtury i mierzy czas w Node.
  Szacunek ponad 10 ms wraca do użytkownika jako decyzja z runbooka przed fazą 7.
- **Decision**: FIXED

### F7 — Granice ugruntowania zostawione kodowi

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Faza 3 §3 (prompt), §5 (grounding), §8 (testy); Desired End State
- **Detail**: `rejected` liczył każde odrzucenie (powtórzony atrybut, brak przy wypełnionej
  kolumnie, brak bez pytania), a karta miała go podpisać jako odrzucone za brak cytatu.
  Minimum 10 znaków cytatu nie było w instrukcji, która każe brać najkrótszy fragment
  niosący fakt. Czerwona flaga z `requirement_ref` wskazującym nieistniejące `Wn` była
  nierozstrzygnięta.
- **Fix**: `rejected` liczy wyłącznie znaleziska pozytywne odrzucone za cytat; pozostałe
  odrzucenia liczy `dropped`, który idzie do logu (`dropped_count`). Minimum trafia do
  reguły cytatu. Flaga ze złym `Wn` zostaje, jeśli cytat przechodzi, a znika samo
  odwołanie.
- **Decision**: FIXED

### F8 — Odcisk tekstu liczony z wejścia z polskimi etykietami

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Faza 3 §2 (`listingFingerprint`), Faza 6 §3 (notatka dla S-09)
- **Detail**: Odcisk był SHA-256 części wejścia opisującej ogłoszenie, a wejście niesie
  parametry pod etykietami z `src/lib/otodom/labels.ts`. Zmiana brzmienia etykiety albo
  układu `buildAuditInput` zmieniłaby odcisk każdej oferty, a S-09 oznaczyłby wszystkie
  audyty jako nieaktualne po zwykłym wdrożeniu. PRD (Open Questions 1) ostrzega, że
  fałszywa nieaktualność uczy zespół ignorować flagę.
- **Fix**: Odcisk z surowych wartości kolumn z białej listy, pod nazwami kolumn, w stałej
  kolejności, z prefiksem wersji `v1:`. Notatka dla S-09: odcisk w innej wersji to „nie
  wiadomo", nie „nieaktualny".
- **Decision**: FIXED

### F9 — Miejsca, których listy plików nie wymieniają

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Fazy 1, 4, 5, 6
- **Detail**: `tests/components/offers/offer-board-item.test.ts` renderuje `OfferBoardItem`
  i nie było go na liście. Sześć plików testów podmienia mock `astro:env/server` własną
  fabryką bez `ANTHROPIC_API_KEY`. `locals.cfContext` jest typowane jako zawsze obecne, a
  testy tras budują `locals: { user }`. `CLAUDE.md` nadal wymienia braki jako „(floor,
  heating, ownership form)". `VP001` to pierwszy własny SQLSTATE w migracjach. Dwie kolumny
  `on delete set null` w jednym wierszu to nowy wzorzec; sprawdzone lokalnie na tabelach
  tymczasowych, że Postgres wykonuje oba UPDATE bez błędu klucza obcego, ale gałąź
  usuniętego konta musi stać przed regułą „każda inna zmiana". Drugi baner może zmienić cel
  ujęcia `gate-focus-banner` (`scripts/ui-screenshots.mjs:38`).
- **Fix**: Dopisać te pliki i uwagi do właściwych faz.
- **Decision**: FIXED

## Triage Summary

- **Fixed**: F1, F2 (Fix A), F3, F4, F5, F6, F7, F8, F9 (9)
- **Skipped**: — (0)
- **Accepted**: — (0)
- **Dismissed**: — (0)
- **Verdict after fixes**: REVISE → SOUND

Sekcja `## Progress` planu nie została zmieniona: 45 wierszy, tytuły bez zmian.
