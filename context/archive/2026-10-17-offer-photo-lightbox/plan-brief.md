# Ostre miniatury galerii i lightbox zdjęć — Plan Brief

> Full plan: `context/changes/offer-photo-lightbox/plan.md`
> Research: `context/changes/offer-photo-lightbox/research.md`

## What & Why

Galeria na karcie oferty rozciąga 184-pikselowy `thumbnail` na komórkę ~223 px (i ~694 px przy jednym zdjęciu), więc miniatury są rozmazane, a przeglądanie ~20 zdjęć oznacza ~20 nowych kart przeglądarki. Zmiana daje ostrą siatkę (`srcset` z `medium`/`large`) i przeglądarkę zdjęć wewnątrz karty. Warunek powrotu z Parked w roadmapie („gdy przeglądanie dwudziestu zdjęć stanie się realnym tarciem”) zaszedł.

## Starting Point

Mapper zapisuje tylko `{thumbnail, large}`, a `small`/`medium` zostają w `raw`. `OfferGallery.astro` filtruje oba URL-e przez `safeHttpsUrl` i renderuje `<a href=large target=_blank><img src=thumbnail>`. W repo nie ma prymitywu `dialog.tsx`, środowiska DOM w Vitest ani żadnej wyspy przechwytującej klik linku.

## Desired End State

Siatka jest ostra: `medium` dla nowych zapisów i re-fetchy, `large` dla starych wierszy. Lewy klik miniatury otwiera dialog z pełnym `large`. Strzałki ←/→ i przyciski zawijają na końcach, licznik „N z M” jest ogłaszany, Esc zamyka, a fokus wraca na klikniętą miniaturę. Ctrl- i środkowy klik oraz brak JS dają dzisiejszą nową kartę.

## Key Decisions Made

| Decyzja                  | Wybór                                                                                              | Dlaczego                                                               | Źródło                 |
| ------------------------ | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ---------------------- |
| Źródło wariantu          | `OfferImage.medium?` w mapperze, bez backfillu i bez `raw` w widoku                                | Walidacja w jednym miejscu; `images` jest poza audytem i fingerprintem | Research + użytkownik  |
| Bramka wpisu             | `thumbnail` + `large`; złe `medium` jest tylko pomijane                                            | Nie gubi zdjęć; ten sam zbiór co na tablicy i w archiwum               | Użytkownik             |
| Fallback starych wierszy | `large`                                                                                            | Ostrość ważniejsza niż transfer                                        | Użytkownik             |
| Siatka                   | `srcset` `medium 655w, large 2048w` + `sizes` (223px / 694px przy `lg`)                            | Pokrywa 3 kolumny i pojedyncze zdjęcie                                 | Użytkownik             |
| Lightbox                 | Wyspa React na `dialog.tsx` (shadcn + rytuał), nowa zależność `@radix-ui/react-dialog ^1.2.0`      | Fokus, Esc i a11y z Radix, zgodnie z decyzją z 2026-09-26              | Użytkownik / CLAUDE.md |
| Bez JS                   | SSR wyspy = dzisiejszy markup `<a target=_blank>`; przechwyt tylko niezmodyfikowanego lewego kliku | Zero regresji dla ctrl-/środkowego kliku i bez JS                      | Użytkownik             |
| Nawigacja                | Zawijanie; `aria-live="polite"`; czyste funkcje w `src/lib/offer-gallery.ts`                       | Logikę da się przetestować bez przeglądarki                            | Użytkownik             |
| Jedno zdjęcie            | Bez przycisków ←/→, licznik „1 z 1”                                                                | Nawigacja nic by tu nie zmieniła                                       | Plan                   |
| Przełącznik dev          | Osobna sekcja `OfferGallery` na `/dev/offer-card` + `?open=photo-<n>` → `openAt`                   | Nie zmienia interfejsu `OfferView`/`OfferCard` dla potrzeb deva        | Plan (delegowane)      |
| Testy                    | Container API + czyste funkcje + 1 spec Playwright, bez nowych bibliotek testowych                 | Klawiatura i fokus wymagają przeglądarki                               | Użytkownik             |
| Bramka wizualna          | Nie                                                                                                | Decyzja w `change.md`                                                  | Użytkownik             |

## Scope

**In scope:** typ i mapper (`medium`), moduł `src/lib/offer-gallery.ts`, `srcset`/`sizes`, `dialog.tsx`, wyspa `OfferPhotoViewer.tsx`, fixtures i sekcja na `/dev/offer-card`, testy unit, render i E2E, `otodom_fetching.md:243`, roadmapa (Parked → Done), jedno zdanie w CLAUDE.md `### UI`.

**Out of scope:** backfill, czytanie `raw`, przepisywanie `;s=` w URL-ach, miniatury na tablicy i w archiwum, zoom, gesty, mobile, preload, jsdom/testing-library, Playwright w CI, zmiany w smoke.

## Architecture / Approach

`images` (dowolna zawartość wiersza) przechodzi przez `galleryPhotos()` z `src/lib/offer-gallery.ts`, które zwraca `GalleryPhoto { medium | null, large }` (URL-e po `safeHttpsUrl`). Ta lista trafia do `OfferPhotoViewer` (`client:load`) razem z `title`. Wyspa renderuje siatkę linków, czyli fallback SSR, oraz kontrolowany dialog Radix. Indeks, licznik, `opensViewer` i `clampOpenAt` to czyste funkcje w tym samym module. Wiersz z bazy nigdy nie trafia do propsów wyspy.

## Phases at a Glance

| Faza            | Co dostarcza                                                                              | Główne ryzyko                                                   |
| --------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| 1. Mapper i typ | `medium` w nowych zapisach i re-fetchach                                                  | Pole `medium: undefined` zapisane do jsonb                      |
| 2. Ostra siatka | `srcset`/`sizes`, filtr w lib, fixtures (`legacyImagesOffer`), whitelist testu o `srcset` | `srcset` poza whitelistą testu; wrogi URL rozbijający kandydata |
| 3. Lightbox     | `dialog.tsx`, wyspa, czyste funkcje, `?open=photo-<n>`                                    | Powrót fokusu bez `DialogTrigger`; rytuał shadcn a lint tokenów |
| 4. E2E i docs   | Spec Playwright, `createFixtureOffer(images)`, docs, roadmapa, CLAUDE.md                  | Ruch sieciowy obrazków w E2E (blokowany przez `page.route`)     |

**Prerequisites:** lokalny Supabase dla fazy 4 (Playwright); `npx shadcn add dialog` w fazie 3.
**Estimated effort:** ~2–3 sesje, 4 commity.

## Open Risks & Assumptions

- Szerokości komórek (223/694 px) wyliczono z klas, nie zmierzono w przeglądarce. Błąd w `sizes` daje co najwyżej inny wybór wariantu, nie awarię.
- Stare oferty pobierają `large` (~328 KB na zdjęcie), dopóki ktoś nie zrobi ręcznego re-fetchu. To świadomy koszt.
- Rejestr shadcn może wygenerować klasy, które odrzuci `tokensOnlyConfig`. Naprawa to token, nigdy wyjątek.

## Success Criteria (Summary)

- Miniatury na karcie są ostre, także na ofertach zapisanych przed zmianą.
- Członek zespołu przegląda wszystkie zdjęcia oferty w dialogu, klawiaturą lub przyciskami, bez otwierania nowych kart. Ctrl-klik i brak JS działają jak dziś.
- Żaden URL z wiersza nie trafia do `href`/`src`/`srcset` ani do propsów wyspy bez `safeHttpsUrl`. Pilnują tego testy renderu.
