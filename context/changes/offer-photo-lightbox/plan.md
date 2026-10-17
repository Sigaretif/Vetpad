# Ostre miniatury galerii i lightbox zdjęć na karcie oferty — plan implementacji

## Overview

Galeria na karcie oferty przestaje rozciągać 184-pikselowy `thumbnail` na komórkę ~223 px (i ~694 px przy jednym zdjęciu): siatka dostaje `srcset` z wariantów `medium` (655w) i `large` (2048w). Kliknięcie miniatury otwiera lightbox wewnątrz karty — dialog Radix z nawigacją ←/→ i przyciskami (z zawijaniem), licznikiem „N z M” ogłaszanym przez `aria-live`, zamknięciem Esc i powrotem fokusu na klikniętą miniaturę. Bez JS galeria działa jak dziś (link do `large` w nowej karcie). Zdjęcia pozostają hotlinkowane (FR-004, FR-007).

## Current State Analysis

- `OfferImage = { thumbnail, large }` (`src/lib/otodom/types.ts:52-55`). `mapImages` (`src/lib/otodom/map.ts:190-200`) czyta tylko te dwa pola przez lokalne `httpsUrl` (`map.ts:46-58`) i odrzuca wpis, gdy któreś nie przejdzie. `small`/`medium` zostają tylko w `raw.images`.
- `OfferGallery.astro:18-22` filtruje `thumbnail` i `large` przez `safeHttpsUrl` (oba muszą przejść) i renderuje `<a href={large} target="_blank" rel="noopener noreferrer"><img src={thumbnail} …></a>` (`:38-55`). Jedyny wywołujący: `OfferCard.astro:85, 211`.
- Rozmiary wariantów (research §1, zmierzone 2026-10-17): `thumbnail` 184×138, `small` 314×236, `medium` 655×491, `large` 2048×1536; rozmiar jest w sufiksie URL `image;s=WxH;q=80`.
- `images` leży poza `AUDIT_OFFER_COLUMNS` (`src/lib/audit/input.ts:4-7`) — zmiana kształtu elementu nie rusza fingerprintu, nieaktualności audytu ani reguły utraconych faktów (`src/lib/offer-refetch.ts:22-27`). Re-fetch zastępuje `images` w całości (`src/pages/api/offer-refetch.ts:186`).
- Brak `src/components/ui/dialog.tsx`; `@radix-ui/react-dialog@1.2.0` jest zainstalowany tylko tranzytywnie przez `@radix-ui/react-alert-dialog` (package-lock.json:3330-3341). `lucide-react` eksportuje `XIcon`, `ChevronLeftIcon`, `ChevronRightIcon`.
- Testy galerii: tylko SSR w `tests/components/offers/render.test.ts:247-288`; helpery `urlsIn`/`expectOnlySafeUrls` (`:63-90`) czytają `href`/`src`, nie `srcset`. `tests/lib/otodom/map.test.ts` nie sprawdza dziś obrazów; fixture `tests/fixtures/otodom.ts:109-124` ma już `small`/`medium`. Brak środowiska DOM w Vitest.
- `tests/e2e/fixture-offer.ts` `createFixtureOffer` zapisuje ofertę bez `images`. `tests/e2e/delete-with-confirmation.spec.ts:55-76` jest wzorem asercji dialogu, Esc i powrotu fokusu.
- `/dev/offer-card` (`src/pages/dev/offer-card.astro`) nie czyta dziś `searchParams`; `ConfirmDialog.tsx:34-37` ma `defaultOpen` „for the /dev kitchen sinks alone”, a `src/pages/dev/forms.astro:120-123` czyta `?open=`.

## Desired End State

