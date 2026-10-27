---
date: 2026-10-26T09:57:42+01:00
researcher: Claude (Opus 5.5) dla Wiktor Ortel
git_commit: b944bce
branch: master
repository: Vetpad (10xDevs4)
topic: "FR-016 — czasy dojazdu: wbudowanie w kod i fakty do Open Questions 2–4"
tags: [research, commute, google-maps-platform, routes-api, geocoding, rls, freshness, zero-config]
status: partial
last_updated: 2026-10-26
last_updated_by: Claude (Opus 5.5)
---

# Research: FR-016 — czasy dojazdu z oferty do punktów zespołu

**Date**: 2026-10-26T09:57:42+01:00
**Git Commit**: b944bce (drzewo robocze: niezacommitowane zmiany w `context/foundation/prd.md` i `shape-notes.md`, które wprowadzają FR-016; numery linii PRD odnoszą się do tej wersji roboczej)
**Branch**: master

Do Google nie wysłano żadnego żądania API. Czytane były tylko strony dokumentacji i warunków (developers.google.com, cloud.google.com) oraz rejestr npm.

## Research Question

Jak wbudować FR-016 (`context/foundation/prd.md:118`) w istniejący kod i jakie fakty są potrzebne do rozstrzygnięcia Open Questions 2–4 (`prd.md:185-187`). Zebrane są opcje z dowodami; żadna decyzja nie zapada. Pełne brzmienie zadania, w 9 punktach, jest w wiadomości użytkownika z 2026-10-26.

## Summary

1. **Integracja serwerowa jest wzorcem bez niespodzianek.** Klucz `access: "secret"` powtarza schemat `APIFY_TOKEN`: schema, `.env`, `.dev.vars`, `.env.example` i sekret Cloudflare, czyli 5 miejsc, bez CI. Build go nie potrzebuje.
   - **Klucz przeglądarkowy działa inaczej.** Pole `context: "client", access: "public"` Astro **wkleja do bundla w czasie buildu** (`node_modules/astro/dist/env/vite-plugin-env.js:134-138`). Ani sekret Workers, ani `vars` w `wrangler.jsonc` go nie dostarczą — wartość musi być w środowisku buildu.
   - Wyjątek od „kluczy tylko po stronie serwera” trzeba zapisać w czterech miejscach: w `CLAUDE.md:17`, `:25` i `:56`, w `README.md:130` oraz w kryteriach recenzenta (`packages/code-reviewer/src/prompts/system.ts:29,62,132`).
   - Zmiana promptu recenzenta pociąga za sobą płatny eval, który uruchamia użytkownik (`CLAUDE.md:60`).
2. **Punkty zespołu mają być tabelą o kształcie `offers`.** Wzorzec to cztery polityki dla `authenticated`, bez `anon` (`supabase/migrations/20260922202756_create_offers.sql:84-113`).
   - Tabela **nie może** ruszać `criteria_revision`. Ten licznik jest jeden, globalny, i jego bump unieważnia każdy audyt na karcie i na tablicy (`src/lib/audit/freshness.ts:63-66,81-82`, `src/pages/dashboard.astro:52,61`), a audyt punktów nie czyta.
   - Audyt dziś nie ma drogi do punktów: czyta jawne kolumny trzech tabel (`src/lib/criteria.ts:385-422`) i nie robi `select("*")`.
   - Moduł punktów musi być osobny, bo `audits.ts` importuje `@/lib/criteria` (`src/pages/api/audits.ts:15`). Wtedy `auditNoNotesConfig` da się rozszerzyć o ten moduł (`eslint.config.js:121-137`).
3. **[OQ 2] Warunki Google wprost pozwalają przechowywać tylko dwie rzeczy.** Konto rozliczeniowe w Polsce podlega warunkom EEA. Te pozwalają trzymać:
   - `place_id` bezterminowo (EEA SST A.3),
   - lat/lng z Routes maks. 30 kolejnych dni (EEA SST §20.2).

   **Czasy, dystanse i polilinie nie są na liście tego, co wolno cache'ować**, a ToS zabrania cache'owania „except as expressly permitted” (EEA ToS §3.3.2(b)). Na pierwszy rzut oka zapis wyniku „na zawsze” koliduje z warunkami. To interpretacja prawna, nie zdanie Google.
   - Klauzula „no use with non-Google maps” w EEA nie istnieje.
   - Zakazany jest opis i kroki trasy „With any Map” (§20.1).

4. **[OQ 3] Brak dowodu, że otodom daje współrzędne przybliżone.** Żaden dokument ani kod nie zna pola dokładności lub promienia dla otodom; `radius`/`show_detailed` ma tylko olx (`context/foundation/ingestion/olx_fetching.md:364`).
   - Przybliżenie twierdzą PRD (`prd.md:186`) i decyzja z archiwum map-link, ale to nie jest weryfikacja na payloadzie.
   - Rozstrzygnięcie wymaga ręcznego `npm run otodom:inspect` przez użytkownika na ogłoszeniu z ukrytym adresem. To luka tego badania.
5. **[OQ 4] Mechanizm `auditFreshness` przenosi się wprost**, jako osobny, wersjonowany odcisk punktów i lokalizacji zapisany przy wyniku.
   - Obecny `listingFingerprint` **nie zawiera** `latitude`/`longitude` (`src/lib/audit/input.ts:45-71,333-351`).
   - Re-fetch czyta z powrotem tylko `AUDIT_OFFER_COLUMNS` (`src/pages/api/offer-refetch.ts:36,38,217`). Dojazdy potrzebują więc własnej listy kolumn lokalizacji.
6. **Route Matrix nie zwraca polilinii**, więc mapa wymaga `computeRoutes`: jednego wywołania na punkt i tryb.
   - TRANSIT i DRIVE bez `TRAFFIC_AWARE*` to SKU Essentials: 10 000 darmowych zdarzeń miesięcznie, potem $5/1000.
   - `TRAFFIC_AWARE` przenosi żądanie do Pro.

**Status `partial`.** Brakuje trzech rzeczy:

- weryfikacji dokładności współrzędnych otodom (wymaga żywego zapytania, które uruchamia użytkownik),
- sprawdzenia, czy Maps JS akceptuje `oklch()` jako `strokeColor`,
- potwierdzenia na stronach Cloudflare, jak zmienne buildu Workers Builds dostarczają klucz publiczny.

