# Dziennik mutantów — `auth-outage-not-signed-out`

Wynik Strykera dla czterech plików zmiany i decyzja dla każdego mutanta, który
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
npx stryker run --mutate "src/middleware.ts,src/lib/auth-error.ts,src/lib/error-pages.ts,src/lib/log.ts"
```

Testy: `tests/middleware.test.ts`, `tests/middleware.unconfigured.test.ts`,
`tests/lib/auth-error.test.ts`, `tests/lib/error-pages.test.ts`,
`tests/lib/log.test.ts` oraz testy tras, które przechodzą przez reporter.

## Wynik (2026-10-06)

Wyniku bazowego sprzed zmiany nie ma: `src/middleware.ts` nie miał żadnego
testu, a `src/lib/auth-error.ts` i `src/lib/error-pages.ts` powstały w tej
zmianie. Pierwszy przebieg odbył się po fazach 1–3.

| Przebieg                         | Wynik  | Zabite | Ocalałe | Bez pokrycia | Przekroczony czas | Razem |
| -------------------------------- | ------ | ------ | ------- | ------------ | ----------------- | ----- |
| 1. Po fazach 1–3                 | 96,59% | 170    | 6       | 0            | 0                 | 176   |
| 2. Po asercjach z tego dziennika | 98,30% | 173    | 3       | 0            | 0                 | 176   |

Przebieg 2 według plików:

| Plik                     | Wynik  | Zabite | Ocalałe | Bez pokrycia | Przekroczony czas | Razem |
| ------------------------ | ------ | ------ | ------- | ------------ | ----------------- | ----- |
| `src/lib/auth-error.ts`  | 94,44% | 34     | 2       | 0            | 0                 | 36    |
| `src/lib/error-pages.ts` | 100%   | 30     | 0       | 0            | 0                 | 30    |
| `src/lib/log.ts`         | 96,77% | 30     | 1       | 0            | 0                 | 31    |
| `src/middleware.ts`      | 100%   | 79     | 0       | 0            | 0                 | 79    |

## Asercje dopisane po przebiegu 1

Razem zabiły 3 mutanty; przebieg 2 to potwierdza.

| Mutanty (przebieg 1)                                                                 | Co by zaszkodziło                                                                                                                                                                                                                                          | Asercja                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth-error.ts:10:46` — `(error.status ?? 0) >= 500` → `> 500`                       | `classifyAuthError` i tak odpowiada `unavailable` (status 500 nie jest 4xx), ale `src/pages/api/auth/signin.ts` czyta sam `isAuthOutage`: odpowiedź 500 z Auth przy logowaniu dostałaby komunikat innego powodu zamiast komunikatu o niedostępnej usłudze. | `tests/lib/auth-error.test.ts`, „isAuthOutage › puts the bound between 499 and 500": `AuthApiError` 499 → `false` obok `AuthApiError` 500 → `true`.                                                                                                                                                 |
| `middleware.ts:13:10` — `pathname === "/auth"` → `false`; `13:23` — `"/auth"` → `""` | Kontrakt fazy 3 wymienia ścieżkę `/auth` wprost wśród wyłączonych z 503. Bez niej żądanie `/auth` przy awarii dostałoby stronę 503 zamiast odpowiedzi trasy.                                                                                               | `tests/middleware.test.ts`, „#14 leaves the bare /auth path alone, but not a path that only begins like it": `/auth` przy awarii przechodzi dalej (`next()`), z całym wpisem `auth_check` / `unavailable` wpisanym ręcznie; obok `/authors`, które zaczyna się tak samo, jest przepisane na `/503`. |

Kandydat z fazy 1 — brak przypadku tuż poniżej 400 (`AuthApiError` 399) — nie
dostał asercji: żaden mutant dolnej granicy nie ocalał. `status >= 400` → `true`
zabija „AuthError without a status" (status `0` czytany jako odrzucenie), a
`>= 400` → `> 400` zabija przypadek ze statusem 400.

## Ocalałe mutanty i mutanty bez pokrycia po przebiegu 2

Mutantów bez pokrycia ani z przekroczonym czasem nie ma.

| Wiersz i mutacja                                                                                          | Decyzja             | Powód                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------------------------------------------------------------------------------------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth-error.ts:24:24` — `status >= 400 && status <= 499 && status !== 429` → `status >= 400 && true && …` | równoważny          | Do tego wiersza nie dociera żaden status od 500 w górę: `isAuthOutage` w wierszu 21 zwraca dla niego `unavailable` wcześniej. Górna granica zostaje, bo wiersz ma mówić sam za siebie „tylko 4xx".                                                                                                                                                                                                                                              |
| `auth-error.ts:21:7` — `if (isAuthOutage(error))` → `if (false)`                                          | świadomie pominięty | Dla każdego błędu, który `auth-js` potrafi zbudować, wynik jest ten sam: błąd ponawialny ma status `0` albo 502–504 i 520–530 (`node_modules/@supabase/auth-js/src/lib/fetch.ts`, `NETWORK_ERROR_CODES`), `AuthUnknownError` nie ma statusu, więc wszystkie trafiają do `unavailable` ostatnim wierszem. Zabiłby go tylko ręcznie zbudowany błąd ponawialny ze statusem 4xx, którego biblioteka nie zwraca — asercja na coś, co się nie zdarza. |
| `log.ts:48:47` — `typeof value === "number" && Number.isFinite(value)` → `true && Number.isFinite(value)` | równoważny          | Jak w dzienniku `offers-outcome-logging`: `Number.isFinite` nie rzutuje argumentu, więc dla każdej wartości, która nie jest liczbą, odpowiada `false` i klucz nie trafia do wpisu.                                                                                                                                                                                                                                                              |

## Czego ten przebieg nie widzi

- Stryker uruchamia wyłącznie `npm test`. To, że odrzucona sesja kończy na
  logowaniu przy prawdziwym Auth, sprawdzają kroki `scripts/smoke.mjs` ze
  sfałszowanym ciasteczkiem; drogę wyjątku przez `src/pages/500.astro` — próba
  na zbudowanym podglądzie (kryterium 4.2 planu). Żaden z nich nie zabija mutanta.
- `src/pages/500.astro`, `src/pages/503.astro` i `src/components/ErrorPage.astro`
  nie są mutowane: Stryker nie mutuje plików `.astro`. Status i znacznik
  `data-error-page` obu stron pilnuje smoke.
- Test middleware woła `onRequest` z ręcznie zbudowanym kontekstem. Tego, że
  Astro po `next("/503")` nie uruchamia middleware ponownie i że drugi przebieg
  ma `routePattern` równy `/500`, dowodzą kroki ręczne 4.8–4.9 i kryterium 4.2,
  nie mutacje.
