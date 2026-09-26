# Notatki członków obok ogłoszenia — plan implementacji

## Overview

Realizujemy S-05 (US-01, FR-012, FR-013). Każdy członek zespołu pisze i edytuje na karcie oferty **jedną własną notatkę** w trzech polach — Zalety, Wady, Obserwacje ogólne — i czyta notatki pozostałych członków podpisane nazwą autora. Ograniczeniem w modelu dostępu jest wyłącznie autorstwo: zapis, zmiana i usunięcie tylko własnej notatki, odczyt wszystkich. RLS jest jedyną bramką (CLAUDE.md), więc polityki powstają w migracji tworzącej tabelę i są sprawdzane w smoke z dwóch kont. Karta przechodzi na układ dwukolumnowy: ogłoszenie po lewej, kolumna zespołu (notatki, a od S-04 audyt nad nimi) po prawej. Slice rozstrzyga też pytanie otwarte w PRD: notatki usuniętego członka zostają, podpisane „osoba z usuniętym kontem”.

## Current State Analysis

- Tabeli notatek nie ma. Wzorzec nowej tabeli z RLS: `supabase/migrations/20260922202756_create_offers.sql:84-109` (jedna polityka na operację, `to authenticated`, nic dla `anon`); wzorzec zamrożenia autora z dopuszczeniem `null` po usunięciu konta: `supabase/migrations/20260923153747_offers_keep_after_author_deleted.sql:30-45` (`security definer`, `search_path = ''`).
- Nazwa członka: `public.members` (`supabase/migrations/20260926185936_create_members.sql`) i `src/lib/members.ts`. `resolveSaver` (`:25-41`) czyta jednego autora; zapytanie zbiorcze `.in("id", ids)` istnieje tylko jako zapowiedź w komentarzu (`:21-23`) — `created_by`/autor notatki wskazuje `auth.users`, więc PostgREST nie osadzi nazwy. `saverName` (`:47-62`) daje biernik („przez Ciebie”, „osobę z usuniętym kontem”); nagłówek notatki potrzebuje mianownika.
- Strona karty `src/pages/offers/[id].astro` tworzy jeden klient na widok (`:16`), ładuje ofertę (`:22-31`), autora zapisu (`:43-45`) i nie obsługuje `?error=`. `AppLayout` ma `max-w-4xl` (`src/layouts/AppLayout.astro:17`), `OfferCard` renderuje nagłówek, parametry, opis i galerię jako rodzeństwo w kolumnie `main` (`src/components/offers/OfferCard.astro:37-73`).
- Wzorzec trasy formularza: `src/pages/api/offers.ts:43-101` — `locals.user` albo `/auth/signin`, `createClient` `null` → komunikat, `formData()` w try/catch, porażka to przekierowanie z `?error=`. `PROTECTED_ROUTES` (`src/middleware.ts:4`) nie obejmuje `/api/*` — trasa sama sprawdza użytkownika.
- Formularze: kompozyty `src/components/form/` (`FormField` — tylko `Input`, `SubmitButton`, `ServerError`, `usePendingSubmit`); w `src/components/ui` nie ma `textarea` (są: alert, badge, button, card, input, label).
- Kitchen sinki: `/dev/offer-card` (stany z `src/pages/dev/_offer-fixtures.ts`), `/dev/forms` (sekcje `data-state` × kolumny `data-form`, tylko sekcja `default` ma prawdziwe wyspy, pozostałe renderują kompozyty). Zestawy zrzutów w `scripts/ui-screenshots.mjs:52-112`, `USAGE` wymienia je ręcznie.
- `scripts/smoke.mjs` nigdy nie zapisuje danych; sprawdza RLS `members` z obu stron przez liczbę wierszy (`:79-91`, `:106-107`); loguje się jednym kontem (`SMOKE_EMAIL`, domyślnie `sigaretif1@vetpad.local`). Seed ma trzy konta z tym samym hasłem (`supabase/seed.sql:23-25`). Smoke nigdy nie biegnie przeciw produkcji (README, „Smoke test”); CI stawia świeży lokalny Supabase (`.github/workflows/ci.yml:41`).
- PRD, Non-Functional Requirements: „What happens to a deleted member's notes (FR-013) is not decided here.”

## Desired End State

- Istnieje `public.offer_notes`: jedna notatka na (oferta, autor), trzy pola tekstowe, co najmniej jedno niepuste, każde do 5000 znaków. Każdy zalogowany czyta wszystkie; zapisuje, zmienia i usuwa tylko autor. Usunięcie oferty zabiera jej notatki; usunięcie konta zostawia notatki z autorem `null`, których nikt już nie edytuje.
- `/offers/<id>` na szerokim ekranie (≥ `lg`) ma dwie kolumny: ogłoszenie po lewej, „Notatki zespołu” po prawej; węziej kolumny układają się jedna pod drugą.
- Kolumna notatek:
  - „Twoja notatka”: gdy jej nie ma — otwarty formularz trzech pól z „Zapisz notatkę”; gdy jest — podgląd z datą „edytowano 26 września 2026” i przyciskiem „Edytuj”, który zamienia go w formularz z „Zapisz notatkę” i „Anuluj”.
  - Notatki pozostałych, od ostatnio edytowanej, z nagłówkiem: e-mail członka / „Osoba z usuniętym kontem” / „Notatka członka zespołu” (autor nieustalony — nikogo nie nazywa). Puste pole czyta się „nie wpisano”.
  - Brak notatek innych: „Pozostali członkowie nie napisali jeszcze notatek.”
  - Błąd odczytu: „Nie udało się wczytać notatek.” — bez formularza. Kontener ma `data-notes-state="ok"|"error"`.
- Zapis wszystkich trzech pól pustych jest odrzucany komunikatem „Wpisz coś w co najmniej jednym polu notatki.” (w przeglądarce i na serwerze), także przy istniejącej notatce.
- Po zapisie przeglądarka wraca na `/offers/<id>#notatki` z notatką w trybie podglądu; porażka wraca z `?error=` i otwartym formularzem.
- `/dev/offer-card` i `/dev/forms` pokazują każdy stan notatek; zrzuty zestawów `gate` i `forms` leżą w `context/changes/member-notes/screenshots`.
- Smoke sprawdza odczyt z obu stron, kontrakt `/api/notes` i ograniczenie zapisu do autora z dwóch kont na sztucznej ofercie, którą na końcu usuwa.
- PRD rozstrzyga los notatek usuniętego członka.

