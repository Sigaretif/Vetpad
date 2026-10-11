# Usuwanie oferty i własnej notatki — Plan Brief

> Full plan: `context/changes/delete-offer-and-notes/plan.md`

## What & Why

Slice S-11 (FR-015): członek usuwa zapisaną ofertę — żywą albo zarchiwizowaną — oraz własną notatkę. Twarde usuwanie sprząta prawdziwe pomyłki, takie jak błędnie wklejony adres; PRD przyjął, że z ofertą znikają notatki całego zespołu. To ostatni slice strumienia „Team notes”.

## Starting Point

Baza jest gotowa: polityki usuwania istnieją, a notatki i audyt mają `on delete cascade` od oferty. Aplikacja nie ma żadnego usuwania oferty ani notatki — `src/pages/api/notes.ts` to sam upsert bez logu i bez testu, a w `src/components/ui/` nie ma dialogu.

## Desired End State

Na karcie każdej oferty i w wierszu `/offers/archive` stoi „Usuń ofertę”, a przy własnej notatce „Usuń”. Każdy przycisk otwiera dialog, który mówi, co zniknie; po potwierdzeniu członek wraca tam, gdzie pracował, z banerem o wyniku. Cudzej notatki nie da się usunąć osobno.

## Key Decisions Made

| Decyzja                     | Wybór                                                                        | Dlaczego                                                                        |
| --------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Potwierdzenie usunięcia     | Dialog Radix (`alert-dialog` z shadcn) dla oferty i dla notatki              | Jeden wzorzec nieodwracalnej akcji, z treścią i wyglądem pod naszą kontrolą     |
| Gdzie stoi przycisk         | Żywa oferta: tylko karta; zarchiwizowana: karta i wiersz archiwum            | Wiersz tablicy zostaje samym linkiem, bez przycisku do trafienia przypadkiem    |
| Po udanym usunięciu         | Z karty → `/dashboard`, z wiersza archiwum → `/offers/archive`; baner `info` | Członek zostaje w swoim widoku i dostaje jawne potwierdzenie                    |
| Zero usuniętych wierszy     | Osobna informacja „już jej nie było”, w logu `already_gone`                  | Cel jest osiągnięty, ale nie tą ręką — to ani sukces, ani błąd                  |
| Audyt w toku                | Usunięcie przechodzi; trasa nie czyta audytu                                 | Nikt nie potrzebuje wyniku audytu oferty, którą zespół wyrzucił                 |
| Dwa okna tego samego autora | Usunięcie zabiera notatkę w brzmieniu z bazy                                 | Oba okna należą do osoby, która właśnie potwierdziła usunięcie                  |
| Trasa oferty                | Nowa `POST /api/offer-delete`, jeden zapis bez wcześniejszego odczytu        | Usunięcie nie jest ruchem między dwoma stanami archiwum                         |
| Trasa notatki               | Pole `intent` w `/api/notes`: brak lub `save` zapisuje, `delete` usuwa       | Wzorzec z `/api/requirements`; dotychczasowy zapis nie zmienia zachowania       |
| Log                         | Obie trasy logują każde wyjście; usunięcie oferty niesie `otodom_id`         | PRD odsyła administratora do logów, a po usunięciu wiersza nie ma skąd go wziąć |
| Bramka wizualna             | Bez bramki                                                                   | Decyzja użytkownika; nowe stany i tak dostają sekcje na `/dev/*`                |

## Scope

**In scope:**

- trasa `POST /api/offer-delete` i intencja `delete` w `POST /api/notes`, z logiem i testami;
- prymityw `alert-dialog`, token nakładki, kompozyt `ConfirmDialog`;
- przyciski na karcie, w wierszu archiwum i przy własnej notatce;
- banery wyniku na `/dashboard`, `/offers/archive` i karcie;
- sekcje na `/dev/forms`, `/dev/offer-card`, `/dev/board`;
- kroki smoke, jedna specyfikacja Playwright, PRD, `CLAUDE.md`, README, plan testów.

**Out of scope:**

- migracje i zmiany polityk;
- przycisk usuwania w wierszu tablicy;
- kosz, cofanie, ślad po usuniętej ofercie;
- usuwanie cudzej notatki i notatki osoby z usuniętym kontem;
- blokada albo ostrzeżenie przy trwającym audycie;
- zamiana istniejących `window.confirm` na dialog;
- zrzuty ekranu i macierz 7 stanów;
- działanie przycisków usuwania bez JavaScriptu.

## Architecture / Approach

Wyspa z dialogiem trzyma natywny formularz `POST`. Trasa wysyła jedno usunięcie z prośbą o usunięte wiersze i po ich liczbie wybiera adres powrotu: jeden wiersz to `?deleted=1` (notatka: `?note=deleted`), zero to `?deleted=gone` (`?note=gone`), awaria to `?error=…&form=delete` albo `&form=note-delete`. Strony czytają te parametry przez białe listy i renderują baner; notatki i audyt usuwa kaskada w bazie, której trasa oferty nie dotyka.

## Phases at a Glance

| Faza                         | Co dostarcza                                                            | Główne ryzyko                                                            |
| ---------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 1. Trasy usuwania            | `POST /api/offer-delete`, intencja `delete` i log w `/api/notes`, testy | Zero wierszy odczytane jako sukces albo zmiana zachowania zapisu notatki |
| 2. Dialog i widoki           | Prymityw, `ConfirmDialog`, przyciski, banery, kitchen sinki             | Dialog zamknięty przed wysyłką formularza; błąd usunięcia otwiera edytor |
| 3. Smoke, E2E i dokumentacja | Kroki smoke przez trasy, specyfikacja dialogu, dokumenty                | Usunięta notatka psuje kroki smoke, które oczekują notatek obu kont      |

**Prerequisites:** lokalny Supabase dla smoke i Playwrighta; S-05, S-09 i S-10 są zakończone.
**Estimated effort:** ok. 3 sesje, po jednej na fazę; faza 2 jest największa.

## Open Risks & Assumptions

- Gdyby baza nie zobaczyła sesji członka, usunięcie trafiłoby w zero wierszy i trasa zgłosiłaby „już jej nie było”, choć oferta istnieje; żaden odczyt tego nie odróżni, a middleware potwierdza sesję tym samym ciasteczkiem.
- Opłacony audyt przepada, gdy ktoś usunie ofertę w jego trakcie; uruchamiający widzi niepowodzenie `claim_lost`.
- Nakładka dialogu z rejestru shadcn używa literału koloru; plan zakłada nowy token roli w `global.css`.
- Bez bramki wizualnej wygląd dialogu i przycisku destrukcyjnego ocenia się ręcznie w fazie 2.

## Success Criteria (Summary)

- Członek usuwa ofertę z karty albo z archiwum i własną notatkę, każdorazowo po potwierdzeniu w dialogu, i widzi baner o wyniku.
- Usunięcie oferty zabiera notatki zespołu i audyt, a nic z innej oferty; usunięcie notatki zostawia notatki pozostałych członków.
- Druga osoba usuwająca tę samą ofertę dowiaduje się, że oferty już nie było.
