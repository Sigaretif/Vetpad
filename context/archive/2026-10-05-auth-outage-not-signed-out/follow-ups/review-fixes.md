# Follow-ups z przeglądu implementacji

Źródło: `context/changes/auth-outage-not-signed-out/reviews/impl-review.md` (2026-10-06).
Pozycje poza zakresem tej zmiany, do podjęcia w następnej.

## F6 — Wylogowanie podczas awarii Auth nic nie robi i nie zostawia wpisu

- **Gdzie**: `src/pages/api/auth/signout.ts`, `isAuthPath` w `src/middleware.ts`.
- **Co**: middleware zostawia `/api/auth/signout` osiągalne podczas awarii, ale `_signOut` w
  auth-js przy błędzie innym niż 401/403/404 wraca bez usunięcia sesji. Trasa ignoruje wynik i
  przekierowuje na `/`, gdzie middleware odpowiada stroną 503. Członek pozostaje zalogowany, a
  nieudane wylogowanie nie ma wpisu w logu.
- **Dokąd**: zmiana obejmująca logowanie w pozostałych trasach (P3, P6–P8 z audytu
  `context/audits/observability/2026-10-05_add-offer-from-otodom.md`).

## F4 — Powtarzalna próba awarii zamiast ręcznej

- **Co**: prawdziwe przepisanie żądania na `/503` pokrywa wyłącznie ręczna próba z zatrzymanym
  kontenerem Auth (`context/foundation/test-plan.md` §6.10). Skrypt, który ją odgrywa — także z
  wygasłym tokenem dostępu — zamknąłby tę lukę.