Interpretacja „czy zapisany czas to caching” zostaje pytaniem prawnym.

## Detailed Findings

### 1. Zero-config dla dwóch kluczy Google

**Wzorzec dzisiejszych integracji, cztery miejsca:**

- **Schema:** `astro.config.mjs:21-22`, `envField.string({ context: "server", access: "secret", optional: true })`. Żadne pole nie używa dziś `context: "client"`.
- **Fabryka zwracająca `null`:**
  - `createAuditProvider()` w `src/lib/audit/provider.ts:111-112`,
  - `createApifyLeg()` w `src/lib/otodom/apify.ts:54-56`.
  - Obie budują klienta per żądanie.
- **Null-check w miejscu wywołania:**
  - `src/pages/api/audits.ts:162-163`, po darmowych sprawdzeniach oferty i przed kryteriami,
  - `src/pages/api/offers.ts:106-108`,
  - `src/pages/api/offer-refetch.ts:163-165`.
- **ConfigStatus:**
  - wpisy w `src/lib/config-status.ts:19-31` (import tylko z `astro:env/server`, `:1`),
  - `isAuditAvailable()` (`:42-44`) i `isApifyAvailable()` (`:54-56`),
  - banner w `src/layouts/Layout.astro:23-35`.

**Klucz serwerowy (Routes, Geocoding).** Kopiuje Apify 1:1:

- moduł np. `src/lib/commute/google.ts` jako jedyny czyta klucz,
- `isCommuteAvailable()` w `config-status.ts`,
- blokada importu w widokach na wzór `apifyServerOnlyConfig` (`eslint.config.js:208-224`).

Pułapka: przy nakładających się `files` w flat config `no-restricted-imports` się nadpisuje, więc wzorce trzeba scalić w jeden blok (`eslint.config.js:117-120`).

**Miejsca klucza serwerowego:** schema, `.env`, `.dev.vars`, `.env.example`, sekret Cloudflare, czyli 5. CI go nie potrzebuje, bo sekret jest czytany w runtime (`vite-plugin-env.js:142-149`, `_internalGetSecret`). Włączenie go do CI jest decyzją użytkownika, jak w przypadku Apify (`CLAUDE.md:25`).

**Klucz przeglądarkowy (Maps JS API), dwie drogi:**

- **(a) `context: "client", access: "public"`.**
  - Astro emituje `export const KEY = <wartość>` w module klienckim w czasie buildu (`vite-plugin-env.js:113-114,134-138`). Wartość pochodzi z env loadera przy `buildStart` (`:25-35`, `env-loader.js:39-46`).
  - Miejsca: schema, `.env`, `.env.example` oraz zmienna **buildu** w Cloudflare Workers Builds (niezweryfikowane na dokumentacji Cloudflare). Opcjonalnie sekret GitHub i krok buildu w `ci.yml`, jeśli CI ma budować z mapą.
  - `.dev.vars` jest tu bez znaczenia.
  - Zmiana klucza wymaga przebudowania.
  - Brak wartości daje `undefined`: wyspa renderuje stan zdegradowany i nie wstrzykuje skryptu. To wniosek z kodu pluginu, nietestowany.
- **(b) `server/secret` przekazany wyspie jako prop.**
  - Klucz trafia do HTML, ale jest czytany w runtime: sekret Workers albo `vars`, bez przebudowy.
  - Jeszcze mocniej łamie `CLAUDE.md:17` („never client-side”).
- **Testy w obu drogach:** `tests/setup.ts:7-13` mockuje tylko `astro:env/server`. Droga (a) wymaga `vi.mock("astro:env/client")` i strażnika w `tests/setup.test.ts`, bo `vitest.config.ts:9-12` przepuszcza plugin env i lokalny `.env` przeciekłby do testów.

**Gdzie zapisać wyjątek:**

- `CLAUDE.md:11`: wzorzec „czterech miejsc” bez wariantu wyspy.
- `CLAUDE.md:17`: sekrety tylko z `astro:env/server`, „never client-side”.
- `CLAUDE.md:25`: listy miejsc kluczy i „server-only”.
- `CLAUDE.md:53-54`: „Nothing reaches … on its own”. Prawdopodobnie potrzebny trzeci punkt, dla Google: Routes, Geocoding i ładowania mapy, które jest rozliczane jako Dynamic Maps.
- `CLAUDE.md:56`: „The three keys never cross”.
- `README.md:130,234,259`.
- `system.ts`:
  - `:29` (twardy błąd: sekret osiągalny z wyspy — klucz publiczny by go uruchomił),
  - `:62`,
  - `:132-133`.
- `CLAUDE.md:156` każe zmienić kryteria recenzenta w tej samej zmianie.

**Klucze po stronie Google:**

- **Klucz serwerowy:** Google zaleca ograniczenie IP, ale przyznaje, że jest ono „impractical … in cloud environments that rely on dynamic IP addresses” (developers.google.com/maps/api-security-best-practices, 2026-10-23). Na Workers realnie zostaje ograniczenie API plus dzienne kwoty.
- **Klucz przeglądarkowy:** „Apply both website and API restrictions”, czyli referrer i ograniczenie do Maps JavaScript API.
- **Kwoty dzienne** są twardym limitem (docs.cloud.google.com/apis/docs/capping-api-usage, 2026-10-22), z opóźnieniem egzekwowania. Budżet tylko alarmuje.

### 2. Tabela punktów zespołu

**Migracja i RLS:**

- Wzorzec to `20260922202756_create_offers.sql`: RLS `:84`, select `:87-91`, insert `:94-98` (`created_by = auth.uid()`), update `:101-106`, delete `:109-113`, wszystko `to authenticated`.
- Punkty nie są ograniczone autorstwem (`prd.md:118,152`). Kolumna autora, jeśli jest, służy tylko do pochodzenia i wtedy deklaruje `on delete set null` (lekcja w `context/foundation/lessons.md`, `team_criteria.updated_by`: `20260927144141_create_team_criteria.sql:18-22,36`).

**`criteria_revision`:**

