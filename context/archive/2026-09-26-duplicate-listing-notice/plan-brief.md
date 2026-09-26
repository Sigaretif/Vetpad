# Komunikat o duplikacie z autorem zapisu — Plan Brief

> Full plan: `context/changes/duplicate-listing-notice/plan.md`

## What & Why

S-07 (FR-005): członek, który wkleja adres już zapisanej oferty, ląduje na istniejącej karcie i dowiaduje się, **kto** ją zapisał. Na trzyosobowej tablicy to najważniejsza informacja — że ktoś inny już tę ofertę ma na oku. Przy okazji powstaje jedno źródło nazwy członka, z którego skorzystają S-05 (autor notatki) i S-10 (kto zarchiwizował).

## Starting Point

S-02 wykrywa duplikat przed pobraniem (znormalizowany `source_url`) i po pobraniu (`otodom_id`), przekierowuje na `/offers/<id>?duplicate=1` i pokazuje ogólny baner. `offers.created_by` trzyma uuid autora (`null` po usunięciu konta), ale `auth.users` nie jest czytelne przez Data API, więc aplikacja nie potrafi zamienić go na nazwę.

## Desired End State

Baner duplikatu mówi „Ta oferta była już zapisana przez sigaretif2@vetpad.local — otwieramy istniejącą kartę." (albo „przez Ciebie", albo „przez konto usunięte"), a nagłówek każdej karty ma linię „Zapisane przez … · 20 września 2026". Gdy autora nie da się ustalić, baner wraca do obecnego tekstu, a nagłówek pokazuje samą datę — nigdy „konto usunięte".

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Źródło nazwy członka | Tabela `public.members` (id, email) wypełniana wyzwalaczami z `auth.users` | RLS zostaje jedyną bramką, a S-05/S-10 czytają z niej zwykłym `select`. |
| Zapis do `members` | Tylko wyzwalacz `security definer`; brak polityk zapisu | E-mail należy do Supabase Auth — odmowa jest zamierzona, nie luka. |
| Nazwa członka | Pełny adres e-mail | Tak jak w Topbarze; bez nowych danych i ręcznych kroków w panelu. |
| Oglądający jest autorem | „…zapisana przez Ciebie" | Naturalniejsze niż czytanie własnego adresu. |
| Zasięg | Baner **i** stała linia w nagłówku karty | Decyzja użytkownika: autor przydaje się także poza duplikatem. |
| Błąd odczytu autora | Wariant nieustalony, nigdy „konto usunięte" | „Konto usunięte" to fakt wynikający tylko z `created_by = null`. |
| Źródło autora | Wiersz oferty, nie parametr adresu | `?duplicate=1` da się dopisać ręcznie; nazwa w URL-u byłaby do podrobienia. |
| Bramka wizualna | Tak — macierz 7 stanów, zrzuty `gate` | Zmienia się nagłówek karty, a długi e-mail przy 375 px to realne ryzyko. |

## Scope

**In scope:** migracja `members` z RLS, `src/lib/members.ts`, komponent `DuplicateNotice`, linia autora w `OfferCard`, formater daty w strefie `Europe/Warsaw`, warianty na `/dev/offer-card`, dwa kroki smoke (anon `[]`, członek widzi wiersze), wpisy w CLAUDE.md i README, zrzuty bramki, `db push` za zgodą.

**Out of scope:** oferta re-fetchu na komunikacie (czeka na S-09), `display_name`, autor na tablicy, autorzy notatek i archiwizacji, zmiany w `src/pages/api/offers.ts`, dopasowanie międzyportalowe i relisting.

## Architecture / Approach

`offers/[id].astro` po wczytaniu oferty woła `resolveSaver(supabase, created_by, viewerId)` → `self` | `member(email)` | `deleted` | `unknown`. Ten sam wynik trafia do `DuplicateNotice` (tylko przy `?duplicate=1`) i do nowego propsu `saver` w `OfferCard`. `resolveSaver` czyta `members` po kluczu głównym i nigdy nie rzuca, więc karta nigdy nie zwraca 500. Kitchen sink renderuje te same komponenty z fixtur, bez Supabase.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Tabela `members` | Migracja, wyzwalacze, uzupełnienie kont, RLS tylko `select` | Wyzwalacz na `auth.users`, który przy błędzie zablokowałby tworzenie konta |
| 2. Autor na karcie i w banerze | `resolveSaver`, `DuplicateNotice`, linia w nagłówku, fixtury | Pomylenie wariantu nieustalonego z „konto usunięte" |
| 3. Smoke, dokumentacja, bramka, wdrożenie | Kroki RLS w smoke, CLAUDE.md/README, zrzuty, `db push` | Worker na `master` przed `db push` (karta działa, ale bez autora) |

**Prerequisites:** S-02 (gotowe); lokalny Supabase (`npx supabase start`) do weryfikacji i zrzutów; zgoda użytkownika na `db push`.
**Estimated effort:** ~1–2 sesje w 3 fazach.

## Open Risks & Assumptions

- Zakładamy, że hostowany projekt pozwala na wyzwalacze na `auth.users` (standardowy wzorzec Supabase) — sprawdza to `db push`.
- E-maile członków są widoczne dla pozostałych członków; przy zespole, który się zna, to akceptowalne.
- Security Advisor Supabase może zgłosić funkcję `security definer` w `public`; odebrany `execute` powinien to wyciszyć — weryfikacja w fazie 1.

## Success Criteria (Summary)

- Wklejenie zapisanego adresu (z parametrami śledzącymi lub bez) prowadzi na istniejącą kartę z banerem nazywającym autora, bez drugiego wiersza.
- Każda karta pokazuje, kto i kiedy ją zapisał; usunięte konto czyta się „konto usunięte", błąd odczytu nie udaje żadnego faktu.
- Anon nie czyta `members`, członek czyta — sprawdzane w smoke przy każdym PR.
