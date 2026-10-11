# Usuwanie oferty i własnej notatki — Implementation Plan

## Overview

Slice S-11 (FR-015): członek usuwa zapisaną ofertę — żywą albo zarchiwizowaną — razem z notatkami całego zespołu i wynikiem audytu, oraz usuwa własną notatkę. Obie akcje są nieodwracalne, więc każdą poprzedza dialog potwierdzenia, a po każdej członek dostaje jawną informację o wyniku. Baza jest gotowa od S-02, S-04 i S-05; ten plan dokłada trasy, widoki, testy i dokumentację.

## Current State Analysis

- **Baza.** `offers_delete_authenticated` pozwala każdemu zalogowanemu usunąć każdą ofertę (`supabase/migrations/20260922202756_create_offers.sql:109-113`). `offer_notes_delete_own` pozwala usunąć tylko notatkę, której `author_id = auth.uid()` (`supabase/migrations/20260926202537_create_offer_notes.sql:136-140`). `offer_notes.offer_id` i `offer_audits.offer_id` mają `on delete cascade` (`…create_offer_notes.sql:26`, `supabase/migrations/20261007073300_create_offer_audits.sql:33`); to jedyne dwa klucze obce do `public.offers`. Żaden trigger nie działa przy usuwaniu tych trzech tabel.
- **Aplikacja.** Nie istnieje żadne usuwanie oferty ani notatki. `src/pages/api/notes.ts` to sam upsert: bez pola `intent`, bez `logEvent`, bez testu trasy; zapis sądzi po kodzie błędu.
- **Jedna notatka na członka na ofertę** (`unique (offer_id, author_id)`, `…create_offer_notes.sql:37`), więc usunięcie nie potrzebuje id notatki od klienta.
- **Karta.** `src/pages/offers/[id].astro:98-108` traktuje każdy `?error=`, którego `form` nie jest `refetch` ani `archive`, jako błąd edytora notatki — a `NoteEditor` otwiera wtedy tryb edycji (`src/components/offers/NoteEditor.tsx:33`).
- **Komunikaty.** `/dashboard` nie ma komunikatu sukcesu; `?error=` trafia do `AddOfferForm`. `/offers/archive` ma baner `?restored=1` w slocie `notice` i `Alert` dla `?error=`.
- **UI.** W `src/components/ui/` nie ma dialogu; `package.json` zna z Radixa tylko `react-select` i `react-slot`. `button.tsx` ma wariant `destructive`, którego żaden przycisk dziś nie używa. Jedyne potwierdzenia nieodwracalnych akcji to `window.confirm` w `RequirementsEditor.tsx:85-91` i `TeamLimitsForm.tsx:82-86`.
- **Smoke.** Polityki usuwania i kaskadę sprawdza już przez Data API (`scripts/smoke.mjs:1454-1513`, `:2247-2289`); `context/foundation/test-plan.md:445-456` każe S-11 powtórzyć te kroki przez trasy i jawnie rozstrzygnąć, co znaczy zero usuniętych wierszy.

## Desired End State

Na karcie każdej oferty, żywej i zarchiwizowanej, stoi blok „Usuwanie” z przyciskiem, który otwiera dialog wymieniający, co zniknie; potwierdzenie usuwa ofertę i prowadzi na tablicę z banerem. Ten sam przycisk stoi w wierszu `/offers/archive` obok „Przywróć” i po usunięciu zostawia członka na stronie archiwum. Przy własnej notatce, obok „Edytuj”, stoi „Usuń” z takim samym dialogiem; po usunięciu karta pokazuje baner i pusty edytor. Cudza notatka i notatka osoby z usuniętym kontem nie mają żadnej akcji.

Weryfikacja: `npm test`, `npm run lint`, `npx astro check`, `npm run build`, `npm run smoke` i `npx playwright test` przechodzą; ręcznie — scenariusze z sekcji „Manual Testing Steps”.

### Key Discoveries:

- Zakończenie próby audytu, której wiersz zniknął, to już `claim_lost` z testem (`tests/pages/api/audits.test.ts:1708`) — usunięcie oferty w trakcie audytu nie wymaga zmian w module audytu.
- Nakładka `alert-dialog` z rejestru shadcn używa `bg-black/50`, co odrzuca `tokensOnlyConfig` (`eslint.config.js`); potrzebny jest token roli.
- `scripts/smoke.mjs:1551-1555` wysyła `intent: "delete"` do `/api/offer-archive` jako przykład nieznanej intencji — osobna trasa usuwania zostawia ten krok w spokoju.
- `tests/e2e/fixture-offer.ts:70-85` oczekuje przy sprzątaniu dokładnie jednego usuniętego wiersza; test, który sam usuwa ofertę, potrzebuje innego sprzątania.
- `src/lib/notes.ts` jest importowany przez wyspę, więc `@/lib/supabase` wchodzi do niego tylko przez `import type` — usuwanie zostaje w trasie.
- `src/lib/log.ts` buduje wpis z białej listy pól; `intent`, `offer_id`, `otodom_id`, `user_id` już na niej są.

## What We're NOT Doing

