# Kryteria wyszukiwania zespołu — plan implementacji

## Overview

Realizujemy S-03 (FR-002, FR-003). Zespół ustawia **wspólne twarde limity** — miasto, cenę od/do, minimalny metraż — które edytuje każdy członek, a każdy członek pisze **własne wymagania dodatkowe** (wolny tekst), które zapisuje, zmienia i usuwa tylko on, a czytają wszyscy. Baza prowadzi **licznik rewizji kryteriów**, podbijany przy każdej realnej zmianie limitów lub czyichkolwiek wymagań — S-04 zapisze go w audycie, a S-09 oznaczy audyt jako nieaktualny, gdy licznik się zmieni. Tablica ofert (`/dashboard`) dostaje **znacznik „poza limitem”** przy ofercie, której podany w ogłoszeniu fakt łamie limit; fakt niepodany nigdy limitu nie łamie.

## Current State Analysis

- W `src/`, `supabase/` i `scripts/` nie ma nic o kryteriach. Jedyne konsumenty limitów w PRD to audyt (FR-010, Business Logic) i — od tej zmiany — znacznik na tablicy.
- Najbliższy wzorzec to notatki S-05: `supabase/migrations/20260926202537_create_offer_notes.sql` (RLS według autorstwa, trigger zamrażający, gałąź usuniętego konta), `supabase/migrations/20260927133501_offer_notes_server_timestamps.sql` (daty ustawia baza), trasa `src/pages/api/notes.ts` (FormData → `?error=`), `src/lib/notes.ts` (błąd odczytu to osobny stan), wyspa `src/components/offers/NoteEditor.tsx` z kompozytów `src/components/form/`.
- `supabase/migrations/20260926185936_create_members.sql` to wzorzec tabeli zapisywanej wyłącznie przez trigger `security definer` — bez polityk zapisu, i ta odmowa jest zamierzona.
- W repo nie ma jeszcze żadnej ścieżki usuwania z UI (notatki mają tylko zapis; usuwanie notatek to S-11). Ten slice ustala wzorzec: pole `intent` w formularzu tej samej trasy.
- `src/middleware.ts:4` chroni `["/dashboard", "/offers"]`; `src/components/Topbar.astro` ma jeden link „Oferty”.
- Tablica: `src/pages/dashboard.astro` czyta oferty przez `BOARD_COLUMNS` (`src/lib/offer-board.ts:62`), wiersz to `src/components/offers/OfferBoardItem.astro`; kitchen sink `/dev/board` renderuje stany z `src/pages/dev/_offer-fixtures.ts`.
- `location_label` to `fullName` z `reverseGeocoding` o najdłuższej hierarchii, np. „Praga-Południe, Warszawa, mazowieckie” (`context/foundation/ingestion/otodom_fetching.md:446`); `address.city` bywa `null` (§7.3). `price_currency` to kod ISO („PLN”) albo `null`.
- `Badge` (`src/components/ui/badge.tsx`) nie ma wariantu ostrzegawczego; tokeny `--color-warning` / `--color-warning-foreground` istnieją w `src/styles/global.css:141-142`.

## Desired End State

- `/criteria` („Kryteria” w Topbarze) pokazuje wspólne limity z „ostatnio zmienił(a) X, data”, formularz ich edycji z „Wyczyść limity”, własne wymagania (podgląd + „Edytuj”/„Usuń”, bez wymagań od razu formularz) i wymagania pozostałych członków podpisane autorem. Nieustawiony limit czyta się „bez limitu”, nigdy 0.
- Nieudany odczyt kryteriów pokazuje błąd i **nie renderuje formularzy** — nikt nie nadpisze wspólnego wiersza pustymi polami.
- Wiersz tablicy, którego podana cena / metraż / lokalizacja łamie limit, niesie odznakę nazywającą złamany limit. Nieudany odczyt limitów na tablicy jest widocznym komunikatem, nie „brakiem znaczników”.
- `public.criteria_revision.revision` rośnie dokładnie przy realnej zmianie kryteriów (także przy usunięciu wymagań i usunięciu konta), a nie rośnie przy zapisie tych samych wartości.
- Smoke dowodzi z dwóch kont RLS wszystkich trzech tabel, zachowania licznika i znacznika; bramka wizualna ma zrzuty każdego stanu macierzy.

### Key Discoveries:

- Upsert przez PostgREST sprawdza politykę `select` względem starego i nowego wiersza (`create_offer_notes.sql:110-112`) — polityka `select` wymagań nie może być węższa niż „każdy zalogowany”.
- `on delete set null` wykonuje się jako UPDATE i przechodzi przez trigger zamrażający; bez gałęzi „konto już nie istnieje” usunięcie konta się wywraca (lekcja „Declare `on delete`…”, `context/foundation/lessons.md:12-17`).
- WITH CHECK polityki RLS jest oceniane na wierszu **po** triggerach `before`, więc to, co ustawi trigger (`updated_by`), jest tym, co widzi polityka — polityka nie może więc wymagać `updated_by = auth.uid()`, skoro trigger zostawia stary podpis przy zapisie bez zmian.
- Błąd odczytu z RLS wygląda jak `[]` z HTTP 200 (`CLAUDE.md`) — stąd znaczniki `data-criteria-state` i `data-limits-state` sprawdzane w smoke.