- Bumpują go wyłącznie 4 triggery w `20260927144141_create_team_criteria.sql:238-263`, przez `bump_criteria_revision()` (`:221-236`).
- Nowa tabela go nie ruszy, jeśli nie dodamy triggera.
- Ruszyć go nie powinna. Licznik jest jeden dla wszystkich ofert (`src/lib/criteria.ts:327-351`). Bump oznaczyłby każdy audyt jako `stale` (`freshness.ts:81-82`), na karcie (`src/pages/offers/[id].astro:78,93-96`) i na tablicy (`dashboard.astro:52,61`), mimo że audyt punktów nie czyta (`prd.md:129`).

**Odczyt:**

- Wzorzec `loadCriteria` (`src/lib/criteria.ts:214-269`): nieudany odczyt daje `{ state: "error" }` dla braku klienta, błędu, braku wiersza i wyjątku.
- Na `/criteria` każda sekcja ma własny odczyt w `Promise.all` (`src/pages/criteria.astro:16-20`) i własny atrybut stanu, tak jak sekcja ustawień audytu (`src/components/criteria/CriteriaView.astro:224-293`).
- Punkty potrzebują:
  - `data-commute-points-state`,
  - nowej wartości `form=points` w whiteliście (`criteria.astro:27-29`, `CriteriaView.astro:47`),
  - route'u formularza z ukrytym `intent` (`src/pages/api/criteria.ts:55-58` jako wzorzec),
  - usuwania przez `ConfirmDialog.tsx`, bo usunięcie jest nieodwracalne (`CLAUDE.md`, `### UI`). Istniejące `window.confirm` w `RequirementsEditor.tsx:86` poprzedzają tę regułę.

**Audyt nie przeczyta adresów:**

- `AUDIT_OFFER_COLUMNS` (`src/lib/audit/input.ts:45-71`) to tylko kolumny `offers`, i to bez `latitude`/`longitude`.
- `buildAuditInput` (`:310-331`) bierze ofertę oraz limity i treści wymagań.
- `loadAuditCriteria` wybiera jawne kolumny: `criteria_revision.revision`, `team_criteria` (`LIMIT_COLUMNS`, `:176`), `member_requirements.body` (`:395-399`).
- Jedyny `select("*")` w `src/` i `scripts/` to `src/pages/offers/[id].astro:33` (karta, nie audyt).
- Ograniczenie: reguła ESLint blokuje import, nie bezpośrednie `supabase.from("commute_points")` w `src/lib/audit/`.

**Kiedy geokodować punkty — opcje:**

- **(A) Przy zapisie w `/criteria`.** Zapisujemy `place_id`, bezterminowo dozwolony (EEA SST A.3). Pokazujemy członkowi, co Google zrozumiał: `location_type`, `partial_match` w v3 (developers.google.com/maps/documentation/geocoding/requests-geocoding, 2026-10-23).
  - Wada: zapis formularza staje się płatnym wywołaniem i wymaga klucza. Bez klucza punkt zapisuje się bez geokodu.
  - lat/lng z geokodera można trzymać 30 dni (EEA SST §6.2.1) albo „indefinitely … solely … End User facing … must not be used across multiple End Users” (§6.2.2). Wspólny punkt zespołu do tego ostatniego nie pasuje (interpretacja).
- **(B) Przy liczeniu.** Albo osobne geokodowanie, albo adres jako `waypoint.address` w Routes, który „internally geocodes the string” (developers.google.com/maps/documentation/routes/specify_location, 2026-10-23).
  - Wada: z waypointu wracają tylko `partialMatch`, `placeId` i `type`, bez granularności. Wynik geokodu może się też różnić od Geocoding API.
  - Czy wewnętrzne geokodowanie jest rozliczane osobno — niezweryfikowane.
- **(C) Hybryda:** `place_id` z (A) jako `waypoint.placeId` przy liczeniu. Google zaleca place ID.

### 3. Zapis wyników, płatny route, wyspa, archiwum i usunięcie

**Kolejność w `src/pages/api/audits.ts`, do skopiowania:**

- sesja → redirect (`:296-301`, jedyny redirect),
- osiadła sesja przed streamem i strażnik ciasteczka `responseLeft` (`:308-321`),
- `offer_id` z `formData` (`:322-327`),
- `isUuid`, odczyt oferty, `offer_not_found`, `offer_archived` (`:135-160`),
- klucz dopiero po sprawdzeniach oferty (`:162-163`), więc nieznana oferta dostaje tę samą odpowiedź z kluczem i bez,
- claim (`:187-191`),
- log `started` przed płatnym wywołaniem (`:200`),
- wywołanie bez retry,
- zakończenie próby na każdym wyjściu (`:210-254`),
- `waitUntil` (`:375`).

**Strumień** NDJSON: linie `stage` / `alive` / `done` / `failed` (`:28-34`), zawsze 200 (`:378`).

**Elementy specyficzne dla audytu:** odczyt kryteriów i ustawień, prompt i grounding, heartbeat, terminy 165/175/180 s (`src/lib/audit/failure.ts:12-30`) oraz retry zapisu do DB (`store.ts:172-225`).

**Tabela wyników — opcje:**

- **(a) Kopia `offer_audits`.**
  - Jeden wiersz na ofertę, `offer_id` jako PK `on delete cascade` (`20261007073300_create_offer_audits.sql:33`).
  - Grupa próby `run_*`, a wynik jako całość albo brak (`:58-65`).
  - Triggery `security definer` podpisują daty i osoby (`:84-252`).
  - Wiersz jest blokadą, `VP001` (`:137-142`). Brak polityki delete.
  - Blokada audytu chroni przed podwójną płatnością i przed nadpisaniem nowszej próby, a 175 s obsługuje martwe żądanie. Wywołania Google trwają sekundy, ale podwójne kliknięcie nadal płaci 2×N×2.
- **(b) Prosty upsert** z politykami per operacja, last-writer-wins. Podwójne naciśnięcie płaci dwa razy; twardym limitem pozostają kwoty Google (`prd.md:129`).

**Pola do zapisu, zależne od OQ 2:**

- czas i dystans na punkt i tryb,
- `encodedPolyline`,
- tryb,
- `departureTime` użyty dla TRANSIT,
- data i osoba,
- wejście: odcisk punktów, odcisk lokalizacji oferty, ewentualnie `place_id` punktów.

**Wyspa:**

