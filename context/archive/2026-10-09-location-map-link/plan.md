# Link do mapy z lokalizacji ogłoszenia — Implementation Plan

## Overview

Karta oferty dostaje odnośnik, który jednym kliknięciem otwiera wyszukiwanie Google Maps
dla lokalizacji podanej w ogłoszeniu (FR-008, S-08). Adres wyszukiwania powstaje z
zapisanego tekstu lokalizacji — ulicy i etykiety miejscowości — i z niczego więcej.

## Current State Analysis

- `public.offers` trzyma już wszystko, czego link potrzebuje: `location_label`,
  `street_name`, `latitude`, `longitude` (`supabase/migrations/20260922202756_create_offers.sql:52-55`),
  wypełniane przez `mapAdToOffer` (`src/lib/otodom/map.ts:296-299`).
- `src/components/offers/OfferCard.astro:46-48` pokazuje etykietę lokalizacji albo
  „Lokalizacja: nie podano w ogłoszeniu"; `:58-67` renderuje link „Otwórz oryginał na
  otodom.pl ↗" przez `safeHttpsUrl` — to wzorzec wyglądu i zabezpieczenia dla nowego linku.
- Żaden moduł w `src/` nie buduje dziś adresu mapy.
- `context/foundation/lessons.md` („Render URLs from database rows only through
  `safeHttpsUrl`") wymienia S-08 z nazwy: wiersz oferty może zmienić każdy zalogowany
  członek przez Data API, więc link zbudowany z danych wiersza przechodzi przez
  `safeHttpsUrl`.
- Roadmapa (S-08, Risk): link jest z założenia zgrubnym sprawdzeniem okolicy, a adres,
  którego ogłoszenie nie podało, nie może zostać uzupełniony domysłem.
- PRD, Non-Goals: żadnych pinezek ani tras — wygenerowany link wyszukiwania to cała
  funkcja lokalizacji.

## Desired End State

Na karcie oferty z podaną etykietą lokalizacji stoi link „Pokaż na mapie Google ↗".
Kliknięcie otwiera w nowej karcie wyszukiwanie Google Maps:

| `street_name`     | `location_label`                   | Zapytanie wysłane do map                            |
| ----------------- | ---------------------------------- | --------------------------------------------------- |
| `ul. Przykładowa` | `Warszawa, Mokotów, Stary Mokotów` | `ul. Przykładowa, Warszawa, Mokotów, Stary Mokotów` |
| `null`            | `Ząbki, wołomiński, mazowieckie`   | `Ząbki, wołomiński, mazowieckie`                    |
| `ul. Przykładowa` | `null`                             | brak linku                                          |
| `null`            | `null`                             | brak linku                                          |

Weryfikacja: `npm test` (reguła i render), `/dev/offer-card` pokazuje wszystkie cztery
stany, a kliknięcie na prawdziwej ofercie ląduje w Google Maps z właściwym zapytaniem.

### Key Discoveries:

- Format adresu: `https://www.google.com/maps/search/?api=1&query=<zapytanie>` — udokumentowany
  format Maps URLs, bez klucza API i bez żądania po stronie serwera.
- `safeHttpsUrl` zwraca `parsed.href` (`src/lib/safe-url.ts:11`), więc wynik jest adresem
  znormalizowanym przez parser; test porównuje zapytanie po zdekodowaniu, nie cały napis.
- `streetOnlyOffer` (`src/pages/dev/_offer-fixtures.ts:200`) i `outsideCityOffer` (`:247`)
  już istnieją jako fixtures tablicy; `/dev/offer-card` (`src/pages/dev/offer-card.astro:67`)
  ich nie renderuje.
- `tests/components/offers/render.test.ts:91` („OfferCard: the source link") jest wzorcem
  testu linku z wiersza: wroga wartość obok poprawnej, `expectOnlySafeUrls` na całym HTML.
- `tests/lib/team-limits.test.ts` jest wzorcem testu czystej reguły: każdy przypadek bez
  wyniku stoi obok takiego, który wynik daje, a wartości oczekiwane są pisane ręcznie.

## What We're NOT Doing

- **Współrzędne nie wchodzą do linku.** `latitude`/`longitude` zostają w wierszu nieużyte:
  punkt z otodom bywa przybliżony, a pinezka wygląda jak dokładny adres.
- **Sama ulica nie daje linku.** Bez etykiety miejscowości Google wybrałby miasto sam.
- **Brak linku na tablicy** (`/dashboard`, `OfferBoardItem.astro`) — tylko karta oferty.
- **Bez bramki wizualnej** — decyzja użytkownika; bez macierzy 7 stanów i bez zrzutów.
- Bez migracji, bez nowej trasy w `src/pages/api/`, bez zmian w `scripts/smoke.mjs`,
  bez osadzonej mapy, geokodowania, tras i czasu dojazdu.
- Bez nowej zależności w `package.json`.

## Implementation Approach

Reguła żyje w jednej czystej funkcji w `src/lib/`, testowanej bez renderowania; widok
tylko pyta ją o adres i renderuje link, gdy dostał napis. Dzięki temu „kiedy link jest"
i „z czego jest zbudowany" mają jedno miejsce, a karta nie składa adresu sama.

## Critical Implementation Details

- **Wiersz jest niezaufany.** `location_label` i `street_name` mogą po zmianie przez Data
  API zawierać cokolwiek: same białe znaki, znaczniki HTML, `javascript:…`, `&query=…`.
  Funkcja przycina obie wartości, pustą traktuje jak brak, a całe zapytanie koduje jednym
  `encodeURIComponent` — treść wiersza trafia wyłącznie do wartości parametru `query`,
  nigdy do hosta, ścieżki ani innego parametru. Wynik przechodzi przez `safeHttpsUrl`.

## Phase 1: Reguła linku do mapy

### Overview

Czysta funkcja, która z wiersza oferty zwraca adres wyszukiwania Google Maps albo `null`,
z testem jednostkowym.

### Changes Required:

#### 1. Moduł reguły

**File**: `src/lib/map-link.ts` (nowy)

**Intent**: Jedno miejsce, które rozstrzyga, czy oferta ma link do mapy i jak brzmi jego
adres, tak by widok nie składał adresu z danych wiersza samodzielnie.

**Contract**: `mapSearchUrl(offer: Pick<OfferRow, "location_label" | "street_name">): string | null`.

- Etykieta, która nie jest napisem albo po przycięciu jest pusta → `null`, niezależnie od ulicy.
- Zapytanie = ulica (jeśli po przycięciu niepusta) i etykieta, połączone `", "`, w tej kolejności.
- Adres = `https://www.google.com/maps/search/?api=1&query=` + `encodeURIComponent(zapytanie)`,
  zwrócony przez `safeHttpsUrl`.
- Moduł nie importuje `@/lib/supabase` ani `astro:env/server`; typ `OfferRow` wchodzi przez
  `import type`.

#### 2. Test reguły

**File**: `tests/lib/map-link.test.ts` (nowy)

**Intent**: Utrwalić cztery wiersze tabeli z „Desired End State" oraz to, że treść wiersza
nie wychodzi poza parametr `query`.

**Contract**: wzorzec `tests/lib/team-limits.test.ts` — wartości oczekiwane pisane ręcznie,
każdy przypadek `null` obok takiego, który daje adres:

- ulica + etykieta → `searchParams.get("query")` równe
  `ul. Przykładowa, Warszawa, Mokotów, Stary Mokotów`;
- sama etykieta → zapytanie równe etykiecie; dla etykiety ASCII `Zabki, mazowieckie` cały
  adres równy `https://www.google.com/maps/search/?api=1&query=Zabki%2C%20mazowieckie`;
- etykieta `null`, `""`, `"   "` i wartość niebędąca napisem → `null`, także gdy ulica jest podana;
- ulica `null`, `""`, `"   "` przy podanej etykiecie → zapytanie równe samej etykiecie, bez
  wiodącego przecinka;
- białe znaki wokół obu wartości są przycięte;
- wrogie wartości (`javascript:alert(1)`, `"><script>alert(1)</script>`, `x&api=2&query=y`,
  `https://evil.example/`) → adres zaczyna się od `https://www.google.com/maps/search/?`,
  `searchParams.get("api")` to `"1"`, `searchParams.getAll("query")` ma jeden element równy
  wrogiej wartości, a host to `www.google.com`.

### Success Criteria:

#### Automated Verification:

- Test reguły przechodzi: `npx vitest run tests/lib/map-link.test.ts`
- Cały zestaw przechodzi: `npm test`
- Typy i lint przechodzą: `npx astro sync && npx astro check && npm run lint`
- Mutacje modułu ocenione: `npx stryker run --mutate "src/lib/map-link.ts"` — każdy ocalały
  mutant rozstrzygnięty według `### Mutation testing (Stryker)` w `CLAUDE.md`

---

## Phase 2: Link na karcie oferty

### Overview

Karta oferty renderuje link do mapy, kitchen sink pokazuje każdy jego stan, test
renderowania pilnuje atrybutów i braku linku.

### Changes Required:

#### 1. Karta oferty

**File**: `src/components/offers/OfferCard.astro`

**Intent**: Pokazać link do mapy tam, gdzie członek czyta lokalizację i otwiera oryginał,
i tylko wtedy, gdy reguła zwróciła adres.

**Contract**: link z tekstem „Pokaż na mapie Google ↗", `href` z `mapSearchUrl(offer)`,
`target="_blank"`, `rel="noopener noreferrer"`, klasy jak istniejący link do oryginału
(`buttonVariants({ variant: "link" })` przez `cn()`). Oba linki stoją w jednym kontenerze,
który zawija się na wąskim ekranie i nie renderuje się wcale, gdy żadnego linku nie ma.
Każdy link renderuje się niezależnie od drugiego. Wiersz „Lokalizacja: nie podano w
ogłoszeniu" zostaje bez zmian. Wyłącznie tokeny ról — żadnego literału koloru.

#### 2. Stany na kitchen sinku

**File**: `src/pages/dev/offer-card.astro`

**Intent**: Nowy stan karty dostaje wpis na `/dev/offer-card` (reguła z `CLAUDE.md`, `### UI`),
choć zmiana nie przechodzi bramki.

**Contract**: dwa nowe wpisy w `states`, z istniejących fixtures: `outsideCityOffer` (sama
etykieta → link) i `streetOnlyOffer` (sama ulica → brak linku do mapy), z podpisami
nazywającymi stan linku. Podpisy `fullOffer` i `unknownOffer` dopisują stan linku do mapy.
`src/pages/dev/_offer-fixtures.ts` zmienia się tylko, jeśli komentarz fixture'a przestaje
opisywać jego użycie.

#### 3. Test renderowania

**File**: `tests/components/offers/render.test.ts`

**Intent**: Dowieść na wyrenderowanym HTML, że link jest tam, gdzie reguła go daje, i że
wroga treść wiersza nie staje się adresem ani znacznikiem.

**Contract**: nowy `describe("OfferCard: the map link")` obok bloku linku do oryginału:

- `fullOffer` → dokładnie jeden `href` zaczynający się od `https://www.google.com/maps/search/`,
  z zapytaniem `ul. Przykładowa, Warszawa, Mokotów, Stary Mokotów`, a jego znacznik niesie
  `target="_blank"` i `rel="noopener noreferrer"`;
- `outsideCityOffer` → link z samą etykietą;
- `unknownOffer` i `streetOnlyOffer` → brak tekstu linku i brak `href` do map;
- kontrola niezależności: oferta z etykietą i z `source_url` odrzuconym przez
  `safeHttpsUrl` ma link do mapy bez linku do oryginału, i odwrotnie;
- etykieta `"><script>alert(1)</script>` i `javascript:alert(1)` → `expectOnlySafeUrls(html)`
  przechodzi, HTML nie zawiera `<script`, link do map istnieje.

#### 4. Reguła projektu

**File**: `CLAUDE.md`

**Intent**: Następna zmiana, która buduje link z zapisanego tekstu, ma wskazaną referencję
zamiast drugiego mechanizmu.

**Contract**: jeden punkt w `## Structure`, w stylu sąsiednich: `src/lib/map-link.ts` jest
referencją dla linku do mapy (FR-008) — zbudowany z etykiety lokalizacji i ulicy, nigdy ze
współrzędnych, brak etykiety to brak linku, treść wiersza tylko w wartości parametru `query`;
`tests/lib/map-link.test.ts` jest testem referencyjnym. Bez liczb i bez parafrazy pliku.

### Success Criteria:

#### Automated Verification:

- Test renderowania przechodzi: `npx vitest run tests/components/offers/render.test.ts`
- Cały zestaw przechodzi: `npm test`
- Typy i lint przechodzą: `npx astro sync && npx astro check && npm run lint`
- Build przechodzi bez konfiguracji: `npm run build`

#### Manual Verification:

- `/dev/offer-card` pod `npm run dev`: link do mapy widoczny dla pełnej oferty i dla samej
  etykiety, nieobecny dla „wszystko nieznane" i dla samej ulicy
- Kliknięcie linku na prawdziwej ofercie otwiera Google Maps w nowej karcie z wyszukiwaniem
  właściwej ulicy i miejscowości
- Na szerokości 375 px oba linki zawijają się bez poziomego przewijania, a fokus klawiaturą
  jest widoczny na obu

**Implementation Note**: Po przejściu weryfikacji automatycznej tej fazy zatrzymaj się na
potwierdzenie człowieka, że weryfikacja ręczna się powiodła.

---

## Testing Strategy

### Unit Tests:

- `tests/lib/map-link.test.ts` — cała reguła: skład zapytania, brak linku bez etykiety,
  przycinanie, kodowanie, wrogie wartości zamknięte w `query`.

### Integration Tests:

- `tests/components/offers/render.test.ts` — karta przez Container API: obecność, atrybuty
  i niezależność obu linków, wroga etykieta.
- `scripts/smoke.mjs` bez zmian: powierzchnia `src/pages/api/` się nie zmienia.
- Bez nowego speca Playwright: link prowadzi poza aplikację, a jego adres dowodzi test
  renderowania.

### Manual Testing Steps:

1. `npm run dev`, wejść na `/dev/offer-card`, sprawdzić cztery stany linku.
2. Otworzyć zapisaną ofertę z ulicą, kliknąć „Pokaż na mapie Google ↗", porównać wynik z
   lokalizacją w ogłoszeniu.
3. Zwęzić okno do 375 px i przejść Tabem po obu linkach.

## Performance Considerations

Brak: funkcja działa na dwóch napisach przy renderowaniu karty, bez żądania sieciowego.

## Migration Notes

Brak migracji. Oferty zapisane wcześniej dostają link od razu, bo kolumny są już wypełnione.

## References

- PRD: `context/foundation/prd.md` — FR-008, Non-Goals („No map plotting or commute-time routing")
- Roadmapa: `context/foundation/roadmap.md` — S-08
- Lekcja: `context/foundation/lessons.md` — „Render URLs from database rows only through `safeHttpsUrl`"
- Wzorzec linku: `src/components/offers/OfferCard.astro:58`
- Wzorzec testu linku: `tests/components/offers/render.test.ts:91`
- Wzorzec testu reguły: `tests/lib/team-limits.test.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Reguła linku do mapy

#### Automated

- [x] 1.1 Test reguły przechodzi: `npx vitest run tests/lib/map-link.test.ts` — bf76b75
- [x] 1.2 Cały zestaw przechodzi: `npm test` — bf76b75
- [x] 1.3 Typy i lint przechodzą: `npx astro sync && npx astro check && npm run lint` — bf76b75
- [x] 1.4 Mutacje modułu ocenione: `npx stryker run --mutate "src/lib/map-link.ts"` — bf76b75

### Phase 2: Link na karcie oferty

#### Automated

- [x] 2.1 Test renderowania przechodzi: `npx vitest run tests/components/offers/render.test.ts` — eba519d
- [x] 2.2 Cały zestaw przechodzi: `npm test` — eba519d
- [x] 2.3 Typy i lint przechodzą: `npx astro sync && npx astro check && npm run lint` — eba519d
- [x] 2.4 Build przechodzi bez konfiguracji: `npm run build` — eba519d

#### Manual

- [x] 2.5 `/dev/offer-card`: link widoczny dla pełnej oferty i samej etykiety, nieobecny dla „wszystko nieznane" i samej ulicy — eba519d
- [x] 2.6 Kliknięcie na prawdziwej ofercie otwiera Google Maps w nowej karcie z właściwym wyszukiwaniem — eba519d
- [x] 2.7 Na 375 px oba linki zawijają się bez poziomego przewijania, fokus widoczny na obu — eba519d