## What We're NOT Doing

- **Filtrowanie ani ukrywanie** ofert spoza limitów — tylko znacznik; oferta nigdy nie znika z tablicy bez akcji członka (duch FR-014).
- **Znacznik na karcie oferty** (`/offers/[id]`) — tylko tablica, której dotyczy „govern the whole board”.
- **Porównanie cen w innej walucie niż PLN** — cena w innej walucie albo bez waluty jest dla znacznika nieznana.
- **Wiele „wyszukiwań”** — jeden zestaw kryteriów na zespół („single global team state”, PRD Non-Goals).
- **Wykrywanie konfliktu jednoczesnej edycji limitów** — wygrywa późniejszy zapis, zmiana jest podpisana.
- **Stan „nieaktualny” audytu** — tu tylko licznik; porównanie i etykieta to S-04/S-09.
- **Wymóg ustawienia kryteriów przed audytem** — decyzja S-04.
- **Okno dialogowe z Radixa** do potwierdzenia usunięcia — natywne `window.confirm` wystarcza; wzorzec dialogu może wprowadzić S-11.
- **Dane seedowe kryteriów** w `supabase/seed.sql`.

## Implementation Approach

Najpierw schemat, RLS i triggery, sprawdzone przez REST z dwóch kont i przez usunięcie konta, zanim cokolwiek od nich zależy (faza 1). Potem warstwa danych, czysta funkcja porównania i dwie trasy formularzy, sprawdzone curlem (faza 2). Potem widok `/criteria` z kitchen sinkami (faza 3), znacznik na tablicy (faza 4), a na końcu smoke, dokumentacja, bramka wizualna i `db push` za zgodą (faza 5).

## Critical Implementation Details

- **Licznik tylko przez trigger.** `criteria_revision` nie ma polityk zapisu; podbija go jedna funkcja `security definer` wołana z triggerów `after` obu tabel kryteriów, i to tylko przy realnej zmianie (`is distinct from`). Wiersz limitów nie trzyma licznika — gdyby trzymał, trigger zamrażający musiałby odróżniać zapis klienta od podbicia.
- **Kolejność w triggerze limitów.** Najpierw gałąź usuniętego konta (`updated_by` → `null` tylko gdy konta już nie ma; nic więcej się nie zmienia), potem: limity zmienione → `updated_by := auth.uid()`, `updated_at := now()`; niezmienione → oba z `old`. Zapis tych samych wartości nie zmienia podpisu ani licznika.
- **Miasto.** Porównanie po normalizacji (małe litery, usunięte znaki diakrytyczne przez NFD **i** jawne `ł → l`, bo „ł” nie rozkłada się w NFD, przycięte spacje) z każdym członem `location_label` rozdzielonym przecinkami. Limit „Warszawa” łamie „Ząbki, wołomiński, mazowieckie”, nie łamie „Stary Mokotów, Mokotów, Warszawa, mazowieckie”.

## Phase 1: Schemat, RLS i licznik rewizji

### Overview

Jedna migracja tworzy trzy tabele z RLS, triggerami i wierszami singletonów; sprawdzona lokalnie przez REST z tokenami dwóch kont seedowych i przez usunięcie konta.

### Changes Required:

#### 1. Migracja kryteriów

**File**: `supabase/migrations/<timestamp>_create_team_criteria.sql` (przez `supabase migration new create_team_criteria`)

**Intent**: Przechować wspólne limity, wymagania członków i licznik rewizji tak, żeby RLS był jedyną i wystarczającą bramką, a licznik był faktem bazy. Komentarz nagłówkowy w stylu `create_offer_notes.sql` wyjaśnia: FR-002/FR-003, limity edytuje każdy członek, wymagania tylko autor, czytają wszyscy (PRD: „disagreement surfaces”), kryteria mogą trafić do dostawcy modelu (PRD NFR), dlaczego `cascade` dla wymagań, sygnatury odmowy RLS i zależność od wyłączonych anonimowych logowań.

**Contract**:

- `public.team_criteria` — singleton: `id boolean primary key default true check (id)`, `city text` (≤ 100 znaków, niepusty po `btrim` albo `null`), `price_min numeric`, `price_max numeric`, `area_min numeric` (każda `> 0` albo `null`), check `price_min <= price_max` gdy oba ustawione, `updated_at timestamptz`, `updated_by uuid references auth.users (id) on delete set null`. Migracja wstawia jedyny wiersz (wszystkie limity `null`).
  - Trigger `before update` (`security definer`, `search_path = ''`, `revoke execute`): zamraża `id`; gałąź usuniętego konta; ustawia `updated_by`/`updated_at` tylko przy zmianie limitu (patrz Critical Implementation Details).
  - RLS: `select` i `update` `to authenticated` z `using`/`with check (auth.uid() is not null)` — nie `updated_by = auth.uid()`, bo zapis tych samych wartości zostawia poprzedni podpis i taka polityka odrzuciłaby go jako naruszenie RLS; podpis gwarantuje trigger; **brak** polityk `insert` i `delete` — singleton istnieje z migracji, „usunięcie limitów” to zapis `null`. Komentarz nazywa tę odmowę zamierzoną, jak w `create_members.sql`.