Weryfikacja: `npx supabase db reset`, REST z tokenami dwóch kont, zapis notatki z trzech kont seedowych, `npm run smoke`, zrzuty bramki.

### Key Discoveries:

- Upsert na `(offer_id, author_id)` z `author_id = user.id` nigdy nie trafi w cudzą notatkę: autor jest częścią klucza konfliktu, a polityki `insert` i `update` wymagają `author_id = auth.uid()`.
- `on delete set null` Postgres wykonuje jako UPDATE — wyzwalacz zamrażający autora musi przepuścić `null`, gdy konta już nie ma, inaczej usunięcie konta się nie powiedzie (lekcja „Declare `on delete` on every author column…”, `context/foundation/lessons.md`).
- Akcje kluczy obcych (kaskada z `offers`, `set null` z `auth.users`) nie przechodzą przez polityki RLS — kaskadowe usunięcie notatek przy usunięciu oferty działa mimo polityki `delete` ograniczonej do autora; to kaskada, którą PRD zaakceptował (FR-015).
- RLS bez dopasowania przy odczycie to HTTP 200 i `[]`, a zablokowany PATCH/DELETE to 200 i 0 wierszy — smoke rozpoznaje odmowę po liczbie wierszy, jak dla `members`.
- `resolveSaver` nie rzuca; nowy odczyt zbiorczy musi mieć tę samą gwarancję i to samo rozróżnienie `deleted` (fakt z wiersza) od `unknown` (nie udało się ustalić).

## What We're NOT Doing

- Usuwanie własnej notatki w UI — S-11 (FR-015). Polityka `delete` ograniczona do autora powstaje już teraz, bo każda tabela dostaje politykę na każdą operację w migracji tworzącej.
- Czyszczenie notatki do zera — zapis trzech pustych pól jest odrzucany; wyczyszczenie to usunięcie, czyli S-11.
- Audyt (S-04) — kolumna zespołu zostawia mu miejsce nad notatkami, bez atrapy w UI.
- Zachowanie wpisanego tekstu po błędzie serwera — trasa formularza przekierowuje z `?error=` (konwencja CLAUDE.md), więc tekst przepada; pola puste i za długie łapie walidacja w przeglądarce, zostają rzadkie błędy bazy.
- Notatki lub ich liczba na tablicy (`/dashboard`), historia edycji, powiadomienia, edycja w czasie rzeczywistym (Non-Goals PRD).
- Wysyłanie notatek do dostawcy modelu — nigdy (PRD, Non-Functional Requirements); ten slice nie dotyka audytu.
- Obietnica używalności na telefonie — układ się składa, ale nie jest projektowany pod mobile (PRD).

## Implementation Approach

Najpierw schemat i jego RLS, sprawdzone przez REST zanim cokolwiek od niego zależy (faza 1). Potem warstwa danych i trasa, sprawdzone curlem bez UI (faza 2). Potem widok: prymityw `textarea`, kompozyt, wyspa edytora, kolumna notatek, układ dwukolumnowy i stany w kitchen sinkach (faza 3). Na końcu smoke z dwóch kont, dokumentacja, bramka wizualna i `db push` za zgodą (faza 4).

Autor notatki to ten sam typ `Saver` co autor zapisu oferty — jedna unia dyskryminowana, nowe powierzchnie mają przełączniki z kontrolą wyczerpania (`never`), jak `saverName`.

## Critical Implementation Details

- **Błąd odczytu ≠ brak notatki.** Gdy odczyt notatek się nie powiedzie, kolumna nie renderuje formularza: pusty formularz wysłany upsertem nadpisałby istniejącą notatkę członka. Tak samo autor: `unknown` nigdy nie wyświetla się jako usunięte konto.
- **`updated_at` przy `set null`.** Gałąź wyzwalacza, która przepuszcza `author_id = null` po usunięciu konta, nie przestawia `updated_at` — nikt notatki nie edytował, a „edytowano <data>” by skłamało.
- **Unikalne identyfikatory pól.** `/dev/offer-card` i `/dev/forms` renderują wiele edytorów na jednej stronie; identyfikatory pól i komunikatów biorą się z `useId()`, nie ze stałych.
- **Kolejność w smoke.** Sprawdzenie „anon nie czyta notatek” wykonujemy dopiero, gdy notatka istnieje — wcześniej `[]` niczego nie dowodzi.
- **Kolejność wdrożenia.** `npx supabase db push` przed tym, jak Worker z fazy 2/3 trafi na `master`. Bez tabeli karta nie pada — odczyt zwraca błąd i kolumna pokazuje stan błędu — ale notatek nie da się zapisać.

## Phase 1: Tabela `offer_notes`

### Overview

Jedna migracja: tabela, ograniczenia, wyzwalacz, RLS. Decyzja o notatkach usuniętego członka trafia do PRD.

### Changes Required:

#### 1. Migracja

**File**: `supabase/migrations/<timestamp>_create_offer_notes.sql` (przez `npx supabase migration new create_offer_notes`, nigdy ręcznie)

**Intent**: Przechować po jednej notatce na członka i ofertę tak, żeby RLS był jedyną i wystarczającą bramką autorstwa. Komentarz nagłówkowy w stylu `create_offers.sql` wyjaśnia: FR-012/FR-013, autorstwo jako jedyne ograniczenie, dlaczego `set null` (PRD, rozstrzygnięte w tym slice), że notatki nigdy nie trafiają do dostawcy modelu, i powtarza sygnatury odmowy RLS.

**Contract**:
- `public.offer_notes (id uuid primary key default gen_random_uuid(), offer_id uuid not null references public.offers (id) on delete cascade, author_id uuid references auth.users (id) on delete set null, pros text not null default '', cons text not null default '', observations text not null default '', created_at timestamptz not null default now(), updated_at timestamptz not null default now())`.
- `unique (offer_id, author_id)` — jedna notatka na członka i ofertę; indeks służy też odczytowi po `offer_id`. Wiele wierszy z `author_id is null` na jednej ofercie jest dopuszczalne (notatki różnych usuniętych kont).
- `check`: co najmniej jedno pole zawiera znak niebiały (`pros ~ '\S' or cons ~ '\S' or observations ~ '\S'`); każde pole `char_length(...) <= 5000`.
- Wyzwalacz `offer_notes_before_update` (`before update`, `for each row`), funkcja `public.offer_notes_before_update()` `security definer`, `set search_path = ''`, nazwy kwalifikowane: przywraca `offer_id` i `created_at` z `old`; `author_id` może stać się `null` tylko gdy `old.author_id` nie istnieje już w `auth.users` — wtedy **nie** zmienia `updated_at`; w każdym innym przypadku przywraca `old.author_id` i ustawia `updated_at = now()`. `revoke execute … from public, anon, authenticated`.
- RLS: `enable row level security`; polityki `to authenticated`, żadnej dla `anon`:
  - `offer_notes_select_authenticated` — `for select using (auth.uid() is not null)` (FR-013); komentarz mówi, że upsert z `/api/notes` od niej zależy — `ON CONFLICT DO UPDATE` sprawdza politykę `select` na istniejącym i nowym wierszu, więc jej zawężenie zepsułoby zapis notatek błędem `new row violates row-level security policy`,
  - `offer_notes_insert_own` — `for insert with check (author_id = auth.uid())`,
  - `offer_notes_update_own` — `for update using (author_id = auth.uid()) with check (author_id = auth.uid())`,
  - `offer_notes_delete_own` — `for delete using (author_id = auth.uid())` (FR-015, UI w S-11).