- Bez migracji i bez zmian polityk — baza jest gotowa.
- Bez przycisku usuwania w wierszu tablicy `/dashboard` — żywą ofertę usuwa się z jej karty.
- Bez miękkiego usuwania, kosza, cofania i śladu po usuniętej ofercie; ponownie wklejony adres usuniętej oferty zapisuje się jako nowy (PRD, FR-015).
- Bez usuwania cudzej notatki i bez usuwania notatki osoby z usuniętym kontem.
- Bez blokady i bez ostrzeżenia, gdy trwa audyt oferty: trasa usuwania nie czyta `public.offer_audits`.
- Bez ochrony przed wyścigiem dwóch okien tego samego autora: usunięcie zabiera notatkę w tym brzmieniu, jakie ma w bazie.
- Bez liczenia notatek w dialogu — zdanie jest ogólne, bo wiersz archiwum notatek nie czyta.
- Bez zamiany `window.confirm` w `RequirementsEditor` i `TeamLimitsForm` na nowy dialog.
- Bez bramki wizualnej (decyzja użytkownika): żadnej macierzy 7 stanów i zrzutów; nowe stany dostają tylko sekcje na `/dev/*`.
- Bez działania przycisków usuwania przy wyłączonym JavaScripcie — formularz żyje w dialogu.

## Implementation Approach

Najpierw trasy z testami, bo ich kontrakt (adresy powrotu, wartości parametrów) wiąże widoki. Potem jeden kompozyt dialogu, z którego korzystają oba miejsca usuwania, i widoki, które czytają parametry przez białe listy. Na końcu smoke przenosi istniejące kroki kaskady z Data API na trasy, a dokumentacja zapisuje rozstrzygnięcia.

Każde usunięcie to jeden zapis sądzony po błędzie i po liczbie usuniętych wierszy, bez wcześniejszego odczytu: odczyt niczego by nie dodał, bo polityka nie filtruje usunięcia oferty, a notatkę wskazuje para (oferta, autor z sesji).

## Critical Implementation Details

- **Przycisk potwierdzenia nie może zamykać dialogu.** `AlertDialogAction` zamyka dialog przy kliknięciu, a zamknięcie odmontowuje formularz z portalu, zanim przeglądarka go wyśle. Potwierdzenie to zwykły przycisk `submit` wewnątrz formularza; dialog zostaje otwarty w stanie „Usuwam…” do przeładowania strony.
- **Zero wierszy przy niewidocznej sesji.** Gdyby baza nie zobaczyła sesji członka, polityka odfiltrowałaby usunięcie i trasa zgłosiłaby „już jej nie było”, choć oferta istnieje. Tego samego stanu nie odróżni żaden odczyt (polityka `select` też wymaga sesji), a middleware potwierdza sesję tym samym ciasteczkiem — przyjęte ograniczenie, zapisane w komentarzu trasy.
- **Kolejność kroków smoke.** Kroki świeżości audytu i archiwum oczekują notatek obu kont na obu ofertach testowych. Usunięcie notatki przez trasę staje więc tuż przed blokiem kaskady, a sprawdzenie „obie notatki są” w tym bloku zostaje dopasowane.

## Phase 1: Trasy usuwania

### Overview

Dwie ścieżki zapisu: nowa trasa usuwa ofertę, istniejąca trasa notatek dostaje intencję usunięcia. Obie logują każde wyjście i mają testy każdej gałęzi.

### Changes Required:

#### 1. Trasa usuwania oferty

**File**: `src/pages/api/offer-delete.ts` (nowy)

**Intent**: Usunąć jedną ofertę na żądanie członka jednym zapisem sądzonym po błędzie i liczbie wierszy, z jednym wpisem logu na każdym wyjściu, na wzór `src/pages/api/offer-archive.ts`. Notatki i audyt znikają kaskadą w bazie; trasa ich nie czyta.

**Contract**:

- `POST`, `FormData`: `offer_id`, `return` (`card` | `archive`; wszystko inne znaczy `card`). Bez pola `intent` — trasa ma jedną akcję.
- Jedyne przekierowanie bez sesji: `/auth/signin`.
- Kolejność: sesja → Supabase skonfigurowany → czytelny formularz → `offer_id` jest uuid → usunięcie z prośbą o usunięte wiersze (`id, otodom_id`).
- Wyjścia:
  - brak konfiguracji, nieczytelny formularz, błędne id → `/dashboard?error=…`, każde z własnym zdaniem;
  - jeden wiersz → `return=card`: `/dashboard?deleted=1`; `return=archive`: `/offers/archive?deleted=1`;
  - zero wierszy → te same adresy z `?deleted=gone`; to ani sukces, ani błąd: oferty już nie było;
  - błąd zapisu → `return=card`: `/offers/<id>?error=…&form=delete#usuwanie`; `return=archive`: `/offers/archive?error=…`; zdanie mówi, że oferta została;
  - zapis bez odpowiedzi (`status === 0`) → te same adresy ze zdaniem, które nie twierdzi, że oferta została.
