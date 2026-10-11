# Archiwizacja i przywracanie ofert — Implementation Plan

## Overview

Członek może przenieść ofertę do archiwum, żeby zniknęła z tablicy, i przywrócić ją stamtąd (FR-014). Baza zapisuje, kto i kiedy zarchiwizował; `/dashboard` pokazuje tylko żywe oferty, a pod nimi sekcję „ostatnio zarchiwizowane” z licznikiem; pełna lista stoi na osobnej stronie `/offers/archive`. Slice S-10 roadmapy, issue [#21](https://github.com/Sigaretif/Vetpad/issues/21).

## Current State Analysis

- `public.offers` nie ma żadnej kolumny archiwizacji. Jedyna kolumna wskazująca `auth.users` to `created_by` (`on delete set null`), chroniona triggerem `offers_freeze_created_by` (`supabase/migrations/20260923153747_offers_keep_after_author_deleted.sql:30-45`).
- Polityka `offers_update_authenticated` pozwala każdemu zalogowanemu członkowi zmienić dowolną kolumnę dowolnej oferty przez Data API (`supabase/migrations/20260922202756_create_offers.sql:101-106`). Podpis archiwizującego ustawiany przez klienta dałoby się więc podrobić.
- Tablica czyta wszystkie oferty bez filtra (`src/pages/dashboard.astro:25-29`), a jej nagłówek liczy je wszystkie (`src/components/offers/OfferBoard.astro:50-52`).
- Wiersz tablicy jest jednym linkiem do karty (`src/components/offers/OfferBoardItem.astro:53-57`) i nie mieści przycisku ani formularza.
- Ścieżka duplikatu otwiera kartę z `?duplicate=1` (`src/pages/api/offers.ts:84-87`, `:152-153`), a komunikat stoi w `src/components/offers/DuplicateNotice.astro`.
- Trasa audytu sprawdza wszystko, co darmowe, przed zajęciem wiersza i przed kluczem dostawcy (`src/pages/api/audits.ts`, funkcja `audit`); powody odmowy i ich zdania stoją w `src/lib/audit/failure.ts`.
- Nazywanie członka jest gotowe: `resolveSaver`, `resolveAuthors`, `saverName` w `src/lib/members.ts`.
- `src/pages/api/offer-refetch.ts` jest wzorcem trasy, która zapisuje jeden wiersz `public.offers` i ocenia zapis po błędzie i liczbie wierszy; `src/pages/api/criteria.ts` — wzorcem trasy z polem `intent`.
- `context/foundation/test-plan.md` §6.3 już wymienia obowiązki S-10: krok smoke przez archiwizację i przez przywrócenie z notatkami `snapshot: "same"`, ataki przez Data API na kolumnę, której członek nie może podrobić, i przypadek w `scripts/account-deletion.sql`.
- `scripts/smoke.mjs` zakłada, że obie oferty testowe stoją na `/dashboard` (`fixtureBoardRow`, `fixtureBoardOrder`, `auditedBoardRow`), więc archiwizacja w smoke musi się odwrócić, zanim dojdzie do tych kroków.
- PRD nie mówi, co się dzieje z archiwum po usunięciu konta archiwizującego (`context/foundation/prd.md:128`), z wklejonym adresem zarchiwizowanej oferty (FR-005) ani z audytem takiej oferty (FR-010).

## Desired End State

- Na karcie żywej oferty stoi przycisk „Zarchiwizuj”. Po jego użyciu oferta znika z `/dashboard`, a karta mówi, że oferta jest w archiwum, od kiedy i przez kogo tam trafiła, i pokazuje przycisk „Przywróć”.
- `/dashboard` pokazuje tylko żywe oferty. Pod tablicą stoi sekcja z ofertami zarchiwizowanymi w ostatnich 7 dniach (tytuł, kto, kiedy) i stały link „Archiwum (N)” z liczbą wszystkich zarchiwizowanych.
- `/offers/archive` wymienia wszystkie zarchiwizowane oferty, od najpóźniej zarchiwizowanej: miniatura, tytuł, cena, metraż, lokalizacja, „zarchiwizowana przez… dnia…”, link do karty i przycisk „Przywróć”.
- Datę i osobę archiwizacji ustawia baza z `auth.uid()`; żaden członek nie podpisze archiwizacji cudzym nazwiskiem ani nie zmieni podpisu istniejącej.
- Na zarchiwizowanej ofercie działają notatki i ponowne pobranie. Audytu nie da się uruchomić do przywrócenia: sekcja audytu nie renderuje przycisku, a `POST /api/audits` odmawia przed zajęciem wiersza i przed sięgnięciem po klucz dostawcy. Zapisany wynik audytu pozostaje czytelny.
- Wklejenie adresu zarchiwizowanej oferty otwiera jej kartę z komunikatem, że jest w archiwum i kto ją tam przeniósł, z przyciskiem przywrócenia. Nic nie przywraca się samo.
- Przywrócenie czyści datę i osobę archiwizacji.
- Po usunięciu konta archiwizującego oferta zostaje w archiwum z tą samą datą, podpisana „przez osobę z usuniętym kontem”.

Weryfikacja: `npm test`, `npm run lint`, `npx astro sync && npx astro check`, `npm run build`, `npm run test:db`, `npm run smoke` — wszystkie zielone; kroki ręczne z faz 3 i 4.

### Key Discoveries:

- `on delete set null` Postgres wykonuje jako UPDATE, który przechodzi przez triggery `before update` — trigger zamrażający podpis musi przepuścić `null`, gdy konta już nie ma (`context/foundation/lessons.md`, „Declare `on delete`…”; `offers_freeze_created_by` jest wzorcem).
- `src/lib/log.ts` buduje wpis z białej listy `FIELDS`; pole spoza niej jest po cichu pomijane i jest błędem typu. Nowe pole dopisuje się do listy.
- `OfferRow` (`src/lib/otodom/types.ts:113-120`) jest używany przez wszystkie fixtury w `src/pages/dev/_offer-fixtures.ts` i w testach; nowa kolumna wymaga uzupełnienia każdej z nich.
- Middleware chroni po prefiksie (`src/middleware.ts:6`, `:83-87`), więc `/offers/archive` jest objęte ochroną bez zmian. Statyczna trasa Astro wygrywa z dynamiczną `src/pages/offers/[id].astro`.
- `boardSortHref` zwraca sztywne `/dashboard?sort=&dir=` (`src/lib/offer-board.ts:57-60`) — kolejny powód, by archiwum nie było przełącznikiem na tablicy.
- `AUDIT_OFFER_COLUMNS` (`src/lib/audit/input.ts`) wyznacza odcisk ogłoszenia; kolumny archiwizacji do niej nie wchodzą, więc archiwizacja nie oznacza żadnego audytu jako nieaktualnego i nie wymaga nowej wersji odcisku.
- `requestAuditOfMissingOffer` w `scripts/smoke.mjs` odrzuca id oferty testowej, żeby smoke nigdy nie doszedł do dostawcy modelu. Odmowa audytu zarchiwizowanej oferty jest więc sprawdzana w `tests/pages/api/audits.test.ts`, nie w smoke.

## What We're NOT Doing

- **Bez bramki wizualnej** — decyzja użytkownika; bez macierzy 7 stanów i bez zrzutów. Nowe stany dostają fixtury i sekcje na `/dev/*`, zmiana przechodzi `npm run lint`.
- **Bez zapisu, kto przywrócił.** Przywrócenie czyści obie kolumny; kto przywrócił, zostaje tylko w logu. Bez historii archiwizacji.
- **Bez przywracania jako skutku ubocznego.** Wklejenie adresu, ponowne pobranie ani usunięcie konta nie przywracają oferty.
- **Bez przycisku archiwizacji w wierszu tablicy.** Wiersz zostaje jednym linkiem; archiwizuje się z karty.
- **Bez statusu audytu i znaczników limitów w wierszu archiwum** — strona archiwum nie czyta indeksu audytów, świeżości ani limitów.
- **Bez blokady audytu w bazie.** Odmawia trasa. Próba rozpoczęta przez Data API na zarchiwizowanej ofercie niczego nie kosztuje, bo nie wywołuje dostawcy; trigger `public.offer_audits` zostaje bez zmian.
- **Bez przerywania trwającej próby audytu** przy archiwizacji — próba dobiega końca i zapisuje wynik.
- **Bez blokady notatek i ponownego pobrania** na zarchiwizowanej ofercie.
- **Bez usuwania ofert** — to S-11. Roadmapa dostaje dopisek, że zarchiwizowaną ofertę też da się usunąć.
- **Bez potwierdzenia przed archiwizacją** — akcja jest odwracalna.
- **Bez paginacji i bez sortowania strony archiwum** poza kolejnością „najpóźniej zarchiwizowana pierwsza”.
- **Bez zawężania `loadBoardFreshness`** do żywych ofert — nadal czyta wiersze wszystkich audytowanych ofert; przy skali zespołu to bez znaczenia.
- **Bez testu E2E** — `context/foundation/test-plan.md` §4 nie planuje warstwy E2E dla tej zmiany.
- **Bez nowej zależności** w `package.json`.

## Implementation Approach

Stan archiwum to dwie kolumny na `public.offers`: `archived_at` i `archived_by`. `archived_at` niesie stan (żywa / zarchiwizowana), `archived_by` — podpis. Klient wyraża tylko intencję: wpisuje dowolną niepustą wartość do `archived_at`, żeby zarchiwizować, albo `null`, żeby przywrócić. Trigger zastępuje ją czasem bazy, podpisuje `auth.uid()` i zamraża obie kolumny, dopóki oferta jest w archiwum. Dzięki temu RLS zostaje bez zmian, a podrobienie podpisu jest niemożliwe także przez Data API.

Kolejność faz idzie od bazy w górę: schemat i czyste reguły, potem trasy, potem karta, potem tablica i strona archiwum, na końcu smoke i dokumentacja. Filtr tablicy ląduje w fazie 4; do tego czasu zarchiwizowana oferta nadal stoi na `/dashboard`, co jest stanem przejściowym między lokalnymi commitami, nie stanem wdrożonym.

## Critical Implementation Details

**Kolejność w triggerze.** Gałąź usuniętego konta jest sprawdzana przed każdą inną regułą: `archived_by` przechodzi z wartości na `null` przy niezmienionym `archived_at` tylko wtedy, gdy konta z `old.archived_by` już nie ma w `auth.users`. Gdy ten sam członek zapisał i zarchiwizował ofertę, usunięcie konta wykonuje dwa osobne UPDATE-y (po jednym na klucz obcy), więc trigger musi poprawnie przepuścić każdy z nich osobno — także ten, w którym druga kolumna wciąż trzyma id usuniętego konta.

**Kolejność w trasie audytu.** Sprawdzenie archiwum stoi zaraz po odczycie oferty i przed `createAuditProvider()`, tak jak `offer_not_found`: zarchiwizowana oferta dostaje tę samą odpowiedź niezależnie od tego, czy środowisko ma klucz. To sprawdzenie nie jest blokadą — archiwizacja między nim a zajęciem wiersza przepuści jeden audyt, co jest zaakceptowane.

## Phase 1: Schemat i reguły

### Overview

Baza zna stan archiwum i sama go podpisuje; kod ma typ wiersza, czystą regułę „ostatnio” i odczyt archiwum; PRD mówi to, co plan rozstrzygnął.

### Changes Required:

#### 1. Migracja kolumn archiwizacji

**File**: `supabase/migrations/<timestamp>_offers_archive.sql` (utworzony przez `supabase migration new offers_archive`)

**Intent**: Dodać do `public.offers` stan archiwum i podpis, których klient nie może podrobić, oraz zachować archiwum po usunięciu konta archiwizującego.

**Contract**:

- Kolumny: `archived_at timestamptz` (null = żywa) i `archived_by uuid references auth.users (id) on delete set null`.
- Ograniczenie: `archived_by` jest niepuste tylko przy niepustym `archived_at`.
- Trigger `before insert`: nowa oferta zawsze zaczyna jako żywa — obie kolumny `null`, cokolwiek przysłał klient.
- Trigger `before update` (`security definer`, `search_path = ''`, nazwy z kwalifikacją schematu), reguły w tej kolejności:
  1. usunięte konto: `archived_by` z wartości na `null`, `archived_at` bez zmian, konta `old.archived_by` nie ma w `auth.users` → przepuść;
  2. archiwizacja (`old.archived_at` null, `new.archived_at` niepuste): `archived_at := now()`, `archived_by := auth.uid()`; bez `auth.uid()` zapis jest odrzucany, bo archiwum bez podpisu znaczy wyłącznie „konto usunięte”;
  3. przywrócenie (`old.archived_at` niepuste, `new.archived_at` null): obie kolumny `null`;
  4. w każdym innym przypadku obie kolumny wracają do wartości z `old`.
- Bez nowych polityk RLS i bez `grant`: `offers_update_authenticated` już obejmuje te kolumny, a trigger jest jedyną bramką podpisu.
- Komentarz migracji nazywa regułę z PRD (FR-014, Non-Functional Requirements) dla `on delete set null`.

#### 2. Typ wiersza

**File**: `src/lib/otodom/types.ts`

**Intent**: `OfferRow` niesie stan archiwum, żeby karta i widoki czytały go z wiersza, który już mają.

**Contract**: `OfferRow` dostaje `archived_at: string | null` i `archived_by: string | null`. `OfferInsert` zostaje bez zmian — mapper i obie trasy ingestii nigdy nie wysyłają tych kolumn.

#### 3. Moduł archiwum

**File**: `src/lib/offer-archive.ts`

**Intent**: Jedno miejsce na regułę „ostatnio zarchiwizowane” i na odczyt archiwum, żeby tablica, strona archiwum i karta nie liczyły tego każda po swojemu.

**Contract**:

- `RECENTLY_ARCHIVED_MS` = 7 dni (168 godzin).
- `isRecentlyArchived(archivedAt: string, now: Date): boolean` — prawda, gdy `now − archivedAt ≤ RECENTLY_ARCHIVED_MS`; data z przyszłości jest „ostatnio”; data, która się nie parsuje, nie jest.
- `ARCHIVE_COLUMNS` — kolumny wiersza archiwum: te z `BOARD_COLUMNS` plus `archived_at`, `archived_by`.
- `loadArchive(supabase, viewerId, now): Promise<ArchiveResult>` — jeden odczyt `offers` z `archived_at is not null`, kolejność `archived_at desc`, potem `id asc`; archiwizujący nazwani jednym zapytaniem przez `resolveAuthors`. Nigdy nie rzuca. `{ ok: false }` dla braku klienta, błędu zapytania i wyjątku — nigdy pusta lista. `{ ok: true, offers, recent }`, gdzie każdy element niesie wiersz, `archivedAt` i `archiver: Saver`, a `recent` to podzbiór spełniający `isRecentlyArchived`.
- `archiveOf(offer: OfferRow, archiver: Saver)` albo równoważny kształt dla karty: `null` dla żywej oferty, `{ archivedAt, archiver }` dla zarchiwizowanej.
- Moduł nie importuje notatek ani audytu.

#### 4. Pole logu

**File**: `src/lib/log.ts`

**Intent**: Wpis trasy archiwizacji ma mówić, czy chodziło o archiwizację, czy o przywrócenie.

**Contract**: `intent` dopisane do `FIELDS`.

#### 5. Testy jednostkowe

**File**: `tests/lib/offer-archive.test.ts`

**Intent**: Reguła 7 dni i odczyt archiwum mają testy na wzór `tests/lib/team-limits.test.ts` (czysta reguła) i `tests/lib/criteria.test.ts` (odczyt ze stubem HTTP).

**Contract**:

- `isRecentlyArchived` z zegarem podanym w teście: dokładnie 7 dni wstecz jest „ostatnio”, sekunda dłużej już nie; data z przyszłości; data nieparsowalna.
- `loadArchive`: każdy nieudany odczyt (brak klienta, błąd bazy, wyjątek) stoi obok odczytu, który się udał i nic nie znalazł; kolejność; jedno zapytanie o nazwiska; archiwizujący `null` czyta się jako usunięte konto, nieudany odczyt nazwisk jako `unknown`.

#### 6. Fixtury z nową kolumną

**File**: `src/pages/dev/_offer-fixtures.ts`, `tests/fixtures/` (wszędzie, gdzie powstaje `OfferRow`)

**Intent**: Istniejące fixtury przechodzą kontrolę typów po rozszerzeniu `OfferRow`.

**Contract**: Każdy istniejący `OfferRow` dostaje `archived_at: null`, `archived_by: null`. Nowe fixtury archiwum powstają w fazach 3 i 4.

#### 7. Usunięcie konta archiwizującego

**File**: `scripts/account-deletion.sql`

**Intent**: Sprawdzić, co usunięcie konta zostawia po archiwizacji — akcję `on delete`, do której klucz publikowalny nie sięga.

**Contract**:

- Odchodzący członek archiwizuje ofertę, którą sam zapisał (ta sama oferta niesie więc `created_by` i `archived_by` usuwanego konta), podpisany przez trigger tak, jak fixtury limitów i audytu w tym pliku.
- Autokontrola fixtury: przed usunięciem `archived_at` jest niepuste, a `archived_by` to odchodzący.
- Po usunięciu: oferta jest, `archived_by` jest `null`, `archived_at` ma wartość sprzed usunięcia, reszta wiersza bez zmian. Porównanie „leaving offer” odejmuje `created_by` i `archived_by`.
- Oferta zostającego członka nadal porównywana całym wierszem.
- Wszystko wewnątrz istniejącej transakcji zakończonej `ROLLBACK`.

#### 8. PRD

**File**: `context/foundation/prd.md`

**Intent**: PRD wiąże kod; rozstrzygnięcia tego planu mają w nim stać, zanim powstanie kod, który na nich polega.

**Contract**:

- FR-014: archiwizuje i przywraca każdy członek; „ostatnio” to 7 dni, a licznik podaje wszystkie zarchiwizowane; przywrócenie nie zostawia śladu po archiwizacji; notatki i ponowne pobranie działają w archiwum.
- FR-005: adres zarchiwizowanej oferty otwiera jej kartę z informacją o archiwum i propozycją przywrócenia; nic nie przywraca się samo.
- FR-010: audytu zarchiwizowanej oferty nie da się uruchomić do przywrócenia; zapisany wynik pozostaje.
- Non-Functional Requirements, akapit o usuniętym koncie: archiwizujący dołącza do listy — oferta zostaje w archiwum, podpisana „przez osobę z usuniętym kontem”.
- Open Questions, blok rozstrzygnięć: wpis „resolved 2026-10-11 in S-10”.

### Success Criteria:

#### Automated Verification:

- Migracja nakłada się na czystą lokalną bazę: `npx supabase db reset`
- Testy jednostkowe przechodzą: `npm test`
- Kontrola typów przechodzi: `npx astro sync && npx astro check`
- Lint przechodzi: `npm run lint`
- Skrypty bazy przechodzą: `npm run test:db`

#### Manual Verification:

- Przez lokalne Data API jako członek: zapis `archived_at` z datą z przeszłości i cudzym `archived_by` zostawia w wierszu czas bazy i id wywołującego
- PRD czyta się spójnie: FR-014, FR-005, FR-010 i akapit o usuniętym koncie mówią to samo, co tabela decyzji w `plan-brief.md`

**Implementation Note**: Po tej fazie i przejściu weryfikacji automatycznej zatrzymaj się na ręczne potwierdzenie przed kolejną fazą.

---

## Phase 2: Trasa archiwizacji i odmowa audytu

### Overview

Jedna trasa formularza archiwizuje i przywraca; trasa audytu odmawia zarchiwizowanej ofercie, zanim cokolwiek zajmie lub zapłaci.

### Changes Required:

#### 1. Trasa archiwizacji

**File**: `src/pages/api/offer-archive.ts`

**Intent**: Zapisać intencję członka — zarchiwizuj albo przywróć — jednym update'em ocenianym po błędzie i liczbie wierszy, z jednym wpisem logu na każdym wyjściu, na wzór `src/pages/api/offer-refetch.ts`.

**Contract**:

- `POST`, `FormData`: `offer_id`, `intent` (`archive` | `restore`), `return` (`card` | `archive`; wszystko inne znaczy `card`).
- Jedyne przekierowanie bez sesji: `/auth/signin`.
- Kolejność: sesja → Supabase skonfigurowany → czytelny formularz → `intent` z listy → `offer_id` jest uuid → odczyt `id, archived_at, archived_by` → zapis.
- Zapis archiwizacji: update `archived_at` z warunkiem `archived_at is null`; zapis przywrócenia: update `archived_at = null` z warunkiem `archived_at is not null`; oba proszą o zmienione wiersze. Trasa nigdy nie wysyła `archived_by`.
- Wyjścia:
  - brak wiersza przy odczycie → tablica, zdanie o ofercie, której już nie ma;
  - oferta już w żądanym stanie → karta z `?archive=already-archived` / `?archive=already-live`, bez zapisu i bez błędu; przy archiwizacji karta nazywa tego, kto zarchiwizował wcześniej;
  - błąd zapisu → karta, `?error=…&form=archive#archiwum`; zapis bez odpowiedzi (`status === 0`) dostaje zdanie, które nie twierdzi, że stan się nie zmienił;
  - zero wierszy → stan zmienił się między odczytem a zapisem: karta z osobnym zdaniem, nigdy sukces;
  - sukces → `return=card`: `/offers/<id>?archive=archived` / `?archive=restored`; `return=archive`: `/offers/archive?restored=1`.
- Log: `event: "offer_archive"`, `outcome` z `archived | restored | unchanged | refused | failed`, pola `intent`, `stage`, `reason`, `user_id`, `offer_id`, pola bazy bez `details`. Odmowa oczekiwana przez produkt to `info`, awaria to `error`.
- Zdania porażki jako stałe w pliku trasy, po jednym rozróżnialnym na powód.
- Trasa czyta i pisze wyłącznie `public.offers`.

#### 2. Zakaz importu notatek w trasie archiwizacji

**File**: `eslint.config.js`

**Intent**: Archiwizacja nie dotyka notatek; struktura kodu ma to trzymać tak samo jak przy ponownym pobraniu.

**Contract**: `src/pages/api/offer-archive.ts` i `src/lib/offer-archive.ts` dołączają do plików objętych `refetchNoNotesConfig` (albo dostają własny, analogiczny blok).

#### 3. Powód odmowy audytu

**File**: `src/lib/audit/failure.ts`

**Intent**: Członek ma przeczytać jedno zdanie, dlaczego audyt się nie zaczął.

**Contract**: `offer_archived` w `AUDIT_FAILURE_REASONS`, zdanie w `auditFailureMessage` (oferta jest w archiwum; przywróć ją, żeby uruchomić audyt), `AUDIT_OUTCOME.offer_archived = "refused"`.

#### 4. Odmowa w trasie audytu

**File**: `src/pages/api/audits.ts`

**Intent**: Nie płacić za audyt oferty, którą zespół odrzucił.

**Contract**: Odczyt oferty prosi o `AUDIT_OFFER_COLUMNS` i `archived_at`. Niepuste `archived_at` → `refuse("offer_archived", { stage: "offer" })`, zaraz po `offer_not_found` i przed `createAuditProvider()`. `buildAuditInput`, `readAuditOffer` i odcisk ogłoszenia nadal dostają tylko kolumny z białej listy — `archived_at` nie trafia do wejścia audytu.

#### 5. Testy trasy archiwizacji

**File**: `tests/pages/api/offer-archive.test.ts`, `tests/pages/api/offer-archive.unconfigured.test.ts`

**Intent**: Każde wyjście trasy ma scenariusz ze stubem na krawędzi HTTP, na wzór `tests/pages/api/offer-refetch.test.ts` i `tests/pages/api/criteria.test.ts`.

**Contract**: Każdy scenariusz podaje, ile zapisów dotarło do `public.offers`.

- archiwizacja i przywrócenie, które się udały: jeden odczyt, jeden PATCH do własnego wiersza, ciało bez `archived_by`, `id`, `created_by`; przekierowanie zależne od `return`;
- oferta już w żądanym stanie: zero zapisów, `?archive=already-…`;
- zapis, który dotarł do zera wierszy, jest porażką; błąd bazy; zapis bez odpowiedzi;
- odmowy przed odczytem: brak sesji, ciało nie-formularz, nieznany `intent`, id nie-uuid; oferta, której nie ma;
- żaden wpis logu nie niesie adresu email, tytułu ani treści ogłoszenia;
- żadne żądanie nie dotyka `offer_notes` ani `offer_audits`;
- osobny plik dla stanu zero-config.

#### 6. Testy odmowy audytu

**File**: `tests/pages/api/audits.test.ts`, `tests/lib/audit/stream.test.ts`

**Intent**: Dowieść, że zarchiwizowana oferta kończy trasę audytu bez zajęcia wiersza i bez żądania do dostawcy.

**Contract**: Scenariusz zarchiwizowanej oferty: ostatnia linia strumienia niesie `offer_archived`, zero żądań do dostawcy, zero zapisów do `offer_audits`, wpis logu `refused`; obok niego kontrola — ta sama oferta żywa dochodzi do dostawcy. Test strumienia: `offer_archived` czyta się jako odmowa ze swoim zdaniem.

### Success Criteria:

#### Automated Verification:

- Testy tras przechodzą: `npm test`
- Kontrola typów przechodzi: `npx astro sync && npx astro check`
- Lint przechodzi, w tym zakaz importu notatek: `npm run lint`
- Build przechodzi bez sekretów: `npm run build`

#### Manual Verification:

- `curl` z sesją na lokalnej bazie: `POST /api/offer-archive` z `intent=archive` ustawia w wierszu czas bazy i id zalogowanego, a `intent=restore` czyści obie kolumny

**Implementation Note**: Po tej fazie i przejściu weryfikacji automatycznej zatrzymaj się na ręczne potwierdzenie przed kolejną fazą.

---

## Phase 3: Karta oferty

### Overview

Karta pokazuje stan archiwum z nazwiskiem i datą, pozwala zarchiwizować i przywrócić, nie daje uruchomić audytu w archiwum i mówi prawdę, gdy ktoś wkleił adres zarchiwizowanej oferty.

### Changes Required:

#### 1. Formularz archiwizacji

**File**: `src/components/offers/ArchiveForm.tsx`

**Intent**: Jeden przycisk — „Zarchiwizuj” albo „Przywróć” — jako wyspa złożona z kompozytów `src/components/form/`, na wzór `src/components/offers/RefetchForm.tsx`.

**Contract**: Eksport domyślny. Propsy: `offerId`, `intent`, `returnTo` (`card` | `archive`), `serverError`. Natywny `POST` na `/api/offer-archive`. `intent` i `return` w kontrolowanych ukrytych polach, nigdy tylko w `name`/`value` przycisku (reguła z `TeamLimitsForm.tsx`). Stan wysyłki przez `usePendingSubmit`, błąd przez `ServerError`.

#### 2. Blok archiwum na karcie

**File**: `src/components/offers/OfferCard.astro`

**Intent**: Karta mówi, czy oferta jest w archiwum, od kiedy i przez kogo, i trzyma formularz zmiany stanu.

**Contract**: Nowy blok z kotwicą `#archiwum` (prop `archiveAnchorId` dla kitchen sinka). Żywa oferta: zdanie objaśniające i `ArchiveForm intent="archive"`. Zarchiwizowana: „W archiwum od {data} — zarchiwizowana przez {kto}” przez `saverName` i `formatTimestamp`, bez „przez”, gdy `saverName` zwraca `null`, oraz `ArchiveForm intent="restore"`. Nazwisko jako tekst, nigdy przez `set:html` ani atrybut. Nowe propsy: `archive`, `archiveError`.

#### 3. Stan archiwum w widoku oferty

**File**: `src/components/offers/OfferView.astro`

**Intent**: Przekazać stan archiwum do karty i do sekcji audytu oraz wynieść go do znaczników, które czyta smoke.

**Contract**: Nowe propsy `archive` i `archiveError`. Kontener niesie `data-offer-archived="true" | "false"`. `OfferCard` dostaje `archive`, `OfferAudit` dostaje `archived`.

#### 4. Sekcja audytu w archiwum

**File**: `src/components/offers/OfferAudit.astro`

**Intent**: W archiwum nie ma jak uruchomić audytu, a zapisany wynik zostaje czytelny.

**Contract**: Nowy prop `archived: boolean` (domyślnie `false`). Gdy `true`: wyspa `AuditRunner` nie jest renderowana w żadnym stanie danych audytu, a w jej miejscu stoi zdanie, że audyt uruchomi się po przywróceniu oferty. Zapisany wynik, jego oznaczenie nieaktualności i trwająca próba renderują się jak dotąd; zachęta do ponownego uruchomienia przy wyniku nieaktualnym ustępuje temu samemu zdaniu. `data-audit-state`, `data-audit-available` i `data-audit-freshness` nie zmieniają znaczenia i nie zastępują stanu archiwum.

#### 5. Strona karty

**File**: `src/pages/offers/[id].astro`

**Intent**: Nazwać archiwizującego z wiersza, rozdzielić błędy trzech formularzy i pokazać komunikat po archiwizacji lub przywróceniu.

**Contract**:

- Archiwizujący przez `resolveSaver(supabase, offer.archived_by, viewerId)` w istniejącym `Promise.all`, tylko gdy `archived_at` jest niepuste; stan zawsze z wiersza, nigdy z adresu.
- `form=archive` kieruje `?error=` do bloku archiwum; `form=refetch` do bloku pobrania; reszta do notatek.
- `?archive=` czytane przez białą listę (`archived`, `restored`, `already-archived`, `already-live`) i renderowane komponentem komunikatu w slocie `notice`; żadna wartość nie jest wypisywana tak, jak przyszła.
- Dla zarchiwizowanej oferty link powrotu prowadzi do `/offers/archive`.

#### 6. Komunikat po zmianie stanu

**File**: `src/components/offers/ArchiveNotice.astro`

**Intent**: Członek widzi, co się stało po kliknięciu, w tym że ofertę zarchiwizował już ktoś inny.

**Contract**: Props `archive` (wartość z adresu) i `archive` stanu z wiersza. Cztery zdania z białej listy; nieznana wartość nie renderuje niczego. Wariant `already-archived` nazywa archiwizującego z wiersza. Wzorzec: `src/components/offers/RefetchNotice.astro`.

#### 7. Komunikat duplikatu

**File**: `src/components/offers/DuplicateNotice.astro`

**Intent**: Kto wkleja adres zarchiwizowanej oferty, dowiaduje się, że zespół ją odłożył, przez kogo, i może ją przywrócić.

**Contract**: Nowy prop `archive`. Dla zarchiwizowanej oferty zdanie mówi, że oferta była już zapisana, jest w archiwum i kto ją tam przeniósł, a pod nim stoją `ArchiveForm intent="restore"` i dotychczasowy `RefetchForm`. Dla żywej oferty komunikat zostaje bez zmian. `src/pages/api/offers.ts` zostaje bez zmian — przekierowuje jak dotąd, a stan czyta karta.

#### 8. Kitchen sinki

**File**: `src/pages/dev/offer-card.astro`, `src/pages/dev/forms.astro`, `src/pages/dev/_offer-fixtures.ts`

**Intent**: Każdy nowy stan karty, sekcji audytu i formularza renderuje się przez komponenty produkcyjne.

**Contract**:

- Fixtury: oferta zarchiwizowana przez innego członka, przez oglądającego, przez osobę z usuniętym kontem i z archiwizującym nieustalonym.
- `/dev/offer-card`: karta w każdym z czterech wariantów; sekcja audytu w archiwum bez wyniku, z wynikiem aktualnym, z nieaktualnym i z trwającą próbą; komunikat duplikatu dla zarchiwizowanej oferty; cztery warianty `ArchiveNotice`.
- `/dev/forms`: `ArchiveForm` w stanach archiwizuj, przywróć, wysyłka i błąd serwera.

#### 9. Testy renderowania

**File**: `tests/components/offers/render.test.ts`

**Intent**: Stan archiwum na karcie i jego skutki dla audytu są sprawdzone przez Container API.

**Contract**:

- żywa karta: formularz archiwizacji, `data-offer-archived="false"`; zarchiwizowana: zdanie z nazwiskiem i datą, formularz przywrócenia, `data-offer-archived="true"`;
- usunięte konto czyta się „przez osobę z usuniętym kontem”, archiwizujący nieustalony nie nazywa nikogo i nie czyta się jako usunięte konto;
- sekcja audytu w archiwum nie zawiera wyspy w żadnym stanie danych, a zapisany wynik i jego oznaczenie zostają; obok kontrola — ta sama sekcja dla żywej oferty zawiera wyspę;
- nazwisko archiwizującego z HTML-em w adresie email renderuje się jako tekst;
- `DuplicateNotice` dla zarchiwizowanej oferty zawiera formularz przywrócenia i formularz pobrania; dla żywej nie zawiera formularza przywrócenia.

### Success Criteria:

#### Automated Verification:

- Testy renderowania przechodzą: `npm test`
- Kontrola typów przechodzi: `npx astro sync && npx astro check`
- Lint przechodzi, w tym `tokensOnlyConfig`: `npm run lint`
- Build przechodzi: `npm run build`

#### Manual Verification:

- Na lokalnej bazie: „Zarchiwizuj” na karcie pokazuje komunikat, stan z własnym podpisem („przez Ciebie”) i przycisk „Przywróć”; „Przywróć” wraca do stanu wyjściowego
- Karta zarchiwizowana przez inne konto z `supabase/seed.sql` pokazuje jego adres email
- Na zarchiwizowanej ofercie sekcja audytu nie ma przycisku, a notatka i ponowne pobranie dają się wysłać
- Wklejenie adresu zarchiwizowanej oferty w formularzu na `/dashboard` otwiera kartę z komunikatem o archiwum i przyciskiem przywrócenia
- `/dev/offer-card` i `/dev/forms` renderują nowe stany pod `npm run dev`

**Implementation Note**: Po tej fazie i przejściu weryfikacji automatycznej zatrzymaj się na ręczne potwierdzenie przed kolejną fazą.

---

## Phase 4: Tablica i strona archiwum

### Overview

`/dashboard` pokazuje tylko żywe oferty i mówi, co ostatnio zniknęło; `/offers/archive` wymienia wszystko, co jest w archiwum, i pozwala przywracać z listy.

### Changes Required:

#### 1. Filtr żywych ofert

**File**: `src/pages/dashboard.astro`

**Intent**: Zarchiwizowana oferta znika z tablicy, a strona czyta archiwum obok niej.

**Contract**: Zapytanie tablicy dostaje `archived_at is null`; sortowanie i `nullsFirst: false` zostają. `loadArchive` dołącza do istniejącego `Promise.all`; jego nieudany odczyt nie zmienia stanu tablicy. Licznik w nagłówku „Zapisane oferty (N)” liczy odtąd żywe oferty.

#### 2. Sekcja „ostatnio zarchiwizowane”

**File**: `src/components/offers/RecentlyArchived.astro`

**Intent**: Oferta nigdy nie znika po cichu: świeże archiwizacje są nazwane, a licznik pokazuje całość.

**Contract**:

- Props: `ArchiveResult`. Renderowana pod tablicą na `/dashboard`.
- Kontener niesie `data-archive-state="ok" | "error"`.
- Zawsze widoczny link do `/offers/archive` z liczbą wszystkich zarchiwizowanych: „Archiwum (N)”; przy nieudanym odczycie link bez liczby.
- Lista ofert z `recent`: tytuł jako link do karty, „zarchiwizowana przez {kto}” i data; każdy element niesie `data-archived-offer="<id>"`.
- Brak świeżych przy niepustym archiwum: zdanie, że w ostatnich 7 dniach nic nie zarchiwizowano. Puste archiwum: zdanie, że archiwum jest puste.
- Nieudany odczyt: komunikat błędu, nigdy „nic nie zarchiwizowano”.
- Bez przycisków — przywraca się z karty i ze strony archiwum.

#### 3. Strona archiwum

**File**: `src/pages/offers/archive.astro`

**Intent**: Pełna lista zarchiwizowanych ofert z przywracaniem z wiersza.

**Contract**: Renderuje się w `AppLayout`; chroniona przez istniejący prefiks `/offers` w `PROTECTED_ROUTES`. Jeden odczyt przez `loadArchive`. Czyta `?restored=1` (komunikat w slocie `notice`) i `?error=` (błąd przywrócenia z wiersza trafia na kartę, więc strona nie potrzebuje `form=`). Link powrotu do `/dashboard`. Bez `prerender`.

#### 4. Lista i wiersz archiwum

**File**: `src/components/offers/OfferArchive.astro`, `src/components/offers/OfferArchiveItem.astro`

**Intent**: Wiersz archiwum mówi, kto i kiedy, i pozwala przywrócić bez wchodzenia w kartę.

**Contract**:

- `OfferArchive`: sekcja z `data-archive-state="ok" | "error"`, nagłówek z liczbą, stan pusty i stan błędu odczytu jako osobne gałęzie, lista `OfferArchiveItem`.
- `OfferArchiveItem`: miniatura przez `safeHttpsUrl` (brak bezpiecznego adresu → zaślepka), tytuł jako link do karty, cena i metraż z `Unstated` dla wartości niepodanych, lokalizacja, „zarchiwizowana przez {kto} · {data}”, `ArchiveForm intent="restore" returnTo="archive"` obok linku — link i przycisk to osobne elementy, przycisk nie siedzi wewnątrz `<a>`.
- Bez `AuditStatusBadge` i `LimitBreachBadges`.
- Wiersz niesie `data-archived-offer="<id>"`.

#### 5. Kitchen sink tablicy

**File**: `src/pages/dev/board.astro`, `src/pages/dev/_offer-fixtures.ts`

**Intent**: Każdy stan sekcji „ostatnio” i strony archiwum renderuje się przez komponenty produkcyjne.

**Contract**: Fixtury `ArchiveResult`: puste archiwum, archiwum ze świeżymi, archiwum bez świeżych, nieudany odczyt. Sekcje z własnym `data-state`: `recent-some`, `recent-none`, `recent-empty`, `recent-error`, `archive-list`, `archive-empty`, `archive-error` oraz stany wiersza archiwum (usunięte konto, archiwizujący nieustalony, niebezpieczne adresy zdjęć, wartości niepodane, długi tytuł). Akapit wstępu strony wymienia nowe sekcje.

#### 6. Testy widoków

**File**: `tests/components/offers/offer-archive.test.ts`

**Intent**: Sekcja „ostatnio” i wiersz archiwum są sprawdzone przez Container API, na wzór `tests/components/offers/offer-board-item.test.ts`.

**Contract**:

- `RecentlyArchived`: licznik podaje wszystkie zarchiwizowane, lista tylko świeże; nieudany odczyt niesie `data-archive-state="error"` i nie mówi, że archiwum jest puste — obok kontrola pustego archiwum z `ok`;
- `OfferArchiveItem`: niepodana cena i metraż nigdy nie czytają się jako 0; tylko bezpieczne adresy w `href`/`src`; przycisk przywrócenia nie jest zagnieżdżony w linku; ukryte pola niosą `intent=restore` i `return=archive`; brak statusu audytu i znaczników limitów;
- usunięte konto i archiwizujący nieustalony czytają się różnie.

### Success Criteria:

#### Automated Verification:

- Testy widoków przechodzą: `npm test`
- Kontrola typów przechodzi: `npx astro sync && npx astro check`
- Lint przechodzi: `npm run lint`
- Build przechodzi: `npm run build`

#### Manual Verification:

- Na lokalnej bazie: zarchiwizowana oferta znika z `/dashboard`, licznik w nagłówku tablicy maleje, a sekcja pod tablicą wymienia ją z nazwiskiem i datą; „Archiwum (N)” rośnie o jeden
- `/offers/archive` pokazuje ofertę; „Przywróć” w wierszu wraca na stronę archiwum z komunikatem, a oferta wraca na `/dashboard`
- Oferta z `archived_at` cofniętym w lokalnej bazie o ponad 7 dni znika z sekcji, a licznik nadal ją liczy
- `/offers/archive` bez sesji przekierowuje do `/auth/signin`
- `/dev/board` renderuje nowe sekcje pod `npm run dev`

**Implementation Note**: Po tej fazie i przejściu weryfikacji automatycznej zatrzymaj się na ręczne potwierdzenie przed kolejną fazą.

---

## Phase 5: Smoke i dokumentacja

### Overview

Smoke dowodzi na żywej lokalnej bazie, że archiwizacja nie rusza notatek i że podpisu nie da się podrobić; dokumenty projektu opisują nową trasę, stronę i reguły.

### Changes Required:

#### 1. Kroki smoke

**File**: `scripts/smoke.mjs`

**Intent**: Pokryć nową trasę i nową kolumnę tak, jak wymaga `context/foundation/test-plan.md` §6.3, bez zostawiania oferty testowej w archiwum.

**Contract**:

- Odmowy bez zapisu: `POST /api/offer-archive` bez sesji i ze sfałszowaną sesją → `/auth/signin`; `/offers/archive` bez sesji → `/auth/signin`; po zalogowaniu id nie-uuid, nieznany `intent` i oferta, której nie ma.
- Blok archiwizacji stoi po krokach zapisu ofert względem notatek i autora, a przed krokami kryteriów; działa na pierwszej ofercie testowej i kończy się jej przywróceniem, więc każdy późniejszy krok zastaje obie oferty na `/dashboard`.
- Nowy budowniczy obserwowanego odczytu dla wiersza `offers` oraz jego krok kontrolny, który wypada czerwono, gdy porównanie przestaje widzieć zmianę.
- Przez trasę: archiwizacja → `302` na kartę, `ALL_FIXTURE_NOTES` z `snapshot: "same"`; karta niesie `data-offer-archived="true"`; `/dashboard` nie ma wiersza tej oferty (`boardRow` puste) i niesie `data-archive-state="ok"` oraz `data-archived-offer="<id>"`; `/offers/archive` niesie `data-archive-state="ok"` i wiersz oferty. Przed archiwizacją krok kontrolny czyta ten sam wiersz na `/dashboard`.
- Przez Data API, jako drugi członek, na zarchiwizowanej ofercie: zmiana `archived_by` na siebie i zmiana `archived_at` → `rows: 1`, wiersz oferty `snapshot: "same"`.
- Przez trasę: przywrócenie → `302`, notatki `snapshot: "same"`, wiersz wraca na `/dashboard`, karta niesie `data-offer-archived="false"`.
- Przez Data API, jako drugi członek, na żywej ofercie: zapis `archived_at` z datą z przeszłości i `archived_by` pierwszego członka → w wierszu stoi id wywołującego i czas bazy; potem przywrócenie przez Data API.
- Smoke nie wysyła `POST /api/audits` dla zarchiwizowanej oferty testowej: `requestAuditOfMissingOffer` nadal odrzuca id ofert testowych.
- Komentarz nagłówka pliku opisuje nową trasę i nowy blok.

#### 2. README

**File**: `README.md`

**Intent**: Opis tras, stron i pokrycia smoke odpowiada kodowi.

**Contract**: `/offers/archive` i `POST /api/offer-archive` w opisie układu i ochrony tras; akapit o tym, co sprawdza smoke i `npm run test:db`, uzupełniony o archiwum.

#### 3. Reguły projektu

**File**: `CLAUDE.md`

**Intent**: Następny agent znajduje wzorce tej zmiany po nazwie pliku.

**Contract**:

- `## Structure`: migracja `offers_archive` jako wzorzec kolumny podpisywanej triggerem na tabeli, którą każdy członek może pisać; `src/lib/offer-archive.ts` jako wzorzec odczytu archiwum i reguły 7 dni; `src/pages/api/offer-archive.ts` jako wzorzec trasy zmieniającej stan z ochroną „kto pierwszy”; `data-offer-archived` i `data-archive-state` z regułą, że nieudany odczyt nigdy nie jest pustym archiwum.
- Product invariants: archiwizacja nie dotyka notatek ani audytu; audytu zarchiwizowanej oferty nie da się uruchomić; nic nie przywraca się samo.
- `### UI`: `ArchiveForm` na liście formularzy `/dev/forms`; stany archiwum na `/dev/board` i `/dev/offer-card`.
- `## Testing`: blok archiwizacji w smoke, jego miejsce i warunek, że kończy się przywróceniem; przypadek w `scripts/account-deletion.sql`.
- Zapowiedzi „S-10's archiver reuses them” i „S-10's archive among them” przepisane na stan faktyczny.

#### 4. Plan testów

**File**: `context/foundation/test-plan.md`

**Intent**: §6.3 przestaje opisywać S-10 jako przyszłość.

**Contract**: Punkt S-10 w §6.3 i wiersz ryzyka #5 nazywają istniejące kroki i pliki zamiast planowanych.

#### 5. Roadmapa i komentarze w kodzie

**File**: `context/foundation/roadmap.md`, `src/lib/members.ts`, `src/lib/format.ts`

**Intent**: Usunąć zapowiedzi, które stały się faktem.

**Contract**: Komentarze „later the archive author of S-10” i „later, note and archive dates” opisują stan obecny. Wiersz S-11 w Backlog Handoff wymienia `src/pages/api/offer-archive.ts` jako sąsiednią trasę zapisu jednego wiersza. Status S-10 zmienia `/10x-implement` i `/10x-archive`, nie ta faza.

### Success Criteria:

#### Automated Verification:

- Smoke przechodzi na lokalnej bazie: `npm run smoke`
- Skrypty bazy przechodzą: `npm run test:db`
- Testy jednostkowe przechodzą: `npm test`
- Kontrola typów przechodzi: `npx astro sync && npx astro check`
- Lint przechodzi: `npm run lint`
- Build przechodzi: `npm run build`

#### Manual Verification:

- Krok kontrolny bloku archiwizacji w smoke wypada czerwono po celowym zepsuciu (filtr tablicy usunięty lokalnie) i zielono po jego przywróceniu
- `CLAUDE.md` i `README.md` nie zawierają już zapowiedzi S-10 w czasie przyszłym

**Implementation Note**: Po tej fazie i przejściu weryfikacji automatycznej zatrzymaj się na ręczne potwierdzenie.

---

## Testing Strategy

### Unit Tests:

- `tests/lib/offer-archive.test.ts`: granica 7 dni z zegarem z testu; każdy nieudany odczyt archiwum obok udanego i pustego.
- `tests/pages/api/offer-archive.test.ts`: każde wyjście trasy z liczbą zapisów do `public.offers`; zero wierszy jako porażka; brak dotknięcia notatek i audytów.
- `tests/pages/api/audits.test.ts`: zarchiwizowana oferta — zero żądań do dostawcy, zero zapisów do `offer_audits`.
- `tests/components/offers/render.test.ts`, `tests/components/offers/offer-archive.test.ts`: stany karty, sekcji audytu, sekcji „ostatnio” i wiersza archiwum; usunięte konto różne od nieustalonego; tekst zamiast HTML-a.

### Integration Tests:

- `scripts/smoke.mjs`: archiwizacja i przywrócenie przez trasę z notatkami bez zmian; podrobienie podpisu przez Data API; tablica, sekcja „ostatnio” i strona archiwum czytane po znacznikach `data-*`.
- `scripts/account-deletion.sql`: usunięcie konta, które zapisało i zarchiwizowało tę samą ofertę.

### Manual Testing Steps:

1. Zarchiwizuj ofertę z karty jako pierwsze konto z seeda; sprawdź kartę, `/dashboard` i `/offers/archive`.
2. Zaloguj się jako drugie konto; sprawdź, że wszędzie stoi adres email pierwszego.
3. Wklej adres tej oferty w formularzu dodawania; sprawdź komunikat i przycisk przywrócenia.
4. Na zarchiwizowanej ofercie zapisz notatkę i uruchom ponowne pobranie; sprawdź brak przycisku audytu.
5. Przywróć z wiersza archiwum; sprawdź powrót na tablicę i czyste kolumny w bazie.

## Performance Considerations

`/dashboard` dostaje jeden dodatkowy odczyt `offers` (archiwum) i najwyżej jeden odczyt `members`, równolegle z istniejącymi. Strona archiwum robi dwa odczyty. Bez indeksu na `archived_at`: tabela ma kilkadziesiąt wierszy. Żadna z tych zmian nie dodaje pracy CPU nad treścią strony w Workerze.

## Migration Notes

- Migracja tylko dodaje kolumny z wartością `null`; wszystkie istniejące oferty są po niej żywe. Nie ma danych do przeniesienia.
- Do hostowanego projektu migracja trafia przez `npx supabase db push` przed wdrożeniem Workera, który jej potrzebuje: najpierw `--dry-run`, lista migracji do wglądu, pytanie o zgodę, push tylko po „tak” (`context/foundation/deployment-runbook.md`).
- Worker wdrożony przed migracją dostałby błąd przy filtrze `archived_at` i pokazał tablicę w stanie błędu odczytu — stąd kolejność.
- Wycofanie: wdrożenie poprzedniej wersji Workera wystarcza, bo stare zapytania ignorują nowe kolumny; kolumny mogą zostać.

## References

- PRD: `context/foundation/prd.md` — FR-014, FR-005, FR-006, FR-010, Non-Functional Requirements (usunięte konto)
- Roadmapa: `context/foundation/roadmap.md` — S-10, issue #21
- Plan testów: `context/foundation/test-plan.md` §6.3
- Lekcje: `context/foundation/lessons.md` — „Declare `on delete`…”, „Render URLs… through `safeHttpsUrl`”, „Formularz z kompozytów…”
- Wzorzec triggera zamrażającego: `supabase/migrations/20260923153747_offers_keep_after_author_deleted.sql:30-45`
- Wzorzec stanu, którego właścicielem są triggery: `supabase/migrations/20261009191000_offer_audits_ended_by_starter.sql`
- Wzorzec trasy zapisu jednego wiersza: `src/pages/api/offer-refetch.ts`
- Wzorzec trasy z `intent`: `src/pages/api/criteria.ts`, `src/components/criteria/TeamLimitsForm.tsx`
- Wzorzec nazywania członka: `src/lib/members.ts`
- Poprzedni plan tej samej serii: `context/archive/2026-10-09-refetch-and-stale-audit/plan.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Schemat i reguły

#### Automated

- [x] 1.1 Migracja nakłada się na czystą lokalną bazę: `npx supabase db reset` — af88d2a
- [x] 1.2 Testy jednostkowe przechodzą: `npm test` — af88d2a
- [x] 1.3 Kontrola typów przechodzi: `npx astro sync && npx astro check` — af88d2a
- [x] 1.4 Lint przechodzi: `npm run lint` — af88d2a
- [x] 1.5 Skrypty bazy przechodzą: `npm run test:db` — af88d2a

#### Manual

- [x] 1.6 Przez lokalne Data API jako członek: zapis `archived_at` z datą z przeszłości i cudzym `archived_by` zostawia w wierszu czas bazy i id wywołującego — af88d2a
- [x] 1.7 PRD czyta się spójnie: FR-014, FR-005, FR-010 i akapit o usuniętym koncie mówią to samo, co tabela decyzji w `plan-brief.md` — af88d2a

### Phase 2: Trasa archiwizacji i odmowa audytu

#### Automated

- [x] 2.1 Testy tras przechodzą: `npm test` — 6284cf3
- [x] 2.2 Kontrola typów przechodzi: `npx astro sync && npx astro check` — 6284cf3
- [x] 2.3 Lint przechodzi, w tym zakaz importu notatek: `npm run lint` — 6284cf3
- [x] 2.4 Build przechodzi bez sekretów: `npm run build` — 6284cf3

#### Manual

- [x] 2.5 `curl` z sesją na lokalnej bazie: `POST /api/offer-archive` z `intent=archive` ustawia w wierszu czas bazy i id zalogowanego, a `intent=restore` czyści obie kolumny — 6284cf3

### Phase 3: Karta oferty

#### Automated

- [x] 3.1 Testy renderowania przechodzą: `npm test` — b67f9f9
- [x] 3.2 Kontrola typów przechodzi: `npx astro sync && npx astro check` — b67f9f9
- [x] 3.3 Lint przechodzi, w tym `tokensOnlyConfig`: `npm run lint` — b67f9f9
- [x] 3.4 Build przechodzi: `npm run build` — b67f9f9

#### Manual

- [x] 3.5 Na lokalnej bazie: „Zarchiwizuj” na karcie pokazuje komunikat, stan z własnym podpisem („przez Ciebie”) i przycisk „Przywróć”; „Przywróć” wraca do stanu wyjściowego — b67f9f9
- [x] 3.6 Karta zarchiwizowana przez inne konto z `supabase/seed.sql` pokazuje jego adres email — b67f9f9
- [ ] 3.7 Na zarchiwizowanej ofercie sekcja audytu nie ma przycisku, a notatka i ponowne pobranie dają się wysłać
- [x] 3.8 Wklejenie adresu zarchiwizowanej oferty w formularzu na `/dashboard` otwiera kartę z komunikatem o archiwum i przyciskiem przywrócenia — b67f9f9
- [x] 3.9 `/dev/offer-card` i `/dev/forms` renderują nowe stany pod `npm run dev` — b67f9f9

### Phase 4: Tablica i strona archiwum

#### Automated

- [x] 4.1 Testy widoków przechodzą: `npm test` — 684f78c
- [x] 4.2 Kontrola typów przechodzi: `npx astro sync && npx astro check` — 684f78c
- [x] 4.3 Lint przechodzi: `npm run lint` — 684f78c
- [x] 4.4 Build przechodzi: `npm run build` — 684f78c

#### Manual

- [x] 4.5 Na lokalnej bazie: zarchiwizowana oferta znika z `/dashboard`, licznik w nagłówku tablicy maleje, a sekcja pod tablicą wymienia ją z nazwiskiem i datą; „Archiwum (N)” rośnie o jeden — 684f78c
- [x] 4.6 `/offers/archive` pokazuje ofertę; „Przywróć” w wierszu wraca na stronę archiwum z komunikatem, a oferta wraca na `/dashboard` — 684f78c
- [x] 4.7 Oferta z `archived_at` cofniętym w lokalnej bazie o ponad 7 dni znika z sekcji, a licznik nadal ją liczy — 684f78c
- [x] 4.8 `/offers/archive` bez sesji przekierowuje do `/auth/signin` — 684f78c
- [x] 4.9 `/dev/board` renderuje nowe sekcje pod `npm run dev` — 684f78c

### Phase 5: Smoke i dokumentacja

#### Automated

- [x] 5.1 Smoke przechodzi na lokalnej bazie: `npm run smoke`
- [x] 5.2 Skrypty bazy przechodzą: `npm run test:db`
- [x] 5.3 Testy jednostkowe przechodzą: `npm test`
- [x] 5.4 Kontrola typów przechodzi: `npx astro sync && npx astro check`
- [x] 5.5 Lint przechodzi: `npm run lint`
- [x] 5.6 Build przechodzi: `npm run build`

#### Manual

- [x] 5.7 Krok kontrolny bloku archiwizacji w smoke wypada czerwono po celowym zepsuciu (filtr tablicy usunięty lokalnie) i zielono po jego przywróceniu
- [x] 5.8 `CLAUDE.md` i `README.md` nie zawierają już zapowiedzi S-10 w czasie przyszłym