- Nota o anonimowych logowaniach jak w `20260923153747_offers_keep_after_author_deleted.sql:47-53`. Bez `grant` (CLAUDE.md).

#### 2. PRD

**File**: `context/foundation/prd.md`

**Intent**: Zamknąć pytanie, które PRD zostawiło otwarte, żeby nie wracało (CLAUDE.md: rozstrzygnięcie trafia do PRD, nie do reguły).

**Contract**: w Non-Functional Requirements zdanie „What happens to a deleted member's notes (FR-013) is not decided here.” zastąpione rozstrzygnięciem: notatki usuniętego członka zostają, podpisane „osoba z usuniętym kontem” (w mianowniku nagłówka: „Osoba z usuniętym kontem”), i nikt ich już nie edytuje; data rozstrzygnięcia (2026-09-26, S-05). Dopisek w bloku „Resolved during implementation” pod Open Questions.

### Success Criteria:

#### Automated Verification:

- `npx supabase db reset` przechodzi bez błędów
- REST jako `sigaretif1` tworzy ofertę testową i notatkę (`POST /rest/v1/offer_notes` z `author_id` = własny uid) — 201; drugi `POST` tej samej pary (oferta, autor) kończy się naruszeniem unikalności
- REST jako anon: `GET /rest/v1/offer_notes?select=id` → 200 i `[]` przy istniejącej notatce
- REST jako `sigaretif2`: `GET` zwraca notatkę `sigaretif1`; `PATCH` i `DELETE` jej po `id` z `Prefer: return=representation` → 200 i `[]`; `POST` z `author_id` = uid `sigaretif1` → odrzucony (`new row violates row-level security policy`)
- REST jako `sigaretif1`: `POST` z trzema polami pustymi / samymi spacjami i `POST` z polem > 5000 znaków → naruszenie `check`; `PATCH` notatki z inną `offer_id` lub `author_id` zostawia oba bez zmian, a `updated_at` rośnie
- psql (lokalnie): usunięcie konta `sigaretif3` (po zapisaniu przez nie notatki) powodzi się, jego notatka zostaje z `author_id = null` i niezmienionym `updated_at`; usunięcie oferty usuwa jej notatki; na koniec `npx supabase db reset` przywraca konto
- `npm run lint`, `npx astro sync`, `npx astro check` i `npm run build` przechodzą

#### Manual Verification:

- W Supabase Studio (lokalnie) `offer_notes` ma włączone RLS i dokładnie cztery polityki, a Security Advisor nie zgłasza tabeli ani funkcji wyzwalacza
- Zmieniony akapit PRD czyta się jako rozstrzygnięcie, bez sprzeczności z Access Control i FR-015

**Implementation Note**: Faza kończy się przed napisaniem kodu TypeScript. Jeśli którykolwiek warunek RLS nie jest spełniony, poprawiamy migrację, nie kod aplikacji. Po automatycznej weryfikacji zatrzymaj się na potwierdzenie ręczne przed fazą 2.

---

## Phase 2: Odczyt i zapis notatek

### Overview

Zbiorcze nazywanie autorów, moduł odczytu notatek i trasa `POST /api/notes` — sprawdzone curlem, zanim powstanie UI.

### Changes Required:

#### 1. Nazywanie wielu autorów

**File**: `src/lib/members.ts`

**Intent**: Nazwać autorów wszystkich notatek jednym zapytaniem, z tymi samymi czterema wariantami co autor zapisu oferty, i dać nagłówkowi notatki mianownik.

**Contract**:
- `export async function resolveAuthors(supabase: SupabaseClient | null, authorIds: readonly (string | null)[], viewerId: string | undefined): Promise<Saver[]>` — wynik w kolejności wejścia. `null` → `deleted`; `viewerId` → `self`; pozostałe unikalne id z jednego `.from("members").select("id, email").in("id", ids)`; brak wiersza, pusty e-mail, błąd, wyjątek lub brak klienta → `unknown`. Nigdy nie rzuca; przy braku id do odczytu nie wysyła zapytania.
- `export function authorName(saver: Saver): string | null` — mianownik: `member` → e-mail, `self` → „Ty”, `deleted` → „Osoba z usuniętym kontem”, `unknown` → `null`; wyczerpujący `switch` z `never`.
- Komentarz nagłówkowy i komentarz przy `resolveSaver` (`:21-23`) mówią już o istniejącym `resolveAuthors` zamiast zapowiedzi. Zachowanie `resolveSaver` bez zmian.

#### 2. Moduł notatek

**File**: `src/lib/notes.ts` (nowy)

**Intent**: Jedno miejsce, które czyta notatki oferty i dzieli je na własną i pozostałe; w tym samym module stałe limitu i walidacja, której używa trasa i wyspa.

**Contract**:
- `export const NOTE_FIELDS = ["pros", "cons", "observations"] as const`, `export const NOTE_MAX_LENGTH = 5000`, etykiety pól („Zalety”, „Wady”, „Obserwacje ogólne”).
- `export type NoteView = { id: string; author: Saver; pros: string; cons: string; observations: string; updatedAt: string }`.
- `export type OfferNotes = { state: "ok"; own: NoteView | null; others: NoteView[] } | { state: "error" }`.
- `export async function loadNotes(supabase, offerId: string, viewerId: string | undefined): Promise<OfferNotes>` — `select id, author_id, pros, cons, observations, updated_at … eq("offer_id", offerId) order by updated_at desc`; autorzy przez `resolveAuthors`; `own` = notatka z `author_id === viewerId`; brak klienta, błąd lub wyjątek → `{ state: "error" }`. Nigdy nie rzuca.
- `export function noteError(fields: Record<NoteField, string>): string | null` — „Wpisz coś w co najmniej jednym polu notatki.” gdy każde pole po `trim()` jest puste; „Każde pole notatki może mieć najwyżej 5000 znaków.” gdy któreś jest dłuższe; inaczej `null`. Wyspa importuje ten moduł, więc cokolwiek z `@/lib/supabase` wchodzi tu wyłącznie przez `import type` — import wartości wciągnąłby `astro:env/server` do paczki przeglądarki (tak samo robi `src/lib/members.ts:11`).