- Log: `event: "offer_delete"`, `outcome` z `deleted | already_gone | refused | failed`, pola `stage`, `reason`, `user_id`, `offer_id`, przy sukcesie `otodom_id` z usuniętego wiersza, pola bazy bez `details`. `already_gone` i odmowy to `info`, awaria to `error`.
- Komentarz dokumentacyjny mówi wprost, co znaczy zero wierszy i dlaczego trasa nie czyta przed zapisem (`context/foundation/test-plan.md:445`).
- Trasa czyta i pisze wyłącznie `public.offers`.

#### 2. Zakaz importu notatek w trasie usuwania oferty

**File**: `eslint.config.js`

**Intent**: Notatki znikają z ofertą tylko przez kaskadę w bazie; struktura kodu ma to trzymać jak przy archiwum i ponownym pobraniu.

**Contract**: Nowy blok `deleteNoNotesConfig` dla `src/pages/api/offer-delete.ts` z tą samą regułą `no-restricted-imports` co `archiveNoNotesConfig`, własnym zdaniem i wpisem w eksporcie. Komentarz nad `auditNoNotesConfig`, który wylicza bloki z tą regułą, dostaje nową nazwę.

#### 3. Intencja usunięcia i log w trasie notatek

**File**: `src/pages/api/notes.ts`

**Intent**: Dać członkowi usunięcie własnej notatki tą samą trasą, która ją zapisuje, i zacząć logować każde wyjście trasy — PRD odsyła administratora do logów przy przypadkowym usunięciu.

**Contract**:

- Nowe pole `intent`: brak albo `save` → zapis jak dziś, bez zmiany zachowania; `delete` → usunięcie; inna wartość → odmowa z własnym zdaniem na `/dashboard?error=…`. Wartość spoza listy nie trafia do logu.
- Usunięcie: wiersz o `offer_id` z formularza i `author_id` z sesji, z prośbą o usunięte wiersze. Pola treści nie są czytane ani walidowane.
- Wyjścia usunięcia:
  - jeden wiersz → `/offers/<id>?note=deleted#notatki`;
  - zero wierszy → `/offers/<id>?note=gone#notatki` (notatki już nie było; jeśli nie ma też oferty, karta odpowie 404);
  - błąd → `/offers/<id>?error=…&form=note-delete#notatki`, zdanie mówi, że notatka została;
  - zapis bez odpowiedzi → ten sam adres ze zdaniem, które tego nie twierdzi.
- Log: `event: "note"`, `outcome` z `saved | deleted | already_gone | refused | failed`, pola `intent`, `stage`, `reason`, `user_id`, `offer_id`, pola bazy bez `details`. Nigdy treść notatki.
- Komentarz dokumentacyjny mówi, co znaczy zero wierszy przy usunięciu i że usunięcie zabiera notatkę w brzmieniu z bazy, nie z okna.

#### 4. Testy trasy usuwania oferty

**File**: `tests/pages/api/offer-delete.test.ts`, `tests/pages/api/offer-delete.unconfigured.test.ts` (nowe)

**Intent**: Pokryć każde wyjście trasy przy sieci zatkanej na krawędzi HTTP, na wzór `tests/pages/api/offer-archive.test.ts`; każdy scenariusz podaje, ile zapisów dotarło do `public.offers`.

**Contract**: Scenariusze: brak sesji; nieczytelne ciało; błędne id (zero zapisów); jeden usunięty wiersz dla `return=card` i `return=archive`; zero wierszy dla obu powrotów (nigdy adres sukcesu); błąd bazy dla obu powrotów; brak odpowiedzi; nieznana wartość `return` znaczy `card`. Żądanie usunięcia niesie filtr po `id` i nie dotyka `offer_notes` ani `offer_audits`. Wpis logu sprawdzany przy sukcesie (`otodom_id`), `already_gone` i awarii (bez `details`). Plik `.unconfigured` pokrywa wyjście bez klienta.

#### 5. Testy trasy notatek

**File**: `tests/pages/api/notes.test.ts`, `tests/pages/api/notes.unconfigured.test.ts` (nowe)

**Intent**: Trasa nie ma dziś testu; ten plik pokrywa nową intencję i trzyma dotychczasowy zapis przy zmianie kontraktu.

**Contract**: Usunięcie: jeden wiersz, zero wierszy, błąd bazy, brak odpowiedzi; żądanie niesie filtr po `offer_id` i po `author_id` równym id sesji — nigdy wartość z formularza. Nieznana intencja: zero zapisów. Zapis: brak `intent` i `intent=save` wysyłają ten sam upsert co dziś; `23503`, `23514` i inny błąd prowadzą tam, gdzie prowadziły. Każdy scenariusz podaje liczbę zapisów do `public.offer_notes`.

### Success Criteria:

#### Automated Verification:

- `npm test` przechodzi, w tym nowe pliki testów obu tras
- `npm run lint` przechodzi
- `npx astro sync && npx astro check` przechodzi
- `npm run build` przechodzi bez `.env` i `.dev.vars`

#### Manual Verification:

- Na lokalnym Supabase żądanie `POST /api/offer-delete` z id oferty testowej usuwa ją razem z notatkami i audytem, a powtórzone prowadzi na `/dashboard?deleted=gone`

**Implementation Note**: Po zakończeniu fazy i przejściu automatycznej weryfikacji zatrzymaj się na ręczne potwierdzenie przed kolejną fazą.

---

## Phase 2: Dialog i widoki

### Overview

Jeden kompozyt potwierdzenia obsługuje oba usunięcia. Karta, wiersz archiwum i edytor notatki dostają przyciski, a trzy strony — banery wyniku.

### Changes Required:

#### 1. Prymityw dialogu

**File**: `src/components/ui/alert-dialog.tsx` (nowy), `package.json`

**Intent**: Wprowadzić dialog potwierdzenia przez `npx shadcn add alert-dialog` i rytuał z `CLAUDE.md` (`### UI`) dla prymitywu, który zostaje przy Radixie.

**Contract**: Nowa zależność `@radix-ui/react-alert-dialog`, import z niej wprost; parasolowy pakiet `radix-ui` i pakiet `cn` usunięte, jeśli CLI je doda; `"use client"` usunięte; `cn` z `@/lib/utils`. Wzorzec: `src/components/ui/select.tsx`. Przed pisaniem sprawdź aktualną dokumentację prymitywu przez Context7.

#### 2. Token nakładki

**File**: `src/styles/global.css`

**Intent**: Dać nakładce dialogu kolor z tokenu roli zamiast literału z rejestru.

**Contract**: Nowy token nazwany od roli (`--overlay` → `bg-overlay`), zdefiniowany dla obu bloków motywu; `alert-dialog.tsx` używa tylko jego. Lista `ignores` w `tokensOnlyConfig` zostaje pusta.

#### 3. Kompozyt potwierdzenia

**File**: `src/components/form/ConfirmDialog.tsx` (nowy), `src/components/form/SubmitButton.tsx`

**Intent**: Jeden element dla każdej nieodwracalnej akcji: przycisk, który otwiera dialog, a w dialogu natywny formularz z ukrytymi polami i przyciskiem potwierdzenia.

**Contract**:

- Eksport nazwany `ConfirmDialog`. Propsy: etykieta, ikona, wariant i rozmiar przycisku otwierającego; tytuł; opis; etykieta potwierdzenia i tekst w trakcie wysyłki; `action`; ukryte pola jako mapa nazwa → wartość; `defaultOpen` wyłącznie dla stron `/dev/*`.
- Formularz `method="POST"` stoi w treści dialogu; ukryte pola niosą wszystko, czego trasa potrzebuje — nic w `name`/`value` przycisku.
- Potwierdzenie to `SubmitButton` w wariancie `destructive` z `usePendingSubmit`, nie `AlertDialogAction` (patrz „Critical Implementation Details”); „Anuluj” to `AlertDialogCancel`, wyłączony w trakcie wysyłki.
- `SubmitButton` dostaje prop `variant`, jeśli go nie ma.
- Tytuł i opis są renderowane jako tekst.

#### 4. Formularz usuwania oferty

**File**: `src/components/offers/DeleteOfferForm.tsx` (nowy)

**Intent**: Wyspa z przyciskiem „Usuń ofertę” i dialogiem, która wysyła `POST /api/offer-delete`; używana na karcie i w wierszu archiwum.

**Contract**: Eksport domyślny. Propsy: `offerId`, `returnTo` (`card` | `archive`, domyślnie `card`), `serverError`, `compact`, `defaultOpen`. Ukryte pola `offer_id` i `return`. Przycisk otwierający: wariant `destructive`, ikona `Trash2`. Dialog — tytuł „Usunąć tę ofertę?”, opis: oferta zniknie na zawsze razem z notatkami wszystkich członków zespołu i wynikiem audytu, a tej zmiany nie da się cofnąć; potwierdzenie „Usuń ofertę”, w trakcie „Usuwam…”. `ServerError` stoi przy przycisku, poza dialogiem.

#### 5. Blok usuwania na karcie

**File**: `src/components/offers/OfferCard.astro`, `src/components/offers/OfferView.astro`

**Intent**: Postawić usuwanie na karcie każdej oferty, żywej i zarchiwizowanej, pod blokiem ponownego pobrania.

**Contract**: Nowy blok o id z propa `deleteAnchorId` (domyślnie `usuwanie`), z atrybutem `data-offer-delete`, zdaniem wyjaśniającym (usunięcie jest nieodwracalne i zabiera notatki oraz audyt; oferta, która ma tylko zniknąć z tablicy, nadaje się do archiwum — to drugie zdanie tylko dla żywej oferty) i `DeleteOfferForm client:load`. Nowe propy `deleteError` i `deleteAnchorId` przechodzą przez `OfferView`.

#### 6. Przycisk usuwania w wierszu archiwum

**File**: `src/components/offers/OfferArchiveItem.astro`

**Intent**: Pozwolić usunąć zarchiwizowaną ofertę bez otwierania karty, obok „Przywróć”.