- Nowo zapisana lub ręcznie pobrana ponownie oferta przechowuje `{ thumbnail, medium?, large }`; `medium` jest pominięte, gdy brak go w payloadzie albo nie jest https.
- Siatka renderuje `<img src={medium ?? large} srcset="medium 655w, large 2048w" sizes=…>` (sam `large 2048w`, gdy `medium` brak) — każdy URL znormalizowany przez `safeHttpsUrl`. Stare wiersze bez `medium` pokazują ostry `large`.
- Niezmodyfikowany lewy klik miniatury otwiera dialog z pełnym `large`; ←/→ i przyciski „Poprzednie zdjęcie”/„Następne zdjęcie” zawijają; widoczny licznik „N z M” w regionie `aria-live="polite"`; Esc i „Zamknij” zamykają; fokus wraca na klikniętą miniaturę. Ctrl/meta/shift/alt-klik i środkowy klik otwierają `large` w nowej karcie jak dziś. Bez JS — dzisiejszy markup.
- `/dev/offer-card` pokazuje stan z `medium`, stan starej oferty bez `medium` oraz sekcję lightboxa, którą `?open=photo-<n>` otwiera na zdjęciu N.
- Weryfikacja: `npm test`, `npm run lint`, `npx astro sync && npx astro check`, `npm run build`, spec Playwright `tests/e2e/photo-lightbox.spec.ts` zielony lokalnie.

### Key Discoveries:

- `safeHttpsUrl` zwraca `URL.href` — spacje są w nim zakodowane jako `%20`, więc znormalizowany URL nie rozbije kandydata `srcset` (`src/lib/safe-url.ts:7-15`). Do `srcset` trafia wyłącznie ten `href`, nigdy surowa wartość z wiersza.
- Wyspa SSR-uje się przez Container API z rendererem React (`render.test.ts:1-2, 54-55`); Radix Portal zamkniętego dialogu nie renderuje nic na serwerze, więc SSR wyspy to dokładnie markup siatki.
- `scripts/ui-screenshots.mjs:36-37` wybiera miniatury jako `[data-slot=card] a` z `img` — zachowanie `<a target=_blank><img>` utrzymuje selektory.

## What We're NOT Doing

- Backfill istniejących wierszy, czytanie `raw.images` w widoku, przepisywanie sufiksu `;s=` w URL-u CDN.
- Zmiany miniatur na tablicy (`OfferBoardItem.astro`) i w archiwum (`OfferArchiveItem.astro`) — dalej jeden `thumbnail`.
- Przechowywanie plików, analiza zdjęć (Non-Goals), gesty dotykowe/mobile (Non-Goal), zoom/pan, preload sąsiednich zdjęć, miniatury w dialogu.
- Nowe biblioteki testowe (jsdom, happy-dom, testing-library); Playwright nie staje się krokiem CI.
- Bramka wizualna (macierz 7 stanów, screenshoty) — decyzja użytkownika w `change.md`.
- Zmiana `scripts/smoke.mjs` — powierzchnia `src/pages/api/` się nie zmienia; istniejący krok 404 dla `/dev/*` pokrywa nowy `?open=`.

## Implementation Approach

Cztery fazy, każda zielona i commitowalna osobno. Dane najpierw (mapper), potem czysty moduł `src/lib/offer-gallery.ts` z filtrem wiersza i matematyką `srcset`/`sizes`, którego używa i galeria Astro, i wyspa. Lightbox to wyspa React, która sama renderuje siatkę linków (SSR = fallback bez JS) i przechwytuje tylko niezmodyfikowany lewy klik. Logika indeksu, licznika i rozpoznania „czy ten klik otwiera dialog” to czyste funkcje testowane bez przeglądarki (wzór `src/lib/audit/stream.ts`); zachowanie klawiatury i fokusu sprawdza jeden spec Playwright.

Przełącznik dev (decyzja delegowana): osobna sekcja na `/dev/offer-card`, która renderuje `OfferGallery` bezpośrednio, z `?open=photo-<n>` przekazanym jako `openAt`. Alternatywa — prop przeciągnięty przez `OfferView → OfferCard → OfferGallery` — zmieniłaby interfejs trzech produkcyjnych komponentów dla potrzeb deva; ten wariant dotyka tylko galerii i wyspy, na wzór `defaultOpen` w `ConfirmDialog.tsx`.

## Critical Implementation Details

