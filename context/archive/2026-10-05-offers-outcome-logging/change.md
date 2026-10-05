---
change_id: offers-outcome-logging
title: Log one structured entry for every outcome of adding an offer
status: archived
created: 2026-10-05
updated: 2026-10-05
archived_at: 2026-10-05T20:45:52Z
---

## Notes

Krok 1 z context/audits/observability/2026-10-05_add-offer-from-otodom.md (sekcja 6): mały reporter w src/lib/ piszący jeden ustrukturyzowany wpis przez console i wywołany na każdym wyjściu z src/pages/api/offers.ts. Zamyka A1, A2, A3, A5, A7, A10, A11, A16, A18. Odpowiedzi dla użytkownika się nie zmieniają. Warunki: biała lista logowanych pól (nigdy error.details z Postgresa, HTML strony, payload ad ani email), poziom per powód obok failureMessage (odmowy oczekiwane = info, blokada otodom i błędy bazy = error), najpierw czerwone testy dla trzech gałęzi bez pokrycia (pre-check, insert, wyszukanie bliźniaka). Bez nowej zależności; format wpisu ma pasować też do późniejszego Sentry przez captureConsoleIntegration — do zweryfikowania w dokumentacji.