- `public.member_requirements`: `author_id uuid primary key references auth.users (id) on delete cascade`, `body text not null` (check `body ~ '\S'`, `char_length(body) <= 2000`), `created_at`, `updated_at`.
  - Triggery jak w notatkach: `before insert` ustawia obie daty na `now()`; `before update` zamraża `author_id`, `created_at`, ustawia `updated_at := now()`.
  - RLS: `select` dla każdego zalogowanego; `insert`/`update`/`delete` na `author_id = auth.uid()`.
  - `on delete cascade`: wymagania osoby, która opuściła zespół, przestają sterować audytem; nikt inny nie mógłby ich zmienić ani usunąć.
- `public.criteria_revision` — singleton: `id boolean primary key default true check (id)`, `revision bigint not null default 0`, `changed_at timestamptz not null default now()`. Migracja wstawia wiersz. RLS: tylko `select` dla zalogowanych; brak polityk zapisu (zamierzone).
  - `public.bump_criteria_revision()` (`security definer`, `search_path = ''`, `revoke execute`): `revision + 1`, `changed_at := now()`.
  - Triggery `after`: na `team_criteria` `after update … when` któryś z czterech limitów `is distinct from`; na `member_requirements` `after insert`, `after delete` i `after update … when (old.body is distinct from new.body)`.

### Success Criteria:

#### Automated Verification:

- `npx supabase db reset` stosuje migrację bez błędów, a `team_criteria` i `criteria_revision` mają po jednym wierszu
- `npm run lint`, `npx astro sync` i `npx astro check` przechodzą

#### Manual Verification:

- REST z tokenami dwóch kont seedowych: oba czytają limity, wymagania obu i licznik; anon dostaje `[]` ze wszystkich trzech tabel
- `insert` i `delete` na `team_criteria` oraz jakikolwiek zapis `criteria_revision` są odrzucane (403 `42501` albo 0 wierszy); drugi członek nie zmieni ani nie usunie cudzych wymagań (0 wierszy), a wstawienie wymagań podpisanych cudzym `author_id` kończy się `42501`
- Zmiana limitu podbija licznik i ustawia `updated_by`; zapis tych samych wartości nie zmienia ani licznika, ani `updated_by`/`updated_at`; PATCH `updated_by` na cudze id wraca do wartości z triggera
- Dodanie, zmiana i usunięcie wymagań podbija licznik; PATCH tego samego `body` nie
- Usunięcie lokalnego konta (poza kontami używanymi przez smoke), które ostatnio zmieniło limity i ma wymagania: konto znika bez błędu, `updated_by` staje się `null`, jego wymagania znikają, licznik rośnie

**Implementation Note**: Po automatycznej weryfikacji zatrzymaj się na ręczne potwierdzenie przed kolejną fazą.

---

## Phase 2: Warstwa danych, porównanie z limitami i trasy

### Overview

Moduły w `src/lib/` (typy, walidacja, odczyt, czyste porównanie) i dwie trasy formularzy, sprawdzone curlem bez UI.

### Changes Required:

#### 1. Kryteria — typy, walidacja, odczyt

**File**: `src/lib/criteria.ts`

**Intent**: Jedno miejsce na reguły kryteriów, współdzielone przez trasy i wyspy (jak `src/lib/notes.ts`: tylko import typu z `@/lib/supabase`, żeby `astro:env/server` nie trafił do paczki wyspy).

**Contract**:

- `TeamLimits = { city: string | null; priceMin: number | null; priceMax: number | null; areaMin: number | null }`.
- `parseLimitsForm(values: Record<"city"|"price_min"|"price_max"|"area_min", string>)` → `{ ok: true; limits } | { ok: false; error: string }`: przycina miasto (puste → `null`, > 100 znaków → błąd); liczby akceptują cyfry z opcjonalnymi spacjami („850 000”), puste → `null`, `0`/ujemne/nieliczbowe → błąd; `priceMin > priceMax` → błąd. Komunikaty po polsku, jeden na przyczynę.
- `REQUIREMENTS_MAX_LENGTH = 2000`, `requirementsError(body)` (puste/same białe znaki, za długie) — pure, jak `noteError`.
- `loadCriteria(supabase | null, viewerId)` → `{ state: "ok"; limits; limitsChangedBy: Saver | null; limitsChangedAt: string | null; own: RequirementsView | null; others: RequirementsView[] } | { state: "error" }`. Autorów nazywa `resolveAuthors`, zmieniającego limity `resolveSaver` (`src/lib/members.ts`). Brak klienta, błąd zapytania, brak wiersza singletonu albo wyjątek → `error`; nigdy nie rzuca.
- `loadTeamLimits(supabase | null)` → `{ ok: true; limits } | { ok: false }` — lekki odczyt dla tablicy.

#### 2. Porównanie oferty z limitami

**File**: `src/lib/team-limits.ts`

