# Awaria Supabase Auth odróżniona od braku sesji — Plan Brief

> Full plan: `context/changes/auth-outage-not-signed-out/plan.md`

## What & Why

Middleware przestaje traktować każdy błąd Supabase Auth jak wylogowanie. Dziś awaria
Auth, uśpiony projekt i każde 5xx kończą się przekierowaniem na logowanie bez
komunikatu, a w logach wyglądają jak wygasła sesja (P1); nieprzechwycony wyjątek to
pusta odpowiedź 500 i sam stos w logu (P4). To krok 1 z sekcji 6 raportu
`context/audits/observability/2026-10-05_verify-add-offer-from-otodom.md`.

## Starting Point

`src/middleware.ts` czyta `data.user` z `getUser()` i ignoruje `error`; `next()` nie
jest opakowane, a `src/pages/500.astro` nie istnieje. Reporter `src/lib/log.ts` i
wzorzec testu wpisu istnieją od zmiany `offers-outcome-logging`, ale woła go tylko
`src/pages/api/offers.ts`.

## Desired End State

Członek z wygasłą albo odrzuconą sesją trafia na logowanie jak dziś. Gdy Auth nie
odpowiada, widzi stronę „Nie możemy teraz potwierdzić Twojej sesji” ze statusem 503 i
po powrocie usługi jest nadal zalogowany. Gdy żądanie kończy się wyjątkiem, widzi
stronę Vetpada ze statusem 500. Osoba czytająca logi odróżnia odrzuconą sesję
(`info`), awarię Auth (`error`) i wyjątek (`error` z trasą, metodą i `user_id`).

## Key Decisions Made

| Decision                                  | Choice                                                               | Why (1 sentence)                                                                                | Source |
| ----------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------ |
| Klasy błędu Auth                          | Trzy: brak sesji, sesja odrzucona, awaria                            | Opis czytany dosłownie pokazałby stronę awarii członkowi z wygasłym refresh tokenem.            | Plan   |
| Sesja odrzucona (status 400–499 poza 429) | Zachowanie jak dziś plus wpis `info` z nazwą, statusem i kodem błędu | Wygaśnięcie zostaje zwykłym logowaniem, a rotacja sekretu JWT czy usunięte konto są policzalne. | Plan   |
| Awaria                                    | Sieć, 5xx, nieczytelna odpowiedź, 429 i błąd bez statusu             | Reguła domyka się w stronę awarii: nierozpoznany błąd jest widoczny i nie wylogowuje.           | Plan   |
| Co widzi członek przy awarii              | Osobna strona ze statusem 503 i linkiem „Spróbuj ponownie”           | Status mówi prawdę monitoringowi, a komunikat odróżnia awarię logowania od błędu aplikacji.     | Plan   |
| Zakres ścieżek                            | Każda poza `/auth/*` i `/api/auth/*`, także strona główna            | Żaden widok nie udaje, że członek jest gościem, a logowanie zostaje wyjściem awaryjnym.         | Plan   |
| Trasy sprawdzające `locals.user`          | Bez zmian w kodzie                                                   | Middleware zatrzymuje awarię przed trasą, więc `signed_out` staje się prawdziwe.                | Plan   |
| Wzorzec klasyfikacji                      | Warunek z `signInErrorMessage` wyniesiony do `src/lib/auth-error.ts` | Opis zmiany wymaga użycia istniejącego wzorca zamiast drugiego.                                 | Audit  |
| Pole `route`                              | Wzorzec trasy z Astro, nie surowa ścieżka                            | Żadnego tekstu od użytkownika ani query stringa w logu.                                         | Plan   |
| Treść błędu w logu                        | Tylko nazwa, status i kod; bez komunikatu                            | Komunikat może cytować dane, a stos wyjątku loguje już Astro.                                   | Plan   |
| Bramka wizualna                           | Uruchomiona, ze stroną `/dev/errors`                                 | To jedyny praktyczny sposób obejrzenia obu widoków.                                             | Plan   |
| Zero-config                               | Stan bez wpisu                                                       | Brak konfiguracji jest wspieranym stanem aplikacji, nie awarią.                                 | Audit  |

## Scope

