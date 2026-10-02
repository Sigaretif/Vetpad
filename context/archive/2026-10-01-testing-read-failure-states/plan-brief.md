# Stany nieudanego odczytu i limity zespołu — testy jednostkowe — Plan Brief

> Full plan: `context/changes/testing-read-failure-states/plan.md`
> Research: `context/changes/testing-read-failure-states/research.md`

## What & Why

Dodajemy testy jednostkowe dla logiki, którą dziś pokrywa wyłącznie
`scripts/smoke.mjs` — a smoke sprawdza tylko znaczniki `ok`. Dwa ryzyka:
nieudany odczyt pokazany jako pusty stan („brak notatek”, „osoba z usuniętym
kontem”, „brak limitów”) oraz limit zespołu złamany przez fakt, którego
ogłoszenie nie podaje. Oba prowadzą do wymyślonego faktu na ekranie, a pierwsze
także do nadpisania danych pustym formularzem.

## Starting Point

Żaden test w `tests/` nie importuje żadnej z 16 funkcji z `team-limits.ts`,
`offer-board.ts`, `members.ts`, `notes.ts` i `criteria.ts`. Wynik Strykera z
2026-10-01: `team-limits.ts` 6,0%, `criteria.ts` 22,35% (w całości z walidacji
formularza), `notes.ts`, `members.ts` i `offer-board.ts` 0%. Mechanika
hermetyczna (`stubFetch`) już istnieje.

## Desired End State

Pięć nowych plików pod `tests/lib/` z asercjami wyprowadzonymi ze źródeł, cztery
nowe kroki smoke dowodzące, że oferta bez ceny albo metrażu stoi na końcu
tablicy, reguły dotąd niezapisane dopisane do PRD i CLAUDE.md, a każdy ocalały
mutant w zakresie ma zapisaną decyzję. Kod produkcyjny pozostaje bez zmian.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Gdzie dowodzić „nieznane na końcu” | Krok w `scripts/smoke.mjs`; testy jednostkowe tylko dla `parseBoardSort` i `boardSortHref` | Reguła żyje w zapytaniu SQL (`dashboard.astro:26`), więc tylko prawdziwa baza o niej nie skłamie | Plan |
| Kolejność złamań | Dokładnie `city`, `price_above`, `price_below`, `area_below`, zapisana w CLAUDE.md | Domyka „stałą kolejność” z planu `team-search-criteria` | Plan |
| Pusta etykieta lokalizacji (`""`, `" , "`) | Nie łamie limitu miasta; dopisane do PRD FR-002 | Pusty tekst nie podaje żadnego miejsca | Plan |
| Nieczytelna wartość w `team_criteria` | Stan błędu, nigdy „brak limitu”; zapisane w CLAUDE.md | Limit odczytany jako brak ukryłby każde złamanie | Plan |
| `null` autora bez klienta | `deleted` | To fakt z wiersza, który nie wymaga odczytu | Plan |
| Odwrócony zakres cen w `limitBreaches` | Każda granica osobno: 850 000 przy min 900 000 / max 800 000 daje oba znaczniki | Żadnej dodatkowej reguły, wadliwe limity są widoczne | Plan |
| Pusty limit miasta w `limitBreaches` | Bez limitu | Pusty tekst nie nazywa miasta | Plan |
| Limit miasta z przecinkiem | Porównywany w całości — znacznik `city` | Jedna prosta reguła, wadliwy limit jest głośny | Plan |
| `sort=PRICE`, `dir=ASC`, pusty `sort` | Ściśle, małe litery — inne wartości są „nieznane” | Mieści się w istniejącej regule, interfejs generuje tylko małe litery | Plan |
| Zakres Strykera | Zakresy wierszy odczytu (`notes.ts:1-99`, `criteria.ts:151-285`); walidatory poza zakresem | Decyzję dostają tylko mutanty z ryzyka tej zmiany | Plan |
| Teksty interfejsu | Wiązane wszystkie cztery warianty; „Ty” / „Ciebie” wpisane ręcznie | Pusta nazwa widza też byłaby widoczną usterką | Plan |
| Warstwa testów odczytu | Hermetyczna, `stubFetch`, bez `vi.mock` `@/lib/*` | Lokalny Supabase nie zwróci błędu na żądanie | Research |
| Tryb wykonania | `/10x-implement` we wszystkich fazach | Kod istnieje, żadna faza nie zaczyna od czerwonego testu | Plan |

