# Wpis w logu dla każdego wyniku dodawania oferty — Plan Brief

> Full plan: `context/changes/offers-outcome-logging/plan.md`
> Audit (źródło ustaleń): `context/audits/observability/2026-10-05_add-offer-from-otodom.md`

## What & Why

Każde wyjście z `POST /api/offers` zostawia w Workers Logs jeden ustrukturyzowany
wpis z etapem, powodem i kodem błędu. Dziś zapis, duplikat, odmowa, blokada otodom
i błąd bazy to ta sama linia `POST /api/offers → 302`, więc awarii dodawania ofert
nie da się ani zauważyć, ani zdiagnozować z logów. Trzy komunikaty, które wskazują
zły etap albo twierdzą nieprawdę, dostają prawdziwą treść.

## Starting Point

W `src/` nie ma ani jednego `console.*`. Trasa rozróżnia 13 powodów porażki i niesie
status z otodom oraz `detail` z mappera, ale zużywa je wyłącznie na zdanie w
`?error=`; obiekty błędów Supabase sprawdza jako prawdę/fałsz i wyrzuca. Gałęzie
pre-checku, zapisu i wyszukania bliźniaka nie mają żadnego testu.

## Desired End State

Członek widzi to samo co dziś, poza trzema przypadkami z poprawionym tekstem. Osoba
czytająca `wrangler tail` widzi dla każdego żądania wpis z polami `outcome`,
`stage`, `reason`, `status`, `db_code` i identyfikatorami, po których da się
filtrować. Runbook przestaje wymagać logu, którego nie ma, i opisuje, jak odróżnić
blokadę otodom od zepsutego parsera.

## Key Decisions Made

| Decision                    | Choice                                                                                                                                                             | Why (1 sentence)                                                                              | Source                     |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- | -------------------------- |
| Zakres                      | Reporter + wszystkie wyjścia z `src/pages/api/offers.ts`                                                                                                           | Krok 1 z audytu zamyka oba krytyczne ustalenia przepływu jedną zmianą                         | Audit                      |
| Komunikaty dla A7, A10, A16 | Trzy nowe teksty; status 302 i cele bez zmian                                                                                                                      | Członek nie powinien czytać, że nic nie zapisano, gdy to nieprawda albo nie wiadomo           | Plan (decyzja użytkownika) |
| Kształt wpisu               | Jeden płaski obiekt ze stałym `event: "offer_add"`                                                                                                                 | Workers Logs indeksuje pola tylko z pojedynczego obiektu (dokumentacja Cloudflare)            | Plan                       |
| Zgodność z Sentry           | Wszystkie wywołania `console` w jednym module                                                                                                                      | Sposobu budowania komunikatu przez `captureConsoleIntegration` nie dało się sprawdzić bez SDK | Plan                       |
| Biała lista                 | Egzekwowana w czasie działania: tylko znane klucze i wartości proste, tekst do 300 znaków                                                                          | Rzutowanie w typach nie może wypuścić `details` ani payloadu                                  | Audit                      |
| Pola błędu bazy             | `code`, `message`, `hint`, status; nigdy `details`                                                                                                                 | `details` cytuje odrzucony wiersz razem z opisem ogłoszenia                                   | Audit                      |
| Identyfikator ogłoszenia    | Token `ID…` z końca sluga i `otodom_id`                                                                                                                            | Slug powstaje z tytułu, który może nieść słowa ogłoszeniodawcy                                | Plan                       |
| Poziomy                     | `refused`, `saved`, `duplicate`, `started` → info; `failed` → error                                                                                                | Odmowy oczekiwane nie mogą zagłuszyć awarii ani zjeść limitu przyszłego trackera              | Audit                      |
| Podział powodów             | `refused`: 4 powody adresu, `not_for_sale`, `not_a_flat`, `not_found`, `expired`; `failed`: `http_denied`, `upstream_error`, `shape_changed`, `timeout`, `network` | Pierwsze to wynik wklejenia złego adresu, drugie to awaria albo blokada                       | Audit + Plan               |
| Etap pobierania             | `ingestOffer` zwraca `stage` (`url` / `fetch` / `map`)                                                                                                             | `shape_changed` ma dwa źródła i sam powód ich nie rozróżnia                                   | Plan                       |
| Jedno ujście                | `no-console` błędem w `src/` poza `src/lib/log.ts`                                                                                                                 | Reguła narzędzia, nie umowa                                                                   | Plan                       |
| Bramka wizualna             | Nie dotyczy                                                                                                                                                        | Żaden widok się nie zmienia                                                                   | Plan                       |