**Contract**: `DeleteOfferForm client:load` z `returnTo="archive"` i `compact` w tej samej kolumnie `relative z-10` co `ArchiveForm`, nad warstwą linku tytułu. Komentarz nagłówkowy komponentu wymienia drugi przycisk.

#### 7. Usuwanie własnej notatki

**File**: `src/components/offers/NoteEditor.tsx`, `src/components/offers/OfferNotes.astro`

**Intent**: Dodać „Usuń” obok „Edytuj” w podglądzie własnej notatki i nazwać intencję zapisu w formularzu edycji.

**Contract**:

- Podgląd: slot `action` `NoteCard` trzyma „Edytuj” i `ConfirmDialog` (przycisk `outline`, `sm`, `Trash2`, „Usuń”) z `action="/api/notes"` i ukrytymi polami `offer_id`, `intent=delete`. Dialog — tytuł „Usunąć Twoją notatkę?”, opis: zalety, wady i obserwacje znikną na zawsze; potwierdzenie „Usuń notatkę”.
- Formularz edycji dostaje ukryte pole `intent=save`.
- Nowy prop `deleteError`: zdanie nieudanego usunięcia, pokazane przez `ServerError` w podglądzie; nie otwiera trybu edycji.
- `OfferNotes.astro` przekazuje `deleteError`; cudze notatki i stan błędu odczytu zostają bez akcji.

#### 8. Komunikaty wyniku

**File**: `src/components/offers/DeleteNotice.astro`, `src/components/offers/NoteDeleteNotice.astro` (nowe)

**Intent**: Powiedzieć członkowi, jak skończyło się usunięcie, czytając parametr adresu przez białą listę — na wzór `ArchiveNotice.astro`.

**Contract**:

- `DeleteNotice`: prop `result`; `1` → „Oferta została usunięta razem z notatkami zespołu i wynikiem audytu.” (`data-delete-result="deleted"`); `gone` → „Tej oferty już nie było — ktoś usunął ją wcześniej. Niczego nie usunięto.” (`data-delete-result="already-gone"`); inna wartość → nic. `Banner` w wariancie `info`.
- `NoteDeleteNotice`: propy `result` i `hasOwnNote`; `deleted` → „Twoja notatka została usunięta.”; `gone` → „Twojej notatki już nie było — niczego nie usunięto.”; atrybut `data-note-result`. Gdy członek ma notatkę, komponent nie pokazuje nic — wiersz przeczy adresowi.
- Żadna wartość z adresu nie jest renderowana.

#### 9. Strony

**File**: `src/pages/dashboard.astro`, `src/pages/offers/archive.astro`, `src/pages/offers/[id].astro`

**Intent**: Podłączyć banery i rozdzielić błędy karty po formularzu.

**Contract**:

- `/dashboard` i `/offers/archive`: `?deleted=` → `DeleteNotice` w slocie `notice`.
- Karta: `form=delete` → `deleteError` dla bloku usuwania; `form=note-delete` → `deleteError` edytora notatki; `noteError` zostaje dla adresów bez znanego `form`. `?note=` → `NoteDeleteNotice` w slocie `notice`, z informacją, czy członek ma notatkę.
- Komentarz o trasach wracających na kartę z `?error=` dostaje dwie nowe wartości `form`.

#### 10. Kitchen sinki

**File**: `src/pages/dev/forms.astro`, `src/pages/dev/offer-card.astro`, `src/pages/dev/board.astro`, `src/pages/dev/_offer-fixtures.ts`

**Intent**: Pokazać każdy nowy stan przez komponenty produkcyjne, bez zrzutów ekranu.

**Contract**:

- `/dev/forms`: kolumna `DeleteOfferForm` w stanach default, error (`serverError`), loading i z otwartym dialogiem (`defaultOpen`); `NoteEditor` z zapisaną notatką w podglądzie (z „Usuń”), z `deleteError` i z otwartym dialogiem; `CLAUDE.md` wymienia `DeleteOfferForm` wśród formularzy tej strony (faza 3).
- `/dev/offer-card`: blok usuwania na karcie żywej, zarchiwizowanej i z błędem usunięcia; oba warianty `NoteDeleteNotice`.
- `/dev/board`: oba warianty `DeleteNotice`; wiersz archiwum z dwoma przyciskami.
- Sekcje z otwartym dialogiem stoją tak, by jeden dialog nie zasłaniał reszty strony na stałe (każda otwierana przyciskiem albo jedna otwarta naraz).

#### 11. Testy renderowania

**File**: `tests/components/offers/render.test.ts`, `tests/components/offers/offer-archive.test.ts`

**Intent**: Utrzymać w testach, gdzie akcja usuwania jest, a gdzie jej nie ma, oraz białe listy banerów.

**Contract**: Karta żywa i zarchiwizowana ma blok `data-offer-delete` z przyciskiem; wiersz archiwum ma oba przyciski; własna notatka ma „Usuń”, cudza i notatka osoby z usuniętym kontem — nie; nieudany odczyt notatek nie renderuje akcji. `form=delete` i `form=note-delete` nie otwierają edytora notatki i nie trafiają do bloku archiwum ani ponownego pobrania. `DeleteNotice` i `NoteDeleteNotice`: każda wartość z listy stoi obok wartości spoza listy, która nie renderuje nic; `NoteDeleteNotice` milczy, gdy notatka istnieje. Tytuł i opis dialogu nie przechodzą przez `set:html`.

