# Archiwizacja i przywracanie ofert — Plan Brief

> Full plan: `context/changes/archive-and-restore/plan.md`

## What & Why

Członek może przenieść ofertę do archiwum, żeby zniknęła z tablicy, i przywrócić ją stamtąd (FR-014, slice S-10). Tablica ma pokazywać tylko mieszkania, które zespół nadal rozważa. Na wspólnej tablicy jedna osoba może jednak schować mieszkanie, które pozostałe dwie jeszcze rozważają — dlatego baza zapisuje, kto zarchiwizował, a `/dashboard` pokazuje świeże archiwizacje. To cała mitygacja i nie da się jej pominąć.

## Starting Point

`public.offers` nie ma kolumny archiwizacji, a `/dashboard` czyta wszystkie oferty bez filtra. Gotowe są: nazywanie członka (`src/lib/members.ts`), wzorzec trasy zapisującej jeden wiersz (`src/pages/api/offer-refetch.ts`) i lista obowiązków testowych dla S-10 (`context/foundation/test-plan.md` §6.3).

## Desired End State

Na karcie oferty stoi przycisk „Zarchiwizuj”; po nim oferta znika z `/dashboard`, a karta mówi, od kiedy i przez kogo jest w archiwum, i daje przycisk „Przywróć”. Pod tablicą stoi sekcja z ofertami zarchiwizowanymi w ostatnich 7 dniach i link „Archiwum (N)”; pełna lista z przywracaniem z wiersza jest na `/offers/archive`. Podpisu archiwizującego nie da się podrobić, także przez Data API.

## Key Decisions Made

| Decyzja                          | Wybór                                                                          | Dlaczego                                                                              |
| -------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| Lista archiwum                   | Osobna strona `/offers/archive`                                                | Tablica zostaje krótka, a jej sortowanie i znaczniki `data-*` nie zmieniają znaczenia |
| „Ostatnio”                       | Sekcja z ostatnich 7 dni (168 h) + link „Archiwum (N)” z liczbą wszystkich     | Świeże zniknięcia są nazwane, a licznik pokrywa także stare                           |
| Adres zarchiwizowanej oferty     | Karta z informacją o archiwum, nazwiskiem i przyciskiem przywrócenia           | Zespół dowiaduje się, że mieszkanie już odłożono; nic nie przywraca się samo          |
| Oferta w archiwum                | Notatki i ponowne pobranie działają; audytu nie da się uruchomić               | Żadnego płatnego wywołania na odłożonej ofercie                                       |
| Gdzie odmawia audyt              | W trasie, przed zajęciem wiersza i przed kluczem dostawcy; bez blokady w bazie | Próba przez Data API nie wywołuje dostawcy, więc nic nie kosztuje                     |
| Przywrócenie                     | Czyści datę i osobę archiwizacji; kto przywrócił, tylko w logu                 | PRD przyjmuje binarny stan bez historii                                               |
| Wiersz archiwum                  | Kto, kiedy, link do karty i przycisk „Przywróć”; bez statusu audytu i limitów  | Dwa odczyty na stronie zamiast pięciu                                                 |
| Skąd się archiwizuje             | Tylko z karty                                                                  | Wiersz tablicy jest jednym linkiem i nie mieści przycisku                             |
| Usunięte konto archiwizującego   | Oferta zostaje w archiwum, podpisana „przez osobę z usuniętym kontem”          | Ta sama reguła co dla zapisującego, notatek i audytu                                  |
| Kto stawia podpis                | Trigger bazy z `auth.uid()`; klient wyraża tylko intencję                      | Każdy członek może pisać `offers` przez Data API                                      |
| Dwie archiwizacje naraz          | Podpisany zostaje pierwszy                                                     | Zapis z warunkiem na stan i trigger zamrażający podpis                                |
| Potwierdzenie przed archiwizacją | Brak                                                                           | Akcja jest odwracalna                                                                 |
| Bramka wizualna                  | Bez bramki                                                                     | Decyzja użytkownika; nowe stany i tak dostają sekcje na `/dev/*`                      |

## Scope

**In scope:**

