# Wklejony URL otodom.pl staje się zapisaną kartą oferty: plan implementacji

## Overview

Realizujemy S-02 — north star roadmapy. Członek zespołu wkleja URL ogłoszenia otodom.pl, aplikacja pobiera stronę oferty, wyciąga `__NEXT_DATA__` jednym ograniczonym `RegExp`-em, odrzuca wszystko, co nie jest sprzedażą mieszkania, mapuje fakty z regułą „nieznane zamiast zera", odcina dane sprzedającego przy granicy pobrania i zapisuje wiersz chroniony RLS. Karta pod `/offers/<id>` pokazuje opis, parametry i hotlinkowaną galerię bez otwierania portalu (FR-004, FR-005, FR-007, US-01). To pierwsza migracja SQL w historii tego repozytorium i pierwsza integracja zewnętrzna, więc slice ustanawia wzorce, z których będą korzystać S-04, S-06, S-07, S-08 i S-09.

## Current State Analysis

- Brak jakiejkolwiek tabeli domenowej: `supabase/migrations/` nie istnieje na dysku ani w historii gita — jedyny SQL w repo to `supabase/seed.sql` (trzy konta zespołu wstawiane wprost do `auth.users`). Aplikacja używa dziś wyłącznie `auth.users`.
- Trasy domenowe nie istnieją: w `src/pages/api/` są tylko `auth/signin.ts` i `auth/signout.ts`. `src/pages/dashboard.astro:4-24` to placeholder z e-mailem użytkownika i formularzem wylogowania.
- Wzorzec trasy formularzowej: `src/pages/api/auth/signin.ts:5` czyta `formData()`, `:10-12` null-check klienta Supabase, `:15-17` zwraca błąd przez `context.redirect(\`...?error=${encodeURIComponent(...)}\`)`. Nigdy JSON, nigdy ręcznie budowany `Response`.
- Wzorzec wyspy formularzowej: `src/pages/auth/signin.astro:5` czyta `?error` z URL i przekazuje do `<SignInForm serverError={error} client:load />` (`:14`); `src/components/auth/SignInForm.tsx:12` to default export, składany z nazwanych eksportów `FormField`, `SubmitButton` (używa `useFormStatus()`), `ServerError`. Żadna wyspa w repo nie używa `fetch()`.
- `createClient()` (`src/lib/supabase.ts:5-8`) zwraca `null` przy braku `SUPABASE_URL`/`SUPABASE_KEY`; klient nie ma parametru typu `Database` — dziś jest nietypowany. `src/env.d.ts` deklaruje wyłącznie `Locals.user`.
- `src/middleware.ts:4` chroni prefiksy z `PROTECTED_ROUTES = ["/dashboard"]` przez `startsWith` (`:18`); trasy `/api/` **nie są** przez middleware chronione — muszą sprawdzać `locals.user` same.
- `scripts/smoke.mjs:54-77` to tablica `steps` z krotkami `[nazwa, () => request(...), oczekiwanie]`, gdzie oczekiwanie obsługuje `{ status, location, locationPrefix, errorCode }`; wspólny cookie jar niesie sesję między krokami, więc kolejność ma znaczenie. Job `smoke` w CI (`.github/workflows/ci.yml:27-55`) startuje lokalny Supabase, który **stosuje `supabase/migrations/` i seed automatycznie**.
- Dostęp do otodom.pl z egressu Cloudflare jest zweryfikowany end-to-end 2026-09-20 (`context/foundation/ingestion/otodom_fetching.md:539-560`): 200, `pageProps.ad` z 62 kluczami, `RegExp` + `JSON.parse` poniżej 1 ms na planie Free.
- `wrangler.jsonc:6` ma `nodejs_compat`, `compatibility_date` `2026-05-08`; `preview_urls: false`. Brak bloku `limits` — celowo, plan Free.

## Desired End State

- Istnieje `public.offers` z włączonym RLS, czterema politykami dla roli `authenticated` (po jednej na operację), **bez żadnej polityki dla `anon`**, unikalnym indeksem na `otodom_id` (tożsamość oferty, odporna na zmianę sluga) i zwykłym indeksem na znormalizowanym `source_url` (szybki lookup przed pobraniem).
- `POST /api/offers` przyjmuje `FormData` z polem `url`, a sukces przekierowuje na `/offers/<id>`; każda ścieżka odmowy przekierowuje na `/dashboard?error=<komunikat>` i **nie zapisuje żadnego wiersza**.
- Odrzucane są, z rozróżnialnym komunikatem: obcy host, adres nie będący ofertą, ogłoszenie wynajmu, ogłoszenie nie-mieszkania, oferta wygasła lub nieistniejąca, odmowa HTTP portalu, brak `__NEXT_DATA__`, przekroczenie limitu czasu, brak konfiguracji Supabase.
- Duplikat jest wykrywany **przed** pobraniem — po znormalizowanym URL-u — i przekierowuje na istniejącą kartę z `?duplicate=1` i banerem, także gdy ogłoszenie w portalu już wygasło; ten sam `otodom_id` pod innym slugiem łapie unikalny indeks po pobraniu. Nazwanie autora zapisu zostaje w S-07.
- `/offers/<id>` renderuje tytuł, cenę, tabelę parametrów, pełny opis tekstem i siatkę hotlinkowanych miniatur. Każdy nieznany parametr czyta „nie podano w ogłoszeniu" — nigdy „0", nigdy „nie", nigdy pusty wiersz.
- Numer telefonu i nazwisko ogłoszeniodawcy z pól strukturalnych (`owner`, `agency`, `contactDetails`) nie istnieją w bazie: żadna kolumna ich nie trzyma, a `raw` powstaje z **białej listy** kluczy, więc ani te pola, ani żaden przyszły klucz otodomu nie trafia do bazy po cichu. Tekst ogłoszenia (tytuł, opis) jest przechowywany tak, jak go napisano — także gdy ogłoszeniodawca wpisał w nim swój kontakt; PRD zapisuje to wprost.
- `scripts/otodom-inspect.mjs <url>` drukuje surowe `characteristics`/`target`/`adCategory` obok wyniku prawdziwego mappera — narzędzie debugowania dla przyszłych agentów.
- `npm run smoke` przechodzi, pokrywając wszystkie ścieżki odmowy bez dotykania sieci do otodom.pl.

Weryfikacja: kryteria sukcesu pięciu faz poniżej.

### Key Discoveries:

- **`ad.adCategory` to właściwy dyskryminator.** Zweryfikowane 2026-09-22 na trzech żywych ogłoszeniach: sprzedaż mieszkania `{id:101, name:"FLAT", type:"SELL"}`, wynajem mieszkania `{id:102, name:"FLAT", type:"SELL"→"RENT"}` (`OfferType: "wynajem"`), sprzedaż domu `{id:201, name:"HOUSE", type:"SELL"}`. Obok istnieje **inne** pole `ad.category`, którego `name` to pusta tablica — pomyłka między nimi cicho wyłącza bramkę.
- **`ad.transaction` nie istnieje na stronie oferty.** `transaction: SELL` z `otodom_fetching.md:231` dotyczy wyłącznie elementów wyników wyszukiwania. `ad.market` też nie rozróżnia transakcji — dla wynajmu zwrócił `ALL`, nie wartość „najmową".
- **Pułapka czynszu jest szersza niż opisana.** Obok `rent: "0"` z `otodom_fetching.md:352-364` zaobserwowano całkowity **brak klucza `rent`** (oferta domu) oraz `rent: "1"` (wynajem). Reguła musi brzmieć „klucz nieobecny lub wartość liczbowa ≤ 0 → nieznane" i obejmować każdą wartość liczbową, nie tylko czynsz.
- **`features` przyszło puste** (`[]`) na ofercie, której opis wymienia balkon i windę. Pusta lista udogodnień nie jest stwierdzeniem ich braku.
- **Etykieta lokalizacji nie leży w `location.address`** — `city`, `district` i `province` były `null`, wypełniona była tylko `street.name`. Źródłem jest `location.reverseGeocoding.locations[]`, wpis o najdłuższym `fullNameItems` (`"Praga-Południe, Warszawa, mazowieckie"`).
- **`owner` i `contactDetails` były obecne i wypełnione** (`phones`, `name`, `contacts`) na żywej ofercie 2026-09-22 — reguła o danych osobowych z `@CLAUDE.md` jest operacyjna, nie teoretyczna. `agency` było `null`, więc kod nie może zakładać jego obecności.
- `localizedValue` zachowuje się dokładnie jak w `otodom_fetching.md:366-373`: wypełnione dla `price`, `rent`, `price_per_m`, `m`, `rooms_num`, `build_year`, `building_floors_num`, `free_from`; **pusty ciąg** dla każdego enuma (`market`, `floor_no`, `building_type`, `construction_status`, `building_material`, `windows_type`, `building_ownership`, `heating`, `energy_certificate`).
- `description` to sekwencja `<p>…</p>`, `images[]` mają `thumbnail`/`small`/`medium`/`large` i `isExterior` (20 zdjęć na badanej ofercie).