## Scope

**In scope:**

- `src/lib/log.ts` z `logEvent` i regułą lint
- wpis dla każdego wyjścia z `src/pages/api/offers.ts`, wpis `started` przed pobraniem
- `stage` w wyniku `ingestOffer`
- trzy nowe teksty w `?error=`
- testy trasy dla gałęzi bez pokrycia, test przekrojowy prywatności, mutacje
- reguła w `CLAUDE.md`, akapit w runbooku, wzorzec w `test-plan.md`

**Out of scope:**

- pod-powody `shape_changed`, nagłówki odpowiedzi otodom, rozbicie `network` (A4, A6, A15)
- sygnały dryfu mappera (A13, A14), typ treści nieczytelnego body (A17)
- middleware, strony docelowe, pozostałe trasy, klient (P1–P11, A8, A9)
- Sentry i każda nowa zależność
- zmiany w `scripts/smoke.mjs`

## Architecture / Approach

Trasa pozostaje jedynym miejscem, które zna wynik żądania: przed każdym `return`
woła `logEvent` z polami tego wyjścia. `logEvent` buduje wpis, przechodząc po stałej
liście dozwolonych kluczy, i wypuszcza go jednym wywołaniem `console.info` albo
`console.error`. Poziom wynika z `outcome`, a `outcome` dla powodów pobierania z
tabeli stojącej obok `failureMessage` i tak samo wyczerpującej. Moduł otodom
dostaje jedną zmianę: `stage` w wyniku porażki.

## Phases at a Glance

| Phase                                | What it delivers                                                      | Key risk                                                                                     |
| ------------------------------------ | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 1. Reporter i jedno ujście           | `src/lib/log.ts`, pomocnik testowy konsoli, `no-console` jako błąd    | Biała lista tylko w typach — dlatego test sprawdza klucz podany przez rzutowanie             |
| 2. Błędy bazy w trasie               | Testy trzech gałęzi bez pokrycia, wpisy z `db_*`, trzy nowe teksty    | Ponawianie GET przez `postgrest-js` spowalnia test przy złym wyborze odpowiedzi stubu        |
| 3. Pozostałe wyjścia i pobieranie    | `stage`, tabela powód → wynik, wpisy dla reszty wyjść, wpis `started` | Zmiana kształtu `IngestResult` dotyka istniejących asercji dokładnej równości                |
| 4. Prywatność, mutacje, dokumentacja | Test przekrojowy, `mutation.md`, `CLAUDE.md`, runbook, `test-plan.md` | Test przekrojowy jest zielony od pierwszego uruchomienia — jego siłę dowodzi próba i Stryker |

**Prerequisites:** lokalny Supabase dla `npm run smoke` i kroków ręcznych fazy 3;
nic poza tym.
**Estimated effort:** ~2 sesje w 4 fazach; fazy 1–3 nadają się do `/10x-tdd`.

## Open Risks & Assumptions

- To, że Workers Logs pokaże pola wpisu jako osobne klucze, wynika z dokumentacji,
  nie z obserwacji; potwierdzi to dopiero `wrangler tail` po wdrożeniu.
- `error.message` z Postgresa może cytować wartość kolumny typowanej (liczbę, datę).
  Przyjęte: to nie są dane osobowe, a przycięcie do 300 znaków ogranicza resztę.
- Zmiana dodająca Sentry może wymagać innego kształtu wywołania `console`; dotknie
  wtedy jednego pliku.
- P1 z audytu pozostaje otwarte: awaria Supabase Auth nadal wygląda jak wylogowanie
  i w logu da wpis `refused` / `auth` / `signed_out`, nie awarię.

## Success Criteria (Summary)

- Dla każdego z wyjść trasy test wskazuje dokładny wpis, a `wrangler tail` pozwala
  odróżnić blokadę otodom, zmieniony format strony i błąd bazy po polach.
- W żadnym wpisie nie ma danych ogłoszenia, sprzedającego ani emaila członka — i
  test, który to sprawdza, zawodzi przy próbie ich dodania.
- Członek nie czyta już „Nic nie zostało zapisane", gdy trasa tego nie wie.
