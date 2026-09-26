# Wspólna tablica ofert — Plan Brief

> Full plan: `context/changes/shared-offer-board/plan.md`

## What & Why

Zapisana karta jest dziś osiągalna tylko zaraz po wklejeniu adresu. Zespół nie ma miejsca, w którym widzi wszystkie oferty naraz, więc nie może porzucić arkusza. To główne kryterium sukcesu z PRD. Zmiana robi z `/dashboard` wspólną tablicę wszystkich zapisanych ofert ze statusem audytu (FR-006, roadmapa S-06).

## Starting Point

`/dashboard` renderuje tylko kartę „Nowa oferta” z formularzem. Topbar „Oferty” i „← Wróć do ofert” na karcie już tam prowadzą. `public.offers` ma politykę `select` dla każdego zalogowanego, więc odczyt nie wymaga migracji. Nie ma tabeli audytów (S-04) ani archiwizacji (S-10).

## Desired End State

Członek zespołu na `/dashboard` widzi formularz dodawania, a pod nim „Zapisane oferty (N)”. Każdy wiersz ma miniaturę, tytuł, cenę, metraż, lokalizację (etykieta i ulica) i odznakę „Nie audytowano”. Kliknięcie otwiera kartę. Listę sortuje po dacie dodania (domyślnie, najnowsze na górze), cenie albo metrażu, w obu kierunkach. Oferta bez ceny nigdy nie udaje najtańszej ani najdroższej. Pusta tablica i błąd odczytu wyglądają inaczej.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Trasa | Tablica na `/dashboard`, formularz nad listą | Nawigacja już tam prowadzi, a plan `ui-remaining-views` odłożył tablicę właśnie tam |
| Układ | Pionowa lista wierszy (Card), miniatura po lewej, cały wiersz jest jednym linkiem | Da się przejrzeć kilkadziesiąt ofert jak w arkuszu, w obecnej ramie `max-w-4xl` |
| Treść wiersza | Tytuł, cena, metraż, lokalizacja (`location_label` i `street_name`), odznaka | Wybór użytkownika. Numeru budynku otodom nie podaje, więc go nie ma |
| Nieznane wartości | `Unstated` „…: nie podano w ogłoszeniu” | Guardrail PRD: nieznane nigdy nie jest „0” ani pustką |
| Status audytu | Odznaka „Nie audytowano” ze stałego `auditStatus()`, punkt podmiany dla S-04 | FR-006 spełnione już teraz, a S-04 zmienia jedno miejsce |
| Sortowanie | `?sort=added\|price\|area&dir=asc\|desc`, linki bez JS, domyślnie data dodania malejąco | Użytkownik chce własnego sortowania. Linki nie wymagają wyspy React |
| Brakujące wartości przy sortowaniu | Zawsze na końcu (`nullsFirst: false`), remis po `id` | Oferta bez ceny nie może wyglądać na najtańszą ani najdroższą |
| Paginacja | Brak | Kilkadziesiąt ofert przy trzech osobach, a S-10 zmniejszy listę |
| Błąd odczytu | Osobny stan (`Alert`) i znacznik `data-board-state`, sprawdzany w smoke | RLS i zepsute zapytanie dają 200, więc sam status niczego nie dowodzi |
| Bramka wizualna | Tak: `/dev/board`, zestaw `board` w `ui-screenshots.mjs`, macierz 7 stanów | Nowy widok z kilkoma stanami. S-10 dostaje gotowe miejsce na stan archiwum |

## Scope

**In scope:**
- `src/lib/offer-board.ts`: sortowanie, kolumny, typ wiersza, `auditStatus()`
- Komponenty `OfferBoard`, `OfferBoardItem`, `BoardSort`, `AuditStatusBadge`
- Nowy `/dashboard` z trzema stanami (lista, pusto, błąd)
- Kroki smoke: sortowanie, stan `ok`, `/dev/board` → 404
- `/dev/board`, zestaw zrzutów, zrzuty bramki
- README, CLAUDE.md i notatki roadmapy

**Out of scope:** nazwa członka, który zapisał ofertę (S-07); prawdziwy status i tabela audytów (S-04); archiwum (S-10); paginacja, filtry i wyszukiwanie; data dodania w wierszu; numer budynku; przeliczanie walut; wyspa React; migracje, nowe zależności i trasy API.

## Architecture / Approach

Czysty moduł `offer-board.ts` trzyma reguły: odczyt `sort`/`dir` z powrotem do domyślnych, kolumny `select` bez `raw` i `description` oraz link zmiany sortowania. `/dashboard` wykonuje jedno zapytanie `from("offers").select(BOARD_COLUMNS).order(col, { ascending, nullsFirst: false }).order("id")` na wzór `loadOffer` z karty. `null` klienta, błąd i wyjątek dają `{ ok: false }`, nigdy 500. Wynik trafia do statycznych komponentów Astro, a `Card`, `Badge` i `Alert` renderują się bez JS. `/dev/board` renderuje te same komponenty z fixtur karty.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Tablica na `/dashboard` | Działająca tablica z sortowaniem, stanami pusty i błąd oraz krokami smoke | Pominięte `nullsFirst: false` przy `desc` pokazuje oferty bez ceny jako najdroższe. Smoke tego nie złapie (pusta baza w CI), łapie to krok ręczny 1.6 |
| 2. Bramka wizualna | `/dev/board`, zestaw `board`, zrzuty macierzy 7 stanów | Selektory fokusu i hovera muszą trafić w sekcję `default`, nie w inne stany na tej samej stronie |
| 3. Dokumentacja | README, CLAUDE.md, notatki S-04 i S-10 w roadmapie | Opis rozjedzie się z kodem, jeśli faza 2 zmieni nazwy |

**Prerequisites:** S-02 done (tabela `offers`, karta `/offers/<id>`). Lokalny Supabase z seedem do smoke'a i zrzutów.
**Estimated effort:** ~2 sesje w 3 fazach.

## Open Risks & Assumptions

- Oferty w innej walucie niż PLN sortują się po samej liczbie. Przyjmujemy to, bo otodom wystawia sprzedaż mieszkań prawie wyłącznie w PLN.
- Miniatury to hotlinki. Po wygaśnięciu ogłoszenia `<img>` może się nie wczytać, a placeholder obejmuje tylko brak URL-a, nie martwy URL. To ta sama strata, którą PRD przyjęło w FR-004.
- Bez paginacji strona rośnie liniowo. Przy kilkuset ofertach trzeba wrócić do tematu.

## Success Criteria (Summary)

- Zespół otwiera „Oferty” i widzi każdą zapisaną ofertę ze statusem „Nie audytowano”, bez zaglądania do arkusza.
- Sortowanie po cenie lub metrażu nigdy nie stawia oferty z nieznaną wartością na pozycji, która sugeruje fakt.
- Smoke potwierdza, że tablica czyta dane (`data-board-state="ok"`) przy każdym sortowaniu, a zrzuty `/dev/board` pokrywają każdy stan.

## References

- Roadmapa S-06: `context/foundation/roadmap.md`
- PRD FR-006 i Guardrails: `context/foundation/prd.md`
- Lekcje (`safeHttpsUrl`, tokeny ról): `context/foundation/lessons.md`
- Wzorce: `src/pages/offers/[id].astro`, `src/pages/dev/offer-card.astro`, `scripts/ui-screenshots.mjs`