#### 3. Trasa zapisu

**File**: `src/pages/api/notes.ts` (nowy)

**Intent**: Zapisać lub zmienić własną notatkę członka z formularza — autor zawsze z sesji, nigdy z formularza.

**Contract**: `POST`, `FormData` z `offer_id`, `pros`, `cons`, `observations`. Kolejność jak w `src/pages/api/offers.ts`:
- brak `locals.user` → 302 `/auth/signin`;
- `createClient` `null` → `/dashboard?error=` „Supabase nie jest skonfigurowany — nie można zapisać notatki.”;
- ciało, które nie jest formularzem → `/dashboard?error=` „Nie udało się odczytać formularza notatki.”;
- `offer_id` nie-uuid → `/dashboard?error=` „Nie znaleziono oferty, do której należy notatka.”;
- każde pole: `\r\n` → `\n` przed walidacją i zapisem — formularz wysyła nowe linie jako CRLF, a `maxlength` pola liczy je jako jeden znak, więc bez tej zamiany notatka na granicy limitu byłaby odrzucona i przepadła;
- `noteError(...)` niepuste → `/offers/<offer_id>?error=<komunikat>#notatki`;
- `upsert({ offer_id, author_id: user.id, pros, cons, observations }, { onConflict: "offer_id,author_id" })`, tekst zapisany tak, jak go wpisano (po zamianie końców linii, bez przycinania); błąd `23503` (oferty nie ma) → `/dashboard?error=` jak przy nie-uuid; inny błąd lub wyjątek → `/offers/<offer_id>?error=` „Nie udało się zapisać notatki. Spróbuj ponownie.”;
- sukces → 302 `/offers/<offer_id>#notatki`.
Każda porażka to przekierowanie, nigdy 500 i nigdy JSON. Komunikaty jako stałe, jak w `offers.ts`.

### Success Criteria:

#### Automated Verification:

- `npm run lint`, `npx astro sync`, `npx astro check` i `npm run build` przechodzą
- curl (z ciasteczkiem sesji `sigaretif1`, `npm run dev`, lokalny Supabase): zapis notatki → 302 `/offers/<id>#notatki` i jeden wiersz w `offer_notes`; drugi zapis zmienia ten sam wiersz (nadal jeden, `updated_at` wyższy)
- curl: bez sesji → 302 `/auth/signin`; ciało JSON, `offer_id=not-a-uuid` i nieistniejący uuid → 302 `/dashboard?error=…`; trzy pola puste → 302 `/offers/<id>?error=…#notatki`; `author_id` dopisany do formularza jest ignorowany (wiersz ma autora z sesji); pole z 5000 znakami, w tym nowymi liniami wysłanymi jako `%0D%0A`, zapisuje się, a w bazie ma `\n`

#### Manual Verification:

- Przy Supabase niekonfigurowanym (bez `.env`) `POST /api/notes` przekierowuje z komunikatem, nie zwraca 500

**Implementation Note**: Po automatycznej weryfikacji zatrzymaj się na potwierdzenie ręczne przed fazą 3. Karta nie pokazuje jeszcze notatek — to faza 3.

---

## Phase 3: Notatki na karcie

### Overview

Prymityw `textarea`, kompozyt pola, wyspa edytora własnej notatki, kolumna notatek, układ dwukolumnowy, podpięcie strony i stany w obu kitchen sinkach.

### Changes Required:

#### 1. Prymityw `textarea`

**File**: `src/components/ui/textarea.tsx`

**Intent**: Brakujący prymityw dla pól wielowierszowych.

**Contract**: `npx shadcn add textarea` i w tej samej zmianie rytuał z CLAUDE.md `### UI`: `cn` z `@/lib/utils`, bez `"use client"`, usunięte pakiety `cn`/`radix-ui` z `package.json`, jeśli CLI je dodało. Tylko tokeny ról.

#### 2. Kompozyt pola wielowierszowego

**File**: `src/components/form/TextareaField.tsx` (named export)

**Intent**: Pole notatki z etykietą, licznikiem limitu i błędem, dostępne tak jak `FormField` — zamiast budować je w wyspie od zera (lekcja „Formularz z kompozytów…”).

**Contract**: props `{ id, name, label, value, onChange, maxLength, rows?, invalid?, describedBy? }`; `Label` + `Textarea` z `name`, `maxLength`, `aria-invalid` i `aria-describedby` jak w `FormField` (`src/components/form/FormField.tsx:43-54`); pod polem licznik „<n> / 5000” w `text-muted-foreground`.

#### 3. Nagłówek i treść notatki

**File**: `src/components/offers/NoteCard.tsx` (named export)

**Intent**: Jeden render notatki w trybie podglądu, używany statycznie dla notatek pozostałych i w wyspie dla własnej — React, bo wyspa musi renderować to samo co strona (jedyny powód odejścia od `.astro`).

**Contract**: props `{ author: Saver; note: { pros; cons; observations; updatedAt }; action?: ReactNode }`; `Card` z nagłówkiem `authorName(author) ?? "Notatka członka zespołu"` (e-mail z `wrap-anywhere`), „edytowano <formatTimestamp(updatedAt)>”, trzy sekcje z etykietami z `src/lib/notes.ts`; puste pole → „nie wpisano” w `text-muted-foreground`; tekst z zachowaniem nowych linii (`whitespace-pre-wrap`, `wrap-anywhere`). `action` w nagłówku (przycisk „Edytuj”).

#### 4. Wyspa edytora własnej notatki

**File**: `src/components/offers/NoteEditor.tsx` (default export)

**Intent**: Podgląd własnej notatki z „Edytuj” albo formularz trzech pól — stan wymaga wyspy.