## What We're NOT Doing

- Nie dodajemy biblioteki walidacyjnej (`zod`, `valibot`). Reguła URL to `new URL()` i dwa porównania, a twarde miejsca mappera to reguły biznesowe, których schema nie wyraża lepiej. Wybór należy do S-04 — zapisane jako otwarte pytanie roadmapy nr 3.
- Nie wdrażamy fallbacku przez usługę ekstrakcji (Apify). Ścieżka bezpośrednia jest zweryfikowana; zamiast tego rozróżniamy tryby awarii, żeby wiadomo było, kiedy fallback staje się potrzebny.
- Nie budujemy abstrakcji „dostawcy oferty" pod przyszłą zamianę na Apify — jeden użytkownik nie definiuje interfejsu, a Apify zwraca inny kształt danych niż `pageProps.ad`.
- Nie robimy lightboxa ani podglądu zdjęć w tej samej karcie — zaparkowane w roadmapie.
- Nie nazywamy członka, który zapisał ofertę jako pierwszy (pełne FR-005) — to S-07. Tu powstaje tylko unikalny indeks na `otodom_id`, lookup duplikatu i `created_by`, na których S-07 się oprze.
- Nie robimy re-fetchu ani flagi nieaktualności (FR-009) — to S-09.
- Nie robimy tablicy ofert ani listy (FR-006) — to S-06. Po dodaniu widać jedną kartę.
- Nie robimy linku do map (FR-008) — to S-08; zapisujemy jednak `location_label` i współrzędne, z których S-08 skorzysta.
- Nie dotykamy `src/pages/api/auth/*`, `src/middleware.ts` poza dopisaniem prefiksu do `PROTECTED_ROUTES`, ani `supabase/seed.sql`.
- Nie dodajemy nowego sekretu — otodom.pl nie wymaga klucza, więc `astro.config.mjs`, `.env.example` i `src/lib/config-status.ts` pozostają bez zmian, a zasada zero-config jest spełniona trywialnie.
- Nie dodajemy runnera testów (`vitest`, `playwright`) — `scripts/smoke.mjs` pozostaje jedyną powierzchnią testową.
- Nie parsujemy HTML-a żadną biblioteką i nie budujemy DOM w Workerze.

## Implementation Approach

Fazy idą od fundamentu, na którym nie da się pracować inaczej, do warstwy widocznej. Faza 1 to pierwsza migracja — odseparowana, bo błąd w politykach RLS jest ekspozycją danych, a nie usterką UI, i chcemy go weryfikować bez szumu. Faza 2 to czysta logika ingestii bez UI, weryfikowalna skryptem inspekcyjnym przeciwko żywemu ogłoszeniu — tu mieszkają wszystkie guardraile produktowe. Faza 3 spina je w ścieżkę zapisu z pełnym zestawem odmów i rozszerza smoke. Faza 4 dokłada kartę. Faza 5 zapisuje w dokumentacji to, czego nauczył nas ten slice, i domyka roadmapę.

Świadoma konsekwencja kolejności: na końcu fazy 3 udane dodanie oferty przekierowuje na `/offers/<id>`, która powstaje dopiero w fazie 4 — wiersz jest w bazie, strona zwraca 404. Weryfikacja fazy 3 sprawdza więc wiersz w bazie i cel przekierowania, nie renderowanie.

## Critical Implementation Details

- **`ad.adCategory`, nie `ad.category`.** Bramka czyta `adCategory.type === "SELL"` i `adCategory.name === "FLAT"`, z `target.OfferType`/`target.ProperType` jako kontrolą krzyżową. `ad.category.name` to pusta tablica i porównanie z nią zawsze przejdzie — czyli wyłączy bramkę po cichu.
- **Nieznane przed zerem, zawsze.** Każda wartość liczbowa z `characteristics` przechodzi przez jedną funkcję: klucz nieobecny, wartość pusta, nieliczbowa lub `≤ 0` → `null`. `null` w kolumnie znaczy „ogłoszenie tego nie podało" i tylko to. Nie ma drugiej ścieżki mapowania liczb.
- **Enumy czyta się z `value`, nigdy z `localizedValue`.** Dla każdego enuma `localizedValue` jest pustym ciągiem, więc mapowanie przez nie da „nie podano" dla ogłoszeń, które parametr podały — czyli odwrotność guardrailu.
- **Dane osobowe giną przed zapisem, nie przy odczycie.** `raw` jest budowany z białej listy kluczy, a nie przez usuwanie znanych pól z całego `ad` — czarna lista oparta na jednej obserwacji przepuściłaby każdy nowy klucz z danymi ogłoszeniodawcy. `owner`, `agency` i `contactDetails` nie są nigdy czytane; żadna kolumna ich nie przyjmuje. Tekst ogłoszenia nie jest zamazywany: cytaty audytu (FR-011) muszą zgadzać się znak w znak z treścią.
- **Pusta lista nie jest zaprzeczeniem.** `features: []` renderuje się jako „ogłoszenie nie wymienia udogodnień", nigdy jako „brak udogodnień".
- **`src/lib/otodom/map.ts` i `src/lib/otodom/fetch.ts` nie mogą mieć importów runtime'owych.** Skrypt inspekcyjny ładuje oba bezpośrednio w Node (natywne zdejmowanie typów w Node 22.18+), więc moduły używają wyłącznie importów typów (`import type`) i składni wymazywalnej — bez `enum`, bez `namespace`, bez właściwości w parametrach konstruktora.
- **Limit czasu należy do serwera, nie do przeglądarki.** `AbortSignal.timeout(45_000)` na `fetch` do otodom.pl zostawia margines na zapis w bazie wewnątrz ~minutowego budżetu z Non-Functional Requirements. Cloudflare mierzy CPU, nie czas oczekiwania, więc oczekiwanie nie zużywa budżetu Workera.
- **Kolejność kroków w smoke ma znaczenie** — `scripts/smoke.mjs` niesie sesję we wspólnym cookie jarze, więc kroki wymagające zalogowania muszą stać po kroku logowania i przed wylogowaniem.

---

## Faza 1: Pierwsza migracja — tabela `offers` z RLS

### Overview

Zakłada `public.offers` wraz z politykami dostępu i unikalnym indeksem tożsamości. To pierwszy plik w `supabase/migrations/` w historii repo, więc ustanawia wzorzec, do którego odwoła się `@CLAUDE.md`.

### Changes Required:

#### 1. Migracja tworząca tabelę ofert

**File**: `supabase/migrations/<timestamp>_create_offers.sql` (utworzony poleceniem `npx supabase migration new create_offers`, nigdy ręcznie)