- `src/lib/audit/stream.ts`: `classifyAuditAnswer` `:37-45`, `followAuditStream` `:93-122` jako czyste funkcje.
- `AuditRunner.tsx`: wyniki `:85-104`, `fetch` z `AbortController` `:132-170`, `preview` dla `/dev` `:30,66-68`.
- `OfferAudit.astro`:
  - atrybuty `data-*` (`:190-196`),
  - nieudany odczyt → brak przycisku (`:208-212`),
  - zarchiwizowana oferta → brak runnera, wynik zostaje (`:46-52,250-271`).
- Sekcja dojazdów byłaby kolejnym rodzeństwem w kolumnie zespołu (`src/components/offers/OfferView.astro:111-129`), z własnym odczytem w `Promise.all` (`[id].astro:71-78`).

**Archiwum (FR-014).** FR-016 milczy o archiwum. Opcje:

- (a) jak audyt: odmowa liczenia (płatne) i wynik czytelny,
- (b) dozwolone, jak notatki i re-fetch,
- (c) ukrycie sekcji.

Każda opcja musi zostawić wynik nietknięty przy archiwizacji i przywróceniu (`prd.md:111`). To pytanie dla PRD, nie dla planu.

**Usunięcie (FR-015).** FK `on delete cascade` kopiuje zachowanie `offer_audits`. Wynik musi zniknąć z ofertą, bo usunięta oferta „leaves no trace” (`prd.md:189`).

**Logi.** `src/lib/log.ts:9-69` to whitelista 60 kluczy, a nieznane klucze są odrzucane (`:84-91`). Nowe pola, np. `points_count`, `routes_ok`, `google_status`, trzeba do niej dopisać. Nigdy nie logujemy:

- nazw i adresów punktów ani ich współrzędnych (`prd.md:129`),
- lat/lng i etykiety oferty,
- ciał żądań i odpowiedzi Google,
- polilinii.

### 4. Google Routes API v2 i Geocoding

Źródła: developers.google.com/maps/documentation/routes/… — `compute_route_matrix` (2026-10-23), `reference/rest/v2/TopLevel/computeRouteMatrix` (2026-09-04), `reference/rest/v2/TopLevel/computeRoutes` (2026-10-08), `transit-route` (2026-10-23), `choose_fields` (2026-10-23), `usage-and-billing` (2026-10-23), `billing-and-pricing/sku-details` i `/pricing` (2026-10-23).

**computeRouteMatrix:**

- Limity elementów: 625 poza TRANSIT, **100 dla TRANSIT**, 100 dla `TRAFFIC_AWARE_OPTIMAL`, 50 waypointów jako adres lub place ID, 3000 elementów/min.
- 1 oferta × 5–10 punktów mieści się z zapasem.
- `departureTime` w przeszłości jest dozwolony tylko dla TRANSIT; bez niego obowiązuje czas żądania. `arrivalTime` działa tylko w TRANSIT, wymiennie z `departureTime`.
- Odpowiedź REST to tablica JSON, elementy mogą przyjść poza kolejnością (`originIndex`/`destinationIndex`). Strumień działa tylko w gRPC.
- **Brak pola polyline.**

**computeRoutes:**

- `routes.polyline.encodedPolyline`; `polylineQuality` `OVERVIEW` (domyślnie) albo `HIGH_QUALITY`.
- TRANSIT: brak waypointów pośrednich, tylko `transitPreferences`. Okno czasowe: „up to 7 days in the past or 100 days in the future”.
- `routingPreference` „can be set only for DRIVE or TWO_WHEELER. Otherwise the request fails.”
- Okno 7/100 dni dla matrixa: niezweryfikowane.

**Field mask** jest obowiązkowa w obu metodach: „There is no default list of returned fields”, nagłówek `X-Goog-FieldMask`. W masce matrixa trzeba uwzględnić `status`, bo inaczej „all messages will appear to be OK”.

- Przykład dla nas: `routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline`.

**SKU.** Jedno SKU na żądanie.

| Funkcja                                                                                                        | SKU                  |
| -------------------------------------------------------------------------------------------------------------- | -------------------- |
| TRANSIT (nie jest wymieniony jako wyzwalacz)                                                                   | Essentials           |
| DRIVE bez `routingPreference` (domyślne `TRAFFIC_UNAWARE`)                                                     | Essentials           |
| `TRAFFIC_AWARE` / `TRAFFIC_AWARE_OPTIMAL`, 11–25 waypointów, `optimizeWaypointOrder`, modyfikatory lokalizacji | Pro                  |
| Opłaty drogowe, ruch na polilinii, dwa koła                                                                    | Enterprise           |
| Zwykła polilinia                                                                                               | nie jest wyzwalaczem |

| SKU                                          | Darmowe zdarzenia / mies. | Pierwszy próg za 1000 |
| -------------------------------------------- | ------------------------- | --------------------- |
| Compute Routes Essentials                    | 10 000                    | $5,00                 |
| Compute Routes Pro                           | 5 000                     | $10,00                |
| Compute Route Matrix Essentials (za element) | 10 000                    | $5,00                 |
| Geocoding                                    | 10 000                    | $5,00                 |
| Dynamic Maps (ładowanie mapy JS)             | 10 000                    | $7,00                 |

Cennik EEA: niezweryfikowany, strona nie pokazuje osobnej listy.

**Wniosek konstrukcyjny (wynika z „brak polyline w matrixie”).** Skoro mapa rysuje trasę każdego punktu, `computeRoutes` na punkt i tryb daje czas, dystans i polilinię naraz.

- Dla N punktów to 2N żądań Essentials na naciśnięcie, plus geokod(y) i jedno ładowanie mapy na każde otwarcie karty z mapą.
- Matrix byłby zbędny, chyba że mapa pokazuje tylko jeden tryb.
- Czy mapa przełącza polilinie razem z trybem tabeli — do ustalenia w planie.

**Nowa decyzja produktowa, której PRD nie zawiera: czas odjazdu TRANSIT.** Bez `departureTime` wynik zależy od chwili naciśnięcia; w nocy komunikacja wygląda inaczej. To wejście, które trzeba wybrać, np. najbliższy dzień roboczy o 8:00, i zapisać przy wyniku.

**Geocoding:**

- v3: `GET …/maps/api/geocode/json?address=…&region=pl&language=pl`.
  - `geometry.location`, `location_type` (`ROOFTOP` / `RANGE_INTERPOLATED` / `GEOMETRIC_CENTER` / `APPROXIMATE`), `partial_match`, `place_id`.