- **Bezpieczeństwo props wyspy i `srcset`.** Propsy wyspy lądują w atrybucie `<astro-island props>` i na kliencie w `href`/`src`/`srcset`; serializacja escapuje tekst, ale nie sprawdza schematu. Wyspa dostaje wyłącznie wynik `galleryPhotos()` (już przefiltrowane `safeHttpsUrl`) i `title` — nigdy `images` z wiersza. `srcset` składa się tylko z `href` zwróconych przez `safeHttpsUrl`.
- **Fokus.** Dialog otwierany z `onClick` linku nie ma `DialogTrigger`, więc Radix nie zwróci fokusu sam: trzymaj ref na każdy link i indeks _klikniętej_ miniatury (nie aktualnie oglądanej); w `onCloseAutoFocus` wywołaj `preventDefault()` i zfokusuj ten link. W stanie `openAt` z deva brak klikniętego linku — fokus wraca na miniaturę `openAt`.
- **Radix a brak opisu.** Dialog ma sr-only `DialogTitle` i brak `DialogDescription` — przekaż `aria-describedby={undefined}` do `DialogContent`, by Radix nie ostrzegał.
- **`referrerpolicy="no-referrer"`** zostaje na każdym `<img>` (siatka i dialog) — hotlinking z CDN otodom.

## Phase 1: Mapper i typ — wariant `medium`

### Overview

Nowe zapisy i ręczne re-fetche przechowują `medium` obok `thumbnail`/`large`, bez zmiany bramki wpisu.

### Changes Required:

#### 1. Typ obrazu

**File**: `src/lib/otodom/types.ts`

**Intent**: `OfferImage` dostaje opcjonalny wariant średni, opisany komentarzem (655×491, nieobecny w wierszach zapisanych przed tą zmianą do czasu ręcznego re-fetchu).

**Contract**: `interface OfferImage { thumbnail: string; medium?: string; large: string }`.

#### 2. Mapper

**File**: `src/lib/otodom/map.ts`

**Intent**: `mapImages` czyta `image.medium` przez `httpsUrl`; brak lub nie-https `medium` pomija pole, ale nie usuwa wpisu — bramka zostaje na `thumbnail` + `large`. `raw` i `RAW_AD_KEYS` bez zmian.

**Contract**: element wyniku to `{ thumbnail, large }` albo `{ thumbnail, medium, large }`; klucz `medium` nie występuje z wartością `undefined`/`null` (kolumna jsonb przechowuje tylko obecne pola).

#### 3. Testy mappera

**File**: `tests/lib/otodom/map.test.ts`

**Intent**: nowy `describe` dla obrazów: fixture z `medium` daje trzy pola; `medium` jako `http:`/`javascript:`/brak → wpis zostaje bez klucza `medium`; zły `thumbnail` lub `large` dalej usuwa wpis niezależnie od `medium`. Oczekiwane wartości wpisane ręcznie; fixture `tests/fixtures/otodom.ts` modyfikowany tylko przez nadpisanie w teście (kopie z podmienionym `images`).

**Contract**: test przez `mapAdToOffer`, bez eksportowania `mapImages`.

### Success Criteria:

#### Automated Verification:

- Testy mappera dla `medium` przechodzą: `npx vitest run tests/lib/otodom/map.test.ts`
- Cały zestaw przechodzi: `npm test`
- Typy: `npx astro sync && npx astro check`
- Lint: `npm run lint`

---

## Phase 2: Ostra siatka — `srcset` i `sizes`

### Overview

Galeria renderuje `medium`/`large` z `srcset` zamiast rozciągniętego `thumbnail`, z filtrem wiersza wydzielonym do czystego modułu.

### Changes Required:

#### 1. Moduł galerii

**File**: `src/lib/offer-gallery.ts` (nowy)

**Intent**: jedno miejsce, które z kolumny `images` (dowolnej zawartości) robi listę zdjęć do wyrenderowania i składa atrybuty obrazu siatki. Moduł bez importów runtime poza `@/lib/safe-url`, bo wejdzie do wyspy (faza 3).

**Contract**:

- `interface GalleryPhoto { medium: string | null; large: string }` — URL-e już po `safeHttpsUrl`.
- `galleryPhotos(images: unknown[]): GalleryPhoto[]` — wpis zostaje, gdy `thumbnail` i `large` przechodzą `safeHttpsUrl` (bramka jak dziś); `medium` to wynik `safeHttpsUrl` albo `null`; element niebędący obiektem jest pomijany.
- `gridSrc(photo)` → `medium ?? large`; `gridSrcset(photo)` → `"<medium> 655w, <large> 2048w"` albo `"<large> 2048w"`.
- `gridSizes(total)` → przy 1 zdjęciu `"(min-width: 1024px) 694px, 100vw"`, w przeciwnym razie `"(min-width: 1024px) 223px, (min-width: 640px) 33vw, 50vw"` (szerokości z research §1; układ poniżej `lg` jest jednokolumnowy, mobile to Non-Goal).

#### 2. Galeria Astro

**File**: `src/components/offers/OfferGallery.astro`

**Intent**: filtr z modułu zamiast lokalnego; `<img>` dostaje `src`/`srcset`/`sizes` z modułu; link dalej `href={large}` z `target="_blank"`. Pusty wynik dalej renderuje `Unstated` „Ogłoszenie nie zawiera zdjęć.”. Komentarz o bramce aktualizowany (thumbnail nadal bramkuje, choć siatka go nie renderuje — ten sam zbiór zdjęć co tablica i archiwum).

**Contract**: props bez zmian (`images: unknown[]`, `title`).

#### 3. Fixtures kitchen sinka

**File**: `src/pages/dev/_offer-fixtures.ts`, `src/pages/dev/offer-card.astro`

**Intent**: `image(seed)` dostaje `medium` (picsum 655×491) i `large` 2048×1536, by fixture odwzorowywał rozmiary otodom; nowa fixture `legacyImagesOffer` (zdjęcia bez `medium`, stan sprzed zmiany) z wpisem w `states` na `/dev/offer-card`. `unsafeImagesOffer` dostaje wpis z poprawnym `thumbnail`/`large` i wrogim `medium` (`javascript:`), który ma się wyrenderować bez `medium`.

**Contract**: nowy eksport `legacyImagesOffer: OfferRow`; unikalne `id`/`otodom_id` wg istniejącej numeracji.

#### 4. Testy

**Files**: `tests/lib/offer-gallery.test.ts` (nowy), `tests/components/offers/render.test.ts`

**Intent**:

- Test czystego modułu: każdy odrzucony wpis obok zachowanego; `medium` wrogie/`http:`/brak → `null` przy zachowanym zdjęciu; `srcset` z i bez `medium`; `sizes` dla 1 i wielu; wrogie `medium` ze spacją i przecinkiem daje w `srcset` jeden token URL bez białych znaków (znormalizowany `href`).
- `render.test.ts:247-288`: `urlsIn`/`expectOnlySafeUrls` rozszerzone o kandydatów `srcset` (każdy URL kandydata przez tę samą whitelistę, liczba atrybutów pilnuje ekstrakcji); asercja `imgSrcsIn` zmienia się z `[THUMB]` na `[MEDIUM]` dla wpisu z `medium` i `[LARGE]` dla wpisu bez; nowe przypadki: wrogie `medium` nie trafia do markup'u, a zdjęcie się renderuje; `srcset`/`sizes` obecne z oczekiwanymi wartościami wpisanymi ręcznie.

**Contract**: stała `MEDIUM` obok `THUMB`/`LARGE`; `VALID` z `medium`, dodatkowy `VALID_LEGACY` bez.

### Success Criteria:

#### Automated Verification:

- Testy modułu i renderu przechodzą: `npx vitest run tests/lib/offer-gallery.test.ts tests/components/offers/render.test.ts`
- Cały zestaw przechodzi: `npm test`
- Typy: `npx astro sync && npx astro check`
- Lint (tokeny): `npm run lint`
- Build: `npm run build`

#### Manual Verification:

- `/dev/offer-card`: ostre siatki (`medium` w 3 kolumnach, `large` przy jednym zdjęciu), `legacyImagesOffer` ostry z `large`, stany z wrogimi URL-ami bez zmian (sprawdzenie pod `npm run dev`, DevTools → Network)

---

## Phase 3: Lightbox — dialog i wyspa