**Intent**: Czysta funkcja (bez importów runtime, jak `src/lib/offer-board.ts`), która mówi, które limity łamie **podany** fakt oferty; niepodany fakt nigdy nie łamie limitu (PRD, Guardrails).

**Contract**: `LimitBreach = "city" | "price_above" | "price_below" | "area_below"`; `limitBreaches(offer: Pick<OfferBoardItem, "price" | "price_currency" | "area_m2" | "location_label">, limits: TeamLimits): LimitBreach[]` w stałej kolejności. Cena porównywana tylko przy `price !== null` i `price_currency === "PLN"`; granice włącznie (`price === priceMax` mieści się). Metraż: `area_m2 !== null && area_m2 < areaMin`. Miasto: `location_label !== null` i żaden znormalizowany człon nie równa się znormalizowanemu miastu (Critical Implementation Details). Eksportuje też `normalizePlace(value)`.

#### 3. Trasa limitów

**File**: `src/pages/api/criteria.ts`

**Intent**: Zapis i wyczyszczenie wspólnych limitów z formularza (FR-002, FR-003), według wzorca `src/pages/api/notes.ts`.

**Contract**: `POST` z FormData: `intent` = `save` | `clear`, pola `city`, `price_min`, `price_max`, `area_min`. Brak sesji → `/auth/signin`; brak klienta, nieczytelny formularz, błąd walidacji, naruszenie checku (`23514`) albo inny błąd → `/criteria?error=<komunikat>#limity`; sukces → `/criteria#limity`. `save` aktualizuje singleton (`.update(…).eq("id", true)`) wartościami z `parseLimitsForm`; `clear` zapisuje cztery `null`. `updated_by` z sesji (trigger i tak go ustawia). Nigdy JSON, nigdy 500.

#### 4. Trasa wymagań

**File**: `src/pages/api/requirements.ts`

**Intent**: Zapis, zmiana i usunięcie własnych wymagań; autor zawsze z sesji, nigdy z formularza.

**Contract**: `POST` z FormData: `intent` = `save` | `delete`, `body` (CRLF → `\n`, bez przycinania, jak `noteField`). `save` → `upsert({ author_id: user.id, body }, { onConflict: "author_id" })`; `delete` → `delete().eq("author_id", user.id)` (brak wiersza to nie błąd). Błędy → `/criteria?error=<komunikat>#wymagania`; sukces → `/criteria#wymagania`.

### Success Criteria:

#### Automated Verification:

- `npm run lint`, `npx astro sync`, `npx astro check` i `npm run build` przechodzą

#### Manual Verification:

- curl z ciasteczkiem sesji: zapis limitów, zapis z `price_min > price_max`, `0` i tekstem w polu liczbowym, `clear` — każdy kończy się oczekiwanym przekierowaniem, a stan w bazie się zgadza
- curl: zapis, zmiana i usunięcie własnych wymagań; puste i za długie `body` → `?error=`; body nie-formularz → `?error=`, nigdy 500
- Bez sesji obie trasy przekierowują do `/auth/signin`

**Implementation Note**: Po automatycznej weryfikacji zatrzymaj się na ręczne potwierdzenie przed kolejną fazą.

---

## Phase 3: Widok `/criteria`

### Overview

Strona kryteriów w `AppLayout`, dwie wyspy z kompozytów `src/components/form/`, nawigacja, ochrona trasy i kitchen sinki.

### Changes Required:

#### 1. Strona i widok

**File**: `src/pages/criteria.astro`, `src/components/criteria/CriteriaView.astro`

**Intent**: Strona czyta `loadCriteria` i `?error=`, a cały układ oddaje komponentowi widoku, żeby `/dev/criteria` renderował te same komponenty z fixture'ów. Sekcje „Limity zespołu” (`#limity`) i „Wymagania dodatkowe” (`#wymagania`).

**Contract**: kontener `data-criteria-state="ok"|"error"`. Stan `error`: `ServerError` z `?error=` i alert „Nie udało się wczytać kryteriów.”, **bez formularzy**. Stan `ok`: limity w podglądzie (nieustawiony → „bez limitu”; kwoty przez `formatMoney(…, "PLN")`, metraż przez `formatArea`), podpis „ostatnio zmienił(a) {saverName}, {formatTimestamp}” albo nic, gdy nikt jeszcze nie zmieniał; formularz limitów; własne wymagania; wymagania pozostałych (`RequirementsCard`) z `authorName` i datą, albo „Nikt inny nie wpisał jeszcze wymagań.” Tylko tokeny ról.

#### 2. Wyspa limitów

**File**: `src/components/criteria/TeamLimitsForm.tsx`

**Intent**: Formularz czterech pól (`FormField`, `type="text"` z `inputMode="numeric"` dla liczb, ikony z lucide), walidacja `parseLimitsForm` przed wysłaniem, `SubmitButton` „Zapisz limity” i drugi przycisk `name="intent" value="clear"` „Wyczyść limity” (z `window.confirm`), `usePendingSubmit`, `ServerError`.

**Contract**: default export; propsy `limits: TeamLimits`, `serverError?: string | null`; natywny `method="POST" action="/api/criteria" noValidate`; identyfikatory z `useId()` (kitchen sink renderuje kilka egzemplarzy).