- v4 jest GA (`geocode.googleapis.com/v4/geocode/address/{ADDRESS}`, geocoding-v4-migrate, 2026-10-23).
  - `granularity` zamiast `location_type`, **bez `partial_match`**, statusy HTTP zamiast pola `status`.
  - Czy v4 jest rozliczane tym samym SKU — niezweryfikowane.

### 5. [OQ 2] Warunki przechowywania i wyświetlania

**Które warunki obowiązują.** Globalny ToS (cloud.google.com/maps-platform/terms, „Last modified August 26, 2026”):

> „If Customer's billing account address is in the European Economic Area, the Google Maps Platform EEA Terms of Service … will govern”

Wyjątek dotyczy niezmienionych integracji sprzed 8.07.2025, a Vetpad do nich nie należy. Według EEA FAQ (developers.google.com/maps/comms/eea/faq) wersja EEA usuwa „No Use with Non-Google Maps”.

**EEA ToS** (cloud.google.com/terms/maps-platform/eea, „Last modified August 26, 2026”):

- §3.3.2(a): „Customer will not: (i) pre-fetch, index, store, reshare, or rehost Google Maps Content outside of the Services …”
- §3.3.2(b): „Customer will not cache Google Maps Content except as expressly permitted under the Maps Service Specific Terms.”

**EEA Service Specific Terms** (cloud.google.com/terms/maps-platform/eea/maps-service-terms; agent odczytał „Last modified June 10, 2026”; brzmienie §20, A.3 i definicji zweryfikowane ponownie 2026-10-26 surowym HTML-em):

- A.3: „Customer may cache (a) place_id from Places API, Directions API, Geolocation API and Routes API …”
- §20.1: „Customer may not use description or steps from the Routes API With any Map.”
- §20.2: „Customer may temporarily cache latitude and longitude values from the Routes API for up to 30 consecutive calendar days, after which Customer must delete the cached latitude and longitude values.”
- Geocoding §6.1: „Other than latitude, longitude, and place_id, Customer may not use Google Maps Content from the Geocoding API With any Map.” §6.2.1 pozwala na 30 dni lat/lng. §6.2.2 pozwala trzymać je bezterminowo tylko dla „specific End User”.
- A.2, atrybucja: treść Google musi być rozróżnialna. Na mapie Google atrybucja jest już widoczna. Tabela poza mapą wymaga „Google Maps” (logo albo tekst z `translate="no"`). Źródło: developers.google.com/maps/documentation/routes/policies (2026-10-23), który potwierdza też bezterminowe `place_id`.

**Co z tego wynika dla wyniku dojazdu (interpretacja, nie zdanie Google):**

| Element                            | Wolno przechowywać                                       | Źródło                             |
| ---------------------------------- | -------------------------------------------------------- | ---------------------------------- |
| `place_id` punktu lub oferty       | bezterminowo                                             | EEA SST A.3, Routes policies       |
| lat/lng z Routes i Geocoding       | maks. 30 kolejnych dni, potem usunąć                     | §20.2, §6.2.1                      |
| lat/lng z geokodera „per End User” | bezterminowo, ale nie współdzielone między użytkownikami | §6.2.2 — wspólny zespół nie pasuje |
| czas (`duration`), dystans         | brak zezwolenia na liście, więc ToS §3.3.2(b) zabrania   | brak klauzuli                      |
| `encodedPolyline`                  | to ciąg lat/lng, więc w najlepszym razie 30 dni          | interpretacja §20.2                |
| współrzędne oferty z otodom        | nie są treścią Google, warunki ich nie dotyczą           | —                                  |

**Zestawienie z NFR „nothing expires automatically” (`prd.md:132`) — opcje dla OQ 2:**

1. **Zapis z 30-dniowym wygaśnięciem.** Karta dostaje stan „wynik wygasł — policz ponownie”.
   - Za: najbliżej FR-016 („stores the result”) i najbliżej litery warunków dla polilinii.
   - Przeciw: łamie NFR `prd.md:132`, więc PRD musi zapisać wyjątek. Czas i dystans nadal nie mają zezwolenia nawet na 30 dni.
   - Usuwanie wymaga albo czegoś, co faktycznie kasuje dane (zaplanowane zadanie — Non-Goals `prd.md:161` tego zabraniają), albo odczytu, który traktuje starsze wyniki jako nieistniejące, choć wiersz zostaje.
   - To drugie rozwiązanie warunków nie spełnia: „must delete”.
2. **Brak zapisu treści Google.** Liczenie przy naciśnięciu i wynik pokazany tylko w tej sesji; zapisane zostają tylko `place_id` i wejścia.
   - Za: zgodne z warunkami.
   - Przeciw: zmienia FR-016 („stores the result”), a każde obejrzenie wyniku po przeładowaniu jest nowym płatnym naciśnięciem.
3. **Zapis bezterminowy.**
   - Za: zgodne z FR-016 i NFR.
   - Przeciw: na pierwszy rzut oka sprzeczne z ToS §3.3.2(b). Ryzyko leży po stronie właściciela konta rozliczeniowego.
   - Ta opcja osłabia zgodność z warunkami dostawcy. To nie wymóg PRD, ale wybór należy wyłącznie do użytkownika.
4. **Hybryda.** Bezterminowo `place_id` i wejścia, a czasy, dystanse i polilinie wg opcji 1 albo 2.

**Wyświetlanie.** W EEA tabela czasów obok mapy Google jest dozwolona. Zakaz dotyczy „description or steps” z Routes „With any Map” (§20.1), czyli np. `routes.description` i kroków komunikacji. Tabela nie powinna więc pokazywać opisu ani kroków trasy obok mapy. To samo zdanie stoi na stronie developers.google.com/maps/comms/eea/routes (2026-10-23).

### 6. [OQ 3] Punkt startowy trasy

**Fakty:**