## Scope

**In scope:**

- `tests/lib/{team-limits,offer-board,members,notes,criteria}.test.ts`
- Cztery kroki kolejności wierszy w `scripts/smoke.mjs` (+ nagłówek, README)
- Dopisanie reguł do `prd.md` (FR-002) i `CLAUDE.md` (`## Structure`, `## Testing`)
- Komentarz o kształtach żądań odczytu w `tests/fixtures/http.ts`
- `mutation.md` w folderze zmiany; `test-plan.md` §6.7, §6.8, wpis w §6.6

**Out of scope:**

- Jakakolwiek zmiana w `src/` i w migracjach
- Walidatory `parseLimitsForm`, `requirementsError`, `noteError`
- Trasy `api/notes.ts`, `api/requirements.ts`, `api/auth/signin.ts`
- Test hermetyczny zapytania tablicy; powtórzone parametry sortowania
- Asercje renderowania stanów błędu w widokach
- Próg wyniku mutacji, Stryker w CI, zmiany `test-plan.md` §1–§5

## Architecture / Approach

Jedna faza na moduł, od najtańszej warstwy. Czyste funkcje testowane literałami;
funkcje odczytu z klientem zbudowanym w teście i siecią zaślepioną na krawędzi
HTTP (`500` z JSON-em jako błąd, `200 []` jako brak wiersza, `200` o złym
kształcie jako wyjątek). Każda reguła „nie” ma parę „tak”, a każdy stan błędu —
przypadek kontrolny „pusty, ale udany”. Fazy 1–5 kończą się Strykerem zawężonym
do modułu; czerwony test napisany z wyroczni zatrzymuje fazę zamiast zmieniać
oczekiwanie.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Limity zespołu | Test `limitBreaches`/`normalizePlace`, reguły w PRD i CLAUDE.md, `mutation.md` | Asercja lustrzana dla wejść nieosiągalnych — stąd zapis reguł przed testem |
| 2. Sortowanie tablicy | Test parsowania i linku; cztery kroki smoke | Krok smoke wymaga lokalnego Supabase i podglądu produkcyjnego |
| 3. Nazywanie członka | Test `resolveSaver`/`resolveAuthors`/nazw; kształty żądań `members` | Gałąź `catch` może być nieosiągalna z krawędzi HTTP |
| 4. Odczyt notatek | Test `loadNotes` | Pomylenie „brak notatek” z błędem w samym teście — pilnuje przypadek kontrolny |
| 5. Odczyt kryteriów | Test `loadCriteria`/`loadTeamLimits`; reguła w CLAUDE.md | Dwa równoległe odczyty i trzeci po nich — handler musi rozróżniać tabele |
| 6. Cookbook | `test-plan.md` §6.7, §6.8, §6.6; referencje w CLAUDE.md | Opis rozjeżdżający się z `mutation.md` |

**Prerequisites:** lokalny Supabase z seedem dla kroku smoke (faza 2); raport
bazowy Strykera z 2026-10-01 zapisany w planie.
**Estimated effort:** ok. 3–4 sesje w 6 fazach; fazy 3–5 są najcięższe.

## Open Risks & Assumptions

- Zakładamy, że każda rozstrzygnięta reguła pokrywa się z obecnym kodem. Jeśli
  test z wyroczni wyjdzie czerwony, faza staje i zgłasza usterkę.
- Zakresy wierszy Strykera są poprawne tylko dopóki `notes.ts` i `criteria.ts`
  się nie zmieniają.
- Część mutantów bloków `catch` może zostać „świadomie pominięta” jako
  nieosiągalna bez mockowania modułów wewnętrznych.
- Wynik całego pliku `criteria.ts` pozostanie niski — walidatory są poza zakresem.
- Asercje na „Ty” / „Ciebie” zaczerwienią się przy zmianie kopii interfejsu.

## Success Criteria (Summary)

- Zamiana stanu błędu na „pusty” w `notes.ts`, `members.ts` albo `criteria.ts`
  oraz złamanie limitu przez niepodany fakt zaczerwieniają `npm test`.
- Usunięcie `nullsFirst: false` z zapytania tablicy zaczerwienia smoke.
- Każdy ocalały mutant w zakresie ma decyzję w `mutation.md`, a cookbook
  pozwala dodać kolejny taki test bez czytania tego planu.
