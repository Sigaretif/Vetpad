<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Awaria Supabase Auth odróżniona od braku sesji

- **Plan**: context/changes/auth-outage-not-signed-out/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3, 4
- **Date**: 2026-10-06
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 3 warnings, 5 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | WARNING |

Kryteria automatyczne powtórzone na `b026dc0`: `npm test` (626 testów), `npm run lint`,
`npx astro sync && npx astro check`, `npm run build` — przechodzą. `npm run smoke`, próba wyjątku
(4.2) i przebieg Strykera były wykonane w sesji implementacji na tym samym kodzie i nie zostały
powtórzone w przeglądzie.

## Findings

### F1 — Awaria przy wygasłym tokenie dostępu nadal wylogowuje członka

- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Safety & Quality
- **Location**: src/middleware.ts:37-64, src/components/ErrorPage.astro:24
- **Detail**: Plan obiecuje „ciasteczko zostaje”, a strona 503 mówi „To nie jest wylogowanie”. To
  prawda tylko przy niewygasłym tokenie dostępu albo gdy odświeżenie kończy się błędem
  ponawialnym (sieć, 500–504, 520–530). Przy wygasłym tokenie `getUser()` najpierw odświeża; w
  `_callRefreshToken` auth-js każdy nieponawialny `AuthError` woła `_removeSession()`, a
  `@supabase/ssr` zapisuje wtedy ciasteczko z `maxAge: 0`. Astro dołącza ciasteczka do odpowiedzi
  także po `next("/503")`. Trzy klasy, które `classifyAuthError` nazywa `unavailable`, idą tą
  drogą: 429 na `/token`, 540 z treścią HTML (uśpiony projekt) i 540 z JSON. Sonda subagenta
  przeglądu z wygasłym ciasteczkiem pokazała dla wszystkich trzech
  `cookies.set("sb-supabase-auth-token", "", maxAge 0)`. Czyli w scenariuszu z runbooka (uśpiony
  projekt) członek po godzinie bezczynności dostaje stronę 503 razem z usunięciem sesji. Testy
  tego nie widzą: #8 sprawdza brak zapisu ciasteczka tylko dla niewygasłego tokenu, #10 i #11
  używają niewygasłego tokenu i nie sprawdzają `cookiesSet`. Ustalenie pochodzi z lektury
  biblioteki i sondy, nie z działającego Workera.
- **Fix A ⭐ Recommended**: Czerwony test (`expired: true` + 429 i 540 na `/auth/v1/token`,
  asercja braku zapisu ciasteczka), potem middleware odkłada zapisy ciasteczek klienta i porzuca
  je, gdy wynik to `unavailable`.
  - Strength: Spełnia obietnicę planu i tekstu strony; zmiana zostaje w middleware i `createClient`.
  - Tradeoff: Dotyka `src/lib/supabase.ts`, którego plan nie ruszał; odłożone zapisy muszą nadal
    trafiać do odpowiedzi przy udanym odświeżeniu.
  - Confidence: MEDIUM — mechanizm potwierdzony sondą, sposób buforowania `setAll` jeszcze nie.
  - Blind spot: Klient auth-js po `_removeSession()` uważa sesję za usuniętą w pamięci; trzeba
    sprawdzić, że kolejne żądanie z zachowanym ciasteczkiem odświeża poprawnie.
- **Fix B**: Zostawić zachowanie, poprawić obietnicę: tekst strony 503, plan i runbook mówią, że
  sesja przetrwa awarię tylko wtedy, gdy token dostępu jest jeszcze ważny.
  - Strength: Bez zmian w kodzie produkcyjnym; dokumentacja przestaje obiecywać za dużo.
  - Tradeoff: Główny cel zmiany (awaria to nie wylogowanie) pozostaje niespełniony dla członka,
    który wraca po przerwie — czyli w typowym przypadku.
  - Confidence: HIGH — to tylko tekst.
  - Blind spot: None significant.
- **Decision**: FIXED — Fix A: middleware wstrzymuje zapisy ciasteczek klienta i porzuca je przy awarii (`CookieSink` w `src/lib/supabase.ts`); czerwone testy dla 429 i 540 przy wygasłym tokenie oraz test strażniczy udanego odświeżenia. Nie odegrane na działającym serwerze.