### Overview

Prymityw dialogu z shadcn, czyste funkcje nawigacji i wyspa `OfferPhotoViewer`, która zastępuje markup siatki w galerii, plus stan dev otwarty na zdjęciu N.

### Changes Required:

#### 1. Prymityw dialogu

**Files**: `src/components/ui/dialog.tsx` (z `npx shadcn add dialog`), `package.json`, `package-lock.json`

**Intent**: rytuał z CLAUDE.md `### UI` dla prymitywu z Radix: `cn` z `@/lib/utils`, bez `"use client"`, import z `@radix-ui/react-dialog` (wzór `alert-dialog.tsx:2`), overlay z tokenem `bg-overlay` zamiast literału, sr-only etykieta przycisku zamknięcia „Zamknij”, bez `backdrop-blur`; usunąć pakiet `radix-ui`/`cn`, jeśli CLI je doda.

**Contract**: nowa bezpośrednia zależność **`@radix-ui/react-dialog` `^1.2.0`** (deduplikuje się z kopią tranzytywną 1.2.0). Eksporty jak w rejestrze: `Dialog`, `DialogContent`, `DialogTitle`, `DialogClose`, … `npm run lint` (`tokensOnlyConfig`) przechodzi bez wyjątków.

#### 2. Czyste funkcje lightboxa

**File**: `src/lib/offer-gallery.ts`

**Intent**: logika indeksu i kliknięcia bez Reacta i przeglądarki.

**Contract**:

- `nextPhoto(index, total)`, `previousPhoto(index, total)` — zawijanie (ostatnie → pierwsze, pierwsze → ostatnie); `total === 1` zwraca 0.
- `photoCounter(index, total)` → `"N z M"` (1-based).
- `opensViewer(click: { button: number; metaKey; ctrlKey; shiftKey; altKey; defaultPrevented })` → `true` tylko dla niezmodyfikowanego głównego przycisku i nieprzechwyconego zdarzenia.
- `clampOpenAt(value: unknown, total)` → indeks z zakresu albo `null` (dla `?open=photo-<n>`, 1-based w adresie).

#### 3. Wyspa

**File**: `src/components/offers/OfferPhotoViewer.tsx` (nowy, default export)

**Intent**: renderuje siatkę `<ul>`/`<li>`/`<a href={large} target="_blank" rel="noopener noreferrer"><img src srcset sizes alt loading="lazy" decoding="async" referrerpolicy="no-referrer"></a>` identyczną klasami z dzisiejszą galerią — SSR to fallback bez JS. `onClick` linku: gdy `opensViewer` — `preventDefault()`, zapamiętaj indeks klikniętej miniatury, otwórz dialog na nim. Dialog (`max-w` szerszy niż rejestrowe `sm:max-w-lg`, tokeny ról): sr-only `DialogTitle` „Zdjęcia: {title}”, `<img src={large}>` z `object-contain` i ograniczoną wysokością, alt „Zdjęcie N z M: {title}”, przyciski z `ChevronLeftIcon`/`ChevronRightIcon` i `aria-label` „Poprzednie zdjęcie”/„Następne zdjęcie” (ukryte przy jednym zdjęciu), widoczny licznik w elemencie `aria-live="polite"`, `onKeyDown` na `DialogContent` dla `ArrowLeft`/`ArrowRight`, zamknięcie „Zamknij”/Esc przez Radix, powrót fokusu jak w Critical Implementation Details.

**Contract**: props `{ photos: GalleryPhoto[]; title: string; openAt?: number }` — `openAt` „for the /dev kitchen sinks alone”, otwiera dialog przy pierwszym renderze klienta. Importuje tylko `@/lib/offer-gallery`, `@/lib/utils`, `@/components/ui/dialog` i ikony.

#### 4. Galeria mountuje wyspę

**File**: `src/components/offers/OfferGallery.astro`

**Intent**: siatkę zastępuje `<OfferPhotoViewer client:load photos={galleryPhotos(...)} title={title} openAt={openAt} />`; `Card`, nagłówek i `Unstated` zostają w Astro (przy zerze zdjęć wyspa się nie montuje).