### Success Criteria:

#### Automated Verification:

- `npm test` przechodzi, w tym nowe testy renderowania
- `npm run lint` przechodzi z pustą listą `ignores` w `tokensOnlyConfig`
- `npx astro sync && npx astro check` przechodzi
- `npm run build` przechodzi bez `.env` i `.dev.vars`
- `package.json` zawiera `@radix-ui/react-alert-dialog` i nie zawiera pakietu `radix-ui`

#### Manual Verification:

- Na karcie żywej oferty „Usuń ofertę” otwiera dialog; „Anuluj” i Escape niczego nie usuwają, a fokus wraca na przycisk
- Potwierdzenie usuwa ofertę i prowadzi na `/dashboard` z banerem; oferty nie ma na tablicy, w sekcji „Ostatnio zarchiwizowane” ani w liczniku archiwum
- Zarchiwizowaną ofertę da się usunąć z karty (powrót na tablicę) i z wiersza `/offers/archive` (powrót na archiwum z banerem)
- „Usuń” przy własnej notatce usuwa ją po potwierdzeniu; karta pokazuje baner i pusty edytor, a notatki innych członków stoją bez zmian
- Przy cudzej notatce nie ma przycisku „Usuń”
- Strony `/dev/forms`, `/dev/offer-card` i `/dev/board` renderują nowe sekcje pod `npm run dev`
- Dialog jest czytelny na wąskim ekranie i w ciemnym motywie, a przycisk potwierdzenia wyraźnie różni się od „Anuluj”

**Implementation Note**: Po zakończeniu fazy i przejściu automatycznej weryfikacji zatrzymaj się na ręczne potwierdzenie przed kolejną fazą.

---

## Phase 3: Smoke, E2E i dokumentacja

### Overview

Smoke sprawdza obie trasy na żywej bazie, w tym izolację i kaskadę. Jedna specyfikacja Playwright pokrywa dialog, którego testy renderowania nie otworzą. Dokumenty zapisują rozstrzygnięcia.

### Changes Required:

#### 1. Kroki smoke

**File**: `scripts/smoke.mjs`

**Intent**: Powtórzyć przez trasy to, co smoke dziś sprawdza przez Data API, zgodnie z `context/foundation/test-plan.md:445-456`, i nazwać FR-015 w każdym kroku.

**Contract**:

- `POST /api/offer-delete`: bez sesji i ze sfałszowaną sesją → `/auth/signin`; ciało, które nie jest formularzem; id, które nie jest uuid; oferta, której nie ma → `?deleted=gone`.
- `POST /api/notes`: nieznana intencja niczego nie zapisuje; `intent=delete` pierwszego konta na ofercie testowej usuwa jego notatkę, a notatka drugiego konta na tej samej ofercie jest `"same"` (`withSnapshot`); powtórzone usunięcie prowadzi na `?note=gone`.
- Blok kaskady (`:2247-2289`): pierwszą ofertę testową usuwa drugie konto przez trasę — adres `?deleted=1`, jej notatki i wiersze drugiej oferty sprawdzone jak dziś; drugą ofertę usuwa trasa z `return=archive` — adres `/offers/archive?deleted=1`, notatki i audyt znikają. `/dashboard?deleted=1` niesie `data-delete-result="deleted"`.
- Krok usunięcia notatki stoi po krokach świeżości audytu, tuż przed blokiem kaskady; sprawdzenie „obie notatki są” w bloku kaskady dopasowane do jednej usuniętej notatki. Sprzątanie nadal oczekuje zera wierszy.
- Strony `/dev/*` nadal odpowiadają 404 na podglądzie produkcyjnym. Komentarz nagłówkowy skryptu wymienia nowe kroki.

#### 2. Specyfikacja E2E dialogu

**File**: `tests/e2e/delete-with-confirmation.spec.ts` (nowy), `tests/e2e/fixture-offer.ts`

**Intent**: Sprawdzić w przeglądarce to, czego nie widać bez niej: dialog, anulowanie i wysyłkę formularza z portalu.

**Contract**: Dwa testy na ofercie testowej zapisanej przez Data API, na wzór `tests/e2e/seed.spec.ts` i `tests/e2e/note-roundtrip-verbatim.spec.ts`: (1) anulowanie dialogu zostawia ofertę, potwierdzenie prowadzi na `/dashboard` z banerem, a karta odpowiada 404; (2) anulowanie zostawia notatkę, potwierdzenie ją usuwa, karta pokazuje baner i pusty edytor. `fixture-offer.ts` dostaje sprzątanie dla oferty, którą test mógł już usunąć — liczone po wierszach, z oczekiwaną liczbą podaną przez test. Specyfikacja nie wylogowuje konta E2E i nie naciska przycisku audytu.

#### 3. PRD

**File**: `context/foundation/prd.md`

