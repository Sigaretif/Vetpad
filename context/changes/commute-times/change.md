---
change_id: commute-times
title: Czasy dojazdu z oferty do wspólnych punktów zespołu (FR-016)
status: implemented
created: 2026-10-26
updated: 2026-10-27
archived_at: null
---

## Notes

— Czasy dojazdu z mieszkania z oferty do wspólnych punktów zespołu (FR-016 w context/foundation/prd.md, dodane 2026-10-26). W /criteria zespół prowadzi listę nazwanych punktów z adresem (pełny CRUD dla każdego członka). Na karcie oferty członek świadomie naciska „Policz dojazdy”: dla każdego punktu czas i dystans komunikacją miejską i samochodem (przełącznik), wynik zapisany i pokazany jako tabela + jedna mapa Google z trasami w osobnych kolorach. Dostawca: Google Maps Platform (Routes API, Geocoding, Maps JavaScript API), zero-config bez kluczy. Przed planem do rozstrzygnięcia Open Questions 2–4 w PRD (przechowywanie wyników Google, punkt startowy trasy, nieaktualność po zmianie punktów). Rozstrzygnięte 2026-10-26 (PRD, blok „Resolved during implementation”): wynik nie jest zapisywany — żyje w wyspie do odświeżenia strony; bez Geocoding API — adres punktu idzie wprost do Routes API; nie ma więc nieaktualności wyniku.

— 2026-10-27: Progress 5.4 (płatny eval reviewera przed i po zmianie promptu) odhaczony bez uruchomienia — pominięty decyzją użytkownika. Brzmienie wyjątku dla klucza przeglądarkowego w CLAUDE.md (5.5) zaakceptowane przez użytkownika.
— 2026-10-27: jedno płatne liczenie dojazdów wykonane przez agenta za zgodą użytkownika (2 punkty, 4 zapytania Routes, licznik 4→8, jedna mapa). Po przeglądzie spójności dokumentacji dopisano w CLAUDE.md i w prompcie reviewera trzeci wyjątek RLS (tabela zapisywana tylko przez funkcję security definer — commute_usage); eval reviewera dla tej zmiany pominięty decyzją użytkownika.
— 2026-10-27: Progress 6.4 — pierwsze `wrangler secret put` uruchomione przez `!` w sesji Claude Code zapisały puste wartości (brak interaktywnego wejścia), więc baner na produkcji dalej wymieniał oba klucze; ponowione z wartością podaną na stdin z lokalnego .env, baner zniknął.