**Contract**: nowy opcjonalny prop `openAt?: number` (tylko dla deva); `OfferCard` go nie przekazuje.

#### 5. Stan dev „lightbox otwarty na zdjęciu N”

**File**: `src/pages/dev/offer-card.astro`

**Intent**: osobna sekcja „Galeria — przeglądarka zdjęć” renderująca `OfferGallery` z `fullOffer.images` (szerokość lewej kolumny karty) i linkami `?open=photo-1…photo-4`; `Astro.url.searchParams.get("open")` → `clampOpenAt`; tylko jedna sekcja na stronie może być otwarta, bo dialog jest modalny.

**Contract**: parametr `?open=photo-<n>` (1-based); wartość spoza zakresu lub inna → sekcja zamknięta.

#### 6. Testy

**Files**: `tests/lib/offer-gallery.test.ts`, `tests/components/offers/render.test.ts`

**Intent**:

- Czyste funkcje: zawijanie w obie strony obok kroku wewnątrz zakresu; `total === 1`; licznik; `opensViewer` — każdy modyfikator, środkowy przycisk i `defaultPrevented` obok przypadku, który otwiera; `clampOpenAt` dla 0, M+1, tekstu, `null`.
- Render: SSR galerii (teraz przez wyspę) daje ten sam zestaw `href`/`src`/`srcset` co w fazie 2 (asercje z fazy 2 przechodzą bez zmian wartości; normalizacja `<astro-island …>` jak w `:424`); atrybut `props` wyspy nie zawiera żadnej wartości odrzuconej przez filtr (wrogie `thumbnail`/`large`/`medium` z przypadku „exactly the one valid entry”); przy jednym zdjęciu `grid-cols-1`; przy zerze brak `<astro-island`.

**Contract**: bez nowych zależności testowych.

### Success Criteria:

#### Automated Verification:

- Testy przechodzą: `npm test`
- Typy: `npx astro sync && npx astro check`
- Lint (tokeny, brak `"use client"`): `npm run lint`
- Build: `npm run build`
- `package.json` ma `@radix-ui/react-dialog` w `dependencies` i nie ma `radix-ui` ani `cn` — `node -e "const p=require('./package.json');if(!p.dependencies['@radix-ui/react-dialog']||p.dependencies['radix-ui']||p.dependencies.cn)process.exit(1)"`

#### Manual Verification:

- `/dev/offer-card`: klik otwiera dialog, ←/→ i przyciski zawijają, Esc/„Zamknij” zamykają, fokus wraca; ctrl-/środkowy klik → nowa karta (pod `npm run dev`, restart serwera po `astro sync`)
- `?open=photo-3` otwiera dialog na „3 z 4”
- Bez JS klik miniatury otwiera `large` w nowej karcie
- Drzewo dostępności: dialog „Zdjęcia: …”, licznik w regionie live

---

## Phase 4: E2E i dokumentacja

### Overview

Jeden spec Playwright dla zachowań, których nie widzi SSR (klawiatura, zawijanie, Esc, fokus), oraz porządki w dokumentacji.

### Changes Required:

#### 1. Fixture oferty ze zdjęciami

**File**: `tests/e2e/fixture-offer.ts`

**Intent**: `createFixtureOffer` przyjmuje opcjonalne `images` i zapisuje je w wierszu; domyślnie zachowanie bez zmian.

**Contract**: piąty parametr `images?: OfferImage[]` (typ z `@/lib/otodom/types` przez `import type`, jeśli alias działa w Playwright; inaczej lokalny typ strukturalny).

#### 2. Spec

**File**: `tests/e2e/photo-lightbox.spec.ts` (nowy, wzór `delete-with-confirmation.spec.ts`)

