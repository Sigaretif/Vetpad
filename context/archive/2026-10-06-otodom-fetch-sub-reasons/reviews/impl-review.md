<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Pod-powody na granicy pobrania z otodom

- **Plan**: context/changes/otodom-fetch-sub-reasons/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3, 4
- **Date**: 2026-10-06
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 2 warnings, 8 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | WARNING |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

Kryteria automatyczne wszystkich faz uruchomione ponownie w przeglądzie: testy 12/12, 68/68, 59/59, cały zestaw 690/690, `npx astro sync && npx astro check` 0 błędów, `npm run lint` czysty, `npm run build` przechodzi, `fetch.ts` ma jeden `import type`, `node scripts/otodom-inspect.mjs --help` kończy się kodem 0, runbook nazywa nowe powody (11 trafień). Kroki ręczne (2.8, 3.6, 3.7, 4.5–4.7) wykonał agent na polecenie użytkownika; każdy ma ślad w sesji implementacji (dowód wycieku, przebieg Strykera, dwa uruchomienia `otodom:inspect`).

## Findings

### F1 — `landed_path` niesie słowa sluga dla lądowań „prawie na ofercie"

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/lib/otodom/fetch.ts:79, src/lib/otodom/fetch.ts:83
- **Detail**: Slug jest pomijany tylko wtedy, gdy host jest w `OTODOM_HOSTS` i ścieżka pasuje do `OFFER_PATH`. Każda inna gałąź loguje całe `pathname`. Odtworzone: `https://www.otodom.pl/pl/oferta/<slug>-IDKANAR1/galeria` → `unexpected_landing` z pełnym slugiem w `landedPath`; `https://m.otodom.pl/pl/oferta/<slug>-ID…` → `http_denied` z pełnym slugiem; host z kropką na końcu (`www.otodom.pl.`) i `/en/ad/<slug>` tak samo. Slug powtarza tytuł pisany przez ogłoszeniodawcę. To przeczy opisowi `FetchEvidence` w `src/lib/otodom/types.ts:24-25` i zdaniu runbooka „`landed_path` is never logged for an offer page". `tests/lib/otodom/fetch.test.ts:253,256` utrwalają to zachowanie jako poprawne, a tabela nieobecności w `tests/pages/api/offers.test.ts` nie ma scenariusza `unexpected_landing` — `/oferta/` z listy `COMMON` by go zczerwieniło.
- **Fix A ⭐ Recommended**: Dla każdego lądowania, którego ścieżka zawiera segment `oferta`, albo którego host kończy się na `otodom.pl`, logować ścieżkę uciętą przed slugiem (np. `/pl/oferta/…`) i token `ID…` jako `landed_listing`; przepisać dwa wiersze testu i dodać scenariusz `unexpected_landing` do tabeli nieobecności.
  - Strength: Domyka jedyną dziurę w obietnicy, którą typ, runbook i test prywatności stawiają jako bezwzględną; wpis nadal mówi, gdzie wylądowało żądanie.
  - Tradeoff: Wpis traci dokładną ścieżkę pod-strony oferty (np. `/galeria`), chyba że zostawimy segmenty po slugu.
  - Confidence: HIGH — zachowanie odtworzone offline, a lista `COMMON` już zawiera `/oferta/`.
  - Blind spot: Nikt nie widział, dokąd otodom faktycznie przekierowuje; prawdopodobieństwo takich lądowań jest nieznane.
- **Fix B**: Zostawić kod, poprawić opis w `types.ts` i runbooku na zgodny z prawdą i zapisać to jako świadomie przyjęte ryzyko.
  - Strength: Zero zmian w kodzie; pełna ścieżka nieznanego lądowania zostaje w logu do diagnozy.
  - Tradeoff: Słowa tytułu (potencjalnie nazwisko lub telefon) mogą trafić do Workers Logs.
  - Confidence: MEDIUM — zgodne z duchem ryzyka zapisanego w plan-brief dla lądowań poza otodom, ale nie dla ścieżek na otodom.
  - Blind spot: CLAUDE.md zakazuje danych ogłoszeniodawcy w logu bez wyjątków.