#### 3. Wyspa wymagań i karta wymagań

**File**: `src/components/criteria/RequirementsEditor.tsx`, `src/components/criteria/RequirementsCard.tsx`

**Intent**: Podgląd własnych wymagań z „Edytuj” i „Usuń” (`intent=delete`, `window.confirm`), bez wymagań od razu formularz z `TextareaField` (licznik do 2000); „Anuluj” wraca do podglądu. Wzorzec `NoteEditor.tsx`/`NoteCard.tsx`.

**Contract**: `RequirementsEditor` default export, propsy `own: RequirementsView | null`, `serverError?`, `startEditing?`; `RequirementsCard` named export, renderowany bez dyrektywy `client:*` dla cudzych wymagań.

#### 4. Nawigacja i ochrona

**File**: `src/components/Topbar.astro`, `src/middleware.ts`

**Intent**: Link „Kryteria” obok „Oferty”; `/criteria` w `PROTECTED_ROUTES`.

**Contract**: `PROTECTED_ROUTES = ["/dashboard", "/offers", "/criteria"]`.

#### 5. Kitchen sinki

**File**: `src/pages/dev/criteria.astro`, `src/pages/dev/_criteria-fixtures.ts`, `src/pages/dev/forms.astro`

**Intent**: `/dev/criteria` (tylko `astro dev`, gdzie indziej 404 przez `Astro.response.status`, jak `/dev/board`) renderuje `CriteriaView` w stanach: pełne (limity + własne + dwa cudze), puste (bez limitów, bez wymagań), częściowe limity, zmienione przez usunięte konto, autor nieustalony (`unknown`), błąd odczytu, długie słowo i długi e-mail. `/dev/forms` dostaje kolumny `data-form="limits"` i `data-form="requirements"` w istniejących sekcjach `data-state` (default, hover, focus, disabled, error, empty, loading).

**Contract**: sekcje `data-state` na `/dev/criteria`; stan błędu formularza limitów to błąd inline („Cena od nie może być wyższa niż cena do.”) i `ServerError`.

### Success Criteria:

#### Automated Verification:

- `npm run lint`, `npx astro sync`, `npx astro check` i `npm run build` przechodzą

#### Manual Verification:

- `/criteria` z lokalnym Supabase: zapis, zmiana i wyczyszczenie limitów; zapis, edycja i usunięcie własnych wymagań; drugie konto widzi wymagania pierwszego podpisane e-mailem i „ostatnio zmienił(a)” z właściwą osobą
- Nieustawiony limit czyta się „bez limitu”; błąd walidacji zostaje w formularzu z wpisanymi wartościami, błąd serwera pokazuje `ServerError`
- Bez sesji `/criteria` przekierowuje do `/auth/signin`; bez `.env` strona się renderuje w stanie błędu, bez 500
- `/dev/criteria` i nowe kolumny `/dev/forms` renderują każdy stan

**Implementation Note**: Po automatycznej weryfikacji zatrzymaj się na ręczne potwierdzenie przed kolejną fazą.

---

## Phase 4: Znacznik „poza limitem” na tablicy

### Overview

Tablica czyta limity obok ofert i przy każdym wierszu pokazuje złamane limity; nieudany odczyt limitów jest widoczny.

### Changes Required:

#### 1. Odczyt limitów na tablicy

**File**: `src/pages/dashboard.astro`, `src/components/offers/OfferBoard.astro`

**Intent**: `loadTeamLimits` obok `loadBoard` (równolegle); wynik przekazany do tablicy i wierszy. Błąd odczytu limitów: jednozdaniowy komunikat nad listą („Nie udało się wczytać limitów zespołu — oferty nie są z nimi porównane.”), lista ofert renderuje się dalej.

**Contract**: kontener tablicy dostaje `data-limits-state="ok"|"error"` obok istniejącego `data-board-state`.

#### 2. Odznaki złamanych limitów

**File**: `src/components/offers/LimitBreachBadges.astro`, `src/components/offers/OfferBoardItem.astro`, `src/components/ui/badge.tsx`

**Intent**: Jedno miejsce na etykiety złamań (jak `AuditStatusBadge.astro` dla statusu): „Cena powyżej limitu (do {kwota})”, „Cena poniżej limitu (od {kwota})”, „Metraż poniżej limitu (od {m²})”, „Inne miasto niż {miasto}”. Wiersz renderuje je obok statusu audytu tylko przy `limits.ok` i niepustej liście. `Badge` dostaje wariant `warning` z tokenów `bg-warning`/`text-warning-foreground`.

**Contract**: każda odznaka ma `data-limit-breach="<LimitBreach>"`; wiersz bez złamań i tablica z błędem limitów nie renderują żadnej.

#### 3. Stany na `/dev/board`

**File**: `src/pages/dev/board.astro`, `src/pages/dev/_offer-fixtures.ts`

**Intent**: Nowe sekcje: wiersz z każdym rodzajem złamania, wiersz z wieloma złamaniami, wiersz z nieznaną ceną/metrażem/lokalizacją przy ustawionych limitach (bez znacznika), błąd odczytu limitów.

**Contract**: fixture limitów w `_offer-fixtures.ts`; sekcje `data-state` jak istniejące.