- Kolumny `location_label`, `street_name`, `latitude numeric`, `longitude numeric` (`20260922202756_create_offers.sql:51-55`).
- Źródło: `ad.location.coordinates.{latitude,longitude}`. `coordinate()` zamienia wartości niebędące liczbą skończoną, `0` i wartości spoza zakresu na `null` (`src/lib/otodom/map.ts:182-188,301-302`).
- `raw.location` trzyma `coordinates` i `reverseGeocoding` (`map.ts:24-25,159`). Ścieżka Apify przepuszcza `["coordinates","reverseGeocoding","address"]` (`src/lib/otodom/apify-request.ts:52`), a wyniki są JSON-równe ścieżce bezpośredniej (`context/foundation/ingestion/otodom_apify.md:215-217`).
- **O dokładności dokumentacja otodom mówi tylko `location.coordinates | {latitude, longitude}`** (`context/foundation/ingestion/otodom_fetching.md:457`). Brak `mapDetails`, `radius` czy flagi „pokaż dokładny adres” w dokumentach i kodzie otodom. Takie pola istnieją tylko w olx (`olx_fetching.md:364`).
- Nawet gdyby otodom miał takie pole, nie przechodzi ono przez whitelisty (`map.ts:25`, `apify-request.ts:52`). Dodanie go zmienia `APIFY_PAGE_FUNCTION`, czyli kod przeglądany jak kod.
- Współrzędnych nie używa nic poza mapperem, typami i fixture'ami `/dev` (`src/pages/dev/_offer-fixtures.ts:93-94,141-142`).
- W `src/lib/map-link.ts:17-24` docstring opisuje etykietę + ulicę, ale **nie** uzasadnia pominięcia współrzędnych.
- Uzasadnienie jest w archiwum: „Współrzędne | Nieużywane | Punkt z otodom bywa przybliżony, a pinezka wyglądałaby jak dokładny adres.” (`context/archive/2026-10-09-location-map-link/plan-brief.md:28`; powtórzone w `plan.md:58-59`).
- Współrzędne zapisano z myślą o S-08 (`context/archive/2026-09-22-paste-listing-to-card/plan.md:52,184`).

**Opcje:**

| Opcja                                        | Za                                                                                                            | Przeciw                                                                                                                                                                                                                                   |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. Współrzędne otodom                        | brak geokodowania i opłaty; to nie treść Google, więc wolno je trzymać                                        | dokładność nieznana (luka); `null` przy wygasłym ogłoszeniu (`spike-apify.md:34-38`); poza `listingFingerprint` i poza `lostFacts` w re-fetchu (`src/lib/offer-refetch.ts:25-27`), więc re-fetch, który je zgubi, zapisze `null` po cichu |
| B. Geokod etykiety + ulicy (jak FR-008)      | zgodne z linkiem mapy; `location_type`/`partial_match` mówią, jak zgrubny jest punkt; `place_id` bezterminowo | płatne; lat/lng z geokodera maks. 30 dni; bez ulicy wynik zgrubny do dzielnicy                                                                                                                                                            |
| C. `waypoint.address` w Routes               | bez osobnego geokodu                                                                                          | brak informacji o jakości (tylko `partialMatch`); geokod może różnić się od Geocoding API; rozliczenie geokodu wewnątrz Routes niezweryfikowane                                                                                           |
| D. Hybryda: A, gdy są współrzędne, inaczej B | dowolna oferta ma start                                                                                       | dwa źródła; karta musi powiedzieć, z którego policzono                                                                                                                                                                                    |

Przy każdej opcji karta mówi „szacunek okolicy, nie budynku” (`prd.md:186`).

**Brakujący fakt.** Użytkownik może uruchomić `npm run otodom:inspect -- <url>` na ogłoszeniu z ukrytym numerem budynku. Celem jest sprawdzenie, czy `ad.location` zawiera pole dokładności i czy pinezka leży na budynku. Agent tego nie robi, bo to żywe zapytanie do portalu.

### 7. [OQ 4] Nieaktualność

**Jak liczy audyt:**

- `auditFreshness(stored, current)` (`src/lib/audit/freshness.ts:28-38,75-85`) zwraca:
  - `stale`, gdy różni się którakolwiek ze stron; przyczyny `listing`/`criteria`,
  - `fresh` tylko wtedy, gdy obie strony porównały się jako równe,
  - `unknown`, gdy strona jest `null` albo wersja odcisku się nie zgadza (`:43-61`).
- `listingFingerprint` to `"v1:"` + SHA-256 kolumn `AUDIT_OFFER_COLUMNS` w kolejności (`input.ts:333-351`).
- Oba odciski są zapisywane przy wyniku (`store.ts:210-211`), a świeżość liczy się przy każdym odczycie. Niczego się nie zapisuje (`CLAUDE.md`, `freshness.ts`).

**Przeniesienie na dojazdy:**

- **Strona punktów: wersjonowany odcisk** posortowanych `(id, adres[, nazwa])` punktów użytych do liczenia, zapisany z wynikiem i porównywany z bieżącym odczytem punktów. Nie wymaga triggera, łapie dodanie, edycję i usunięcie.
  - Alternatywa: licznik `points_revision` z triggerem `security definer` na wzór `create_team_criteria.sql:206-263`. Każda zmiana, także zmiana nazwy, unieważnia wszystkie wyniki.
  - **Nigdy `criteria_revision`** (sekcja 2).
  - Czy sama zmiana nazwy ma unieważniać wynik, rozstrzyga OQ 4.
- **Strona lokalizacji oferty: własna lista kolumn**, zależna od OQ 3, np. `location_label, street_name, latitude, longitude`. Tworzy własną wersję odcisku.
  - Nie może dołączyć do `AUDIT_OFFER_COLUMNS`: zmieniłoby to odcisk każdego audytu i wysłało współrzędne do dostawcy modelu.
  - Nie można też użyć `listingFingerprint`, bo zmiana opisu unieważniłaby dojazdy bez powodu.
- **Re-fetch.** `offer-refetch.ts` porównuje wiersz przed i po wyłącznie przez `readAuditOffer` na `AUDIT_OFFER_COLUMNS` (`:36,38,202,217,250-253`), choć zapisuje wszystkie kolumny mappera, w tym współrzędne (`:215`). Świeżość dojazdów liczona przy odczycie nie potrzebuje zmian w re-fetchu. Zgubione współrzędne nie zatrzymują jednak zapisu.
- **Wariant per punkt** (alternatywa dla jednej flagi `stale`): dodany punkt daje „brak wyniku dla tego punktu”, usunięty — wiersz bez punktu, zmieniony — `stale` tylko dla niego. Wymaga to zapisu wyniku per punkt.
- **Interakcja z OQ 2.** Jeśli wynik wygasa po 30 dniach, „wygasły” staje się trzecim stanem obok `stale`/`fresh`/`unknown`.

