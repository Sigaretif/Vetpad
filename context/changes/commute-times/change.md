---
change_id: commute-times
title: Czasy dojazdu z oferty do wspólnych punktów zespołu (FR-016)
status: implementing
created: 2026-10-26
updated: 2026-10-27
archived_at: null
---

## Notes

— Czasy dojazdu z mieszkania z oferty do wspólnych punktów zespołu (FR-016 w context/foundation/prd.md, dodane 2026-10-26). W /criteria zespół prowadzi listę nazwanych punktów z adresem (pełny CRUD dla każdego członka). Na karcie oferty członek świadomie naciska „Policz dojazdy”: dla każdego punktu czas i dystans komunikacją miejską i samochodem (przełącznik), wynik zapisany i pokazany jako tabela + jedna mapa Google z trasami w osobnych kolorach. Dostawca: Google Maps Platform (Routes API, Geocoding, Maps JavaScript API), zero-config bez kluczy. Przed planem do rozstrzygnięcia Open Questions 2–4 w PRD (przechowywanie wyników Google, punkt startowy trasy, nieaktualność po zmianie punktów).