**Intent**: Zapisać rozstrzygnięcia S-11 tam, gdzie wiążą reguły projektu.

**Contract**: Blok rozstrzygnięć w „Open Questions” dostaje wpis „Jak działa usuwanie (rozstrzygnięte 2026-10-11 w S-11)”: usunięcie oferty zabiera notatki zespołu i wynik audytu; każde usunięcie poprzedza potwierdzenie; żywą ofertę usuwa się z karty, zarchiwizowaną także z listy archiwum; trwający audyt nie blokuje usunięcia; gdy dwie osoby usuwają tę samą ofertę, druga dowiaduje się, że oferty już nie było; usunięcie własnej notatki zabiera ją w brzmieniu z bazy. FR-015 dostaje dopisek o audycie.

#### 4. Reguły projektu i README

**File**: `CLAUDE.md`, `README.md`

**Intent**: Nazwać nowe wzorce referencyjne i opisać, co pokrywa smoke.

**Contract**: `CLAUDE.md` — w „Structure” punkt o `src/pages/api/offer-delete.ts` (trasa jednego usunięcia sądzonego po liczbie wierszy, zero wierszy jako osobny wynik, `deleteNoNotesConfig`) i o intencji `delete` w `src/pages/api/notes.ts`; w „UI” — `src/components/ui/alert-dialog.tsx` z `@radix-ui/react-alert-dialog` i `src/components/form/ConfirmDialog.tsx` jako wzorzec potwierdzenia nieodwracalnej akcji, `DeleteOfferForm` wśród formularzy `/dev/forms`; w „Testing” — kroki smoke obu tras i ich miejsce względem kroków świeżości, pliki testów tras jako referencje. Reguły nazywają pliki, nie liczby. `README.md` — trasy i pokrycie smoke.

#### 5. Plan testów i roadmapa

**File**: `context/foundation/test-plan.md`, `context/foundation/roadmap.md`

**Intent**: Zamknąć zapowiedzi S-11 w planie testów i zaktualizować wiersz przekazania.

**Contract**: `test-plan.md` — zdania „no route yet (S-11)” (`:69`) i instrukcje S-11 (`:445-456`) opisują stan po zmianie: która warstwa trzyma co, i że obie trasy traktują zero wierszy jako osobny wynik. `roadmap.md` — wiersz przekazania S-11 bez instrukcji „run `/10x-plan`”; status prowadzą `/10x-implement` i `/10x-archive`.

### Success Criteria:

#### Automated Verification:

- `npm run smoke` przechodzi na lokalnym Supabase
- `npm run test:db` przechodzi
- `npx playwright test` przechodzi na lokalnym Supabase
- `npm test`, `npm run lint`, `npx astro sync && npx astro check` i `npm run build` przechodzą

#### Manual Verification:

- Dwie przeglądarki z dwoma kontami: obie mają otwartą kartę tej samej oferty; pierwsza usuwa, druga po potwierdzeniu widzi baner „Tej oferty już nie było”
- W logu `npm run dev` usunięcie oferty zostawia wpis `offer_delete` z `user_id`, `offer_id` i `otodom_id`, a usunięcie notatki wpis `note` bez treści notatki
- `CLAUDE.md`, `README.md`, PRD i plan testów opisują stan zgodny z kodem

**Implementation Note**: Po zakończeniu fazy i przejściu automatycznej weryfikacji zatrzymaj się na ręczne potwierdzenie.

---

## Testing Strategy

### Unit Tests:

- Trasy przy sieci zatkanej na krawędzi HTTP (`tests/fixtures/http.ts`), nigdy przez mockowanie `@/lib/*`; każdy scenariusz podaje liczbę zapisów.
- Gałąź zera wierszy dla obu tras stoi obok gałęzi jednego wiersza i nigdy nie kończy adresem sukcesu.
- Wyjście bez konfiguracji w osobnych plikach `.unconfigured.test.ts`.
- Renderowanie przez Container API: obecność i brak akcji, białe listy banerów, rozdział `form=`.

### Integration Tests:

- Smoke: izolacja usunięcia notatki (`withSnapshot`), kaskada przez trasę, odmowy przed zapisem.
- Playwright: dialog — anulowanie i potwierdzenie — dla oferty i dla notatki.
- Audyt przerwany usunięciem oferty: istniejący test `claim_lost` (`tests/pages/api/audits.test.ts:1708`); żaden test nie wysyła żądania do dostawcy modelu.

### Manual Testing Steps:

1. Zapisz ofertę, dodaj notatki z dwóch kont, usuń ofertę z karty — sprawdź baner, tablicę i brak karty pod starym adresem.
2. Zarchiwizuj inną ofertę i usuń ją z wiersza `/offers/archive` — sprawdź baner i licznik „Archiwum (N)”.
3. Usuń własną notatkę; sprawdź, że notatka drugiego konta stoi bez zmian i że edytor jest pusty.
4. Otwórz dialog i zamknij go przez „Anuluj”, Escape i kliknięcie obok — nic nie znika.
5. Wklej ponownie adres usuniętej oferty — zapisuje się jako nowa, bez informacji o duplikacie.
6. Scenariusz dwóch przeglądarek z fazy 3.