**Intent**: Dać ingestii trwałe miejsce zapisu, w którym reguła „nieznane zamiast zera" jest wyrażona strukturalnie — kolumna dopuszczająca `null` — a nie tylko w kodzie mapującym.

**Contract**: Tabela `public.offers` z kolumnami:

- tożsamość i pochodzenie: `id uuid primary key default gen_random_uuid()`, `source_url text not null` (URL znormalizowany), `otodom_id bigint not null`, `created_by uuid not null references auth.users(id)`, `created_at timestamptz not null default now()`, `fetched_at timestamptz not null default now()`, `listed_at timestamptz`, `listing_modified_at timestamptz`;
- treść: `title text not null`, `description text not null` (czysty tekst);
- fakty liczbowe, wszystkie **nullowalne**: `price numeric`, `price_currency text`, `price_per_m numeric`, `area_m2 numeric`, `rooms integer`, `floors_total integer`, `build_year integer`, `rent numeric`, `rent_currency text`;
- fakty enumeryczne, wszystkie nullowalne, przechowywane jako surowy token otodomu: `floor text` (np. `floor_1`, `ground_floor`), `market text`, `building_type text`, `construction_status text`, `building_ownership text`, `heating text`, `windows_type text`, `building_material text`, `energy_certificate text`, `advert_type text`, `free_from date`;
- lokalizacja: `location_label text`, `street_name text`, `latitude numeric`, `longitude numeric`;
- struktury: `features jsonb not null default '[]'::jsonb`, `images jsonb not null default '[]'::jsonb`, `raw jsonb not null`.

Unikalny indeks `offers_otodom_id_key` na `(otodom_id)` — `ad.id` jest stabilny, a slug w URL-u otodom zmienia z przekierowaniem (`otodom_fetching.md:311-312`). Zwykły indeks `offers_source_url_idx` na `(source_url)` pod lookup duplikatu przed pobraniem. Komentarz w pliku nazywa powód nullowalności: `null` znaczy „ogłoszenie nie podało", nigdy „zero" ani „nie".

#### 2. Row Level Security i polityki

**File**: ten sam plik migracji

**Intent**: RLS jest jedyną bramką dostępu — automatyczny grant Supabase już dał `anon` i `authenticated` pełny CRUD, więc brak polityki to ekspozycja, a nie brak funkcji.

**Contract**: `alter table public.offers enable row level security;` plus dokładnie cztery polityki, każda `to authenticated`, żadna `for all`, żadna dla `anon`:

- `offers_select_authenticated` — `for select using (auth.uid() is not null)` (FR-006, FR-013: każdy zalogowany członek czyta wszystko);
- `offers_insert_authenticated` — `for insert with check (created_by = auth.uid())` (autor zapisu nigdy nie jest przypisywany innej osobie);
- `offers_update_authenticated` — `for update using (auth.uid() is not null) with check (auth.uid() is not null)` (Access Control → Roles: płaskie role, pełny CRUD dla każdego członka; potrzebne przez S-09);
- `offers_delete_authenticated` — `for delete using (auth.uid() is not null)` (FR-015).

Brak polityki dla `anon` jest decyzją, nie przeoczeniem — komentarz w migracji to zapisuje wraz z sygnaturą odmowy: RLS bez polityki `select` zwraca pustą tablicę i HTTP 200, nie błąd uprawnień.

#### 3. Zamrożenie autora zapisu

**File**: ten sam plik migracji

**Intent**: `created_by` jest tym, co S-07 pokaże jako „kto zapisał tę ofertę". Polityka `update` nie potrafi porównać nowej wartości ze starą, więc niezmienność musi być wyrażona wyzwalaczem.

**Contract**: Funkcja `public.offers_freeze_created_by()` (`language plpgsql`, `security definer` niepotrzebne) przypisująca `new.created_by := old.created_by`, oraz wyzwalacz `before update on public.offers for each row`. Efekt: każdy `update` zachowuje pierwotnego autora niezależnie od tego, co przyśle aplikacja.

### Success Criteria:

#### Automated Verification:

Komendy `psql` poniżej celują w **lokalny** Postgres z `npx supabase start` (domyślny URL drukuje `npx supabase status`). Nigdy nie wskazujemy nimi bazy hostowanej — tam migracja trafia wyłącznie przez `supabase db push` (Migration Notes).

- Migracja powstała poleceniem CLI i stosuje się czysto: `npx supabase db reset` kończy się bez błędu
- Tabela istnieje z RLS: `npx supabase db reset && psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "select relrowsecurity from pg_class where relname='offers'"` zwraca `t`
- Istnieją dokładnie cztery polityki, wszystkie dla `authenticated`: `psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "select polname, polcmd, polroles::regrole[] from pg_policy where polrelid='public.offers'::regclass"` zwraca cztery wiersze i żaden nie wymienia `anon`
- Unikalność oferty jest wymuszona: dwukrotny `insert` z tym samym `otodom_id` (przy różnych `source_url`) kończy się błędem `duplicate key value violates unique constraint`
- `npm run lint`, `npx astro sync`, `npx astro check` i `npm run build` przechodzą
- `npm run smoke` przechodzi bez zmian w skrypcie

#### Manual Verification:

- W Supabase Studio (`http://localhost:54323`) tabela `offers` jest widoczna z włączonym RLS i czterema politykami
- Zapytanie o `offers` samym kluczem publishable bez sesji zwraca pustą tablicę i HTTP 200 — potwierdza, że `anon` nie ma dostępu i że sygnatura odmowy to pusty wynik, nie błąd

**Implementation Note**: Faza kończy się przed napisaniem jakiegokolwiek kodu TypeScript. Jeżeli którykolwiek z warunków RLS nie jest spełniony, poprawiamy migrację, nie kod aplikacji.

---

## Faza 2: Moduł ingestii i skrypt inspekcyjny

### Overview

Cała logika pobrania i mapowania jako czyste moduły w `src/lib/otodom/`, bez trasy i bez UI. Tu mieszkają wszystkie guardraile produktowe, więc faza kończy się dowodem na żywym ogłoszeniu.

### Changes Required:

#### 1. Normalizacja i walidacja URL-a

**File**: `src/lib/otodom/url.ts`

**Intent**: Ustalić tożsamość oferty przed czymkolwiek innym (FR-005) i odrzucić obcy adres bez sięgania do sieci.

**Contract**: `normalizeOfferUrl(input: string)` zwraca `{ ok: true; url: string }` albo `{ ok: false; reason: "empty" | "malformed" | "foreign_host" | "not_an_offer" }`. Akceptuje hosty `otodom.pl` i `www.otodom.pl` (wielkość liter bez znaczenia), ścieżkę zawierającą segment `oferta` z lub bez prefiksu `/pl`. Zwracany URL jest kanoniczny: schemat `https`, host `www.otodom.pl`, ścieżka zawsze w postaci `/pl/oferta/<slug>` (prefiks `/pl` dopisywany, gdy go brak), bez końcowego ukośnika, **bez query stringu i bez fragmentu** — to właśnie stripowanie parametrów śledzących, którego wymaga FR-005. Moduł nie wykonuje żadnego żądania sieciowego.

#### 2. Pobranie strony oferty

**File**: `src/lib/otodom/fetch.ts`

**Intent**: Sprowadzić payload oferty jedną wizytą, rozróżniając tryby awarii na tyle, żeby dało się odpowiedzieć na pytanie „czy to blokada egressu, czy zmiana kształtu strony" bez zgadywania.