### 8. Mapa w wyspie

**Biblioteki** (każda zależność wymaga zgody użytkownika):

- **`@googlemaps/js-api-loader` 2.1.3** (npm, 2026-09-22, Apache-2.0, jedyna zależność `@types/google.maps`).
  - API v2 to funkcje `setOptions({ key, v: "weekly" })` + `importLibrary("maps")`. Klasa `Loader` jest „deprecated, non-functional” (Context7 `/googlemaps/js-api-loader`, MIGRATION.md).
- **`@vis.gl/react-google-maps` 1.10.1** (npm, 2026-09-21, MIT).
  - peer `react >=16.8 || ^19`, zależy od js-api-loader `^2.1.1`, ~22 KB gzip,
  - „Google-sponsored” (blog Google, 2023-11-02), ale „not a Google Maps Platform Core Service”,
  - eksportuje `APIProvider`, `Map`, `useMap`, `useMapsLibrary`, `ColorScheme` i **`Polyline` z propem `encodedPath`**, który sam ładuje bibliotekę `geometry` i dekoduje przez `google.maps.geometry.encoding.decodePath`.
- **Bez paczki:** inline'owy bootstrap Google (developers.google.com/maps/documentation/javascript/load-maps-js-api, 2026-10-23), który kopiuje nonce z `script[nonce]`, plus `google.maps.Polyline` i `geometry.encoding.decodePath`. Typy wymagają tylko `@types/google.maps`.

**Ciemny motyw.** `colorScheme: ColorScheme.DARK` nie wymaga Map ID i da się go ustawić tylko przy inicjalizacji (developers.google.com/maps/documentation/javascript/mapcolorscheme). Advanced Markers wymagają Map ID. Zwykłe markery i polilinie nie.

**Kolory polilinii:**

- `tokensOnlyConfig` (`eslint.config.js:72-103`) łapie klasy palety, kolor w nawiasach i kolor w atrybucie `style`. **Nie łapie** `strokeColor: "#e11d48"` w zwykłym obiekcie JS. Reguła z `CLAUDE.md` („literał koloru w widoku to błąd”) obowiązuje mimo to.
- `--chart-1..5` istnieją (`src/styles/global.css:35-39,92-96,152-156`), ale to pięć odcieni jednego cyjanu („theme/chart cyan”, `:7`), nie paleta kategoryczna.
- Opcje:
  - nowe tokeny ról dla tras (lekcja: tokeny nazwane od roli, z kontrastem),
  - odróżnianie tras grubością lub kreską plus etykiety.
- Odczyt w wyspie przez `getComputedStyle(document.documentElement).getPropertyValue(...)` byłby pierwszym takim użyciem w `src/`.
- Tokeny są w `oklch()`. Czy Maps JS przyjmuje `oklch` w `strokeColor` — **niezweryfikowane**. Może być potrzebna konwersja do rgb, np. przez canvas.

**SSR.** W `src/` jest tylko `client:load` (36 użyć). `client:only` pominąłby SSR i atrybuty `data-*`, na których opierają się smoke i testy renderu. Opcja: tabela i atrybuty stanu w `.astro`, a mapa jako wyspa, która dopiero w przeglądarce ładuje skrypt Google.

**CSP i Workers.** Dziś nie ma żadnego CSP: brak w `src/`, `astro.config.mjs`, `wrangler.jsonc`, a w `public/` brak `_headers`. Ładowanie `maps.googleapis.com` niczego nie łamie. Jeśli CSP kiedyś powstanie, Google zaleca nonce + `'strict-dynamic'` i podaje listy `img-src`/`connect-src`/`worker-src blob:` (developers.google.com/maps/documentation/javascript/content-security-policy, 2026-10-23).

### 9. Testy

**Stub Google** na wzór `tests/fixtures/anthropic.ts` (`ANTHROPIC_TEST_KEY` `:48-49`, `isProviderRequest` `:60`, `providerCalls` `:66`, buildery `:181-237`) i `tests/fixtures/apify.ts` (`:21-37,131-157`):

- `GOOGLE_TEST_KEY` jako kanarek,
- `isRoutesRequest` / `isGeocodeRequest`, `googleCalls(requests)` po hoście,
- buildery odpowiedzi (sukces, element `ROUTE_NOT_FOUND`, 4xx, cisza).

**Kanarki prywatności:** adres punktu i lokalizacja oferty nie trafiają do logu ani do żądań poza Google. Na wzór `tests/fixtures/audit.ts` kanarki trzeba też wstawić w notatkach i potwierdzić, że nie lecą do Google.

**Mechanika testów:**

- Rejestr żądań i odmowa nieplanowanych: `tests/fixtures/http.ts:59-93`.
- Wzorzec testu z kluczem: `vi.hoisted` + override `astro:env/server` (`tests/pages/api/audits.test.ts:54-70`).
- Każdy scenariusz podaje liczbę żądań do Google, np. „Google 2N, writes 1” (wzorzec nazw: `tests/pages/api/offers.test.ts:1110`).
- Plik `*.unconfigured.test.ts` obok, wzorzec `tests/pages/api/audits.unconfigured.test.ts:39-58`.

**Smoke:**

- Do route'u dojazdów wysyłamy tylko żądania kończone przed Google: brak sesji, sesja sfałszowana, nie-uuid, nieistniejąca oferta. Wzorzec: `requestAuditOfMissingOffer` z odmową dla id fixture'a (`scripts/smoke.mjs:933-956,1413-1422`).
- Tabela punktów oceniana z obu stron przez `withSnapshot`, jak inne tabele zespołu.
- Na `/criteria` sprawdzamy `data-commute-points-state="ok"`.

**Kitchen-sinki:**

