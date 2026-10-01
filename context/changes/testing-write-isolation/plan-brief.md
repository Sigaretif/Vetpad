# Izolacja zapisów (test-plan Faza 2, ryzyko #5) — Plan Brief

> Full plan: `context/changes/testing-write-isolation/plan.md`
> Research: `context/changes/testing-write-isolation/research.md`

## What & Why

Dokładamy testy, które dowodzą, że zapis jednego członka zostawia dane
pozostałych nietknięte: notatki, wymagania i kolumny autora. Research nie
znalazł wady, ale S-09 (re-fetch), S-10 (archiwum) i S-11 (usuwanie) dołożą
zapisy właśnie tam, a triggery i polityki w migracjach były już poprawiane po
review. To strażnik przed regresją, postawiony zanim te slice'y ruszą.

## Starting Point

`scripts/smoke.mjs` ma osiem kroków odmowy na notatkach i wymaganiach, ale
„niezmieniony” sprawdza jednym polem, a dwóch członków nigdy nie ma wierszy
obok siebie na tej samej ofercie. Usunięcie konta i gałąź trasy „zapis trafił
w zero wierszy” nie mają żadnego testu.

## Desired End State

Smoke porównuje całe wiersze z datami przed zapisem i po nim — po odmowie i po
udanym zapisie obok cudzego wiersza — i w każdym przebiegu dowodzi, że to
porównanie potrafi wykryć zmianę. Usunięcie konta sprawdza skrypt SQL
uruchamiany w CI, który nic po sobie nie zostawia. Cookbook §6.3 mówi, jak
dodać takie sprawdzenie dla nowej ścieżki zapisu i co S-09, S-10 i S-11 muszą
dołożyć same.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Warstwa dla polityk, triggerów, kaskady | Kroki w `scripts/smoke.mjs` przez Data API | Stub nie odpowie za politykę ani kaskadę, a trasy nie są granicą przy kluczu publishable. | Research |
| Jak rozpoznać odmowę | Liczba wierszy i porównanie migawek, nigdy sam status | Odmówiony cudzy `DELETE` bez `Prefer` odpowiada `204`, tak samo jak udany. | Research |
| „Identyczny” | Cały wiersz z `select=*`, z datami | Jedno pole przepuści zmianę `cons`, `observations` lub `updated_at`. | Research |
| Usunięcie konta | Skrypt SQL przez `psql`, transakcja z `ROLLBACK`, w jobie `smoke` | Ta klasa błędu już raz zawiodła (lessons F4), a ścieżka nie wymaga klucza secret. | Plan |
| Luka 8 (zero wierszy w trasie limitów) | Hermetyczny test Vitest w tej fazie | Prawdziwe polityki tej odpowiedzi nie dadzą; wzorzec testu trasy już istnieje. | Plan |
| Dowód, że kroki potrafią być czerwone | Stały krok kontrolny w smoke + jednorazowe celowe psucie | Krok porównujący zły wiersz przechodziłby zawsze. | Plan |
| Framework do SQL | Zwykły `psql` z blokami `DO`, bez pgTAP | Jeden scenariusz nie uzasadnia nowego frameworka. | Plan |
| Tryb wykonania | `/10x-implement` dla wszystkich faz | Kod pod testem istnieje i jest poprawny, więc nie ma pierwszego czerwonego testu. | Plan |
| Trasy re-fetchu, usuwania, archiwum | Poza zakresem; tylko połowa bazodanowa | Tras nie ma (S-09, S-11), archiwum nie ma schematu (S-10). | Research |

## Scope

**In scope:**

- wrapper migawki, dwie oferty-fixtury, notatki obu członków, krok kontrolny;
- luki 1–7 w smoke: odmowy, udane zapisy obok, sfałszowany upsert, zapis
  oferty wobec notatek, autor oferty, kaskada, wymagania sąsiada, sprzątanie
  liczące wiersze;
- `tests/pages/api/criteria.test.ts` (luka 8);
- `scripts/account-deletion.sql`, `npm run test:db`, krok w jobie `smoke`;
- `test-plan.md` §6.3, §6.6, §3–§5; `CLAUDE.md`; `README.md`.

**Out of scope:**

- jakakolwiek zmiana w `src/` lub `supabase/migrations/` — wykryta wada jest
  zgłaszana, nie naprawiana tutaj;
- sprawdzenia na poziomie trasy dla S-09, S-10, S-11;
- zmiana `id` oferty przez Data API; ustawienia hostowanego projektu;
- pgTAP, klucz secret, Stryker.

## Architecture / Approach

Trzy warstwy, każda tam, gdzie sygnał jest prawdziwy i najtańszy. Smoke atakuje
polityki przez Data API jako dwa konta z seeda i opakowuje każdy zapis w dwa
odczyty wierszy sąsiada. Skrypt SQL usuwa trzecie konto z seeda w transakcji,
porównuje wiersze i cofa wszystko. Test Vitest stubuje `PATCH` na krawędzi
HTTP, żeby trafić w gałąź, której baza nie wyprodukuje. Wyrocznią jest PRD;
tabela sondy z researchu mówi tylko, jak PostgREST sygnalizuje wynik.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Harness smoke | Oczekiwanie „identyczne / zmienione”, fixtury, krok kontrolny | Zmiana liczby notatek na ofercie psuje istniejące kroki liczące wiersze |
| 2. Notatki i oferty | Luki 1, 2, 4, 5, 6, 7 dla `offer_notes` i `offers` | Kolejność kroków: wiersz musi istnieć, gdy jest obserwowany |
| 3. Wymagania i limity | Luki 2, 3, 7 dla `member_requirements` | Sprzątanie musi działać także po nieudanym kroku |
| 4. Test trasy `/api/criteria` | Luka 8, druga warstwa | Komunikaty skopiowane z kodu zamiast fragmentów pisanych ręcznie |
| 5. Usunięcie konta | Skrypt SQL, `npm run test:db`, krok CI | `psql` na runnerze; wynik CI znany dopiero po wypchnięciu |
| 6. Dokumentacja i cookbook | §6.3 z punktami dla S-09/S-10/S-11, reguły, README | Opis rozjeżdżający się z tym, co dowieziono |

**Prerequisites:** lokalny Supabase po `npx supabase start` z seedem, `psql`,
zgoda użytkownika na `npx supabase db reset` przy celowym psuciu.
**Estimated effort:** ~3–4 sesje w 6 fazach; Fazy 2 i 3 największe.

## Open Risks & Assumptions

- Zakładamy, że research ma rację i żaden nowy krok nie wykryje wady. Jeśli
  wykryje — plan się zatrzymuje, a naprawa migracji jest osobną zmianą.
- `psql` na obrazie `ubuntu-latest` jest założeniem; zapasem jest
  `docker exec` w kontenerze bazy.
- Celowe psucie kasuje dane wpisane ręcznie do lokalnej bazy.
- Smoke widzi lokalne `enable_anonymous_sign_ins = false`, nie ustawienie
  hostowanego projektu.

## Success Criteria (Summary)

- Poluzowanie polityki `*_own`, wyłączenie triggera zamrażającego albo zmiana
  kaskady wywraca smoke lub `npm run test:db` z nazwą kroku.
- Po każdym przebiegu lokalna baza jest w stanie sprzed przebiegu.
- Autor planu S-09 dodaje sprawdzenie izolacji z samego §6.3.