**Intent**: oferta z trzema zdjęciami na hoście `https://e2e-photos.example.com/…`, przechwyconym przez `page.route` i odpowiadającym małym obrazkiem lub 404 — żadnego ruchu do otodom ani na zewnątrz. Kroki: `waitForIslands`; klik 2. miniatury → widoczny `dialog` o nazwie „Zdjęcia: …”, licznik „2 z 3”; `ArrowRight` → „3 z 3”; `ArrowRight` → „1 z 3” (zawinięcie); `ArrowLeft` → „3 z 3”; przycisk „Następne zdjęcie” → „1 z 3”; Esc → dialog ukryty, fokus na 2. linku miniatury. `afterEach` usuwa ofertę przez `deleteFixtureOffer` (1 wiersz). Nagłówek `// risk:` i `// seed:` jak we wzorze.

**Contract**: nazwa `*.spec.ts`; konto `E2E_USERNAME`; bez wylogowania.

#### 3. Dokumentacja ingestion

**File**: `context/foundation/ingestion/otodom_fetching.md`

**Intent**: wiersz `images[]` (`:243`) wymienia `{thumbnail, small, medium, large, isExterior}` ze zmierzonymi rozmiarami (184×138, 314×236, 655×491, 2048×1536; sufiks `image;s=WxH;q=80`, zmierzone 2026-10-17) i odsyła do tego, co mapper przechowuje.

#### 4. Roadmapa

**File**: `context/foundation/roadmap.md`

**Intent**: usunąć „Photo viewer inside the card (lightbox)” z `## Parked`; w `## Done` dopisać wpis, że temat zdjęto z parkingu 2026-10-17 (warunek powrotu zaszedł) i dostarcza go zmiana `offer-photo-lightbox` poza M-1 (ścieżkę archiwum uzupełnia `/10x-archive`); podbić `updated:`.

#### 5. Reguła kitchen sinka

**File**: `CLAUDE.md`

**Intent**: w punkcie `### UI` o `/dev/offer-card` jedno zdanie: lightbox galerii renderuje się tam we własnej sekcji, a `?open=photo-<n>` otwiera go na zdjęciu N; `openAt` istnieje wyłącznie dla tej strony. To nie jest reguła produktu ani twarda reguła, więc `packages/code-reviewer/src/prompts/system.ts` bez zmian.

### Success Criteria:

#### Automated Verification:

- Spec przechodzi lokalnie (lokalny Supabase): `npx playwright test tests/e2e/photo-lightbox.spec.ts`
- Pozostałe specy dalej przechodzą: `npx playwright test`
- `npm test`, `npm run lint`, `npx astro check` przechodzą

#### Manual Verification:

- `otodom_fetching.md` i `roadmap.md` spójne (brak wpisu w Parked, wpis w Done)
- Prawdziwa oferta: po ręcznym re-fetchu siatka pobiera `medium`, oferta sprzed zmiany — `large` (FR-009)

---

## Testing Strategy

### Unit Tests:

- Mapper: `medium` obecne / wrogie / brak, bramka `thumbnail`+`large` niezmieniona.
- `src/lib/offer-gallery.ts`: filtr wiersza, `srcset`/`sizes`, zawijanie, licznik, `opensViewer`, `clampOpenAt` — każdy odrzucony przypadek obok zachowanego, oczekiwane wartości ręcznie.

### Integration Tests:

- Render przez Container API: whitelist URL-i obejmuje `srcset` i atrybut `props` wyspy; wrogie `medium` nie trafia do markup'u.
- Playwright: otwarcie, ←/→ z zawijaniem, przycisk, Esc, powrót fokusu.

### Manual Testing Steps:

1. `/dev/offer-card`: ostre miniatury (Network: `medium`/`large`), stan bez `medium`.
2. Lightbox: klik, strzałki, Esc, „Zamknij”, ctrl-klik/środkowy klik → nowa karta.
3. JS wyłączony → nowa karta z `large`.
4. `?open=photo-3` → „3 z 4”.

## Performance Considerations

- Siatka 3-kolumnowa pobiera `medium` (~54 KB/zdjęcie zamiast ~7 KB `thumbnail`); stare wiersze pobierają `large` (~328 KB/zdjęcie) do ręcznego re-fetchu — świadoma decyzja użytkownika (ostrość ponad transfer). `loading="lazy"` zostaje.
- Brak pracy CPU w Workerze — wszystko to renderowanie atrybutów.

## Migration Notes