**Contract**: props `{ offerId: string; note: { pros; cons; observations; updatedAt } | null; serverError?: string | null; startEditing?: boolean }`.
- Tryb: edycja gdy `note === null`, `startEditing` albo `serverError`; inaczej podgląd przez `NoteCard` z `author={{ kind: "self" }}` i przyciskiem „Edytuj” (`Button variant="outline"`).
- Formularz: natywny `<form method="POST" action="/api/notes" noValidate>`, ukryte `offer_id`, trzy `TextareaField` (`name` = `pros`/`cons`/`observations`, `maxLength` = `NOTE_MAX_LENGTH`) wypełnione zapisaną treścią, `ServerError`, `SubmitButton` „Zapisz notatkę” / „Zapisuję…” (`usePendingSubmit`), „Anuluj” (`Button variant="ghost"`, tylko gdy notatka istnieje) przywraca zapisane wartości i tryb podglądu.
- `onSubmit`: `noteError(...)` niepuste → `preventDefault`, komunikat pod polami, wszystkie trzy pola `invalid` i `describedBy` na nim; zmiana pola czyści błąd; inaczej `markPending()`.
- Fokus: „Edytuj” przenosi go na pole „Zalety”, „Anuluj” z powrotem na „Edytuj” — przełączenie podmienia DOM, więc bez tego fokus spada na `body`.
- Identyfikatory z `useId()` (patrz Critical Implementation Details). Nagłówek formularza „Twoja notatka”.

#### 5. Kolumna notatek

**File**: `src/components/offers/OfferNotes.astro`

**Intent**: Sekcja „Notatki zespołu” w każdym stanie odczytu, jedna dla strony i kitchen sinka.

**Contract**: props `{ offerId: string; notes: OfferNotes; serverError?: string | null; startEditing?: boolean; anchorId?: string }`. `<section id={anchorId} aria-labelledby=… data-notes-state={notes.state}>` — `anchorId` domyślnie `notatki` (cel przekierowania `#notatki` z trasy), id nagłówka wyprowadzone z niego; kitchen sink podaje unikalne wartości, żeby kilka sekcji na jednej stronie nie dublowało identyfikatorów. z nagłówkiem „Notatki zespołu”. `ok`: `<NoteEditor client:load …>` z `notes.own`, potem notatki `others` jako `NoteCard` bez dyrektywy klienta albo „Pozostali członkowie nie napisali jeszcze notatek.”. `error`: „Nie udało się wczytać notatek.” w `Banner`/`Alert` z tokenem błędu, **bez edytora**. Komentarz: tu S-04 wstawi audyt, nad notatkami.

#### 6. Układ dwukolumnowy

**File**: `src/components/offers/OfferView.astro` (nowy), `src/layouts/AppLayout.astro`

**Intent**: Ogłoszenie i kolumna zespołu obok siebie na desktopie (decyzja użytkownika), w jednym komponencie dla strony i kitchen sinka.

**Contract**:
- `AppLayout`: prop `wide?: boolean` → kontener `max-w-6xl` zamiast `max-w-4xl`; domyślnie bez zmian dla pozostałych stron.
- `OfferView`: props `{ offer: OfferRow; saver: Saver; notes: OfferNotes; noteError?: string | null; startEditing?: boolean; notesAnchorId?: string }` (przekazywany do `OfferNotes` jako `anchorId`); siatka `grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] lg:items-start`; lewa kolumna `flex min-w-0 flex-col gap-6` z `OfferCard`, prawa `OfferNotes`. Poniżej `lg` kolumny jedna pod drugą (ogłoszenie, potem notatki).

#### 7. Strona karty

**File**: `src/pages/offers/[id].astro`

**Intent**: Wczytać notatki raz na widok i pokazać błąd zapisu w edytorze.

**Contract**: gdy oferta istnieje — `loadNotes(supabase, offer.id, Astro.locals.user?.id)`; `?error=` przekazany jako `noteError` (Astro escapuje tekst); `<AppLayout wide>`; `<OfferView … />` zamiast `<OfferCard>`. Oferta `null` → 404 bez zmian (bez odczytu notatek). Strona nigdy nie zwraca 500.

#### 8. Kitchen sink karty i fixtury

**File**: `src/pages/dev/offer-card.astro`, `src/pages/dev/_offer-fixtures.ts`

**Intent**: Każdy nowy stan karty dostaje fixturę (CLAUDE.md `### UI`).

**Contract**: fixtury `NoteView`/`OfferNotes` w `_offer-fixtures.ts` (treść o mieszkaniu, bez osób, telefonów i nazw firm; autorzy z istniejących fixtur `Saver`). Kitchen sink na `<AppLayout wide>`, każdy stan przez `OfferView` z unikalnym `notesAnchorId` (`notatki-1`…):
- pełna oferta → własna notatka w podglądzie + notatki `member` i `deleted`;
- wszystko nieznane → brak notatek (pusty formularz, „Pozostali członkowie…”);
- jedno zdjęcie → brak własnej, notatki `unknown` i `longEmailSaver`, jedna z pustym polem („nie wpisano”);
- filtr adresów → `{ state: "error" }`;
- długi tytuł → własna notatka w edycji z `serverError` + notatka z długim słowem bez spacji i wieloma akapitami.
Podpisy stanów wymieniają wariant notatek.

#### 9. Kitchen sink formularzy

**File**: `src/pages/dev/forms.astro`

**Intent**: Nowy formularz dostaje kolumnę w każdej sekcji stanu (CLAUDE.md `### UI`).

**Contract**: kolumna `data-form="note"` w każdej sekcji `data-state`: `default` — prawdziwa wyspa `NoteEditor client:load` bez notatki; `hover`/`focus` — jak dla pozostałych formularzy (zrzuty wymuszają stan); `disabled` i `loading` — `SubmitButton pending` „Zapisuję…”; `error` — `TextareaField` z `invalid` i komunikatem „Wpisz coś…” + `ServerError` „Nie udało się zapisać notatki…”; `empty` — trzy puste `TextareaField`. Identyfikatory pól unikalne w obrębie strony.

### Success Criteria:

#### Automated Verification:

- `npm run lint` (w tym `tokensOnlyConfig`), `npx astro sync`, `npx astro check` i `npm run build` przechodzą
- `package.json` nie zawiera `radix-ui` ani `cn`; `src/components/ui/textarea.tsx` nie zawiera `"use client"`
- `rg -n "use client|use server" src/` nic nie znajduje

#### Manual Verification:

- Jako `sigaretif1`: pusta karta pokazuje otwarty formularz; zapis → powrót na `#notatki`, podgląd z „edytowano <dzisiaj>”; „Edytuj” → formularz z treścią i fokusem na „Zalety”; „Anuluj” przywraca podgląd bez zapisu i fokus na „Edytuj”
- Zapis trzech pustych pól blokuje przeglądarka z komunikatem; to samo wysłane z wyłączonym JS wraca z `?error=` i otwartym formularzem
- Jako `sigaretif2` na tej samej karcie: notatka `sigaretif1` podpisana e-mailem, bez „Edytuj”; własny pusty formularz
- Po usunięciu konta `sigaretif3` (psql lokalnie, po zapisaniu przez nie notatki): jego notatka podpisana „Osoba z usuniętym kontem”; potem `npx supabase db reset`
- Przy 1440 px dwie kolumny, przy 375 px jedna pod drugą bez poziomego przewijania
- `/dev/offer-card` i `/dev/forms` renderują wszystkie nowe stany

**Implementation Note**: Po automatycznej weryfikacji zatrzymaj się na potwierdzenie ręczne przed fazą 4.

---

## Phase 4: Smoke, dokumentacja, bramka wizualna i wdrożenie migracji

### Overview

Smoke z dwóch kont, wpisy w dokumentacji, zrzuty bramki na macierzy 7 stanów, `db push` za zgodą użytkownika.

### Macierz 7 stanów

| Stan | Gdzie | Uwagi |
| --- | --- | --- |
| default | `/dev/offer-card` „pełna oferta” (własna w podglądzie + notatki innych); `/dev/forms` `data-form="note"` sekcja `default` | Zrzuty `gate-desktop` (dwie kolumny), `forms-desktop` |
| hover | Przycisk „Edytuj” w kolumnie notatek, „Zapisz notatkę” w `/dev/forms` | Wymuszony `:hover` przez CDP (`gate-hover-note-edit`, `forms-hover-note-submit`) |
| focus | Przycisk „Edytuj”, pole „Zalety” w `/dev/forms` | Prawdziwe naciśnięcia Tab (`gate-focus-note-edit`, `forms-focus-note-field`); istniejące zrzuty `gate-focus-*` powtórzone, żeby wykluczyć regresję układu |
| disabled | `/dev/forms` `data-form="note"` sekcja `disabled` | Przycisk zablokowany tylko w trakcie wysyłki — ten sam render co loading |
| error | Błąd walidacji i `ServerError` w `/dev/forms`; własna notatka z `serverError` („długi tytuł”); błąd odczytu notatek („filtr adresów”) | Błąd odczytu nie pokazuje formularza |
| empty | „wszystko nieznane” — brak jakichkolwiek notatek; puste pole w cudzej notatce („jedno zdjęcie”) | „nie wpisano” nie udaje treści |
| loading | `/dev/forms` `data-form="note"` sekcja `loading` („Zapisuję…”) | Odczyt notatek jest po stronie serwera razem ze stroną — poza wysyłką formularza nic nie ładuje się po stronie klienta |

Stany dodatkowe: warianty autora (`member`, długi e-mail, `deleted`, `unknown`), długie słowo bez spacji i wiele akapitów, układ przy 375 px.

### Changes Required:

#### 1. Smoke

**File**: `scripts/smoke.mjs`

**Intent**: Pilnować, że RLS notatek jest jedyną bramką w obie strony i że zapis jest ograniczony do autora — przepuszczalna polityka to żywa ekspozycja (CLAUDE.md), a odmowa wygląda jak brak danych.

**Contract**:
- Drugie konto: `SMOKE_EMAIL_2`/`SMOKE_PASSWORD_2`, domyślnie `sigaretif2@vetpad.local` / hasło z seeda. Helper sesji Supabase (token z `/auth/v1/token?grant_type=password`) dla obu kont, z pamięcią tokenu; helper REST zwracający status, liczbę wierszy i `errorCode` — z pola `code` ciała odpowiedzi PostgREST (nie `error_code`, które jest kształtem Auth API i które czyta `supabaseSignup`). Obecne `supabaseMembers` korzysta z tego samego helpera.
- Kroki, w tej kolejności:
  1. przed logowaniem: „note save redirects anonymous user” — `POST /api/notes` → 302 `/auth/signin`;
  2. po „signin accepts correct password” (konto 1): „smoke fixture offer is created” — REST `POST /rest/v1/offers` jako konto 1 (`created_by` = własny uid, losowe `otodom_id`, `source_url` `https://example.com/smoke/<uuid>`, `title`, `description`, `raw` `{}`), 201, id zapamiętane;
  3. `POST /api/notes`: ciało JSON, `offer_id=not-a-uuid`, nieistniejący uuid → `/dashboard?error=`; trzy pola puste → prefiks `/offers/<fixture>?error=`; poprawna notatka ze znacznikiem tekstu → 302 `/offers/<fixture>#notatki`; drugi zapis → ten sam adres;
  4. „offer card shows the saved note” — `GET /offers/<fixture>` → 200, ciało zawiera znacznik tekstu i `data-notes-state="ok"`;
  5. REST: „member keeps one note per offer” (konto 1, `offer_id=eq.<fixture>`) → 1 wiersz; „anon cannot read notes” → 200, 0 wierszy; „another member reads the note” (konto 2) → 1 wiersz; „another member cannot edit the note” (`PATCH` z `Prefer: return=representation`) → 200, 0 wierszy; „another member cannot delete the note” → 200, 0 wierszy; „another member cannot write a note as its author” (`POST` z `author_id` konta 1) → 403 i `errorCode` `42501`; „note is unchanged after the other member's attempts” (konto 1) → treść ze znacznikiem;
  6. „fixture offer is deleted with its notes” — konto 1 `DELETE` oferty → 1 wiersz; „notes are gone with the offer” → 0 wierszy.
- Komentarz nagłówkowy wymienia nowe sprawdzenia i to, że smoke tworzy i usuwa jedną sztuczną ofertę (dlatego nigdy przeciw produkcji). Job `smoke` w CI nie potrzebuje innej konfiguracji: seed ma oba konta.

#### 2. Zrzuty — zestawy

**File**: `scripts/ui-screenshots.mjs`

**Intent**: Stany hover/focus notatek na zrzutach bez ręcznego sprawdzania.

**Contract**: `FOCUS.noteEdit` (pierwszy przycisk „Edytuj” w sekcji `[data-notes-state]` — stan „pełna oferta”), `FOCUS.noteField` (`[data-state=default] [data-form=note] textarea`); zestaw `gate` + `gate-focus-note-edit`, `gate-hover-note-edit`; zestaw `forms` + `forms-focus-note-field`, `forms-hover-note-submit`; `USAGE` zaktualizowany.

