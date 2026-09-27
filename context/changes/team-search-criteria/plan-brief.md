# Kryteria wyszukiwania zespołu — Plan Brief

> Full plan: `context/changes/team-search-criteria/plan.md`

## What & Why

S-03 (FR-002, FR-003): zespół zapisuje wspólne twarde limity — miasto, cenę od/do, minimalny metraż — a każdy członek własne wymagania dodatkowe jako wolny tekst. To wejście audytu S-04: bez kryteriów audyt nie ma względem czego oceniać ogłoszenia. Limity są wspólne, bo para kupująca uzgadnia je przed wpisaniem; wymagania są osobne, żeby niezgoda wychodziła tam, gdzie naprawdę jest (PRD, FR-002).

## Starting Point

W kodzie nie ma nic o kryteriach. Jest gotowy wzorzec z S-05: tabela według autorstwa z triggerami zamrażającymi (`create_offer_notes.sql`), trasa formularza z `?error=` (`src/pages/api/notes.ts`), wyspa z kompozytów `src/components/form/`, smoke sprawdzający RLS z dwóch kont. Tablica `/dashboard` pokazuje oferty bez żadnego odniesienia do limitów.

## Desired End State

Na nowej stronie `/criteria` („Kryteria” w Topbarze) każdy członek zmienia albo czyści wspólne limity (podpisane „ostatnio zmienił(a) X”) i pisze, zmienia albo usuwa własne wymagania, widząc wymagania pozostałych. Na tablicy wiersz, którego podana cena, metraż albo lokalizacja łamie limit, niesie odznakę nazywającą ten limit. Baza prowadzi licznik rewizji kryteriów, który S-04 zapisze w audycie, a S-09 porówna.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Tablica ofert | Znacznik „poza limitem” przy wierszu; bez filtrowania i ukrywania | Limity mają pracować na tablicy („govern the whole board”), ale oferta nie znika bez akcji członka |
| Niepodany fakt a znacznik | Nieznana cena/metraż/lokalizacja nigdy nie łamie limitu; cena tylko w PLN; granice włącznie | Guardrail PRD: niepodane to „nieznane”, nie fakt |
| Kompletność limitów | Każdy z czterech opcjonalny; nieustawiony to „bez limitu”, nigdy 0 | Wymuszony limit byłby wymyślonym faktem dla audytu |
| Wymagania usuniętego konta | `on delete cascade` — znikają z kontem; zapis w PRD | Osierocony tekst, którego nikt nie zmieni, sterowałby każdym audytem |
| Ślad zmiany dla FR-003 | Licznik `criteria_revision` podbijany wyłącznie przez triggery przy realnej zmianie | Jedno porównanie liczb, obejmuje usunięcia, nieosiągalne przez Data API |
| Jednoczesna edycja limitów | Wygrywa późniejszy zapis; „ostatnio zmienił(a) X, data” ustawiane przez bazę | Proste, a zmiana nigdy nie jest anonimowa |
| Miejsce w UI | Osobna strona `/criteria` z linkiem w Topbarze | Jeden widok całych kryteriów; tablica zostaje listą ofert |
| Bramka wizualna | Tak — macierz 7 stanów, `/dev/criteria`, sekcje `/dev/forms` i `/dev/board`, zrzuty | Nowy widok i nowy stan wiersza tablicy |
| Wspólne limity w bazie | Singleton bez polityk `insert`/`delete`; „usuń” = zapis `null` | Wiersz zawsze istnieje, więc podpis ostatniej zmiany przeżywa wyczyszczenie |

## Scope

**In scope:**
- Migracja: `team_criteria` (singleton), `member_requirements` (według autorstwa), `criteria_revision` (tylko trigger), RLS i triggery
- `src/lib/criteria.ts`, `src/lib/team-limits.ts`, trasy `/api/criteria` i `/api/requirements`
- Strona `/criteria`, wyspy `TeamLimitsForm` i `RequirementsEditor`, Topbar, middleware
- Odznaki złamanych limitów na tablicy, stan błędu odczytu limitów
- Smoke, PRD, `CLAUDE.md`, README, zrzuty bramki, `db push` za zgodą

**Out of scope:**
- Filtrowanie/ukrywanie ofert, znacznik na karcie oferty, waluty inne niż PLN
- Wykrywanie konfliktu edycji, wiele „wyszukiwań”, etykieta „nieaktualny” (S-04/S-09)
- Dialog potwierdzenia z Radixa (wystarcza `window.confirm`), seed kryteriów

## Architecture / Approach

Trzy tabele w jednej migracji. Triggery `after` na limitach (zmiana któregoś limitu) i wymaganiach (insert, delete, zmiana `body`) wołają funkcję `security definer`, która podbija `criteria_revision`. Trigger `before update` na limitach ustawia podpis tylko przy realnej zmianie i ma gałąź usuniętego konta. Strona czyta wszystko przez `loadCriteria` (błąd odczytu to osobny stan bez formularzy). Tablica czyta limity równolegle z ofertami, a czysta `limitBreaches` decyduje o odznakach wiersza.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Schemat, RLS i licznik | Trzy tabele z politykami i triggerami, sprawdzone przez REST i usunięcie konta | Trigger podpisu/licznika bumpujący przy zapisie bez zmian albo blokujący usunięcie konta |
| 2. Warstwa danych i trasy | Walidacja, odczyt, porównanie, dwie trasy formularzy | Liczby z formularza („850 000”, `0`) źle sparsowane |
| 3. Widok `/criteria` | Strona, dwie wyspy, nawigacja, kitchen sinki | Formularz renderowany przy błędzie odczytu nadpisałby wspólny wiersz |
| 4. Znacznik na tablicy | Odznaki złamań, stan błędu limitów, stany `/dev/board` | Fałszywy znacznik z nieznanego faktu albo złego dopasowania miasta |
| 5. Smoke, dokumentacja, bramka, push | Kroki smoke, PRD/CLAUDE.md/README, zrzuty, `db push` za zgodą | Smoke zostawia zmienione limity — sprzątanie przywraca stan sprzed przebiegu |

**Prerequisites:** S-01 (done); lokalny Supabase i konta z `supabase/seed.sql`; `supabase link` do hostowanego projektu przed `db push`.
**Estimated effort:** ~3–4 sesje w 5 fazach.

## Open Risks & Assumptions

- Dopasowanie miasta po członach `location_label` zakłada, że otodom podaje w nim nazwę miasta; oferta z samym powiatem/gminą może dostać znacznik „inne miasto”. Do obserwacji na prawdziwych ofertach.
- S-04 musi obsłużyć częściowo ustawione kryteria i zdecydować, czy audyt bez kryteriów jest dozwolony.
- Usunięcie konta kasuje jego wymagania bez akcji członka — świadomy wyjątek od „removal is always a deliberate member action”, zapisany w PRD.

## Success Criteria (Summary)

- Członek ustawia, zmienia i czyści wspólne limity oraz własne wymagania, a drugi członek widzi zmianę podpisaną i nie może ruszyć cudzych wymagań.
- Tablica oznacza tylko oferty, których podany fakt łamie limit, i nigdy nie ukrywa błędu odczytu limitów.
- Licznik rewizji rośnie dokładnie przy realnej zmianie kryteriów — gotowy do użycia przez S-04 i S-09.