- **Decision**: FIXED — Fix A. `withoutSlugs` w `src/lib/otodom/fetch.ts` zastępuje przez `<slug>` każdy segment stojący po `oferta`, kończący się tokenem `ID…` albo zawierający `oferta`, na każdym hoście; token trafia do `landed_listing`. Dziewięć przypadków w `tests/lib/otodom/fetch.test.ts`, dwa scenariusze w tabeli nieobecności.

### F2 — Dokumenty mówią więcej, niż kod robi

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/foundation/deployment-runbook.md:206-216, context/foundation/ingestion/otodom_fetching.md:670, context/foundation/test-plan.md (§6.9)
- **Detail**: (a) Runbook: „`landed_path` is never logged for an offer page" jest prawdą tylko dla dokładnego kształtu `OFFER_PATH` (F1). (b) Runbook: wpisy „from `phase: "body"` down" mają nieść `landed_listing` — brak go, gdy slug nie ma tokenu; a wpisy powyżej (`challenged`, 404, 5xx, `http_denied` ze statusem) też niosą pola lądowania, o czym runbook milczy. (c) Runbook: `expired` stoi na końcu „kolejności sprawdzeń", w kodzie jest przed `ad_missing` (`fetch.ts:166-173`). (d) Runbook: próg „over 500,000 bytes" — `body_length` to `html.length` (jednostki UTF-16, nie bajty), a pomiar strony oferty jest jeden. (e) `otodom_fetching.md` §11 każe przy braku znacznika logować nagłówek `cf-mitigated`, którego wpis `data_missing` nigdy nie ma. (f) `test-plan.md` §6.9: zdanie o scenariuszu lądowania i liście `COMMON` jest zbyt ogólne — scenariusz lądowania poza otodom trzyma się listy `STRICT`.
- **Fix**: Poprawić sześć zdań tak, by opisywały kod (po rozstrzygnięciu F1 punkt (a) pisze się sam).
- **Decision**: FIXED — runbook opisuje pola lądowania i regułę `<slug>` po F1, `expired` stoi przed `ad_missing`, próg 500 000 ma dopisek o znakach (pomiary stron ofert są dwa: §9.1 i §13, więc „jeden pomiar” z ustalenia był nietrafny); `otodom_fetching.md` §11 nie wymienia już `cf-mitigated`, §7.1 mówi o ścieżce bez sluga; `test-plan.md` §6.9 rozróżnia lądowanie na portalu, poza nim i pod ścieżką oferty.

### F3 — 404 i 5xx obcego hosta są przypisywane otodom

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/lib/otodom/fetch.ts:129-137
- **Detail**: Status jest sprawdzany przed lądowaniem — tak stanowi też tabela kontraktu w planie. 404 pod `https://consent.example/zgoda` daje `not_found` na poziomie `info`, a członek czyta „Ogłoszenie nie istnieje lub wygasło"; 503 daje „otodom.pl jest chwilowo niedostępny". `landed_host` jest we wpisie, więc da się to rozpoznać, ale przypadek 404 nigdy nie trafia na `error`. Kolejność jest sprzed tej zmiany; nowe pola tylko ją uwidoczniły.
- **Fix**: Przenieść sprawdzenie `off_otodom` nad sprawdzenia statusu (po `cf-mitigated`), z wierszem testu i poprawką tabeli w planie, runbooku i §7.1.
  - Strength: Lądowanie poza otodom zawsze jest `http_denied` na `error`, niezależnie od statusu obcej strony.
  - Tradeoff: Zmienia kolejność z zatwierdzonego kontraktu powodów.
  - Confidence: MEDIUM — logika prosta, ale to zmiana decyzji planu.
  - Blind spot: Nie wiadomo, czy otodom kiedykolwiek przekierowuje poza swoją domenę.