### Success Criteria:

#### Automated Verification:

- `npm run lint`, `npx astro sync`, `npx astro check` i `npm run build` przechodzą

#### Manual Verification:

- Z limitami ustawionymi na `/criteria` tablica oznacza tylko oferty, których podany fakt łamie limit; oferta bez ceny, metrażu albo lokalizacji nie dostaje znacznika za ten limit; cena równa limitowi się mieści
- Limit „lodz” oznacza ofertę spoza Łodzi i nie oznacza oferty z „Łódź” w lokalizacji
- Wyczyszczenie limitów usuwa wszystkie znaczniki; `/dev/board` renderuje nowe stany

**Implementation Note**: Po automatycznej weryfikacji zatrzymaj się na ręczne potwierdzenie przed kolejną fazą.

---

## Phase 5: Smoke, dokumentacja, bramka wizualna i wdrożenie migracji

### Overview

Smoke z dwóch kont, wpisy w PRD, `CLAUDE.md` i README, zrzuty macierzy 7 stanów, `db push` za zgodą użytkownika.

### Changes Required:

#### 1. Smoke

**File**: `scripts/smoke.mjs`

**Intent**: Pilnować, że RLS trzech tabel jest jedyną bramką w obie strony, że licznik jest faktem bazy i że trasy/znacznik działają — odmowa wygląda jak brak danych, więc każdy krok sprawdza obie strony.

**Contract**: kroki (nazwy dowolne, `expected` jak istniejące):

- trasy: anon `POST /api/criteria` i `/api/requirements` → `/auth/signin`; zapis limitów → `/criteria#limity`; `price_min > price_max` → prefiks `/criteria?error=`; zapis/zmiana/usunięcie wymagań → `/criteria#wymagania`; puste wymagania → `?error=`; `/criteria` zawiera `data-criteria-state="ok"` i zapisane miasto
- licznik: rośnie po zmianie limitów i po zapisie wymagań; nie rośnie po ponownym zapisie tych samych limitów
- RLS: anon czyta 0 wierszy z trzech tabel; `insert` do `team_criteria` → `42501`; `delete` z `team_criteria` → 0 wierszy; PATCH `criteria_revision` → 0 wierszy; drugi członek: PATCH/DELETE cudzych wymagań → 0 wierszy, `insert` z cudzym `author_id` → `42501`
- znacznik: fixture offer dostaje przez REST cenę w PLN powyżej ustawionego `price_max`; `/dashboard` zawiera `data-limits-state="ok"` i `data-limit-breach="price_above"`
- `/dev/criteria` → 404 na podglądzie produkcyjnym
- sprzątanie niezależnie od wyników: przywrócenie limitów sprzed przebiegu (odczytanych na starcie), usunięcie wymagań obu kont

#### 2. Dokumentacja

**File**: `context/foundation/prd.md`, `CLAUDE.md`, `README.md`

**Intent**: Zapisać decyzje tam, gdzie reguły je wiążą.

**Contract**:

- PRD: FR-002 — zdanie o znaczniku na tablicy (podany fakt łamie limit, niepodany nigdy; oferta nie znika); Non-Functional Requirements — wymagania dodatkowe usuniętego członka znikają z kontem (usunięcie konta to akcja administratora, a osierocony tekst sterowałby audytem bez właściciela); blok rozstrzygnięć pod Open Questions — obie decyzje z datą 2026-09-27 i „resolved in S-03”.
- `CLAUDE.md`: doprecyzowanie „Offers, searches and criteria: full CRUD for any member” — wspólne limity edytuje każdy członek, wymagania dodatkowe tylko autor; w `## Structure` punkt nazywający migrację kryteriów wzorcem singletonu bez polityk `insert`/`delete` i licznika zapisywanego tylko przez trigger, `src/lib/criteria.ts` i `src/lib/team-limits.ts` jako referencje (S-04 czyta kryteria i zapisuje `revision`, S-09 porównuje); wzmianka o `/dev/criteria` w `### UI` (kitchen sink widoku kryteriów, ta sama reguła dev-only/404) i `data-limits-state` przy tablicy.
- README: `/criteria` w strukturze/trasach, nowe kroki smoke, zestaw `criteria` w sekcji zrzutów.

#### 3. Zrzuty i macierz 7 stanów

**File**: `scripts/ui-screenshots.mjs`

**Intent**: Przejść bramkę wizualną wybraną przez użytkownika.

**Contract**: nowy zestaw `criteria` (desktop, mobile, fokus na polu miasta, fokus na „Edytuj” wymagań, hover „Zapisz limity”); zestaw `forms` + `forms-focus-limits-field`, `forms-hover-requirements-submit`; zestaw `board` + zrzut stanu ze złamaniami i błędu limitów. `USAGE` zaktualizowany. Uruchomienie: `node scripts/ui-screenshots.mjs <set> context/changes/team-search-criteria/screenshots` dla `criteria`, `forms` i `board`.