#### 3. CLAUDE.md

**File**: `CLAUDE.md`

**Intent**: Następne slice'y (S-09, S-11) mają sięgnąć po istniejący wzorzec tabeli z autorem i po `resolveAuthors`.

**Contract**: w `## Structure` punkt: `supabase/migrations/<timestamp>_create_offer_notes.sql` jest wzorcem tabeli ograniczonej autorstwem (polityki `insert`/`update`/`delete` po `author_id = auth.uid()`, wyzwalacz zamrażający z `set null` po usunięciu konta), `src/lib/notes.ts` — odczytu notatek, `resolveAuthors` w `src/lib/members.ts` — nazywania wielu autorów jednym zapytaniem; `src/components/offers/OfferView.astro` to miejsce, gdzie S-04 wstawi audyt nad notatkami. W `### UI` punkt o `/dev/forms` wymienia też `NoteEditor`. W `## Testing` zdanie, że smoke tworzy i usuwa jedną sztuczną ofertę na koncie 1 i używa konta 2 z seeda.

#### 4. README

**File**: `README.md`

**Intent**: Opis schematu (`:116`) i smoke (`:181`, `:190`) nie znają notatek ani drugiego konta.

**Contract**: dopisać `public.offer_notes` (notatki członków, RLS ograniczony autorstwem) oraz nowe kroki smoke i zmienne `SMOKE_EMAIL_2`/`SMOKE_PASSWORD_2`.

#### 5. Zrzuty bramki

**File**: `context/changes/member-notes/screenshots/`

**Intent**: Przejść bramkę wizualną wybraną przez użytkownika.

**Contract**: `node scripts/ui-screenshots.mjs gate context/changes/member-notes/screenshots` i `node scripts/ui-screenshots.mjs forms context/changes/member-notes/screenshots` przy działającym `npm run dev` i lokalnym Supabase. Po triage `/10x-impl-review`, jeśli zmieniła widok, zrzuty powtarzane przed commitem.

#### 6. Migracja na hostowany projekt

**Intent**: Tabela musi istnieć w hostowanym projekcie, zanim Worker z notatkami trafi na `master`.

**Contract**: `npx supabase db push --dry-run`, pokazać listę dopasowaną do `supabase/migrations/` (oczekiwana dokładnie jedna: `…_create_offer_notes.sql`), zapytać użytkownika i wypchnąć tylko na „tak”. Coś nieoczekiwanego na liście → stop bez pytania. Nigdy `db reset --linked`.

### Success Criteria:

#### Automated Verification:

- `npm run smoke` przechodzi przeciw `npm run preview` z lokalnym Supabase, włącznie z nowymi krokami, a po przebiegu w `offers` i `offer_notes` nie zostaje nic z oferty smoke
- `npm run lint`, `npx astro check` i `npm run build` przechodzą
- `node scripts/ui-screenshots.mjs gate …` i `node scripts/ui-screenshots.mjs forms …` do `context/changes/member-notes/screenshots` kończą się kodem 0

#### Manual Verification:

- Zrzuty pokazują każdy wiersz macierzy 7 stanów; `gate-desktop` ma dwie kolumny, `gate-mobile` jedną bez poziomego przewijania; długi e-mail i długie słowo się zawijają
- `npx supabase db push --dry-run` wymienia tylko `…_create_offer_notes.sql`, a push nastąpił wyłącznie po zgodzie użytkownika
- Na hostowanym projekcie dwa konta widzą nawzajem swoje notatki, a każde edytuje tylko własną

**Implementation Note**: Po automatycznej weryfikacji zatrzymaj się na potwierdzenie ręczne, potem `/10x-impl-review`. Wybór `/git-ship` albo `/git-land` należy do użytkownika.

---

## Testing Strategy

### Unit Tests:

- Brak runnera testów jednostkowych (CLAUDE.md `## Testing`). Gałęzie `resolveAuthors`, `authorName` i `noteError` sprawdzają kitchen sinki (render) i scenariusze ręczne z fazy 3.

### Integration Tests:

- `scripts/smoke.mjs`: kontrakt `/api/notes` (anon, ciało JSON, zły/nieistniejący `offer_id`, puste pola, zapis i ponowny zapis), karta pokazuje notatkę, jedna notatka na członka i ofertę, RLS z obu stron i z dwóch kont, kaskada przy usunięciu oferty.

### Manual Testing Steps:

1. `npx supabase db reset`, zaloguj się jako `sigaretif1`, zapisz ofertę z otodom.pl, napisz notatkę z samymi Zaletami — podgląd, „Wady: nie wpisano”.
2. „Edytuj”, dopisz Wady, „Anuluj” — nic się nie zmienia; „Edytuj”, dopisz, „Zapisz notatkę” — nowa treść i data.
3. Jako `sigaretif2` otwórz tę kartę — notatka `sigaretif1` z e-mailem, bez „Edytuj”; napisz własną.
4. Jako `sigaretif3` — obie notatki innych, od ostatnio edytowanej; napisz własną.
5. Usuń konto `sigaretif3` (psql lokalnie) — jego notatka jako „Osoba z usuniętym kontem”; potem `npx supabase db reset`, bo `sigaretif1`–`sigaretif3` są potrzebne smoke i zrzutom.
6. Przejrzyj `/dev/offer-card` i `/dev/forms` na desktopie i przy 375 px.

## Performance Considerations

Dwa dodatkowe zapytania na widok karty: notatki oferty (po indeksie unikalnym `(offer_id, author_id)`) i jedno `.in` do `members` (pomijane, gdy wszyscy autorzy to oglądający lub usunięte konta). Pomijalne przy trzech członkach.

## Migration Notes

Migracja jest addytywna — `offers` i `members` się nie zmieniają. `db push` przed wdrożeniem Workera; wycofanie kodu nie cofa danych (`context/foundation/deployment-runbook.md`), a pozostawiona tabela nie szkodzi starszemu kodowi.

## References

- PRD: `context/foundation/prd.md` — US-01, FR-012, FR-013, FR-015, Access Control, Non-Functional Requirements
- Roadmapa: `context/foundation/roadmap.md` — S-05
- Poprzedni slice: `context/archive/2026-09-26-duplicate-listing-notice/plan.md` (`members`, warianty autora)
- Lekcje: `context/foundation/lessons.md` — „Declare `on delete` on every author column…”, „Kolory widoku tylko z tokenów ról…”, „Formularz z kompozytów `src/components/form/`…”
- Wzorzec migracji z RLS: `supabase/migrations/20260922202756_create_offers.sql:84-135`
- Wzorzec wyzwalacza z `set null`: `supabase/migrations/20260923153747_offers_keep_after_author_deleted.sql:30-45`
- Nazwa członka: `src/lib/members.ts:21-62`
- Trasa formularza: `src/pages/api/offers.ts:43-101`
- Strona karty: `src/pages/offers/[id].astro`
- Smoke, RLS z obu stron: `scripts/smoke.mjs:79-107`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Tabela `offer_notes`

