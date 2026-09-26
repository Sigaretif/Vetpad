# Komunikat o duplikacie z autorem zapisu — plan implementacji

## Overview

Realizujemy S-07 (FR-005). Wklejenie adresu oferty, która jest już zapisana, ma prowadzić na istniejącą kartę z komunikatem, **który nazywa członka, który ją zapisał**. Przekierowanie i baner istnieją od S-02; brakuje nazwy autora. Aplikacja nie potrafi dziś zamienić `offers.created_by` (uuid z `auth.users`) na nazwę, bo `auth.users` nie jest dostępne przez Data API. Slice wprowadza tabelę `public.members` jako jedyne źródło nazwy członka — z niej skorzystają też S-05 (autor notatki, FR-013) i S-10 (kto zarchiwizował, FR-014). Autor zapisu pojawia się w banerze duplikatu i — na życzenie użytkownika — na stałe w nagłówku karty.

## Current State Analysis

- `src/pages/api/offers.ts:70-76` szuka oferty po znormalizowanym `source_url` przed pobraniem i przekierowuje na `/offers/<id>?duplicate=1`; `:88-96` łapie ten sam `otodom_id` pod innym slugiem (`23505`) i robi to samo. Normalizacja (`src/lib/otodom/url.ts`) zdejmuje query string i fragment. **Kontrakt trasy się nie zmienia.**
- `src/pages/offers/[id].astro:37-45` przy `?duplicate=1` pokazuje `<Banner variant="info">` z tekstem „Ta oferta była już zapisana — otwieramy istniejącą kartę." — bez autora.
- `offers.created_by` jest `uuid null references auth.users on delete set null` (`supabase/migrations/20260923153747_offers_keep_after_author_deleted.sql`); `null` znaczy wyłącznie „konto autora usunięto", a PRD (Non-Functional Requirements) każe wtedy pisać „konto usunięte".
- Jedyną „nazwą" członka w aplikacji jest e-mail w Topbarze (`src/components/Topbar.astro:14`, z `locals.user`). Konta seedowe (`supabase/seed.sql`) nie mają `display_name`. Nie ma tabeli profili.
- `OfferCard` (`src/components/offers/OfferCard.astro`) dostaje sam `OfferRow`; kitchen sink `/dev/offer-card` renderuje go z fixtur bez Supabase (`src/pages/dev/offer-card.astro`, `src/pages/dev/_offer-fixtures.ts`).
- `formatDate` (`src/lib/otodom/labels.ts:193`) liczy dzień w UTC z `YYYY-MM-DD` — dla `created_at` (timestamptz) zapisanego tuż po północy czasu polskiego pokazałby poprzedni dzień.
- `scripts/smoke.mjs` ma bezpośredni dostęp do Supabase (`SUPABASE_URL`/`SUPABASE_KEY`, krok `supabaseSignup`); CI (`.github/workflows/ci.yml`, job `smoke`) uruchamia lokalny Supabase, który stosuje migracje, a potem `seed.sql`.

## Desired End State

- Istnieje `public.members (id, email)`: jeden wiersz na konto w `auth.users`, utrzymywany wyłącznie wyzwalaczami, czytelny dla każdego zalogowanego członka, niewidoczny dla anon, niezapisywalny przez Data API.
- Wklejenie adresu zapisanej oferty (z parametrami śledzącymi lub bez) prowadzi na kartę z banerem:
  - „Ta oferta była już zapisana przez sigaretif2@vetpad.local — otwieramy istniejącą kartę." — gdy zapisał ją inny członek,
  - „Ta oferta była już zapisana przez Ciebie — otwieramy istniejącą kartę." — gdy zapisał ją oglądający,
  - „Ta oferta była już zapisana przez konto usunięte — otwieramy istniejącą kartę." — gdy `created_by` jest `null`,
  - „Ta oferta była już zapisana — otwieramy istniejącą kartę." — gdy autora nie da się ustalić (błąd odczytu, brak wiersza, brak e-maila).
