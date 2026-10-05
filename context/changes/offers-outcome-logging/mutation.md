# Dziennik mutantów — `offers-outcome-logging`

Wynik Strykera dla trzech plików zmiany i decyzja dla każdego mutanta, który
ocalał albo nie ma pokrycia. Kryterium ukończenia to brak mutanta bez decyzji —
nie próg liczbowy (`plan.md`, faza 4, zmiana 2).

Decyzje:

- **asercja** — zmiana zaszkodziłaby członkowi albo osobie czytającej log; dopisana asercja zabija mutanta.
- **równoważny** — mutant nie zmienia obserwowalnego zachowania.
- **świadomie pominięty** — zmiana jest obserwowalna albo niesprawdzalna z krawędzi HTTP, ale nie warta asercji; powód w jednym zdaniu.

Raport (`reports/mutation/mutation.html`) jest nadpisywany przy każdym
przebiegu, więc liczby i decyzje trafiają tutaj.

Polecenie:

```
npx stryker run --mutate "src/lib/log.ts,src/pages/api/offers.ts,src/lib/otodom/index.ts"
```

Testy: `tests/lib/log.test.ts`, `tests/lib/otodom/fetch.test.ts`,
`tests/pages/api/offers.test.ts`, `tests/pages/api/offers.unconfigured.test.ts`.

## Wynik (2026-10-05)

Wyniku bazowego sprzed zmiany nie ma: `src/lib/log.ts` powstał w fazie 1, a
gałęzie błędów bazy w trasie nie miały żadnego testu. Pierwszy przebieg
odbył się po fazach 1–3 i po dopisaniu testu przekrojowego prywatności.

| Przebieg                              | Wynik  | Zabite | Ocalałe | Bez pokrycia | Razem |
| ------------------------------------- | ------ | ------ | ------- | ------------ | ----- |
| 1. Po fazach 1–3 i teście prywatności | 85,37% | 210    | 20      | 16           | 246   |
| 2. Po asercjach z tego dziennika      | 95,53% | 235    | 8       | 3            | 246   |

Przebieg 2 według plików:

| Plik                      | Wynik  | Zabite | Ocalałe | Bez pokrycia | Razem |
| ------------------------- | ------ | ------ | ------- | ------------ | ----- |
| `src/lib/log.ts`          | 96,77% | 30     | 1       | 0            | 31    |
| `src/lib/otodom/index.ts` | 100%   | 18     | 0       | 0            | 18    |
| `src/pages/api/offers.ts` | 94,92% | 187    | 7       | 3            | 197   |

## Asercje dopisane po przebiegu 1

Wszystkie w `tests/pages/api/offers.test.ts`. Każda odgrywa wyjście, którego
żaden test dotąd nie odgrywał; razem zabiły 25 mutantów.

| Mutanty (przebieg 1)                                                                                              | Co by zaszkodziło                                                                                                           | Asercja                                                                                                                                                                                     |
| ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `offers.ts:34:5`, `34:10`, `35:14`, `35:59` (tekst `upstream_error`), `66:19` (`upstream_error: "failed"` → `""`) | Awaria portalu z tekstem innego powodu albo bez `outcome` i na poziomie `info` — osoba filtrująca błędy jej nie widzi.      | Wiersz „an HTTP 503 from otodom" w tabeli odmów: fragmenty „chwilowo niedostępny" i „(HTTP 503)", wpis `error` / `failed` / `fetch` / `upstream_error` ze `status: 503`.                    |
| `offers.ts:40:5`, `40:10`, `41:14` (tekst `network`), `69:12` (`network: "failed"` → `""`)                        | Jak wyżej dla pobrania, które nie doszło do skutku.                                                                         | Wiersz „a fetch that never connected": odrzucona obietnica z `TypeError`, wpis `error` / `failed` / `fetch` / `network`.                                                                    |
| `offers.ts:38:5`, `38:10`, `39:14` (tekst `timeout`), `68:12` (`timeout: "failed"` → `""`)                        | Jak wyżej dla przekroczonego czasu.                                                                                         | Wiersz „a fetch that timed out": odrzucona obietnica z `DOMException` o nazwie `TimeoutError`, wpis `error` / `failed` / `fetch` / `timeout`.                                               |
| `offers.ts:33:54`, `33:77` (`status === undefined ? "" : …`)                                                      | Przekierowanie poza otodom pokazałoby członkowi „(HTTP undefined)" albo obcy tekst w środku zdania.                         | Wiersz „a redirect off otodom": odpowiedź `200` z adresem spoza portalu, fragment „odmówił pobrania ogłoszenia. Nic nie zostało zapisane", wpis `http_denied` bez `status`.                 |
| `offers.ts:30:10` (`case "expired"` → `""`), `64:12` (`expired: "refused"` → `""`)                                | Wygasłe ogłoszenie dostałoby tekst „expired" i wpis bez `outcome`.                                                          | Wiersz „an expired listing that still ships its payload": `shouldShowExpiredAdPage: true`, fragment „nie istnieje lub wygasło", wpis `info` / `refused` / `fetch` / `expired`.              |
| `offers.ts:19:10` (`case "malformed"` → `""`), `23:5`, `23:10`, `24:14` (tekst `not_an_offer`)                    | Członek zobaczyłby nazwę powodu zamiast zdania albo tekst innego powodu.                                                    | Tabela „refuses %s" przed siecią: pusty adres, tekst niebędący adresem, obcy portal i adres otodom, który nie jest ogłoszeniem — każdy z pełnym tekstem i wpisem `refused` / `url` / powód. |
| `offers.ts:119:40`, `119:78` (`typeof rawUrl === "string" ? rawUrl : ""`)                                         | Formularz bez pola `url` wywróciłby trasę (`null.trim()` → 500) albo dał wpis `malformed` zamiast `empty`.                  | „reads a form without the address field as an empty address, never a 500": pusty `FormData`, tekst jak dla pustego adresu, wpis `refused` / `url` / `empty`.                                |
| `offers.ts:87:10` — `exec(url)?.[1]` → `exec(url)[1]`                                                             | Slug bez tokenu `ID…` wywróciłby trasę (500) po przejściu normalizacji.                                                     | „logs no listing for a slug without a token": wpis `duplicate` bez klucza `listing`.                                                                                                        |
| `offers.ts:87:10` — wyrażenie bez `$`                                                                             | Token wzięty z pierwszego „-ID…" w slugu, czyli ze słowa z tytułu (`…-IDEALNE-…`) — dokładnie to, czego token ma nie nieść. | „logs only the token that ends the slug": slug `mieszkanie-IDEALNE-warszawa-IDKANAR1` daje `listing: "IDKANAR1"`.                                                                           |