**Contract**: `fetchOfferAd(url: string, signal: AbortSignal)` zwraca `{ ok: true; ad: unknown }` albo `{ ok: false; reason: "http_denied" | "not_found" | "expired" | "shape_changed" | "timeout" | "network"; status?: number }`. Nagłówki zgodnie z `otodom_fetching.md:94-96`: realistyczny desktopowy `User-Agent` Chrome i `Accept-Language: pl-PL,pl;q=0.9`. Przekierowania są śledzone. Rozpoznanie: `404` → `not_found`; `403`/`429` → `http_denied` z zachowanym statusem; brak trafienia `RegExp`-u `/id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/` lub błąd `JSON.parse` → `shape_changed`; brak `props.pageProps.ad` przy prawdziwym `shouldShowExpiredAdPage` → `expired`, w przeciwnym razie `shape_changed`; `AbortError` → `timeout`. Jeden `RegExp`, jeden `JSON.parse`, żadnego chodzenia po DOM i żadnej zależności parsującej HTML. Jak `map.ts`, moduł ma **wyłącznie importy typów** i składnię wymazywalną, bo skrypt inspekcyjny importuje go wprost w Node.

#### 3. Mapper z bramką i granicą danych osobowych

**File**: `src/lib/otodom/map.ts`, typy w `src/lib/otodom/types.ts`

**Intent**: Zamienić cudzy payload w nasz wiersz, egzekwując w jednym miejscu trzy guardraile: tylko sprzedaż mieszkania, nieznane zamiast zera, zero danych osobowych.

**Contract**: `mapAdToOffer(ad: unknown)` zwraca `{ ok: true; offer: OfferInsert }` albo `{ ok: false; reason: "not_for_sale" | "not_a_flat" | "shape_changed"; detail?: string }`.

- Bramka: `adCategory.type` musi równać się `"SELL"`, inaczej `not_for_sale`; `adCategory.name` musi równać się `"FLAT"`, inaczej `not_a_flat` z `detail` niosącym `target.ProperType` do komunikatu. Kontrola krzyżowa `target.OfferType === "sprzedaz"`; rozbieżność między nimi to `shape_changed`.
- Wartości liczbowe: jedna funkcja `numericOrUnknown(raw)` zwracająca `number | null` — `null` dla klucza nieobecnego, pustego ciągu, wartości nieparsowalnej oraz **każdej wartości `≤ 0`**. Używana dla `price`, `rent`, `price_per_m`, `m`, `rooms_num`, `build_year`, `building_floors_num`.
- Wartości enumeryczne: czytane z `characteristics[].value`, nigdy z `localizedValue`; pusty ciąg → `null`. Token zapisywany surowo (`floor_1`, `ground_floor`, `block`, `full_ownership`), tłumaczenie na etykietę należy do warstwy widoku.
- Waluta: z pola `currency` wpisu, nie z `value`.
- Opis: `htmlToPlainText(ad.description)` — `</p>`, `<br>` i `</li>` stają się złamaniem wiersza, pozostałe tagi znikają, encje HTML są dekodowane, wielokrotne puste wiersze scalane. Wynik nie zawiera `<` ani `>`.
- Lokalizacja: `location_label` z wpisu `location.reverseGeocoding.locations[]` o najdłuższej tablicy `fullNameItems` (jego `fullName`); `street_name` z `location.address.street.name`; współrzędne z `location.coordinates`. Każde z nich niezależnie nullowalne.
- Zdjęcia: `images` mapowane do tablicy `{ thumbnail, large }` z `ad.images[]`; pusta tablica jest dopuszczalna.
- Udogodnienia: `features` przepisywane jak przyszły; pusta tablica jest dopuszczalna i **nie** oznacza braku udogodnień.
- `raw`: obiekt budowany z **białej listy** kluczy `ad` — `id`, `url`, `title`, `description`, `characteristics`, `features`, `target`, `adCategory`, `images`, `createdAt`, `modifiedAt`, a z `location` wyłącznie `coordinates` i `reverseGeocoding` (bez `address`). Klucz spoza listy nie trafia do `raw`, nawet jeśli otodom go doda. `owner`, `agency` i `contactDetails` nie są nigdzie czytane.
- Braki uniemożliwiające sensowny zapis (`id`, `title`, `description`, `url`) → `shape_changed`. Nigdy nie powstaje wiersz częściowy.
- Moduł ma **wyłącznie importy typów** i składnię wymazywalną, żeby dał się załadować wprost w Node.

#### 4. Orkiestracja ingestii

**File**: `src/lib/otodom/index.ts`

**Intent**: Dać trasie API jedno wejście i jeden zamknięty zbiór powodów odmowy, żeby mapowanie powodów na komunikaty istniało w jednym miejscu.

**Contract**: `ingestOffer(rawUrl: string, signal: AbortSignal)` składa trzy powyższe moduły i zwraca `{ ok: true; url: string; offer: OfferInsert }` albo `{ ok: false; reason: IngestFailureReason; status?: number; detail?: string }`, gdzie `IngestFailureReason` to suma powodów z modułów URL, fetch i map. Funkcja nie dotyka Supabase i nie wie nic o HTTP aplikacji.

#### 5. Skrypt inspekcyjny dla przyszłego debugowania

**File**: `scripts/otodom-inspect.mjs`, skrypt `otodom:inspect` w `@package.json`

**Intent**: Zamknąć pętlę „to pole źle się przemapowało — oto URL": pokazać surowe dane portalu obok wyniku naszego mappera, bez pisania skryptu od zera przy każdym zgłoszeniu.

**Contract**: `node scripts/otodom-inspect.mjs <url-oferty>` — zero zależności, w konwencji `scripts/smoke.mjs`. Pobiera ofertę przez `fetchOfferAd` zaimportowane wprost z `../src/lib/otodom/fetch.ts` — bez własnej kopii nagłówków, `RegExp`-u ani wykrywania wygaśnięcia — po czym drukuje trzy sekcje: (1) `adCategory`, `target.OfferType`, `target.ProperType` i wynik bramki; (2) pełną tablicę `characteristics` jako `key / value / localizedValue / currency`; (3) wynik `mapAdToOffer` zaimportowanego wprost z `../src/lib/otodom/map.ts`, z wypisaniem, które pola wyszły `null`. Skrypt uderza w żywy portal, więc **nigdy nie jest uruchamiany w CI** i nie jest częścią powierzchni testowej.

### Success Criteria:

#### Automated Verification:

- `npm run lint`, `npx astro check` i `npm run build` przechodzą
- W repo nie ma zależności parsującej HTML: `grep -nE '"(cheerio|node-html-parser|linkedom|jsdom)"' package.json` nic nie zwraca
- Nie dodano biblioteki walidacyjnej: `grep -nE '"(zod|valibot|yup)"' package.json` nic nie zwraca
- Mapper i moduł pobrania nie mają importów runtime'owych: `grep -n '^import ' src/lib/otodom/map.ts src/lib/otodom/fetch.ts` zwraca wyłącznie linie zaczynające się od `import type`
- Pola z danymi osobowymi nie są nigdzie czytane: `grep -rnE 'contactDetails|\bowner\b|agency' src/lib/otodom/` nic nie zwraca (biała lista ich nie wymienia)
- `node scripts/otodom-inspect.mjs <url-żywej-oferty-sprzedaży-mieszkania>` kończy się kodem 0 i drukuje wszystkie trzy sekcje

#### Manual Verification:

- Skrypt inspekcyjny na ofercie sprzedaży mieszkania: bramka przechodzi, `price`, `area_m2` i `rooms` mają wartości, enumy (`floor`, `heating`, `building_ownership`) są tokenami, a nie pustymi ciągami
- Skrypt na ofercie **wynajmu**: bramka odrzuca z powodem `not_for_sale`
- Skrypt na ofercie **domu**: bramka odrzuca z powodem `not_a_flat`
- Skrypt na ofercie, w której otodom podaje `rent` jako `"0"` lub nie podaje go wcale: w wyniku mappera `rent` to `null`, nie `0`
- Wynik mappera — kolumny i `raw` — nie zawiera wartości z `contactDetails`, `owner` ani `agency` (numer telefonu i nazwisko porównane z tym, co skrypt pokazuje w surowym payloadzie); treść opisu nie jest tu oceniana