#### Automated

- [x] 1.1 `npx supabase db reset` przechodzi bez błędów — 27247a0
- [x] 1.2 REST jako `sigaretif1` tworzy ofertę testową i notatkę (`POST /rest/v1/offer_notes` z `author_id` = własny uid) — 201; drugi `POST` tej samej pary (oferta, autor) kończy się naruszeniem unikalności — 27247a0
- [x] 1.3 REST jako anon: `GET /rest/v1/offer_notes?select=id` → 200 i `[]` przy istniejącej notatce — 27247a0
- [x] 1.4 REST jako `sigaretif2`: `GET` zwraca notatkę `sigaretif1`; `PATCH` i `DELETE` jej po `id` z `Prefer: return=representation` → 200 i `[]`; `POST` z `author_id` = uid `sigaretif1` → odrzucony (`new row violates row-level security policy`) — 27247a0
- [x] 1.5 REST jako `sigaretif1`: `POST` z trzema polami pustymi / samymi spacjami i `POST` z polem > 5000 znaków → naruszenie `check`; `PATCH` notatki z inną `offer_id` lub `author_id` zostawia oba bez zmian, a `updated_at` rośnie — 27247a0
- [x] 1.6 psql (lokalnie): usunięcie konta `sigaretif3` (po zapisaniu przez nie notatki) powodzi się, jego notatka zostaje z `author_id = null` i niezmienionym `updated_at`; usunięcie oferty usuwa jej notatki; na koniec `npx supabase db reset` przywraca konto — 27247a0
- [x] 1.7 `npm run lint`, `npx astro sync`, `npx astro check` i `npm run build` przechodzą — 27247a0

#### Manual

- [x] 1.8 W Supabase Studio (lokalnie) `offer_notes` ma włączone RLS i dokładnie cztery polityki, a Security Advisor nie zgłasza tabeli ani funkcji wyzwalacza — 27247a0
- [x] 1.9 Zmieniony akapit PRD czyta się jako rozstrzygnięcie, bez sprzeczności z Access Control i FR-015 — 27247a0

### Phase 2: Odczyt i zapis notatek

#### Automated

- [x] 2.1 `npm run lint`, `npx astro sync`, `npx astro check` i `npm run build` przechodzą
- [x] 2.2 curl (z ciasteczkiem sesji `sigaretif1`, `npm run dev`, lokalny Supabase): zapis notatki → 302 `/offers/<id>#notatki` i jeden wiersz w `offer_notes`; drugi zapis zmienia ten sam wiersz (nadal jeden, `updated_at` wyższy)
- [x] 2.3 curl: bez sesji → 302 `/auth/signin`; ciało JSON, `offer_id=not-a-uuid` i nieistniejący uuid → 302 `/dashboard?error=…`; trzy pola puste → 302 `/offers/<id>?error=…#notatki`; `author_id` dopisany do formularza jest ignorowany (wiersz ma autora z sesji); pole z 5000 znakami, w tym nowymi liniami wysłanymi jako `%0D%0A`, zapisuje się, a w bazie ma `\n`

#### Manual

- [x] 2.4 Przy Supabase niekonfigurowanym (bez `.env`) `POST /api/notes` przekierowuje z komunikatem, nie zwraca 500

### Phase 3: Notatki na karcie

#### Automated

- [ ] 3.1 `npm run lint` (w tym `tokensOnlyConfig`), `npx astro sync`, `npx astro check` i `npm run build` przechodzą
- [ ] 3.2 `package.json` nie zawiera `radix-ui` ani `cn`; `src/components/ui/textarea.tsx` nie zawiera `"use client"`
- [ ] 3.3 `rg -n "use client|use server" src/` nic nie znajduje

#### Manual

- [ ] 3.4 Jako `sigaretif1`: pusta karta pokazuje otwarty formularz; zapis → powrót na `#notatki`, podgląd z „edytowano <dzisiaj>”; „Edytuj” → formularz z treścią i fokusem na „Zalety”; „Anuluj” przywraca podgląd bez zapisu i fokus na „Edytuj”
- [ ] 3.5 Zapis trzech pustych pól blokuje przeglądarka z komunikatem; to samo wysłane z wyłączonym JS wraca z `?error=` i otwartym formularzem
- [ ] 3.6 Jako `sigaretif2` na tej samej karcie: notatka `sigaretif1` podpisana e-mailem, bez „Edytuj”; własny pusty formularz
- [ ] 3.7 Po usunięciu konta `sigaretif3` (psql lokalnie, po zapisaniu przez nie notatki): jego notatka podpisana „Osoba z usuniętym kontem”; potem `npx supabase db reset`
- [ ] 3.8 Przy 1440 px dwie kolumny, przy 375 px jedna pod drugą bez poziomego przewijania
- [ ] 3.9 `/dev/offer-card` i `/dev/forms` renderują wszystkie nowe stany

### Phase 4: Smoke, dokumentacja, bramka wizualna i wdrożenie migracji

#### Automated

- [ ] 4.1 `npm run smoke` przechodzi przeciw `npm run preview` z lokalnym Supabase, włącznie z nowymi krokami, a po przebiegu w `offers` i `offer_notes` nie zostaje nic z oferty smoke
- [ ] 4.2 `npm run lint`, `npx astro check` i `npm run build` przechodzą
- [ ] 4.3 `node scripts/ui-screenshots.mjs gate …` i `node scripts/ui-screenshots.mjs forms …` do `context/changes/member-notes/screenshots` kończą się kodem 0

#### Manual

- [ ] 4.4 Zrzuty pokazują każdy wiersz macierzy 7 stanów; `gate-desktop` ma dwie kolumny, `gate-mobile` jedną bez poziomego przewijania; długi e-mail i długie słowo się zawijają
- [ ] 4.5 `npx supabase db push --dry-run` wymienia tylko `…_create_offer_notes.sql`, a push nastąpił wyłącznie po zgodzie użytkownika
- [ ] 4.6 Na hostowanym projekcie dwa konta widzą nawzajem swoje notatki, a każde edytuje tylko własną