### F2 — `retryHref` może zwrócić link wychodzący poza aplikację

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/error-pages.ts:9-16
- **Detail**: Komentarz funkcji obiecuje, że link nigdy nie opuszcza aplikacji, ale strażniki
  obejmują tylko `//` i ukośnik wsteczny. `Astro.originPathname` jest zdekodowaną ścieżką, a
  `decodeURI` zamienia `%09`, `%0A`, `%0D` na surowy tabulator, LF i CR. Żądanie
  `/%09/evil.example` daje `"/\t/evil.example/"`, które przechodzi wszystkie warunki; przeglądarki
  usuwają te znaki z adresu, więc `new URL("/\t/evil.example/", base).href` to
  `https://evil.example/` (potwierdzone w node). Warunki ataku są wąskie: ofiara ma ciasteczko
  sesji, Auth jest w tej chwili niedostępny, ofiara otwiera link atakującego i klika „Spróbuj
  ponownie”. XSS nie ma: wartość zawsze zaczyna się od `/`, a cudzysłowy są escapowane.
- **Fix**: Zwracać `/`, gdy ścieżka zawiera znak sterujący (`/[\u0000-\u001f\u007f]/`); najpierw
  czerwone przypadki `"/\t/evil.example"`, `"/\n/evil.example"`, `"/\r/evil.example"` w
  `tests/lib/error-pages.test.ts`, obok ścieżki, która przechodzi.
- **Decision**: FIXED — strażnik znaków sterujących w `retryHref`; pięć czerwonych przypadków w `tests/lib/error-pages.test.ts`.

### F3 — Sprawdzian nieobecności wartości ciasteczka porównuje nie to ciasteczko, które wysłano

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: tests/middleware.test.ts:710
- **Detail**: Zakazana wartość jest liczona w chwili asercji przez `sessionCookieValue()`, którego
  `expires_at` pochodzi z `Date.now()` w sekundach, a wysłane ciasteczko powstało wcześniej, przy
  budowie tablicy `SCENARIOS`. Gdy między nimi minie granica sekundy, ciągi się różnią i dokładne
  porównanie niczego nie sprawdza. Wyciek całej wartości nadal łapią literały `"base64-"` i
  `"sb-supabase-auth-token"` z listy `FORBIDDEN`.
- **Fix**: Brać zakazaną wartość z `scenario.cookie` (po odcięciu prefiksu nazwy), zamiast liczyć
  ją na nowo.
- **Decision**: FIXED — zakazana wartość pochodzi z `scenario.cookie`.

### F4 — Prawdziwe przepisanie żądania nie ma automatycznego pokrycia

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Success Criteria
- **Location**: tests/middleware.test.ts:110-152, scripts/smoke.mjs:628
- **Detail**: Testy middleware używają ręcznie zbudowanego kontekstu, więc `next("/503")` jest
  sprawdzane tylko jako argument wywołania; smoke odwiedza `/503` bezpośrednio. Nic
  automatycznego nie pokrywa statusu przepisanej odpowiedzi, POST-a z treścią, wartości
  `Astro.originPathname` po przepisaniu ani ciasteczek na przepisanej odpowiedzi. F1 i F2 leżą
  właśnie w tej luce, podobnie jak ukośnik na końcu `originPathname` znaleziony dopiero ręcznie w
  fazie 2. Jedynym pokryciem jest próba awarii z zatrzymanym kontenerem Auth.
- **Fix A ⭐ Recommended**: Zapisać w `context/foundation/test-plan.md` §6.10, że przepisanie
  pokrywa wyłącznie ręczna próba awarii, i dodać tę próbę jako powtarzalny skrypt do osobnej
  zmiany.
  - Strength: Uczciwy opis stanu bez rozszerzania tej zmiany; smoke nie umie zatrzymać Auth.
  - Tradeoff: Luka zostaje do następnej zmiany.
  - Confidence: HIGH — zgodne z tym, jak plan dzieli pokrycie.
  - Blind spot: None significant.
- **Fix B**: Test na zbudowanym podglądzie z serwerem-atrapą Auth (Playwright nie przechwyci
  ruchu, który serwer sam wysyła do Auth, więc atrapa musi być osobnym procesem).
  - Strength: Pokrywa przepisanie, POST i ciasteczka w jednym miejscu.
  - Tradeoff: Nowa infrastruktura testowa (atrapa Auth), wyraźnie poza zakresem planu.
  - Confidence: LOW — nie sprawdzono, czy konfiguracja E2E dopuszcza inny `SUPABASE_URL`.
  - Blind spot: `playwright.config.ts` odrzuca nielokalny `SUPABASE_URL`.