**In scope:**

- `src/lib/auth-error.ts` i pięć nowych kluczy białej listy reportera
- `src/pages/500.astro`, `src/pages/503.astro`, wspólny komponent, `/dev/errors`
- `src/middleware.ts`: trzy klasy, przepisanie na `/503`, opakowanie w log-i-rzuć-dalej
- Pierwszy test middleware i fixture sesji na krawędzi HTTP
- Kroki smoke, dziennik mutantów, `CLAUDE.md`, runbook, README, `test-plan.md`

**Out of scope:**

- Pod-powody na granicy pobrania (A4, A6, A15), odczyty karty i tablicy (A8, A9, P2)
- Logowanie w pozostałych trasach (P3, P6–P8), czasy trwania (P9), klient (P10)
- Sentry i każda nowa zależność; zmiana kodu tras zapisu

## Architecture / Approach

Wynik `getUser()` przechodzi przez czystą funkcję klasyfikującą. Brak sesji i sesja
odrzucona dają `locals.user = null` i dotychczasową logikę; awaria dodatkowo kończy
żądanie przez `next("/503")`, czyli przepisanie na stronę 503 bez ponownego
uruchomienia middleware. Cała praca middleware jest w jednym `try`, który loguje
wyjątek i rzuca go dalej, więc Astro nadal odpowiada 500 — teraz treścią
`500.astro`. Astro uruchamia middleware drugi raz dla strony 500; ten przebieg nie
pyta Auth i niczego nie przekierowuje.

## Phases at a Glance

| Phase                                        | What it delivers                                               | Key risk                                                                        |
| -------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 1. Klasyfikacja błędów Auth i pola reportera | Trzy klasy jako czysta funkcja z testem; nowe klucze reportera | Granica „odrzucona / awaria” źle postawiona dla kodu, którego nie ma w tabeli   |
| 2. Strony błędów i bramka wizualna           | Strony 500 i 503, `/dev/errors`, zrzuty macierzy               | Widok polegający na `locals.user`, którego w tych przebiegach nie ma            |
| 3. Middleware                                | Awaria jako 503 i wpis `error`; wyjątek z kontekstem           | Drugi przebieg dla strony 500 loguje wyjątek ponownie albo podmienia 500 na 503 |
| 4. Smoke, mutacje, dokumentacja              | Kroki smoke, próba wyjątku, dziennik mutantów, dokumenty       | Awarii nie odegra ani smoke, ani CI — zostaje krok ręczny                       |

**Prerequisites:** lokalny Supabase z kontami z `supabase/seed.sql`; Docker do
zatrzymania kontenera Auth w kroku ręcznym; Chrome dla `scripts/ui-screenshots.mjs`.
**Estimated effort:** około 3–4 sesji w 4 fazach.

## Open Risks & Assumptions

- `routePattern` równy `/500` w drugim przebiegu odczytałem ze źródeł Astro 7.3.2,
  nie z działającego serwera; potwierdza to próba wyjątku w fazie 4.
- `next("/503")` dla żądania POST na workerd nie było uruchamiane; sprawdza to krok
  ręczny z formularzem dodawania oferty.
- Przyjmuję, że Cloudflare przepuszcza odpowiedź 503 Workera bez podmiany własną
  stroną; do sprawdzenia po najbliższym wdrożeniu, poza tą zmianą.
- Gdy token dostępu wygasł, a Auth nie odpowiada, strona 503 pojawia się po około
  30 s ponawiania w bibliotece (P9, poza zakresem).
- Usunięte konto z żywym ciasteczkiem zostawia wpis `info` przy każdym żądaniu,
  dopóki przeglądarka nie zgubi ciasteczka.

## Success Criteria (Summary)

- Przy zatrzymanym Auth zalogowany członek widzi stronę 503 zamiast logowania, a po
  wznowieniu usługi wraca do tablicy bez ponownego logowania.
- Wygasła albo odrzucona sesja prowadzi na logowanie dokładnie jak przed zmianą.
- Wyjątek daje stronę 500 i jeden wpis z trasą, metodą i `user_id`; żaden wpis nie
  zawiera emaila, tokenu, query stringa ani komunikatu błędu.