Bez migracji SQL i bez backfillu: kolumna `images jsonb` przyjmuje nowe pole. Wiersze dostają `medium` dopiero przy ręcznym re-fetchu (FR-009); do tego czasu widok używa `large`.

## References

- Research: `context/changes/offer-photo-lightbox/research.md`
- Galeria: `src/components/offers/OfferGallery.astro:18-55`
- Mapper: `src/lib/otodom/map.ts:46-58, 190-200`
- Prymityw: `src/components/ui/alert-dialog.tsx:2, 19-46`
- Dev `?open=`: `src/pages/dev/forms.astro:120-123`, `src/components/form/ConfirmDialog.tsx:34-37`
- Wzór czystych funkcji wyspy: `src/lib/audit/stream.ts`, `tests/lib/audit/stream.test.ts`
- Wzór E2E: `tests/e2e/delete-with-confirmation.spec.ts`, `tests/e2e/fixture-offer.ts`
- Lekcja: `context/foundation/lessons.md` — „Render URLs from database rows only through `safeHttpsUrl`”

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Mapper i typ — wariant `medium`

#### Automated

- [x] 1.1 Testy mappera dla `medium` przechodzą: `npx vitest run tests/lib/otodom/map.test.ts` — a082512
- [x] 1.2 Cały zestaw przechodzi: `npm test` — a082512
- [x] 1.3 Typy: `npx astro sync && npx astro check` — a082512
- [x] 1.4 Lint: `npm run lint` — a082512

### Phase 2: Ostra siatka — `srcset` i `sizes`

#### Automated

- [x] 2.1 Testy modułu i renderu przechodzą: `npx vitest run tests/lib/offer-gallery.test.ts tests/components/offers/render.test.ts` — 4775dbf
- [x] 2.2 Cały zestaw przechodzi: `npm test` — 4775dbf
- [x] 2.3 Typy: `npx astro sync && npx astro check` — 4775dbf
- [x] 2.4 Lint (tokeny): `npm run lint` — 4775dbf
- [x] 2.5 Build: `npm run build` — 4775dbf

#### Manual

- [x] 2.6 `/dev/offer-card`: ostre siatki (`medium` w 3 kolumnach, `large` przy jednym zdjęciu), `legacyImagesOffer` ostry z `large`, stany z wrogimi URL-ami bez zmian (sprawdzenie pod `npm run dev`, DevTools → Network) — 4775dbf

### Phase 3: Lightbox — dialog i wyspa

#### Automated

- [x] 3.1 Testy przechodzą: `npm test`
- [x] 3.2 Typy: `npx astro sync && npx astro check`
- [x] 3.3 Lint (tokeny, brak `"use client"`): `npm run lint`
- [x] 3.4 Build: `npm run build`
- [x] 3.5 `package.json` ma `@radix-ui/react-dialog` w `dependencies` i nie ma `radix-ui` ani `cn`

#### Manual

- [x] 3.6 `/dev/offer-card`: klik otwiera dialog, ←/→ i przyciski zawijają, Esc/„Zamknij” zamykają, fokus wraca; ctrl-/środkowy klik → nowa karta (pod `npm run dev`, restart serwera po `astro sync`)
- [x] 3.7 `?open=photo-3` otwiera dialog na „3 z 4”
- [x] 3.8 Bez JS klik miniatury otwiera `large` w nowej karcie
- [x] 3.9 Drzewo dostępności: dialog „Zdjęcia: …”, licznik w regionie live

### Phase 4: E2E i dokumentacja

#### Automated

- [ ] 4.1 Spec przechodzi lokalnie: `npx playwright test tests/e2e/photo-lightbox.spec.ts`
- [ ] 4.2 Pozostałe specy dalej przechodzą: `npx playwright test`
- [ ] 4.3 `npm test`, `npm run lint`, `npx astro check` przechodzą

#### Manual

- [ ] 4.4 `otodom_fetching.md` i `roadmap.md` spójne (brak wpisu w Parked, wpis w Done)
- [ ] 4.5 Prawdziwa oferta: po ręcznym re-fetchu siatka pobiera `medium`, oferta sprzed zmiany — `large` (FR-009)