**Implementation Note**: Nie przechodzimy dalej, zanim trzy ręczne przypadki bramki (sprzedaż mieszkania, wynajem, dom) nie dadzą oczekiwanych wyników na żywych ogłoszeniach. To jedyna faza, w której te guardraile da się sprawdzić w izolacji.

---

## Faza 3: Ścieżka zapisu — trasa API, formularz i smoke

### Overview

Spina moduł ingestii z bazą: trasa przyjmująca wklejony URL, formularz na dashboardzie, komplet rozróżnialnych odmów i kroki smoke pokrywające każdą z nich bez dotykania sieci.

### Changes Required:

#### 1. Trasa zapisu oferty

**File**: `src/pages/api/offers.ts`

**Intent**: Jedyne wejście zapisu — wykonuje ingestię, decyduje o zapisie i tłumaczy powody odmowy na komunikaty, nigdy nie zostawiając wiersza po nieudanym pobraniu.

**Contract**: `export const POST: APIRoute`. Czyta `FormData`, pole `url`. Kolejność: brak `context.locals.user` → `context.redirect("/auth/signin")`; `createClient(...) === null` → `context.redirect("/dashboard?error=" + encodeURIComponent("Supabase nie jest skonfigurowany — nie można zapisać oferty."))`; `normalizeOfferUrl(url)` — odmowa → komunikat z tabeli niżej; `select id from offers where source_url = <znormalizowany>` — trafienie → `context.redirect("/offers/" + id + "?duplicate=1")` **bez pobierania** (FR-005: znana oferta otwiera kartę, nawet jeśli w portalu już wygasła); `ingestOffer(url, AbortSignal.timeout(45_000))`; wynik nieudany → przekierowanie na `/dashboard?error=<komunikat po polsku>` **bez żadnego zapisu**; wynik udany → `insert` do `offers` z `created_by` z `locals.user.id`, po czym `context.redirect("/offers/" + id)`. Naruszenie unikalnego indeksu (kod Postgresa `23505` — ta sama oferta pod innym slugiem) nie jest błędem: trasa czyta `id` istniejącego wiersza po `otodom_id` i przekierowuje na `/offers/<id>?duplicate=1`. Trasa nigdy nie zwraca JSON-a i nigdy nie konstruuje `Response` ręcznie — wzorcem pozostaje `src/pages/api/auth/signin.ts`.

Mapowanie powodów na komunikaty (jeden powód — jeden rozróżnialny komunikat):

| Powód | Komunikat |
| --- | --- |
| `empty`, `malformed` | To nie wygląda na poprawny adres URL. |
| `foreign_host` | Vetpad obsługuje wyłącznie ogłoszenia z otodom.pl. |
| `not_an_offer` | Ten adres nie prowadzi do ogłoszenia otodom.pl. |
| `not_for_sale` | Vetpad służy do kupowania mieszkań — to ogłoszenie dotyczy wynajmu. |
| `not_a_flat` | Vetpad obsługuje wyłącznie mieszkania — to ogłoszenie dotyczy innego rodzaju nieruchomości. |
| `not_found`, `expired` | Ogłoszenie nie istnieje lub wygasło. Nic nie zostało zapisane. |
| `http_denied` | otodom.pl odmówił pobrania ogłoszenia (HTTP `<status>`). Nic nie zostało zapisane — spróbuj ponownie za chwilę. |
| `shape_changed` | Nie udało się odczytać treści ogłoszenia — strona otodom.pl mogła zmienić format. Nic nie zostało zapisane. |
| `timeout` | Pobieranie ogłoszenia trwało dłużej niż 45 sekund. Nic nie zostało zapisane — spróbuj ponownie. |
| `network` | Nie udało się połączyć z otodom.pl. Nic nie zostało zapisane. |
| dowolny inny błąd `insert`/`select` Supabase (np. `42P01` — migracja niezastosowana, naruszenie RLS) | Nie udało się zapisać oferty. Nic nie zostało zapisane. |

`supabase-js` zwraca błąd w `error`, a nie rzuca — trasa sprawdza `error` przy każdym zapytaniu, zanim sięgnie po `data`, żeby żadna ścieżka nie skończyła się 500.

#### 2. Formularz dodawania oferty

**File**: `src/components/offers/AddOfferForm.tsx` (default export), `src/pages/dashboard.astro`

**Intent**: Dać wklejeniu URL-a miejsce w aplikacji i pokazać, że pobranie trwa — bez zgadywania, ile potrwa.

**Contract**: Wyspa mocowana `client:load`, składana z istniejących nazwanych eksportów `FormField`, `SubmitButton` i `ServerError` z `src/components/auth/`. Prawdziwy `<form method="POST" action="/api/offers">`, bez `fetch()`. Walidacja po stronie klienta ogranicza się do niepustego pola. `useFormStatus()` **nie** zgłasza `pending` dla formularza, którego `action` jest stringiem, więc samo `SubmitButton` nie pokaże postępu natywnego POST-a: `AddOfferForm` trzyma własny stan `submitting`, ustawiany w `onSubmit` po przejściu walidacji i zerowany w handlerze `pageshow` (powrót z bfcache), a `SubmitButton` zyskuje opcjonalny prop `pending?: boolean`, który — gdy podany — ma pierwszeństwo przed `useFormStatus()`. Etykieta oczekiwania: „Pobieram ogłoszenie…". `SignInForm` nie jest w tej zmianie dotykany. `dashboard.astro` czyta `Astro.url.searchParams.get("error")` i przekazuje jako `serverError`, dokładnie jak `src/pages/auth/signin.astro:5`.

#### 3. Ochrona tras kart

**File**: `src/middleware.ts`

**Intent**: Oferty zespołu są czytelne wyłącznie dla zalogowanych (FR-006, FR-013), a bez Supabase strona karty nie może zwrócić 500.

**Contract**: `PROTECTED_ROUTES` zyskuje prefiks `"/offers"`. Trasa `/api/offers` pozostaje poza tą listą — sprawdza `locals.user` sama, bo middleware nie obejmuje `/api/`.

#### 4. Kroki smoke dla nowej trasy

**File**: `scripts/smoke.mjs`

**Intent**: Każda ścieżka odmowy ma być pilnowana automatycznie, bo to one niosą guardraile — a żadna z nich nie wymaga sieci do otodom.pl.

**Contract**: Nowe krotki w tablicy `steps`, w dwóch grupach, bo wspólny cookie jar niesie sesję między krokami. Grupa anonimowa, wstawiona **przed** krokiem „signin accepts correct password": `POST /api/offers` bez sesji → 302 na `/auth/signin`; `GET /offers/<losowy-uuid>` bez sesji → 302 na `/auth/signin`. Grupa zalogowana, wstawiona **po** kroku udanego logowania i **przed** wylogowaniem: `POST /api/offers` z pustym `url` → 302 z `locationPrefix: "/dashboard?error="`; z adresem obcego hosta (`https://www.olx.pl/...`) → 302 z tym samym prefiksem; z adresem otodom.pl nie będącym ofertą (`https://www.otodom.pl/pl/wyniki/sprzedaz/mieszkanie/warszawa`) → 302 z tym samym prefiksem. Żaden krok nie wykonuje żądania do otodom.pl — wszystkie są odrzucane przed fazą pobrania.

### Success Criteria:

#### Automated Verification:

- `npm run lint`, `npx astro check` i `npm run build` przechodzą
- `npm run smoke` przechodzi z nowymi krokami, a job `smoke` w CI nie wymaga zmian w `@.github/workflows/ci.yml`
- Trasa nie zwraca JSON-a: `grep -n 'JSON.stringify\|new Response' src/pages/api/offers.ts` nic nie zwraca
- Wyspa nie używa `fetch()`: `grep -n 'fetch(' src/components/offers/AddOfferForm.tsx` nic nie zwraca
- Limit czasu jest ustawiony po stronie serwera: `grep -n 'AbortSignal.timeout' src/pages/api/offers.ts` zwraca jedno trafienie