- Nagłówek każdej karty ma linię „Zapisane przez <X> · <data zapisu>" z tymi samymi trzema wartościami X, albo „Zapisane <data zapisu>" w wariancie nieustalonym. Data w strefie `Europe/Warsaw`.
- `/dev/offer-card` pokazuje wszystkie cztery warianty banera i nagłówka; zrzuty zestawu `gate` leżą w `context/changes/duplicate-listing-notice/screenshots`.
- Smoke sprawdza, że anon dostaje `[]` z `members`, a zalogowany członek widzi wiersze.

Weryfikacja: `npx supabase db reset`, zapytania REST jako anon i jako członek, wklejenie zapisanego adresu z trzech kont seedowych, `npm run smoke`, zrzuty bramki.

### Key Discoveries:

- Duplikat jest już wykrywany w obu ścieżkach — S-07 dotyka tylko strony karty, nie trasy (`src/pages/api/offers.ts:70-96`).
- Autor musi wynikać z wiersza oferty, nie z parametru adresu: `?duplicate=1` każdy może dopisać ręcznie, a nazwa z query stringa byłaby do podrobienia.
- Seed wstawia konta do `auth.users` **po** migracjach (`supabase start` / `db reset`), więc wyzwalacz na `auth.users` wypełni `members` lokalnie i w CI bez zmian w `seed.sql`; konta hostowane uzupełnia `insert … select` w migracji.
- Lekcja „Declare `on delete` on every author column" (`context/foundation/lessons.md`) — `members.id` deklaruje `on delete cascade`; przypadek usuniętego konta renderujemy jako „konto usunięte", a nie jako błąd.
- Pułapka z CLAUDE.md: RLS bez polityki `select` daje `[]` i HTTP 200 — dlatego smoke sprawdza obie strony (anon pusto, członek niepusto).

## What We're NOT Doing

- Oferta ponownego pobrania na komunikacie o duplikacie (pełne FR-005) — wymaga re-fetchu z S-09; łączy je ten slice, który wejdzie drugi (roadmapa, S-07 Unknowns).
- Nazwy wyświetlane / `display_name` — nazwą członka jest pełny e-mail, tak jak w Topbarze.
- Autor zapisu na tablicy (`/dashboard`) — tylko karta.
- Autor notatek (S-05) i archiwizacji (S-10) — tu powstaje tylko `members`, z którego skorzystają.
- Zmiany w `src/pages/api/offers.ts`, normalizacji URL-a, dopasowaniu międzyportalowym i relistingu (Non-Goals PRD).
- Polityki zapisu na `members` dla członków — e-mail należy do Supabase Auth.

## Implementation Approach

Najpierw schemat, potem widok. Faza 1 dodaje `members` i sprawdza RLS zanim cokolwiek od niej zależy. Faza 2 dodaje moduł `src/lib/members.ts`, który zamienia `created_by` na jeden z czterech wariantów autora, i wspólny komponent banera używany zarówno przez stronę karty, jak i przez kitchen sink. Faza 3 domyka smoke, dokumentację, bramkę wizualną i wdrożenie migracji na hostowany projekt.

Warianty autora to jedna unia dyskryminowana; każda powierzchnia (baner, nagłówek) ma przełącznik z kontrolą wyczerpania, jak `failureMessage` w `src/pages/api/offers.ts`.

## Critical Implementation Details

- **Nieustalony ≠ usunięty.** „Konto usunięte" wolno pokazać tylko dla `created_by === null`. Błąd zapytania, brak klienta, brak wiersza w `members` przy niepustym `created_by` albo `email` równy `null` dają wariant nieustalony. Pomylenie ich to zmyślony fakt o członku zespołu — ten sam rodzaj błędu co „0 zł" w guardrailu PRD.
- **Wyzwalacz nie może blokować tworzenia konta.** `auth.users.email` bywa `null` (konta telefoniczne/anonimowe), więc `members.email` jest nullable; błąd w funkcji wyzwalacza zablokowałby logowanie/tworzenie konta w Supabase Auth.
- **Kolejność wdrożenia.** `npx supabase db push` na hostowany projekt przed tym, jak Worker z fazy 2 trafi na `master` (Workers Builds wdraża automatycznie). Bez tabeli karta nie pada — zapytanie zwraca błąd i widok spada do wariantu nieustalonego — ale autor się nie pokazuje.

## Phase 1: Tabela `members`

### Overview