## Ocalałe mutanty i mutanty bez pokrycia po przebiegu 2

| Wiersz i mutacja                                                                                                        | Decyzja             | Powód                                                                                                                                                                                                                                                                                             |
| ----------------------------------------------------------------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `log.ts:43:47` — `typeof value === "number" && Number.isFinite(value)` → `true && Number.isFinite(value)`               | równoważny          | `Number.isFinite` nie rzutuje argumentu: dla każdej wartości, która nie jest liczbą, odpowiada `false`, więc klucz i tak nie trafia do wpisu.                                                                                                                                                     |
| `offers.ts:57:10`, `58:14`, `59:17`, `60:17` — `empty`, `malformed`, `foreign_host`, `not_an_offer`: `"refused"` → `""` | równoważny          | Tych czterech wpisów tabeli nic nie czyta: trasa odrzuca adres przed siecią z `outcome` wpisanym wprost (`refused` / `url`), a `ingestOffer` dostaje adres już znormalizowany i nie może zwrócić żadnego z tych powodów. Wpisy istnieją, bo `Record<IngestFailureReason, …>` wymaga kompletności. |
| `offers.ts:128:57` — `.select("id")` → `.select("")` (sprawdzenie duplikatu)                                            | świadomie pominięty | Lista kolumn to dane dla zapytania, nie reguła: zaślepka odpowiada niezależnie od `select`, a przy pustym `select` PostgREST zwraca cały wiersz, który nadal ma `id`. Asercja na literał byłaby lustrem kodu.                                                                                     |
| `offers.ts:161:13` — `.select("id")` → `.select("")` (zapis)                                                            | świadomie pominięty | Jak wyżej.                                                                                                                                                                                                                                                                                        |
| `offers.ts:189:15` — `.select("id")` → `.select("")` (odczyt bliźniaka)                                                 | świadomie pominięty | Jak wyżej.                                                                                                                                                                                                                                                                                        |
| `offers.ts:35:69` — `status ?? "?"` → `status ?? ""` (bez pokrycia)                                                     | świadomie pominięty | Nieosiągalne z krawędzi HTTP: `fetchOfferAd` zwraca `upstream_error` wyłącznie razem ze statusem odpowiedzi, więc prawa strona `??` nigdy się nie wykonuje; zostaje jako zabezpieczenie typu `status?: number`.                                                                                   |
| `offers.ts:42:5`, `42:14` — gałąź `default` w `failureMessage` (bez pokrycia)                                           | świadomie pominięty | Strażnik kompletności typu (`never`): nieosiągalny dla żadnej wartości `IngestFailureReason`, pilnuje go `astro check`, nie test.                                                                                                                                                                 |

## Czego ten przebieg nie widzi

- Stryker uruchamia wyłącznie `npm test`. Wpisy zapisane przez prawdziwy
  runtime (workerd) sprawdza krok ręczny 3.7–3.8 planu, nie mutacje.
- Przypisania `refused` / `failed` dla powodów z pobrania i mappera są
  zabijane przez tabelę odmów; dla czterech powodów adresu — patrz wiersz
  „równoważny" wyżej. Gdyby trasa czytała `outcome` adresu z tej samej
  tabeli, te cztery mutanty zabiłaby tabela „refuses %s", która już istnieje.