- **Decision**: FIXED — sprawdzenie `off_otodom` stoi w `fetchOfferAd` zaraz po `cf-mitigated`, przed statusami: 404, 410 i 503 obcego hosta to `http_denied` na `error`. Cztery przypadki w `tests/lib/otodom/fetch.test.ts`; runbook i `otodom_fetching.md` §7.1 mają nową kolejność. To świadome odejście od kolejności z tabeli kontraktu w planie (wiersz „Lądowanie poza otodom” stoi teraz nad statusami). Zdanie dla członka nadal mówi „otodom.pl odmówił… (HTTP n)” ze statusem obcego hosta.

### F4 — Lądowanie poza otodom loguje obcą ścieżkę w całości

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/otodom/fetch.ts:79
- **Detail**: `https://consent.example/r/https%3A%2F%2Fwww.otodom.pl%2Fpl%2Foferta%2F<slug>` daje `landedPath` z całym adresem oferty. Odcinane są tylko query i fragment. Plan-brief zapisał to jako znane ryzyko („Open Risks"); wyzwalacz jest hipotetyczny, ścieżka w kodzie prawdziwa. Test prywatności obejmuje tylko echo w query.
- **Fix**: Dla `off_otodom` logować host i pierwszy segment ścieżki; dodać scenariusz echa w ścieżce do tabeli nieobecności. Naturalnie łączy się z Fix A z F1.
- **Decision**: SKIPPED — po F1 echo adresu oferty w obcej ścieżce daje `/r/<slug>`; pełna obca ścieżka zostaje do diagnozy.

### F5 — Przekierowanie na inną ofertę jest zapisywane pod wklejonym adresem

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/lib/otodom/fetch.ts:80-82, src/lib/otodom/fetch.ts:170
- **Detail**: Lądowanie na `/pl/oferta/inne-mieszkanie-IDOTHER9` z poprawnym payloadem zwraca `{ ok: true, ad }`. Zmiana liczy teraz `landedListing`, ale nie porównuje go z tokenem z żądania. Zachowanie sprzed tej zmiany i poza jej zakresem; test „follows a redirect to the same offer under a changed slug" przeszedłby także dla innego ID.
- **Fix**: Zgłosić jako osobną zmianę (`/10x-new`): niezgodność tokenu jako `unexpected_landing`.
  - Strength: Nie rozszerza tej zmiany o decyzję produktową.
  - Tradeoff: Luka zostaje do następnej zmiany.
  - Confidence: MEDIUM — nie wiadomo, czy otodom zmienia token przy przekierowaniu tej samej oferty.
  - Blind spot: Brak obserwacji z żywego portalu.
- **Decision**: FIXED — w tej zmianie, na decyzję użytkownika: `fetchOfferAd` porównuje token z żądania z tokenem lądowania i przy różnicy zwraca `unexpected_landing` przed czytaniem treści; gdy któregoś tokenu brak, strona jest czytana. Testy w `tests/lib/otodom/fetch.test.ts` i wiersz `REFUSALS` „a redirect to another offer” (nic nie jest zapisywane); runbook i `otodom_fetching.md` §7.1 opisują wpis. Nadal nie wiadomo, czy otodom zmienia token tej samej oferty przy przekierowaniu — taki przypadek dałby teraz `unexpected_landing` z oboma tokenami we wpisie.

### F6 — `QUOTED_URL` nie łapie adresu z wielkimi literami w schemacie ani bez schematu

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/otodom/fetch.ts:24
- **Detail**: `HTTPS://www.otodom.pl/pl/oferta/…`, `www.otodom.pl/pl/oferta/…` i sama ścieżka `/pl/oferta/…?utm=…` przechodzą do `error_message` bez zmian. Plan wybrał ten wzorzec i zapisał ograniczenie w plan-brief; nie jest znany komunikat undici ani workerd o takim kształcie.
- **Fix**: Dodać flagę `i` i zastępować też `\S*/oferta/\S+`, z dwoma przypadkami testowymi.
- **Decision**: FIXED — `QUOTED_URL` ma flagę `i`, a `QUOTED_OFFER` zastępuje adres oferty bez schematu i samą ścieżkę `/oferta/…`; cztery przypadki testowe.

### F7 — `error_cause` gubi kod błędu i bywa samą nazwą

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/otodom/fetch.ts:48-53
- **Detail**: `AggregateError` z pustym komunikatem daje `errorCause: "AggregateError: "`. `cause.code` (`ECONNREFUSED`, `UND_ERR_CONNECT_TIMEOUT`) nie jest czytany, a to zwykle najbardziej użyteczna część przyczyny. Format `errorCause` nie był ustalony w planie.
- **Fix**: Dołączać `code`, gdy jest krótkim tekstem; pomijać przyczynę z pustym komunikatem i bez kodu.
- **Decision**: FIXED — `describeCause` zwraca `name code: message` z częściami, które przyczyna ma; kod musi pasować do `ERROR_CODE`, a przyczyna bez kodu i bez komunikatu jest pomijana. Test „leaves out a cause that says nothing in words” zastąpiony, bo zmienił się wymóg: przyczyna z samym kodem jest teraz logowana.

### F8 — Cztery wiersze kontraktu bez porównania całego wpisu w teście trasy

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: tests/pages/api/offers.test.ts (tabela `REFUSALS`)
- **Detail**: „Desired End State" mówi o całym wpisie dla każdego wiersza tabeli. W teście trasy brakuje: `shape_changed`/`page_props_missing`, `shape_changed`/`ad_missing`, `network` z `phase: "body"` i statusu 410. Lista „Test contract" fazy 3 ich nie wymaga, a `fetch.test.ts` pokrywa wszystkie cztery na poziomie modułu; trasa przepuszcza `detail` i `evidence` generycznie.
- **Fix**: Dopisać cztery wiersze do `REFUSALS`.
- **Decision**: FIXED — cztery wiersze w `REFUSALS`: `page_props_missing`, `ad_missing`, `network` z `phase: "body"` i HTTP 410, każdy z całym wpisem.

### F9 — `NEXT_DATA` jest kwadratowy na wrogiej treści

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/otodom/fetch.ts:12
- **Detail**: Treść złożona z powtórzeń `id="__NEXT_DATA__">` bez `</script>` zajęła 329 ms przy 380 KB i 5,3 s przy 1,5 MB (zwykła strona 1 MB: 3 ms). Wzorzec jest sprzed tej zmiany; treść czytana jest tylko po lądowaniu na `otodom.pl`, więc taką stronę musiałby podać portal albo jego CDN. Istotne przez limit CPU na Workers.
- **Fix**: Zastąpić wzorzec dwoma `indexOf` (znacznik, potem `</script>`) — liniowo; albo zgłosić jako osobną zmianę.
- **Decision**: SKIPPED — wzorzec sprzed tej zmiany; wyzwalacz wymaga wrogiej strony podanej przez sam portal.

### F10 — Drobne niespójności wzorca

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/api/offers.ts:5, tests/lib/log.test.ts:80, src/lib/otodom/fetch.ts:40-42, src/lib/otodom/fetch.ts:158
- **Detail**: (a) Trasa importuje `FetchEvidence` z `@/lib/otodom/types`, podczas gdy reszta idzie przez barrel `@/lib/otodom`. (b) Test reportera używa ścieżki oferty jako `landed_path` razem z `landed_listing` — kombinacji, której kontrakt zabrania. (c) `stated()` zwraca `T`, choć usuwa klucze — uczciwa sygnatura to `Partial<T>`. (d) `catch` przy `JSON.parse` słusznie porzuca błąd (komunikat V8 cytuje fragment wejścia, czyli tekst ogłoszenia), ale nie mówi dlaczego — ktoś może go „naprawić" pod regułą „never hide the evidence".
- **Fix**: Reeksport `FetchEvidence` z `index.ts`, ścieżka wyników w fixturze reportera, `Partial<T>`, jednozdaniowy komentarz przy `catch`.
- **Decision**: FIXED — `FetchEvidence` reeksportowany z `src/lib/otodom/index.ts` i importowany w trasie z barrela; fixture reportera używa `/pl/oferta/<slug>/galeria`; `stated()` zwraca `Partial<T>`; komentarz przy `catch` wokół `JSON.parse` mówi, dlaczego błąd jest pomijany.
