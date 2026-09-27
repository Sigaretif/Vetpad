# Notatki członków obok ogłoszenia — Plan Brief

> Full plan: `context/changes/member-notes/plan.md`

## What & Why

S-05 (US-01, FR-012, FR-013): każdy członek zespołu pisze na karcie oferty jedną własną notatkę — Zalety, Wady, Obserwacje ogólne — i czyta notatki pozostałych podpisane autorem. To zastępuje arkusz z wnioskami o mieszkaniach, rozrzucone dziś po czatach i głowach. Autorstwo jest jedynym ograniczeniem dostępu, a RLS jedyną bramką, więc przepuszczalna polityka byłaby żywą ekspozycją.

## Starting Point

Karta oferty (`src/pages/offers/[id].astro`) pokazuje ogłoszenie i autora zapisu w jednej kolumnie; tabeli notatek nie ma. Nazwę członka daje `public.members` + `src/lib/members.ts` (S-07), na razie tylko dla jednego autora naraz. W `src/components/ui` brakuje `textarea`. Smoke nigdy nie zapisuje danych i loguje się jednym kontem.

## Desired End State

Karta na desktopie ma dwie kolumny: ogłoszenie po lewej, „Notatki zespołu” po prawej (tu S-04 dołoży audyt). Własna notatka to podgląd z „Edytuj” albo — gdy jej nie ma — otwarty formularz trzech pól; notatki innych są podpisane e-mailem, „Osoba z usuniętym kontem” albo nie nazywają nikogo, gdy autora nie da się ustalić. Smoke dowodzi z dwóch kont, że nikt nie zmieni ani nie usunie cudzej notatki.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Notatki usuniętego członka | Zostają z autorem `null`, „osoba z usuniętym kontem”, nikt ich nie edytuje | Żadna akcja systemu nie niszczy tekstu napisanego przez człowieka; rozstrzyga pytanie otwarte w PRD | Plan (użytkownik) |
| Układ karty | Dwie kolumny od `lg`, węziej jedna pod drugą | PRD mówi „obok audytu”; pisze się z ogłoszeniem w zasięgu wzroku | Plan (użytkownik) |
| Edycja własnej notatki | Podgląd + „Edytuj” / „Anuluj”; bez notatki od razu formularz | Spójny wygląd wszystkich notatek | Plan (użytkownik) |
| Trzy puste pola | Odmowa z komunikatem, także przy istniejącej notatce | Brak pustego szumu na karcie; wyczyszczenie to usunięcie, czyli S-11 | Plan (użytkownik) |
| Bramka wizualna | Tak — macierz 7 stanów, zrzuty `gate` i `forms` | Zmiana układu dotyka każdego stanu karty | Plan (użytkownik) |
| Smoke | Pełne RLS z dwóch kont na sztucznej ofercie, usuwanej na końcu | Jedyne automatyczne sprawdzenie ograniczenia zapisu do autora | Plan (użytkownik) |
| Model danych | `offer_notes`, `unique (offer_id, author_id)`, upsert; kaskada z `offers` | Jedna notatka na członka; kaskada zaakceptowana w FR-015 | Plan (CLAUDE.md, PRD) |
| Zapis | Natywny formularz POST `/api/notes` + `?error=` | Konwencja CLAUDE.md; JSON tylko dla autosave/pollingu | Plan (CLAUDE.md) |
| Błąd odczytu notatek | Komunikat bez formularza | Pusty formularz nadpisałby upsertem istniejącą notatkę | Plan |
| Limit i kolejność | 5000 znaków na pole; notatki innych od ostatnio edytowanej | Granica w bazie i w przeglądarce; świeże wnioski na górze | Plan |

## Scope

**In scope:**
- Migracja `offer_notes` z czterema politykami, wyzwalaczem zamrażającym i ograniczeniami
- `resolveAuthors` (jedno `.in`), `src/lib/notes.ts`, `POST /api/notes`
- `textarea` z shadcn, `TextareaField`, `NoteCard`, wyspa `NoteEditor`, `OfferNotes`, `OfferView`, `AppLayout wide`
- Stany w `/dev/offer-card` i `/dev/forms`, zrzuty bramki
- Smoke z dwóch kont, CLAUDE.md, README, rozstrzygnięcie w PRD, `db push` za zgodą

**Out of scope:**
- Usuwanie własnej notatki w UI (S-11) — polityka `delete` powstaje już teraz
- Audyt (S-04), notatki na tablicy, historia edycji, czas rzeczywisty
- Zachowanie wpisanego tekstu po błędzie serwera
- Notatki w prompcie audytu — nigdy

## Architecture / Approach

Strona karty ładuje ofertę, autora zapisu i notatki (jedno zapytanie + jedno `.in` do `members`), a `OfferView` składa `OfferCard` i `OfferNotes` w siatkę. Własna notatka to wyspa `NoteEditor` (podgląd przez wspólny `NoteCard`, formularz z `TextareaField`), notatki innych to ten sam `NoteCard` renderowany statycznie. Formularz wysyła `POST /api/notes`, który robi upsert z autorem z sesji i przekierowuje na `/offers/<id>#notatki` albo z `?error=`. Autorstwo pilnują polityki RLS i wyzwalacz w bazie, nie kod aplikacji.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Tabela `offer_notes` | Schemat, RLS, wyzwalacz, rozstrzygnięcie w PRD | Wyzwalacz blokujący usunięcie konta albo przepuszczalna polityka |
| 2. Odczyt i zapis notatek | `resolveAuthors`, `loadNotes`, `POST /api/notes` sprawdzone curlem | Pomylenie `unknown` z usuniętym kontem |
| 3. Notatki na karcie | Dwie kolumny, edytor, notatki innych, stany w kitchen sinkach | Formularz przy błędzie odczytu nadpisujący notatkę; zdublowane identyfikatory pól |
| 4. Smoke, dokumentacja, bramka, migracja | Smoke z dwóch kont, zrzuty 7 stanów, `db push` | Smoke zostawiający sztuczną ofertę po przerwanym przebiegu (tylko lokalnie) |

**Prerequisites:** S-02 i S-07 (done); lokalny Supabase z seedem (trzy konta); `supabase link` do hostowanego projektu przed `db push`.
**Estimated effort:** ~3–4 sesje w 4 fazach.

## Open Risks & Assumptions

- Tekst wpisany w formularz przepada przy błędzie serwera — akceptowane, bo walidacja w przeglądarce łapie puste i za długie pola.
- Przy szerokości `lg` (1024 px) lewa kolumna ma ok. 550 px — wystarcza na galerię i parametry, sprawdzane na zrzutach.
- `db push` musi poprzedzić wdrożenie Workera; bez tabeli karta pokazuje błąd odczytu notatek zamiast padać.

## Success Criteria (Summary)

- Trzech członków pisze, edytuje i czyta notatki na tej samej karcie, każda podpisana właściwym autorem.
- Nikt nie zmieni ani nie usunie cudzej notatki — dowiedzione w smoke z dwóch kont.
- Notatki usuniętego konta zostają; żaden błąd odczytu nie udaje usuniętego konta ani nie kasuje notatki.

## References

- PRD: `context/foundation/prd.md` — FR-012, FR-013, FR-015, Non-Functional Requirements
- Roadmapa: `context/foundation/roadmap.md` — S-05
- Poprzedni slice: `context/archive/2026-09-26-duplicate-listing-notice/plan.md`