#### Manual Verification:

- Wklejenie URL-a żywego ogłoszenia sprzedaży mieszkania kończy się przekierowaniem na `/offers/<uuid>`, a w Supabase Studio istnieje odpowiadający mu wiersz z wypełnionym `created_by`
- W tym wierszu żadna kolumna ani `raw` nie zawiera wartości z `contactDetails`, `owner` ani `agency`; `raw` nie ma kluczy spoza białej listy
- Wklejenie URL-a ogłoszenia wynajmu pokazuje komunikat o wynajmie, a liczba wierszy w `offers` nie rośnie
- Wklejenie tego samego URL-a po raz drugi, raz z parametrami śledzącymi (`?utm_source=...`), raz bez prefiksu `/pl`, nie tworzy drugiego wiersza i kieruje na `/offers/<id>?duplicate=1`
- Podczas pobierania przycisk pokazuje „Pobieram ogłoszenie…" i jest nieaktywny

**Implementation Note**: Po tej fazie `/offers/<id>` zwraca 404 — strona powstaje w fazie 4. Weryfikacja manualna sprawdza wiersz w bazie i adres przekierowania, nie renderowanie.

---

## Faza 4: Karta oferty

### Overview

Widok, który zastępuje otwieranie portalu (FR-007), z prezentacją nieznanych wartości rozstrzygającą Open Question 2 z PRD.

### Changes Required:

#### 1. Strona karty

**File**: `src/pages/offers/[id].astro`

**Intent**: Pokazać pełną zapisaną treść ogłoszenia w jednym miejscu i odróżnić „ogłoszenie tego nie mówi" od „tego nie ma".

**Contract**: Pobiera wiersz po `id` przez klienta Supabase z sesji użytkownika. Brak klienta, `id` niebędące uuid (sprawdzane wyrażeniem przed zapytaniem — inaczej Postgres zwraca `22P02 invalid input syntax for type uuid`), dowolny `error` zapytania lub brak wiersza → `return new Response(null, { status: 404 })` z frontmattera; nigdy 500 (`Astro.redirect` nie jest tu potrzebne, bo `/offers` jest w `PROTECTED_ROUTES`). `scripts/smoke.mjs` zyskuje krok w grupie zalogowanej: `GET /offers/not-a-uuid` → 404. Przy `?duplicate=1` renderuje `<Banner variant="info">` z informacją, że oferta była już zapisana. Sekcje: nagłówek (tytuł, cena, cena za m², etykieta lokalizacji, odnośnik do oryginału), tabela parametrów, opis, galeria. Strona jest w całości `.astro`, bez wyspy React.

#### 2. Prezentacja parametrów i wartości nieznanych

**File**: `src/components/offers/OfferParameters.astro`, `src/lib/otodom/labels.ts`

**Intent**: Zrealizować guardrail — atrybut niepodany w ogłoszeniu czyta „nie podano w ogłoszeniu", nigdy „0", nigdy „nie", nigdy pusty wiersz.

**Contract**: Każdy parametr ma **zawsze** własny wiersz z etykietą; wartość `null` renderuje się jako wyszarzone „nie podano w ogłoszeniu". `labels.ts` tłumaczy surowe tokeny otodomu na polskie etykiety (`floor_1` → „1. piętro", `ground_floor` → „parter", `block` → „blok", `full_ownership` → „pełna własność", `urban` → „miejskie" itd.); token nieznany temu słownikowi renderuje się dosłownie, a **nie** jako „nie podano" — nieznany kod to nie brak danych. Sekcja udogodnień, gdy `features` jest puste, czyta „ogłoszenie nie wymienia udogodnień".

#### 3. Opis i galeria

**File**: `src/components/offers/OfferDescription.astro`, `src/components/offers/OfferGallery.astro`

**Intent**: Dać pełną treść i zdjęcia bez otwierania portalu, przy hotlinkowaniu zaakceptowanym w FR-004.

**Contract**: Opis renderowany jako tekst z zachowaniem złamań wierszy (`whitespace-pre-line`), bez `set:html`. Galeria to siatka miniatur z `images[].thumbnail`, każda w `<a href={large} target="_blank" rel="noopener noreferrer">`, z `loading="lazy"` i sensownym `alt`. Pusta tablica `images` renderuje informację o braku zdjęć w ogłoszeniu. Klasy łączone przez `cn()` z `@/lib/utils`.

### Success Criteria:

#### Automated Verification:

- `npm run lint`, `npx astro check` i `npm run build` przechodzą
- Opis nie jest wstrzykiwany jako HTML: `grep -rn 'set:html' src/pages/offers/ src/components/offers/` nic nie zwraca
- Karta nie jest wyspą React: `grep -rn 'client:' src/pages/offers/` nic nie zwraca
- `npm run smoke` przechodzi

#### Manual Verification:

- Karta zapisanej oferty pokazuje tytuł, cenę, cenę za m², powierzchnię, pokoje, piętro, rok budowy, czynsz, ogrzewanie, formę własności i lokalizację, a wartości enumeryczne są po polsku, nie jako tokeny
- Na ofercie bez podanego czynszu wiersz „Czynsz" czyta „nie podano w ogłoszeniu" — nigdzie nie pojawia się „0 zł"
- Opis czyta się jako tekst z akapitami, bez żadnych znaczników HTML
- Wszystkie miniatury się ładują, a kliknięcie otwiera duże zdjęcie w nowej karcie
- Wejście na `/offers/<id>?duplicate=1` pokazuje baner o wcześniejszym zapisie
- Wylogowany użytkownik wchodzący na `/offers/<id>` trafia na `/auth/signin`

**Implementation Note**: Prezentacja „nie podano w ogłoszeniu" rozstrzyga Open Question 2 z PRD. Faza 5 zapisuje ten wybór w PRD, żeby przestał być pytaniem otwartym.

---

## Faza 5: Dokumentacja i domknięcie

### Overview

Zapisuje to, czego slice nauczył się o otodomie i o własnych regułach, w miejscach, do których sięgnie następny agent, oraz domyka pozycje roadmapy.

### Changes Required:

#### 1. Log weryfikacji ingestii

**File**: `context/foundation/ingestion/otodom_fetching.md`

**Intent**: Ustalenia z 2026-09-22 są nowe wobec dokumentu i dwa z nich unieważniają jego dotychczasowe wskazówki — bez zapisu następny agent powtórzy tę samą sondę.

**Contract**: W sekcji 7 i w logu weryfikacji (sekcja 13) dopisane: `ad.adCategory` jako `{id, name, type}` z wartościami zweryfikowanymi dla trzech typów ogłoszeń i ostrzeżenie o mylącym `ad.category`; brak `ad.transaction` na stronie pojedynczej oferty; `ad.market: "ALL"` dla wynajmu; rozszerzenie pułapki czynszu o brak klucza i o wartość `≤ 0`; puste `features` mimo udogodnień w treści; `location.address` z `null`-ami i `reverseGeocoding.locations` jako właściwe źródło etykiety. Sekcja wskazuje `scripts/otodom-inspect.mjs` jako narzędzie do powtórzenia tych obserwacji.

#### 2. Reguły projektu

**File**: `@CLAUDE.md`

**Intent**: Wpis o `supabase/migrations/` jest dziś „forward-looking"; po tej zmianie katalog istnieje i musi wskazywać instancję odniesienia, a nowe reguły produktowe muszą mieć miejsce.