- `/dev/offer-card`: tablice `states` `:124`, `auditStates` `:342`.
- `/dev/criteria`: `State` `:38-47`, wzorzec stanu „brak integracji” `ingestion-unconfigured` `:153-157` z `_criteria-fixtures.ts:235-238`.
- `/dev/forms`: dialogi przez `?open=` `:121-123`.
- Strony odpowiadają 404 poza dev (`offer-card.astro:69-72` itd.), co sprawdza `smoke.mjs:1150-1154`.
- **Ryzyko kosztowe:** `/dev/*` i `scripts/ui-screenshots.mjs` działają pod `astro dev` z lokalnym kluczem, więc wyspa mapy ładowałaby prawdziwą, płatną mapę (Dynamic Maps). Wyspa potrzebuje propa `preview` na wzór `AuditRunner`, który nie wstrzykuje skryptu. To samo dotyczy specyfikacji Playwright.

## Code References

- `astro.config.mjs:17-24` — schema env, cztery sekrety opcjonalne
- `src/lib/config-status.ts:1-56` — ConfigStatus, `isAuditAvailable`, `isApifyAvailable`
- `src/lib/otodom/apify.ts:54-56` — fabryka zwracająca `null`
- `src/pages/api/audits.ts:28-34,114-255,296-378` — płatny route, NDJSON
- `src/lib/audit/store.ts:68-243` — claim i zakończenie próby
- `src/lib/audit/freshness.ts:23-159` — świeżość
- `src/lib/audit/input.ts:45-71,333-351` — kolumny audytu i odcisk
- `src/lib/criteria.ts:214-269,327-351,385-422` — odczyty kryteriów
- `src/lib/otodom/map.ts:24-25,159-188,301-302` — lokalizacja i współrzędne
- `src/pages/api/offer-refetch.ts:36-38,202-253` — porównanie przed i po
- `supabase/migrations/20260922202756_create_offers.sql:51-55,84-113` — kolumny lokalizacji, RLS
- `supabase/migrations/20260927144141_create_team_criteria.sql:221-263` — bump `criteria_revision`
- `supabase/migrations/20261007073300_create_offer_audits.sql:33-299` — wiersz jako blokada
- `eslint.config.js:72-103,117-137,208-224` — tokeny, notatki w audycie, Apify server-only
- `node_modules/astro/dist/env/vite-plugin-env.js:65-70,113-155` — wklejanie pól publicznych, blokada `astro:env/server` w kliencie
- `src/components/offers/OfferAudit.astro:46-52,190-271`, `AuditRunner.tsx:30-278`, `src/lib/audit/stream.ts:37-122`
- `src/styles/global.css:7,35-39,152-156` — tokeny chart (jeden odcień)
- `tests/fixtures/{anthropic,apify,http}.ts`, `tests/setup.ts:7-13`, `scripts/smoke.mjs:933-956,1150-1154`

## Architecture Insights

- Każda płatna akcja ma ten sam szkielet: darmowe odmowy, potem klucz, claim, log `started`, jedno wywołanie bez retry i jedno zakończenie na każdym wyjściu. Dojazdy dodają N×2 wywołań w jednej akcji, więc „bez retry” obejmuje każde z nich. Częściowy sukces, np. 3 z 4 punktów, to nowy przypadek, który plan musi nazwać.
- Świeżość liczy się przy odczycie z odcisków zapisanych przy wyniku, więc nic jej nie zapisuje. Wzorzec pasuje do FR-016 bez maszynerii triggerów.
- Dane członków (adresy punktów) mają dwie bariery. Pierwszą jest struktura: osobny moduł i reguła ESLint, jak dla notatek. Drugą jest log: whitelista `logEvent`. RLS nie chroni ich przed audytem, bo audyt działa z sesją członka.
- Klucz publiczny to pierwszy wyjątek od „sekrety tylko w `astro:env/server`”. Mechanizm Astro wymusza zmianę modelu dostarczania: w czasie buildu, nie w runtime.

## Historical Context (from prior changes)

- `context/archive/2026-10-09-location-map-link/plan-brief.md:28,47` — współrzędne nieużywane („punkt z otodom bywa przybliżony”); geokodowanie, trasy i czasy dojazdu poza zakresem S-08. Ocena: wykluczenie zakresu było wtedy prawdziwe, a dziś zastępuje je FR-016. Teza o przybliżeniu nadal nie jest zweryfikowana na payloadzie.
- `context/archive/2026-09-22-paste-listing-to-card/plan.md:52,184` — współrzędne zapisane z myślą o S-08. Potwierdzone: kolumny istnieją i nikt ich nie czyta.
- `context/foundation/shape-notes.md` (diff roboczy) — FR-016 zawęża dawny Non-Goal, a „automated” usunięto.

## Related Research

- Nie dotyczy: żaden wcześniejszy `research.md` nie obejmuje Google Maps ani dojazdów.

## Open Questions

Do PRD lub do użytkownika przed `/10x-plan`:

1. **OQ 2:** opcje 1–4 z sekcji 5. Dodatkowo pytanie prawne: czy zapisany czas i dystans to „caching”.
2. **OQ 3:** opcje A–D z sekcji 6. Fakt do zdobycia: `npm run otodom:inspect` na ogłoszeniu z ukrytym adresem (uruchamia użytkownik).
3. **OQ 4:** odcisk vs licznik, zmiana nazwy punktu, flaga całościowa vs per punkt (sekcja 7).
4. **Nowe, PRD milczy:**
   - (a) liczenie dojazdów na zarchiwizowanej ofercie,
   - (b) czas odjazdu dla TRANSIT,
   - (c) częściowy sukces (część punktów bez trasy, np. `ROUTE_NOT_FOUND`),
   - (d) blokada przed podwójnym naciśnięciem vs poleganie na kwotach Google,
   - (e) czy mapa przełącza trasy razem z trybem tabeli.
5. **Do decyzji użytkownika, zależności:** `@vis.gl/react-google-maps` lub `@googlemaps/js-api-loader` lub sam bootstrap + `@types/google.maps`.
6. **Do decyzji użytkownika, klucz przeglądarkowy:** `client/public` (wklejany przy buildzie, zmienna buildu Workers Builds) vs `server/secret` jako prop. Do tego wpis wyjątku w `CLAUDE.md` i w `system.ts`, a w konsekwencji płatny eval recenzenta.
7. **Niezweryfikowane technicznie:**
   - `oklch()` w `strokeColor`,
   - okno 7/100 dni dla TRANSIT w matrixie,
   - SKU geokodowania v4 i geokodowania wewnątrz Routes,
   - cennik EEA,
   - dokumentacja Cloudflare dla zmiennych buildu.