Jedna migracja: tabela, wyzwalacze na `auth.users`, uzupełnienie istniejących kont, RLS.

### Changes Required:

#### 1. Migracja

**File**: `supabase/migrations/<timestamp>_create_members.sql` (utworzony przez `npx supabase migration new create_members`, nigdy ręcznie)

**Intent**: Dać członkom zespołu czytelne przez Data API źródło nazwy innego członka, bez odsłaniania `auth.users` i bez klucza `secret`. Komentarz nagłówkowy wyjaśnia, po co tabela istnieje i że jest wzorcem dla S-05/S-10 — w stylu `create_offers.sql`.

**Contract**:
- `public.members (id uuid primary key references auth.users (id) on delete cascade, email text)` — `email` nullable (patrz Critical Implementation Details).
- Funkcja `public.members_sync_from_auth()` `returns trigger`, `language plpgsql`, `security definer`, `set search_path = ''`, nazwy kwalifikowane schematem: przy `insert` wstawia `(new.id, new.email)`, przy `update of email` aktualizuje `email`; `on conflict (id) do update` przy insercie. `revoke execute … from public, anon, authenticated` — funkcja nie jest wywoływalna przez RPC.
- Wyzwalacze `members_on_auth_user_created` (`after insert on auth.users`) i `members_on_auth_user_email_changed` (`after update of email on auth.users`), `for each row`.
- Uzupełnienie: `insert into public.members (id, email) select id, email from auth.users on conflict (id) do nothing` — dla kont istniejących w hostowanym projekcie.
- RLS: `enable row level security`; jedna polityka `members_select_authenticated` `for select to authenticated using (auth.uid() is not null)`. **Brak polityk `insert`/`update`/`delete`** — odmowa jest zamierzona: tabelę pisze wyłącznie wyzwalacz `security definer`, a e-mail należy do Supabase Auth. Komentarz w migracji mówi to wprost i powtarza sygnatury odmowy (pusta tablica przy braku `select`; `new row violates row-level security policy` przy zapisie) oraz notę o anonimowych logowaniach z `20260923153747_offers_keep_after_author_deleted.sql`.
- Bez `grant` — Supabase nadaje je sam (CLAUDE.md).

### Success Criteria:

#### Automated Verification:

- `npx supabase db reset` przechodzi bez błędów, a `select count(*) from public.members` zwraca 3 (trzy konta z `supabase/seed.sql`)
- REST jako anon (`GET $SUPABASE_URL/rest/v1/members?select=id` z samym `apikey`) zwraca HTTP 200 i `[]`
- REST jako `sigaretif1@vetpad.local` (token z `/auth/v1/token?grant_type=password`) zwraca 3 wiersze z e-mailami
- REST `POST /rest/v1/members` jako zalogowany członek jest odrzucony (`new row violates row-level security policy`), a `PATCH` nie zmienia żadnego wiersza
- Zmiana `email` w `auth.users` (psql na lokalnej bazie) zmienia `members.email`; usunięcie konta, które zapisało ofertę, usuwa jego wiersz z `members`, ustawia `offers.created_by` na `null` i kończy się powodzeniem
- `npm run lint`, `npx astro sync`, `npx astro check` i `npm run build` przechodzą

#### Manual Verification:

- W Supabase Studio (lokalnie) tabela `members` ma włączone RLS i dokładnie jedną politykę, a Security Advisor nie zgłasza jej ani funkcji wyzwalacza

**Implementation Note**: Po automatycznej weryfikacji zatrzymaj się na potwierdzenie ręcznego sprawdzenia przez człowieka przed fazą 2.

---

## Phase 2: Autor na karcie i w banerze

### Overview

Moduł wyznaczający autora, wspólny komponent banera, linia w nagłówku karty, warianty na `/dev/offer-card`.

### Changes Required:

#### 1. Wyznaczanie autora

**File**: `src/lib/members.ts`

**Intent**: Jedno miejsce, które zamienia `created_by` na to, co widzi członek; S-05 i S-10 dołożą tu swoje odczyty.