**Contract**: Wpis o `supabase/migrations/` przepisany z sekcji „Forward-looking" tak, by nazywał utworzoną migrację jako wzorzec RLS. W Product invariants dopisana reguła „tylko sprzedaż mieszkania" ze wskazaniem `ad.adCategory` i FR-005 w PRD jako źródła. Reguła o `rent: "0"` rozszerzona o brak klucza i wartości `≤ 0`, dalej wskazując `otodom_fetching.md`. W Structure lub Conventions nazwane nowe instancje odniesienia: `src/lib/otodom/` jako moduł ingestii, `src/pages/api/offers.ts` jako trasa formularzowa domenowa, `src/pages/offers/[id].astro` jako strona karty. Reguła o telefonie i nazwisku ogłoszeniodawcy doprecyzowana: dotyczy pól strukturalnych i białej listy `raw`, a o tekście ogłoszenia rozstrzyga PRD (Non-Functional Requirements) — reguła wskazuje tam, zamiast powtarzać rozstrzygnięcie. W Testing dopisane, że `scripts/otodom-inspect.mjs` jest narzędziem debugowania uderzającym w żywy portal, nie powierzchnią testową, i nigdy nie biegnie w CI.

#### 3. PRD

**File**: `context/foundation/prd.md`

**Intent**: Ograniczenie do sprzedaży mieszkań jest nową decyzją produktową, a prezentacja „nie podano" rozstrzyga Open Question 2 — jedno i drugie należy do PRD, nie do pliku reguł.

**Contract**: FR-005 i Non-Goals **zostały już uzupełnione na etapie planowania** o warunek „wyłącznie sprzedaż mieszkania" — ta faza jedynie sprawdza, że komunikaty odmowy z fazy 3 mówią dokładnie to, co zapisuje FR-005. Do zrobienia zostaje Open Question 2: przeniesione do bloku rozstrzygniętych z zapisem wybranej prezentacji („nie podano w ogłoszeniu"). Dopisane w Non-Functional Requirements (przy danych osobowych): pola kontaktowe ogłoszeniodawcy nie trafiają do bazy, natomiast tekst ogłoszenia — tytuł i opis — jest przechowywany tak, jak go napisano, także gdy zawiera kontakt wpisany przez ogłoszeniodawcę; zamazywanie złamałoby dosłowność cytatów audytu (FR-011). Pozostała treść PRD bez zmian.

#### 4. README

**File**: `@README.md`

**Intent**: Świeży klon musi wiedzieć, że baza ma teraz migracje i jak zdebugować ingestię.

**Contract**: Zdanie „No database tables or migrations are required" zastąpione opisem stanu faktycznego wraz z informacją, że `npx supabase start` i `supabase db reset` stosują migracje. Dodany krótki akapit o `npm run otodom:inspect <url>` z zaznaczeniem, że skrypt uderza w żywy portal i nie jest testem. Tabela tras uzupełniona o `/offers/<id>`.

#### 5. Roadmapa

**File**: `context/foundation/roadmap.md`

**Intent**: Slice zamyka trzy pozycje bookkeepingowe, które inaczej zostaną jako nieprawdziwe otwarte pytania.

**Contract**: Otwarte pytanie nr 2 oznaczone jako rozstrzygnięte wskazaniem prezentacji „nie podano w ogłoszeniu". Otwarte pytanie nr 3 zawężone: walidacja ręczna dla S-02, decyzja o bibliotece otwarta dla S-04. Otwarte pytanie nr 4 oznaczone jako rozstrzygnięte wskazaniem wpisu w „Parked". Otwarte pytanie nr 5 bez zmian. Dwie pozycje w sekcji „Parked" — fallback Apify z warunkiem wyzwalającym oraz podgląd zdjęć w tej samej karcie — **zostały dopisane na etapie planowania**; ta faza jedynie potwierdza ich obecność i spójność z tym, co slice faktycznie zbudował. Status S-02 prowadzi `/10x-implement`, nie ta faza.

### Success Criteria:

#### Automated Verification:

- `npm run lint`, `npx astro check` i `npm run build` przechodzą
- README nie twierdzi już, że migracje nie są potrzebne: `grep -n 'No database tables or migrations' README.md` nic nie zwraca
- `@CLAUDE.md` nie trzyma już `supabase/migrations/` w sekcji forward-looking: `grep -n 'supabase/migrations/' CLAUDE.md` trafia poza tę sekcję
- Skrypt inspekcyjny jest wywoływalny z `@package.json`: `npm run otodom:inspect -- --help` lub uruchomienie bez argumentu kończy się czytelnym komunikatem o użyciu
- `npm run smoke` przechodzi

#### Manual Verification:

- `context/foundation/ingestion/otodom_fetching.md` opisuje `ad.adCategory` i ostrzega przed `ad.category`, a log weryfikacji nosi datę 2026-09-22
- PRD nie wymienia już prezentacji wartości nieznanych jako pytania otwartego
- Sekcja „Parked" roadmapy wymienia fallback Apify i podgląd zdjęć w tej samej karcie
- PRD rozstrzyga, że tekst ogłoszenia jest przechowywany tak, jak go napisano, a pola kontaktowe nie trafiają do bazy

**Implementation Note**: Ostatnia faza zmiany. Po niej zmiana nadaje się do `/git-ship` lub `/git-land` — wybór należy do użytkownika i agent go nie podejmuje.

---

## Testing Strategy

### Unit Tests:

Brak — projekt nie ma runnera testów jednostkowych i ten slice go nie wprowadza. Rolę sprawdzenia mappera pełni `scripts/otodom-inspect.mjs` uruchamiany ręcznie przeciwko żywym ogłoszeniom trzech typów.

### Integration Tests:

`scripts/smoke.mjs` pokrywa kontrakt HTTP nowej trasy: brak sesji, puste pole, obcy host, adres nie będący ofertą oraz ochronę `/offers/<id>`. Żaden krok nie sięga do otodom.pl, więc job `smoke` w CI pozostaje niezależny od zewnętrznego portalu i od reputacji IP runnera GitHuba.

### Manual Testing Steps:

1. `npx supabase start` (lub `npx supabase db reset`), `npm run dev`, zalogowanie kontem `sigaretif1@vetpad.local`.
2. Wklejenie URL-a żywego ogłoszenia sprzedaży mieszkania → karta z pełną treścią i galerią.
3. Sprawdzenie w Studio, że wiersz nie zawiera wartości z `contactDetails`/`owner`/`agency`, a `raw` tylko klucze z białej listy.
4. Wklejenie URL-a ogłoszenia wynajmu → komunikat o wynajmie, brak nowego wiersza.
5. Wklejenie URL-a ogłoszenia domu → komunikat o rodzaju nieruchomości, brak nowego wiersza.
6. Wklejenie tego samego URL-a z doklejonym `?utm_source=test` → brak duplikatu, przekierowanie na istniejącą kartę z banerem.
7. Wklejenie adresu z olx.pl i adresu niebędącego URL-em → dwa różne komunikaty.
8. Znalezienie ogłoszenia bez podanego czynszu lub z `rent: "0"` (`npm run otodom:inspect`) i sprawdzenie, że karta czyta „nie podano w ogłoszeniu".
9. Wylogowanie i wejście na `/offers/<id>` → przekierowanie na `/auth/signin`.

## Migration Notes

