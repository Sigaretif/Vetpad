# Ponowne pobranie ogłoszenia i znacznik nieaktualnego audytu — Plan Brief

> Full plan: `context/changes/refetch-and-stale-audit/plan.md`

## What & Why

Członek zespołu pobiera dane zapisanego ogłoszenia ponownie, na żądanie, a jego notatki
zostają nietknięte (FR-009). Audyt wykonany na starszych danych ogłoszenia albo starszych
kryteriach dostaje znacznik „nieaktualny" z zachętą do ponownego uruchomienia (FR-003) —
bez tego stary audyt po cichu opisuje ofertę i budżet, których już nie ma.

## Starting Point

Baza jest gotowa: `public.offers` ma politykę `update` i kolumnę `fetched_at`, a każdy
audyt zapisuje `criteria_revision` i `listing_fingerprint`. Nic tych wartości nie czyta,
nie ma trasy ponownego pobrania, karta nie pokazuje daty pobrania, a powiadomienie o
duplikacie niczego nie proponuje.

## Desired End State

Na karcie oferty stoi data ostatniego pobrania i przycisk „Pobierz ponownie z otodom.pl";
po pobraniu członek czyta, czy dane się zmieniły, czy są bez zmian. Sekcja audytu i
tablica pokazują, że audyt jest nieaktualny i dlaczego (ogłoszenie, kryteria albo oba), a
gdy nie da się tego ustalić — mówią to wprost. Powiadomienie o duplikacie ma przycisk
ponownego pobrania.

## Key Decisions Made

| Decyzja                                  | Wybór                                                                                        | Dlaczego                                                                                 |
| ---------------------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Zepsuty scraper a prawdziwa zmiana (PRD) | Gdy znika pole czytane przez audyt, nic nie jest zapisywane; członek może świadomie nadpisać | Zepsuty scraper zwykle gubi pola, a prawdziwe usunięcie kosztuje tylko drugie kliknięcie |
| Zakres zgody na utratę                   | Zgoda dotyczy dokładnie pól, które członek zobaczył                                          | Drugie pobranie może zgubić coś jeszcze                                                  |
| Zasięg znacznika                         | Karta i tablica                                                                              | Po zmianie kryteriów tablica pokazuje, co czeka na ponowny audyt                         |
| Informacja po pobraniu                   | „Dane się zmieniły" albo „bez zmian", plus stała data pobrania                               | „Bez zmian" daje pewność, że audyt nadal dotyczy aktualnej treści                        |
| Jak liczona jest aktualność              | Przy odczycie, z zapisanej rewizji i odcisku; bez flagi w bazie                              | Roadmapa i reguły projektu: jeden mechanizm, żadna maszyna nie rusza audytu              |
| Nie da się ustalić                       | Osobny stan na karcie i osobna etykieta na tablicy                                           | Nieudany odczyt nigdy nie udaje „aktualny"                                               |
| Inne ogłoszenie pod adresem              | Odmowa, gdy `otodom_id` się różni                                                            | Nadpisanie obcymi danymi byłoby cichą podmianą oferty                                    |
| Bramka wizualna                          | Bez bramki                                                                                   | Decyzja użytkownika; nowe stany i tak dostają sekcje na `/dev/*`                         |
| Testy                                    | Vitest, smoke przez Data API, Stryker na dwóch regułach, jedno ręczne pobranie               | Obie reguły decydują o wiarygodności znacznika; otodom nie jest dostępny dla automatów   |

## Scope

**In scope:**

- Trasa `POST /api/offer-refetch` z komunikatem dla każdej przyczyny
- Reguła aktualności audytu i reguła utraconych pól
- Blok pobrania na karcie, komunikat po pobraniu, przycisk w powiadomieniu o duplikacie
- Znacznik w sekcji audytu i dwa nowe statusy na tablicy
- Nowe stany na `/dev/offer-card`, `/dev/forms`, `/dev/board`
- Kroki smoke, `CLAUDE.md`, `README.md`, zamknięcie pytania otwartego nr 1 w PRD

**Out of scope:**

- Migracje, nowe kolumny, zapisywana flaga nieaktualności
- Historia i różnice wartości; wykrywanie błędnie zmienionej wartości
- Pobieranie w tle, uruchamianie albo usuwanie audytu przez pobranie
- Oznaczanie ogłoszenia jako wygasłego, zmiana `source_url`
- Spec Playwright, bramka wizualna, nowe zależności

## Architecture / Approach

Dwie czyste funkcje w `src/lib/` — `auditFreshness` i `lostFacts` — niosą obie decyzje, a
trasa i widoki tylko je pytają. Trasa powtarza porządek trasy dodawania: darmowe
sprawdzenia, jedno pobranie przez `ingestOffer`, jeden zapis w `public.offers` oceniany
po liczbie wierszy; nie dotyka notatek ani audytów, czego pilnuje reguła lint. Karta
liczy bieżący odcisk z wiersza, który i tak czyta; tablica — osobnym odczytem tylko dla
ofert z wynikiem audytu.

## Phases at a Glance

| Faza                        | Co dostarcza                                           | Główne ryzyko                                                |
| --------------------------- | ------------------------------------------------------ | ------------------------------------------------------------ |
| 1. Reguły i odczyty         | Obie reguły, wartości porównawcze w odczytach, Stryker | Zmiana kształtu `AuditIndex` dotyka istniejącej tablicy      |
| 2. Trasa ponownego pobrania | Działająca trasa z testami i logiem                    | Komunikaty trasy dodawania muszą zostać co do znaku          |
| 3. Karta oferty             | Przycisk, komunikaty, znacznik audytu, duplikat        | Dwa formularze dzielą `?error=` na jednej stronie            |
| 4. Tablica                  | Statusy „nieaktualny" i „aktualność nieznana"          | Dodatkowy odczyt opisów rośnie z liczbą audytowanych ofert   |
| 5. Smoke i dokumentacja     | Dowód na lokalnej bazie, reguły projektu, PRD          | Smoke musi policzyć odcisk sam i nigdy nie sięgnąć do otodom |

**Prerequisites:** S-03, S-04 i S-05 ukończone (są); lokalny Supabase z seedem dla smoke.
**Estimated effort:** około 4–5 sesji w 5 fazach.

## Open Risks & Assumptions

- Zatrzymanie łapie tylko utratę pola. Scraper, który zwraca błędną, ale podaną wartość,
  nadal oznaczy audyt jako nieaktualny — przyjęte ograniczenie.
- Kryteria zmienione i przywrócone dają inną rewizję, więc audyt zostaje „nieaktualny",
  choć treść kryteriów jest ta sama. Ogłoszenie zmienione i przywrócone wraca do
  „aktualny", bo odcisk jest ten sam.
- Założenie: wartości `AUDIT_OFFER_COLUMNS` wracają z bazy tak samo przy każdym odczycie,
  więc odcisk wiersza jest stabilny (dowodzi tego dotychczasowe działanie audytu).
- Ręczna weryfikacja sięga do prawdziwego otodom.pl; blokada po stronie portalu
  opóźni ostatni krok, nie zmieniając planu.

## Success Criteria (Summary)

- Po ponownym pobraniu każda notatka czyta się dokładnie tak, jak zostawił ją autor.
- Audyt wykonany przed zmianą ogłoszenia albo kryteriów jest oznaczony na karcie i
  tablicy, z powodem, i żadna maszyna go nie uruchamia ani nie usuwa.
- Nieudane albo wątpliwe pobranie nie zmienia zapisanej oferty i mówi dlaczego.