- migracja `archived_at` / `archived_by` z triggerem podpisującym
- `POST /api/offer-archive` (archiwizuj / przywróć)
- odmowa `POST /api/audits` dla zarchiwizowanej oferty
- karta: blok archiwum, komunikaty, wariant komunikatu duplikatu
- `/dashboard`: filtr żywych ofert i sekcja „ostatnio zarchiwizowane”
- strona `/offers/archive`
- smoke, `scripts/account-deletion.sql`, testy jednostkowe i renderowania
- PRD, README, CLAUDE.md, plan testów

**Out of scope:**

- usuwanie ofert (S-11; zarchiwizowaną też będzie można usunąć)
- zapis, kto przywrócił, i historia archiwizacji
- przycisk archiwizacji w wierszu tablicy
- status audytu i znaczniki limitów w wierszu archiwum
- blokada notatek i ponownego pobrania w archiwum
- blokada audytu w bazie i przerywanie trwającej próby
- bramka wizualna, test E2E, paginacja archiwum

## Architecture / Approach

Stan to dwie kolumny na `public.offers`. Klient wpisuje do `archived_at` cokolwiek niepustego (archiwizuj) albo `null` (przywróć); trigger zastępuje to czasem bazy, podpisuje `auth.uid()` i zamraża obie kolumny, dopóki oferta jest w archiwum. RLS zostaje bez zmian. `src/lib/offer-archive.ts` trzyma regułę 7 dni i jedyny odczyt archiwum, z którego korzystają `/dashboard` i `/offers/archive`; karta czyta stan z wiersza, który już ma. Nieudany odczyt archiwum jest osobnym stanem (`data-archive-state="error"`), nigdy pustym archiwum.

## Phases at a Glance

| Faza                                  | Co dostarcza                                                                      | Główne ryzyko                                                                   |
| ------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 1. Schemat i reguły                   | Migracja z triggerem, typ wiersza, moduł archiwum, przypadek usunięcia konta, PRD | Trigger blokuje usunięcie konta, jeśli gałąź usuniętego konta nie stoi pierwsza |
| 2. Trasa archiwizacji i odmowa audytu | `POST /api/offer-archive`, powód `offer_archived` w trasie audytu, testy tras     | Zapis, który dotarł do zera wierszy, odczytany jako sukces                      |
| 3. Karta oferty                       | Blok archiwum, formularz, sekcja audytu bez przycisku, komunikat duplikatu        | Wyspa audytu renderowana w którymś ze stanów danych mimo archiwum               |
| 4. Tablica i strona archiwum          | Filtr żywych ofert, sekcja „ostatnio”, `/offers/archive`                          | Nieudany odczyt archiwum pokazany jako „nic nie zarchiwizowano”                 |
| 5. Smoke i dokumentacja               | Blok archiwizacji w smoke, README, CLAUDE.md, plan testów                         | Oferta testowa zostawiona w archiwum psuje późniejsze kroki tablicy             |

**Prerequisites:** lokalny Supabase dla `npx supabase db reset`, `npm run test:db` i `npm run smoke`; zgoda użytkownika na `npx supabase db push` przed wdrożeniem.
**Estimated effort:** ok. 4–5 sesji w 5 fazach.

## Open Risks & Assumptions

- Sprawdzenie archiwum w trasie audytu nie jest blokadą: archiwizacja między nim a zajęciem wiersza przepuści jeden audyt. Zaakceptowane.
- Do fazy 4 zarchiwizowana oferta nadal stoi na `/dashboard` — stan przejściowy między lokalnymi commitami, nie do wdrożenia.
- Migracja musi trafić do hostowanego projektu przed Workerem; w odwrotnej kolejności tablica pokaże błąd odczytu.
- Kto nie zajrzy przez ponad 7 dni, zobaczy tylko licznik, bez nazwiska przy konkretnej ofercie — to cena wybranego okna.
- `loadBoardFreshness` nadal czyta wiersze zarchiwizowanych audytowanych ofert; nadmiarowe, ale nieszkodliwe przy tej skali.

## Success Criteria (Summary)

- Zarchiwizowana oferta znika z tablicy, a każdy członek widzi na `/dashboard`, w archiwum i na karcie, kto i kiedy ją schował.
- Przywrócona oferta wraca na tablicę z notatkami i audytem dokładnie takimi, jakie były.
- Żaden członek nie podpisze archiwizacji cudzym nazwiskiem i nie uruchomi audytu oferty w archiwum.