**Contract**: `export type Saver = { kind: "self" } | { kind: "member"; email: string } | { kind: "deleted" } | { kind: "unknown" }`. `export async function resolveSaver(supabase, createdBy: string | null, viewerId: string | undefined): Promise<Saver>` — `createdBy === null` → `deleted`; `createdBy === viewerId` → `self` (bez zapytania); w przeciwnym razie `select email from members where id = createdBy` (`maybeSingle`): wiersz z niepustym e-mailem → `member`; błąd, wyjątek, brak wiersza lub `email === null` → `unknown`. Nigdy nie rzuca.

#### 2. Data zapisu

**File**: `src/lib/otodom/labels.ts`

**Intent**: Pokazać dzień zapisu tak, jak widzi go zespół w Polsce, a nie w UTC.

**Contract**: nowy `formatTimestamp(value: string): string` — timestamptz → „20 września 2026" przez `Intl.DateTimeFormat("pl-PL", { day, month: "long", year, timeZone: "Europe/Warsaw" })`; nieparsowalna wartość wraca dosłownie, jak w `formatDate`.

#### 3. Baner duplikatu

**File**: `src/components/offers/DuplicateNotice.astro`

**Intent**: Tekst banera w jednym komponencie, żeby strona karty i kitchen sink renderowały tę samą produkcyjną treść.

**Contract**: props `{ saver: Saver }`; renderuje `<Banner variant="info">` z czterema tekstami z sekcji Desired End State (wyczerpujący `switch` po `saver.kind`). E-mail zawija się w każdym miejscu (`wrap-anywhere`), żeby długi adres nie rozpychał widoku 375 px. Umieszczany w slocie `notice` przez rodzica.

#### 4. Linia autora w nagłówku karty

**File**: `src/components/offers/OfferCard.astro`

**Intent**: Autor zapisu widoczny na każdej karcie, nie tylko przy duplikacie (decyzja użytkownika).

**Contract**: nowy wymagany prop `saver: Saver`. Pod lokalizacją, przed linkiem do oryginału, `<p class="text-muted-foreground …">`: „Zapisane przez sigaretif2@vetpad.local · 20 września 2026" / „Zapisane przez Ciebie · …" / „Zapisane przez konto usunięte · …" / „Zapisane 20 września 2026" (`unknown`). Data z `formatTimestamp(offer.created_at)`. Tylko tokeny ról; e-mail z `wrap-anywhere`.

#### 5. Strona karty

**File**: `src/pages/offers/[id].astro`

**Intent**: Wyznaczyć autora raz na widok i przekazać go do banera i karty.

**Contract**: po `loadOffer`, gdy oferta istnieje: `resolveSaver(supabase, offer.created_by, Astro.locals.user?.id)`; `duplicate && <DuplicateNotice slot="notice" saver={saver} />` zamiast dzisiejszego `<Banner>`; `<OfferCard offer={offer} saver={saver} />`. Strona dalej nigdy nie zwraca 500 — `resolveSaver` nie rzuca.

#### 6. Kitchen sink i fixtury

**File**: `src/pages/dev/offer-card.astro`, `src/pages/dev/_offer-fixtures.ts`

**Intent**: Każdy nowy stan karty dostaje fixturę (CLAUDE.md `### UI`).

**Contract**: fixtury `Saver` w `_offer-fixtures.ts` (adresy w domenie `example.com`, żaden nie wygląda na prawdziwą osobę; jeden bardzo długi adres do testu zawijania). Dzisiejszy pojedynczy baner info zastąpiony czterema `DuplicateNotice` (member, self, deleted, unknown) w slocie `notice`. Każdy stan karty dostaje `saver`: pełna oferta → `member`, wszystko nieznane → `deleted` (jej `created_by` jest już `null`), jedno zdjęcie → `self`, filtr adresów → `unknown`, długi tytuł → `member` z długim adresem. Podpisy stanów wymieniają wariant autora.

### Success Criteria:

#### Automated Verification:

- `npm run lint`, `npx astro sync`, `npx astro check` i `npm run build` przechodzą
- `rg -n "offers.*source_url|duplicate=1" src/pages/api/offers.ts` pokazuje niezmienioną trasę (`git diff --stat src/pages/api/` pusty)

#### Manual Verification:

- Wklejenie adresu oferty zapisanej przez `sigaretif1` z konta `sigaretif2`, raz z `?utm_source=x`, raz bez `/pl`: karta pokazuje baner „…zapisana przez sigaretif1@vetpad.local…" i nie powstaje drugi wiersz
- To samo z konta `sigaretif1`: baner „…zapisana przez Ciebie…"
- Po usunięciu konta autora (lokalnie, psql): baner i nagłówek pokazują „konto usunięte"
- Wejście na kartę bez `?duplicate=1`: brak banera, nagłówek z linią autora i datą
- `/dev/offer-card` renderuje cztery banery i pięć stanów karty z właściwymi wariantami autora

**Implementation Note**: Po automatycznej weryfikacji zatrzymaj się na potwierdzenie ręcznego sprawdzenia przez człowieka przed fazą 3.

---

## Phase 3: Smoke, dokumentacja, bramka wizualna i wdrożenie migracji

### Overview

Sprawdzenie RLS w smoke, wpisy w dokumentacji, zrzuty bramki na macierzy 7 stanów i `db push` za zgodą użytkownika.

### Macierz 7 stanów

| Stan | Gdzie na `/dev/offer-card` | Uwagi |
| --- | --- | --- |
| default | Baner i nagłówek w wariancie `member` (pełna oferta) | Zrzuty `gate-desktop`, `gate-mobile` |
| hover | nie dotyczy | Nowa linia i baner duplikatu nie mają elementów interaktywnych; hover istniejących linków karty się nie zmienia |
| focus | nie dotyczy | Jak wyżej — nic nowego nie przyjmuje fokusu; istniejące zrzuty `gate-focus-*` powtórzone, żeby wykluczyć regresję |
| disabled | nie dotyczy | Karta nie ma wyłączanych kontrolek |
| error | Wariant `unknown` — baner bez autora, nagłówek z samą datą (stan „filtr adresów") | Błąd odczytu nigdy nie udaje „konto usunięte" |
| empty | Wariant `deleted` — „konto usunięte" (stan „wszystko nieznane") | Brak autora to fakt, nie błąd |
| loading | nie dotyczy | Karta jest renderowana na serwerze razem ze stroną; nic nie jest pobierane po stronie klienta |