| Stan | Gdzie | Dowód |
| --- | --- | --- |
| default | `/dev/criteria` „pełne”; `/dev/forms` `data-form=limits`/`requirements` `default`; `/dev/board` wiersz ze złamaniem | `criteria-desktop`, `forms-desktop`, `board-desktop` |
| hover | „Zapisz limity”, „Zapisz wymagania”, wiersz tablicy ze złamaniem | wymuszony `:hover` przez CDP |
| focus | pole miasta, „Edytuj” wymagań, pole wymagań | prawdziwe naciśnięcia Tab |
| disabled | `SubmitButton` w trakcie wysyłki (oba formularze), „Anuluj” i „Wyczyść limity” zablokowane | sekcja `disabled` na `/dev/forms` |
| error | błąd inline i `ServerError` obu formularzy; `/dev/criteria` błąd odczytu; `/dev/board` błąd limitów | sekcje `error` |
| empty | `/dev/criteria` bez limitów i wymagań („bez limitu”, „Nikt inny…”); pusty edytor wymagań | sekcje `empty` |
| loading | „Zapisuję…” w obu formularzach | sekcja `loading` na `/dev/forms` |

#### 4. Wdrożenie migracji

**Intent**: Migracja trafia do hostowanego projektu przed Workerem, który jej potrzebuje.

**Contract**: `npx supabase db push --dry-run`, lista migracji pokazana użytkownikowi, `db push` wyłącznie po jego „tak”; stop bez pytania, gdy lista zawiera coś nieoczekiwanego.

### Success Criteria:

#### Automated Verification:

- `npm run smoke` przechodzi na lokalnym Supabase
- `npm run lint`, `npx astro sync`, `npx astro check` i `npm run build` przechodzą
- `node scripts/ui-screenshots.mjs criteria …`, `… forms …` i `… board …` do `context/changes/team-search-criteria/screenshots` kończą się kodem 0

#### Manual Verification:

- Zrzuty pokazują każdy wiersz macierzy 7 stanów; `criteria-mobile` bez poziomego przewijania; długi e-mail i długie słowo się zawijają
- PRD, `CLAUDE.md` i README opisują decyzje i nowe trasy zgodnie z planem
- `npx supabase db push --dry-run` pokazuje tylko migrację kryteriów, a push odbył się po zgodzie użytkownika

**Implementation Note**: Po automatycznej weryfikacji zatrzymaj się na ręczne potwierdzenie; po triage `/10x-impl-review`, jeśli zmienił widok, zrzuty są powtarzane przed commitem.

---

## Testing Strategy

### Unit Tests:

- Brak runnera testów jednostkowych (CLAUDE.md, Testing). Czyste funkcje `parseLimitsForm`, `requirementsError`, `limitBreaches` i `normalizePlace` sprawdzane przez stany fixture'ów na `/dev/board` i `/dev/forms` oraz przez smoke.

### Integration Tests:

- `scripts/smoke.mjs`: trasy, RLS trzech tabel z dwóch kont, licznik, znacznik na tablicy, 404 kitchen sinka.

### Manual Testing Steps:

1. Ustaw miasto „Warszawa” i cenę do 900 000 na `/criteria`; sprawdź „ostatnio zmienił(a)” i znaczniki na `/dashboard`.
2. Zaloguj się drugim kontem, wpisz wymagania, sprawdź je z pierwszego konta i to, że pierwsze konto ich nie zmieni.
3. Zapisz limity z tymi samymi wartościami i sprawdź, że licznik i podpis się nie zmieniły.
4. Wyczyść limity i usuń własne wymagania; sprawdź „bez limitu” i brak znaczników.
5. Usuń lokalne konto testowe z wymaganiami; sprawdź podpis „osoba z usuniętym kontem” przy limitach i brak jego wymagań.

## Performance Considerations

Tablica robi jeden dodatkowy odczyt jednego wiersza, równolegle z odczytem ofert; porównanie to stała praca na wiersz. Strona kryteriów: trzy małe odczyty plus jeden odczyt e-maili autorów.

## Migration Notes

Nowa migracja bez zmian w istniejących tabelach; singletony wstawiane w tej samej migracji. Hostowany projekt: `db push` za zgodą, przed wdrożeniem Workera (`context/foundation/deployment-runbook.md`).

## References