Pierwsza migracja w historii repozytorium. Powstaje wyłącznie przez `npx supabase migration new create_offers`, nigdy ręcznie. W projekcie hostowanym trafia poleceniem `supabase db push`, które **nie** uruchamia seeda — a `supabase db reset --linked` uruchomiłby go i wyczyścił bazę produkcyjną, więc nigdy nie jest tu właściwą komendą. Migracja nie wymaga żadnego `grant`: Supabase nadaje je nowym tabelom automatycznie, co jest dokładnie powodem, dla którego polityki RLS muszą powstać w tym samym pliku. **Kolejność wdrożenia:** migrację na projekt hostowany stosuje człowiek (`supabase db push`; `context/foundation/deployment-runbook.md` → „What only a human does") **przed** deployem Workera, który zawiera `/api/offers` — odwrotna kolejność daje na produkcji komunikat „Nie udało się zapisać oferty" przy każdym wklejeniu. Agent nie wykonuje `db push`; przed deployem prosi o to użytkownika i czeka na potwierdzenie. Wycofanie zmiany oznacza `drop table public.offers`, co niszczy zapisane oferty — na etapie MVP akceptowalne, bo przed S-05 nie ma jeszcze notatek do stracenia.

## References

- Wymagania produktowe: `context/foundation/prd.md` — US-01, FR-004, FR-005, FR-007, Success Criteria → Guardrails, Non-Functional Requirements
- Pozycja w roadmapie: `context/foundation/roadmap.md:98-110` — S-02, north star, wraz z ryzykiem slice'u
- Ścieżka pobrania pojedynczej oferty: `context/foundation/ingestion/otodom_fetching.md:284-384` — §7.1, pułapki `rent` i `localizedValue`
- Weryfikacja egressu Cloudflare: `context/foundation/ingestion/otodom_fetching.md:539-560`
- Granice robots.txt i danych osobowych: `context/foundation/ingestion/otodom_fetching.md:17-52` — §1
- Etykieta żądań: `context/foundation/ingestion/otodom_fetching.md:579-594` — §10
- Wzorzec trasy formularzowej: `src/pages/api/auth/signin.ts:5-19`
- Wzorzec wyspy formularzowej: `src/pages/auth/signin.astro:5-14`, `src/components/auth/SignInForm.tsx:12-43`
- Wzorzec rozszerzania smoke: `scripts/smoke.mjs:54-77`
- Reguły RLS, zero-config i runtime'u Workera: `CLAUDE.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Pierwsza migracja — tabela `offers` z RLS

#### Automated

- [x] 1.1 Migracja powstała poleceniem CLI i stosuje się czysto: `npx supabase db reset` kończy się bez błędu — 96509c9
- [x] 1.2 Tabela istnieje z RLS: zapytanie o `relrowsecurity` dla `offers` zwraca `t` — 96509c9
- [x] 1.3 Istnieją dokładnie cztery polityki, wszystkie dla `authenticated`, żadna nie wymienia `anon` — 96509c9
- [x] 1.4 Unikalność oferty jest wymuszona: powtórny `insert` z tym samym `otodom_id` kończy się błędem `duplicate key value violates unique constraint` — 96509c9
- [x] 1.5 `npm run lint`, `npx astro sync`, `npx astro check` i `npm run build` przechodzą — 96509c9
- [x] 1.6 `npm run smoke` przechodzi bez zmian w skrypcie — 96509c9

#### Manual

- [x] 1.7 W Supabase Studio tabela `offers` jest widoczna z włączonym RLS i czterema politykami — 96509c9
- [x] 1.8 Zapytanie o `offers` kluczem publishable bez sesji zwraca pustą tablicę i HTTP 200 — 96509c9

### Phase 2: Moduł ingestii i skrypt inspekcyjny

#### Automated

- [x] 2.1 `npm run lint`, `npx astro check` i `npm run build` przechodzą — 19d2e68
- [x] 2.2 W repo nie ma zależności parsującej HTML — 19d2e68
- [x] 2.3 Nie dodano biblioteki walidacyjnej — 19d2e68
- [x] 2.4 `map.ts` i `fetch.ts` nie mają importów runtime'owych — wyłącznie `import type` — 19d2e68
- [x] 2.5 Pola `owner`/`agency`/`contactDetails` nie występują w `src/lib/otodom/` — `raw` z białej listy — 19d2e68
- [x] 2.6 `node scripts/otodom-inspect.mjs <url>` kończy się kodem 0 i drukuje wszystkie trzy sekcje — 19d2e68

#### Manual

- [x] 2.7 Oferta sprzedaży mieszkania: bramka przechodzi, liczby i enumy zmapowane poprawnie — 19d2e68
- [x] 2.8 Oferta wynajmu: bramka odrzuca z powodem `not_for_sale` — 19d2e68
- [x] 2.9 Oferta domu: bramka odrzuca z powodem `not_a_flat` — 19d2e68
- [x] 2.10 Oferta bez czynszu lub z `rent: "0"`: mapper zwraca `null`, nie `0` — 19d2e68
- [x] 2.11 Wynik mappera (kolumny i `raw`) nie zawiera wartości z `contactDetails`/`owner`/`agency` — 19d2e68

### Phase 3: Ścieżka zapisu — trasa API, formularz i smoke

#### Automated

- [x] 3.1 `npm run lint`, `npx astro check` i `npm run build` przechodzą — e7f29bb
- [x] 3.2 `npm run smoke` przechodzi z nowymi krokami, bez zmian w workflow CI — e7f29bb
- [x] 3.3 Trasa nie zwraca JSON-a ani ręcznie budowanego `Response` — e7f29bb
- [x] 3.4 Wyspa formularza nie używa `fetch()` — e7f29bb
- [x] 3.5 Limit czasu jest ustawiony po stronie serwera przez `AbortSignal.timeout` — e7f29bb

#### Manual

- [x] 3.6 Wklejenie żywego ogłoszenia sprzedaży mieszkania kończy się przekierowaniem na `/offers/<uuid>` i wierszem w bazie z `created_by` — e7f29bb
- [x] 3.7 Wiersz nie zawiera wartości z `contactDetails`/`owner`/`agency`, a `raw` tylko klucze z białej listy — e7f29bb
- [x] 3.8 Ogłoszenie wynajmu daje komunikat o wynajmie i nie tworzy wiersza — e7f29bb
- [x] 3.9 Ten sam URL z parametrami śledzącymi lub bez prefiksu `/pl` nie tworzy duplikatu i kieruje na `/offers/<id>?duplicate=1` — e7f29bb
- [x] 3.10 Podczas pobierania przycisk pokazuje „Pobieram ogłoszenie…" i jest nieaktywny — e7f29bb

### Phase 4: Karta oferty

#### Automated

- [x] 4.1 `npm run lint`, `npx astro check` i `npm run build` przechodzą
- [x] 4.2 Opis nie jest wstrzykiwany jako HTML — brak `set:html`
- [x] 4.3 Karta nie jest wyspą React — brak dyrektywy `client:`
- [x] 4.4 `npm run smoke` przechodzi

#### Manual

- [x] 4.5 Karta pokazuje komplet parametrów, a wartości enumeryczne są po polsku
- [x] 4.6 Oferta bez czynszu czyta „nie podano w ogłoszeniu", nigdzie nie pojawia się „0 zł"
- [x] 4.7 Opis czyta się jako tekst z akapitami, bez znaczników HTML
- [x] 4.8 Miniatury się ładują, a kliknięcie otwiera duże zdjęcie w nowej karcie
- [x] 4.9 `/offers/<id>?duplicate=1` pokazuje baner o wcześniejszym zapisie
- [x] 4.10 Wylogowany użytkownik na `/offers/<id>` trafia na `/auth/signin`

### Phase 5: Dokumentacja i domknięcie

#### Automated

- [ ] 5.1 `npm run lint`, `npx astro check` i `npm run build` przechodzą
- [ ] 5.2 README nie twierdzi już, że migracje nie są potrzebne
- [ ] 5.3 `CLAUDE.md` nie trzyma `supabase/migrations/` w sekcji forward-looking
- [ ] 5.4 Skrypt inspekcyjny jest wywoływalny z `package.json` i bez argumentu drukuje sposób użycia
- [ ] 5.5 `npm run smoke` przechodzi

#### Manual

- [ ] 5.6 `otodom_fetching.md` opisuje `ad.adCategory`, ostrzega przed `ad.category`, a log weryfikacji nosi datę 2026-09-22
- [ ] 5.7 PRD nie wymienia prezentacji wartości nieznanych jako pytania otwartego
- [ ] 5.8 Sekcja „Parked" roadmapy wymienia fallback Apify i podgląd zdjęć w tej samej karcie
- [ ] 5.9 PRD rozstrzyga przechowywanie tekstu ogłoszenia wraz z wpisanym kontaktem