## Performance Considerations

Każde usunięcie to jedno żądanie do bazy. Karta dostaje jedną wyspę więcej, a wiersz archiwum drugą wyspę na wiersz; kod dialogu ładuje się raz na stronę. Trasa nie robi nic obciążającego CPU Workera.

## Migration Notes

Brak migracji i brak `supabase db push`. Wdrożenie to sam Worker. Wycofanie to poprzednia wersja Workera; usuniętych w międzyczasie ofert nie da się odtworzyć — to przyjęta cecha twardego usuwania (PRD, FR-015).

## References

- Slice: `context/foundation/roadmap.md` (S-11), issue [#22](https://github.com/Sigaretif/Vetpad/issues/22)
- Wymaganie: `context/foundation/prd.md:113-114` (FR-015)
- Wzorzec trasy: `src/pages/api/offer-archive.ts`, `src/pages/api/offer-refetch.ts`
- Wzorzec intencji usunięcia: `src/pages/api/requirements.ts:55-72`, `src/components/criteria/RequirementsEditor.tsx`
- Wzorzec prymitywu z Radixem: `src/components/ui/select.tsx`
- Wzorzec komunikatu: `src/components/offers/ArchiveNotice.astro`, `src/pages/offers/archive.astro:23-34`
- Instrukcje testowe S-11: `context/foundation/test-plan.md:445-456`, §6.3
- Poprzedni plan: `context/archive/2026-10-11-archive-and-restore/plan.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Trasy usuwania

#### Automated

- [x] 1.1 `npm test` przechodzi, w tym nowe pliki testów obu tras — 8159321
- [x] 1.2 `npm run lint` przechodzi — 8159321
- [x] 1.3 `npx astro sync && npx astro check` przechodzi — 8159321
- [x] 1.4 `npm run build` przechodzi bez `.env` i `.dev.vars` — 8159321

#### Manual

- [x] 1.5 Na lokalnym Supabase żądanie `POST /api/offer-delete` z id oferty testowej usuwa ją razem z notatkami i audytem, a powtórzone prowadzi na `/dashboard?deleted=gone`

### Phase 2: Dialog i widoki

#### Automated

- [x] 2.1 `npm test` przechodzi, w tym nowe testy renderowania — 166ca94
- [x] 2.2 `npm run lint` przechodzi z pustą listą `ignores` w `tokensOnlyConfig` — 166ca94
- [x] 2.3 `npx astro sync && npx astro check` przechodzi — 166ca94
- [x] 2.4 `npm run build` przechodzi bez `.env` i `.dev.vars` — 166ca94
- [x] 2.5 `package.json` zawiera `@radix-ui/react-alert-dialog` i nie zawiera pakietu `radix-ui` — 166ca94

#### Manual

- [x] 2.6 Na karcie żywej oferty „Usuń ofertę” otwiera dialog; „Anuluj” i Escape niczego nie usuwają, a fokus wraca na przycisk
- [x] 2.7 Potwierdzenie usuwa ofertę i prowadzi na `/dashboard` z banerem; oferty nie ma na tablicy, w sekcji „Ostatnio zarchiwizowane” ani w liczniku archiwum
- [ ] 2.8 Zarchiwizowaną ofertę da się usunąć z karty (powrót na tablicę) i z wiersza `/offers/archive` (powrót na archiwum z banerem)
- [x] 2.9 „Usuń” przy własnej notatce usuwa ją po potwierdzeniu; karta pokazuje baner i pusty edytor, a notatki innych członków stoją bez zmian
- [x] 2.10 Przy cudzej notatce nie ma przycisku „Usuń”
- [x] 2.11 Strony `/dev/forms`, `/dev/offer-card` i `/dev/board` renderują nowe sekcje pod `npm run dev`
- [ ] 2.12 Dialog jest czytelny na wąskim ekranie i w ciemnym motywie, a przycisk potwierdzenia wyraźnie różni się od „Anuluj”

### Phase 3: Smoke, E2E i dokumentacja

#### Automated

- [x] 3.1 `npm run smoke` przechodzi na lokalnym Supabase — 0bc3ad5
- [x] 3.2 `npm run test:db` przechodzi — 0bc3ad5
- [x] 3.3 `npx playwright test` przechodzi na lokalnym Supabase — 0bc3ad5
- [x] 3.4 `npm test`, `npm run lint`, `npx astro sync && npx astro check` i `npm run build` przechodzą — 0bc3ad5

#### Manual

- [ ] 3.5 Dwie przeglądarki z dwoma kontami: obie mają otwartą kartę tej samej oferty; pierwsza usuwa, druga po potwierdzeniu widzi baner „Tej oferty już nie było”
- [x] 3.6 W logu `npm run dev` usunięcie oferty zostawia wpis `offer_delete` z `user_id`, `offer_id` i `otodom_id`, a usunięcie notatki wpis `note` bez treści notatki
- [ ] 3.7 `CLAUDE.md`, `README.md`, PRD i plan testów opisują stan zgodny z kodem