Stany dodatkowe na tej samej stronie: wariant `self` („przez Ciebie"), długi adres e-mail zawijany w banerze i nagłówku przy 375 px.

### Changes Required:

#### 1. Smoke

**File**: `scripts/smoke.mjs`

**Intent**: Pilnować, że `members` jest jedyną bramką w obie strony: anon nie widzi nic, członek widzi wiersze — bo odmowa RLS wygląda jak brak danych (HTTP 200, `[]`).

**Contract**: dwa kroki bezpośrednio na Supabase, obok `supabaseSignup`: „anon cannot read members" (`GET /rest/v1/members?select=id` z `apikey`, oczekiwane 200 i pusta tablica) oraz „signed-in member reads members" (token z `/auth/v1/token?grant_type=password` dla `SMOKE_EMAIL`, oczekiwane 200 i co najmniej jeden wiersz). Helper oczekiwań dostaje sprawdzenie długości tablicy w ciele odpowiedzi. Komentarz nagłówkowy pliku wymienia nowe sprawdzenie. Kontrakt `src/pages/api/` się nie zmienia, więc job `smoke` w CI nie potrzebuje innej konfiguracji.

#### 2. CLAUDE.md

**File**: `CLAUDE.md`

**Intent**: S-05 i S-10 mają sięgnąć po istniejący mechanizm zamiast budować drugi.

**Contract**: w `## Structure` punkt: `public.members` (migracja `…_create_members.sql`) i `src/lib/members.ts` są wzorcem nazywania członka — nazwa to e-mail, `null` w kolumnie autora to „konto usunięte", błąd odczytu to wariant nieustalony, nigdy „konto usunięte". W `### Secrets and data access` jedno zdanie: tabela pisana wyłącznie wyzwalaczem nie ma polityk zapisu — to odmowa zamierzona, nie luka.

#### 3. README

**File**: `README.md`

**Intent**: Opis schematu (akapit o `supabase/migrations/`, ok. linii 116) wymienia tylko `public.offers`.

**Contract**: dopisać `public.members` (e-maile członków, wypełniane wyzwalaczem z `auth.users`) oraz że smoke sprawdza jej RLS.

#### 4. Zrzuty bramki

**File**: `context/changes/duplicate-listing-notice/screenshots/`

**Intent**: Przejść bramkę wizualną wybraną przez użytkownika.

**Contract**: `node scripts/ui-screenshots.mjs gate context/changes/duplicate-listing-notice/screenshots` przy działającym `npm run dev` i lokalnym Supabase. Zestaw `gate` nie wymaga zmian — nowe elementy nie przyjmują fokusu. Po triage `/10x-impl-review`, jeśli zmieniła widok, zrzuty powtarzane przed commitem.

#### 5. Migracja na hostowany projekt

**Intent**: Tabela musi istnieć w hostowanym projekcie, zanim Worker z fazy 2 trafi na `master`.

**Contract**: `npx supabase db push --dry-run`, pokazać listę dopasowaną do `supabase/migrations/` (oczekiwana dokładnie jedna: `…_create_members.sql`), zapytać użytkownika i wypchnąć tylko na „tak". Coś nieoczekiwanego na liście → stop bez pytania. Nigdy `db reset --linked`.

### Success Criteria:

#### Automated Verification:

- `npm run smoke` przechodzi przeciw `npm run preview` z lokalnym Supabase, włącznie z dwoma nowymi krokami
- `npm run lint`, `npx astro check` i `npm run build` przechodzą
- `node scripts/ui-screenshots.mjs gate context/changes/duplicate-listing-notice/screenshots` kończy się kodem 0

#### Manual Verification:

- Zrzuty `gate-desktop` i `gate-mobile` pokazują cztery warianty banera i linię autora w każdym stanie karty; długi adres zawija się bez poziomego przewijania przy 375 px
- `npx supabase db push --dry-run` wymienia tylko `…_create_members.sql`, a push nastąpił wyłącznie po zgodzie użytkownika
- Na hostowanym projekcie baner duplikatu nazywa członka, który zapisał ofertę

**Implementation Note**: Po automatycznej weryfikacji zatrzymaj się na potwierdzenie ręcznego sprawdzenia przez człowieka.

---

## Testing Strategy

### Unit Tests:

- Brak runnera testów jednostkowych (CLAUDE.md `## Testing`); cztery gałęzie `resolveSaver` sprawdza kitchen sink (render) i ręczne scenariusze z fazy 2.

### Integration Tests:

- `scripts/smoke.mjs`: anon → `[]` z `members`, członek → wiersze. Istniejące kroki (404 kitchen sinka w buildzie, trasy ofert) bez zmian.

### Manual Testing Steps:

1. `npx supabase db reset`, zaloguj się jako `sigaretif1`, wklej adres oferty otodom.pl — powstaje karta z „Zapisane przez Ciebie · <dzisiaj>".
2. Zaloguj się jako `sigaretif2`, wklej ten sam adres z `?utm_source=x` — baner „…zapisana przez sigaretif1@vetpad.local…".
3. Jako `sigaretif1` wklej ten sam adres bez `/pl` — baner „…zapisana przez Ciebie…".
4. Usuń konto `sigaretif1` (psql lokalnie), odśwież kartę z `?duplicate=1` — „konto usunięte" w banerze i nagłówku.
5. Przejrzyj `/dev/offer-card` na desktopie i przy 375 px.

## Performance Considerations

Jedno dodatkowe zapytanie po kluczu głównym na widok karty (pomijane dla `self` i `deleted`). Pomijalne przy trzech członkach.

## Migration Notes

Migracja jest addytywna — `offers` się nie zmienia. Uzupełnienie `insert … select … on conflict do nothing` jest idempotentne. `db push` przed wdrożeniem Workera; wycofanie kodu nie cofa danych (`context/foundation/deployment-runbook.md`), a pozostawiona tabela nie szkodzi starszemu kodowi.

## References

- PRD: `context/foundation/prd.md` — FR-005, Non-Functional Requirements („konto usunięte")
- Roadmapa: `context/foundation/roadmap.md` — S-07
- Poprzedni slice: `context/archive/2026-09-22-paste-listing-to-card/plan.md` (duplikat i `created_by`)
- Lekcja: `context/foundation/lessons.md` — „Declare `on delete` on every author column that references `auth.users`"
- Wzorzec migracji z RLS: `supabase/migrations/20260922202756_create_offers.sql`
- Wzorzec wyzwalacza `security definer`: `supabase/migrations/20260923153747_offers_keep_after_author_deleted.sql`
- Trasa duplikatu: `src/pages/api/offers.ts:70-96`
- Strona karty: `src/pages/offers/[id].astro:37-45`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Tabela `members`

#### Automated

- [x] 1.1 `npx supabase db reset` przechodzi bez błędów, a `select count(*) from public.members` zwraca 3 (trzy konta z `supabase/seed.sql`) — 7009487
- [x] 1.2 REST jako anon (`GET $SUPABASE_URL/rest/v1/members?select=id` z samym `apikey`) zwraca HTTP 200 i `[]` — 7009487
- [x] 1.3 REST jako `sigaretif1@vetpad.local` (token z `/auth/v1/token?grant_type=password`) zwraca 3 wiersze z e-mailami — 7009487
- [x] 1.4 REST `POST /rest/v1/members` jako zalogowany członek jest odrzucony (`new row violates row-level security policy`), a `PATCH` nie zmienia żadnego wiersza — 7009487
- [x] 1.5 Zmiana `email` w `auth.users` (psql na lokalnej bazie) zmienia `members.email`; usunięcie konta, które zapisało ofertę, usuwa jego wiersz z `members`, ustawia `offers.created_by` na `null` i kończy się powodzeniem — 7009487
- [x] 1.6 `npm run lint`, `npx astro sync`, `npx astro check` i `npm run build` przechodzą — 7009487

#### Manual

- [x] 1.7 W Supabase Studio (lokalnie) tabela `members` ma włączone RLS i dokładnie jedną politykę, a Security Advisor nie zgłasza jej ani funkcji wyzwalacza — 7009487

### Phase 2: Autor na karcie i w banerze

#### Automated

- [x] 2.1 `npm run lint`, `npx astro sync`, `npx astro check` i `npm run build` przechodzą — 1217046
- [x] 2.2 `rg -n "offers.*source_url|duplicate=1" src/pages/api/offers.ts` pokazuje niezmienioną trasę (`git diff --stat src/pages/api/` pusty) — 1217046

#### Manual

- [x] 2.3 Wklejenie adresu oferty zapisanej przez `sigaretif1` z konta `sigaretif2`, raz z `?utm_source=x`, raz bez `/pl`: karta pokazuje baner „…zapisana przez sigaretif1@vetpad.local…" i nie powstaje drugi wiersz — 1217046
- [x] 2.4 To samo z konta `sigaretif1`: baner „…zapisana przez Ciebie…" — 1217046
- [x] 2.5 Po usunięciu konta autora (lokalnie, psql): baner i nagłówek pokazują „konto usunięte" — 1217046
- [x] 2.6 Wejście na kartę bez `?duplicate=1`: brak banera, nagłówek z linią autora i datą — 1217046
- [x] 2.7 `/dev/offer-card` renderuje cztery banery i pięć stanów karty z właściwymi wariantami autora — 1217046

### Phase 3: Smoke, dokumentacja, bramka wizualna i wdrożenie migracji

#### Automated

- [x] 3.1 `npm run smoke` przechodzi przeciw `npm run preview` z lokalnym Supabase, włącznie z dwoma nowymi krokami — 4aed432
- [x] 3.2 `npm run lint`, `npx astro check` i `npm run build` przechodzą — 4aed432
- [x] 3.3 `node scripts/ui-screenshots.mjs gate context/changes/duplicate-listing-notice/screenshots` kończy się kodem 0 — 4aed432

#### Manual

- [x] 3.4 Zrzuty `gate-desktop` i `gate-mobile` pokazują cztery warianty banera i linię autora w każdym stanie karty; długi adres zawija się bez poziomego przewijania przy 375 px — 4aed432
- [x] 3.5 `npx supabase db push --dry-run` wymienia tylko `…_create_members.sql`, a push nastąpił wyłącznie po zgodzie użytkownika — 4aed432
- [ ] 3.6 Na hostowanym projekcie baner duplikatu nazywa członka, który zapisał ofertę