- PRD: `context/foundation/prd.md` FR-002, FR-003, FR-010, Access Control, Non-Functional Requirements
- Roadmapa: `context/foundation/roadmap.md` S-03, S-04, S-09
- Wzorzec tabeli według autorstwa: `supabase/migrations/20260926202537_create_offer_notes.sql`, `supabase/migrations/20260927133501_offer_notes_server_timestamps.sql`
- Wzorzec tabeli zapisywanej przez trigger: `supabase/migrations/20260926185936_create_members.sql`
- Trasa formularza: `src/pages/api/notes.ts`; odczyt: `src/lib/notes.ts`, `src/lib/members.ts`
- Wyspa: `src/components/offers/NoteEditor.tsx`; kompozyty: `src/components/form/`
- Tablica: `src/lib/offer-board.ts`, `src/components/offers/OfferBoardItem.astro`, `src/pages/dev/board.astro`
- Lekcje: `context/foundation/lessons.md` („Declare `on delete`…”, „Kolory widoku…”, „Formularz z kompozytów…”)
- Poprzedni plan: `context/archive/2026-09-26-member-notes/plan.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Schemat, RLS i licznik rewizji

#### Automated

- [x] 1.1 `npx supabase db reset` stosuje migrację bez błędów, a `team_criteria` i `criteria_revision` mają po jednym wierszu — c6ebff2
- [x] 1.2 `npm run lint`, `npx astro sync` i `npx astro check` przechodzą — c6ebff2

#### Manual

- [x] 1.3 REST z tokenami dwóch kont seedowych: oba czytają limity, wymagania obu i licznik; anon dostaje `[]` ze wszystkich trzech tabel — c6ebff2
- [x] 1.4 `insert` i `delete` na `team_criteria` oraz jakikolwiek zapis `criteria_revision` są odrzucane (403 `42501` albo 0 wierszy); drugi członek nie zmieni ani nie usunie cudzych wymagań (0 wierszy), a wstawienie wymagań podpisanych cudzym `author_id` kończy się `42501` — c6ebff2
- [x] 1.5 Zmiana limitu podbija licznik i ustawia `updated_by`; zapis tych samych wartości nie zmienia ani licznika, ani `updated_by`/`updated_at`; PATCH `updated_by` na cudze id wraca do wartości z triggera — c6ebff2
- [x] 1.6 Dodanie, zmiana i usunięcie wymagań podbija licznik; PATCH tego samego `body` nie — c6ebff2
- [x] 1.7 Usunięcie lokalnego konta (poza kontami używanymi przez smoke), które ostatnio zmieniło limity i ma wymagania: konto znika bez błędu, `updated_by` staje się `null`, jego wymagania znikają, licznik rośnie — c6ebff2

### Phase 2: Warstwa danych, porównanie z limitami i trasy

#### Automated

- [x] 2.1 `npm run lint`, `npx astro sync`, `npx astro check` i `npm run build` przechodzą — e9ad61c

#### Manual

- [x] 2.2 curl z ciasteczkiem sesji: zapis limitów, zapis z `price_min > price_max`, `0` i tekstem w polu liczbowym, `clear` — każdy kończy się oczekiwanym przekierowaniem, a stan w bazie się zgadza — e9ad61c
- [x] 2.3 curl: zapis, zmiana i usunięcie własnych wymagań; puste i za długie `body` → `?error=`; body nie-formularz → `?error=`, nigdy 500 — e9ad61c
- [x] 2.4 Bez sesji obie trasy przekierowują do `/auth/signin` — e9ad61c

### Phase 3: Widok `/criteria`

#### Automated

- [x] 3.1 `npm run lint`, `npx astro sync`, `npx astro check` i `npm run build` przechodzą

#### Manual

- [x] 3.2 `/criteria` z lokalnym Supabase: zapis, zmiana i wyczyszczenie limitów; zapis, edycja i usunięcie własnych wymagań; drugie konto widzi wymagania pierwszego podpisane e-mailem i „ostatnio zmienił(a)” z właściwą osobą
- [x] 3.3 Nieustawiony limit czyta się „bez limitu”; błąd walidacji zostaje w formularzu z wpisanymi wartościami, błąd serwera pokazuje `ServerError`
- [x] 3.4 Bez sesji `/criteria` przekierowuje do `/auth/signin`; bez `.env` strona się renderuje w stanie błędu, bez 500
- [x] 3.5 `/dev/criteria` i nowe kolumny `/dev/forms` renderują każdy stan

### Phase 4: Znacznik „poza limitem” na tablicy

#### Automated

- [ ] 4.1 `npm run lint`, `npx astro sync`, `npx astro check` i `npm run build` przechodzą

#### Manual

- [ ] 4.2 Z limitami ustawionymi na `/criteria` tablica oznacza tylko oferty, których podany fakt łamie limit; oferta bez ceny, metrażu albo lokalizacji nie dostaje znacznika za ten limit; cena równa limitowi się mieści
- [ ] 4.3 Limit „lodz” oznacza ofertę spoza Łodzi i nie oznacza oferty z „Łódź” w lokalizacji
- [ ] 4.4 Wyczyszczenie limitów usuwa wszystkie znaczniki; `/dev/board` renderuje nowe stany

### Phase 5: Smoke, dokumentacja, bramka wizualna i wdrożenie migracji

#### Automated

- [ ] 5.1 `npm run smoke` przechodzi na lokalnym Supabase
- [ ] 5.2 `npm run lint`, `npx astro sync`, `npx astro check` i `npm run build` przechodzą
- [ ] 5.3 `node scripts/ui-screenshots.mjs criteria …`, `… forms …` i `… board …` do `context/changes/team-search-criteria/screenshots` kończą się kodem 0

#### Manual

- [ ] 5.4 Zrzuty pokazują każdy wiersz macierzy 7 stanów; `criteria-mobile` bez poziomego przewijania; długi e-mail i długie słowo się zawijają
- [ ] 5.5 PRD, `CLAUDE.md` i README opisują decyzje i nowe trasy zgodnie z planem
- [ ] 5.6 `npx supabase db push --dry-run` pokazuje tylko migrację kryteriów, a push odbył się po zgodzie użytkownika