- **Decision**: FIXED — Fix A: `context/foundation/test-plan.md` §6.10 mówi, czego nie pokrywa nic automatycznego; powtarzalny skrypt w `follow-ups/review-fixes.md`.

### F5 — Kroki ręczne zamknięte na dowodach z `curl`, nie w przeglądarce

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: context/changes/auth-outage-not-signed-out/plan.md (Progress 2.7–2.8, 3.7, 4.8–4.11)
- **Detail**: Wiersze ręczne są odhaczone za zgodą użytkownika na podstawie zrzutów, przebiegu
  smoke na serwerze dev i próby awarii przez `curl`. Nikt nie kliknął „Spróbuj ponownie” ani nie
  wysłał formularza oferty w przeglądarce przy zatrzymanym Auth. Próba 4.8 używała świeżo
  zalogowanej sesji, czyli niewygasłego tokenu — dlatego nie pokazała F1. Pierwsze żądanie po
  zatrzymaniu kontenera czekało 60 s na lokalną bramkę.
- **Fix**: Jedno przejście w przeglądarce po rozstrzygnięciu F1: awaria z wygasłym tokenem i
  kliknięcie linku po wznowieniu Auth.
- **Decision**: FIXED — kroki 4.8–4.9 odegrane ponownie w prawdziwej przeglądarce (Chromium przez
  Playwright) na podglądzie produkcyjnym, po poprawkach z triage: strona 503 na `/dashboard`,
  formularz logowania, wysłanie formularza oferty, zachowane ciasteczko, „Spróbuj ponownie” po
  wznowieniu Auth. Awaria z wygasłym tokenem (F1) pozostaje pokryta tylko testami z odegranym Auth.

### F6 — Wylogowanie jest osiągalne podczas awarii, ale nic nie robi

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/auth/signout.ts (bez zmian), src/middleware.ts:12-14
- **Detail**: `isAuthPath` zostawia `/api/auth/signout` osiągalne, ale `_signOut` w auth-js przy
  błędzie innym niż 401/403/404 wraca bez `_removeSession()`. Trasa ignoruje wynik i przekierowuje
  na `/`, gdzie middleware odpowiada 503. Członek pozostaje zalogowany, a nieudane wylogowanie nie
  zostawia wpisu. Trasa istniała przed zmianą i plan wyłącza logowanie w pozostałych trasach (P3,
  P6–P8).
- **Fix**: Dopisać do następnej zmiany (pozostałe trasy): `signout.ts` loguje nieudane wylogowanie.
- **Decision**: DEFERRED — dopisane do `follow-ups/review-fixes.md`; kod bez zmian.

### F7 — Dziennik mutantów błędnie cytuje zakres błędów ponawialnych

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/changes/auth-outage-not-signed-out/mutation.md:67
- **Detail**: Powód decyzji „świadomie pominięty” mówi, że błąd ponawialny ma status „`0` albo
  502–504 i 520–530”. `NETWORK_ERROR_CODES` w auth-js zaczyna się od 500, co zgodnie podają
  `src/lib/auth-error.ts:8` i `tests/fixtures/http.ts`. Wniosek pozostaje prawdziwy (500 i 501 nie
  są 4xx).
- **Fix**: Zmienić „502–504” na „500–504”.
- **Decision**: FIXED — „500–504”.

### F8 — Punkt `## Structure` w CLAUDE.md powtarza to, co mówi kod middleware

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: CLAUDE.md (punkt dodany w 870afdb, `## Structure`)
- **Detail**: Punkt wymienia ścieżki wyłączone z 503, „keeps the session cookie” i to, który
  `event` towarzyszy któremu przypadkowi — to treść `src/middleware.ts`, a plan (faza 4, zmiana 3)
  i własna reguła pliku żądają nazwanych instancji bez parafrazy kodu. Treść jest zgodna z kodem i
  nie zawiera liczb; sąsiednie punkty mają podobną gęstość. Jeśli F1 skończy się Fix B, fraza
  „keeps the session cookie” stanie się dodatkowo nieprawdziwa.
- **Fix**: Skrócić punkt do trzech zdań referencyjnych oraz reguły „błąd nierozpoznany jest
  awarią, nigdy wylogowanym członkiem”; zrobić to po rozstrzygnięciu F1.
- **Decision**: FIXED — punkt skrócony do zdań referencyjnych i reguły o błędzie nierozpoznanym.
