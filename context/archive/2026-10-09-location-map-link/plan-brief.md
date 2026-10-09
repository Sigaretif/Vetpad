# Link do mapy z lokalizacji ogłoszenia — Plan Brief

> Full plan: `context/changes/location-map-link/plan.md`

## What & Why

Karta oferty dostaje link, który jednym kliknięciem otwiera wyszukiwanie Google Maps dla
lokalizacji z ogłoszenia (FR-008, slice S-08). Znika krok „gdzie to właściwie jest?":
członek nie kopiuje adresu do przeglądarki.

## Starting Point

`public.offers` trzyma już `location_label`, `street_name` i współrzędne, a karta
(`src/components/offers/OfferCard.astro`) pokazuje etykietę lokalizacji i link do
oryginału na otodom. Nic w `src/` nie buduje dziś adresu mapy.

## Desired End State

Na karcie oferty z podaną miejscowością stoi link „Pokaż na mapie Google ↗", który w nowej
karcie otwiera wyszukiwanie, np. `ul. Przykładowa, Warszawa, Mokotów, Stary Mokotów`.
Oferta bez etykiety miejscowości nie ma linku — także wtedy, gdy ma samą ulicę.

## Key Decisions Made

| Decyzja                  | Wybór                                     | Dlaczego                                                                                 |
| ------------------------ | ----------------------------------------- | ---------------------------------------------------------------------------------------- |
| Skład zapytania          | Ulica + etykieta; bez ulicy sama etykieta | FR-008 mówi „z tekstu lokalizacji", a to najdokładniejsze, co samo ogłoszenie podaje.    |
| Współrzędne              | Nieużywane                                | Punkt z otodom bywa przybliżony, a pinezka wyglądałaby jak dokładny adres.               |
| Sama ulica, bez etykiety | Brak linku                                | Google wybrałby miasto sam — to domysł, przed którym ostrzega roadmapa.                  |
| Zasięg                   | Tylko karta oferty                        | Wiersz tablicy jest już linkiem do karty; drugi cel kliknięcia to osobna zmiana.         |
| Bramka wizualna          | Bez bramki                                | Link kopiuje istniejący wariant przycisku „link" i nie wnosi nowego wyglądu.             |
| Bezpieczeństwo adresu    | `encodeURIComponent` + `safeHttpsUrl`     | Wiersz może zmienić każdy członek przez Data API (lekcja z `lessons.md`, wymienia S-08). |

## Scope

**In scope:**

- `src/lib/map-link.ts` — reguła: czy jest link i jaki ma adres
- Link na `OfferCard.astro`
- Dwa nowe stany na `/dev/offer-card`
- Test reguły i test renderowania
- Jeden punkt referencji w `CLAUDE.md`

**Out of scope:**

- Link na tablicy `/dashboard`
- Współrzędne, osadzona mapa, geokodowanie, trasy, czas dojazdu
- Migracje, trasy API, `scripts/smoke.mjs`, Playwright, zrzuty ekranu

## Architecture / Approach

`mapSearchUrl(offer)` przycina ulicę i etykietę, bez etykiety zwraca `null`, w przeciwnym
razie składa `https://www.google.com/maps/search/?api=1&query=<zakodowane zapytanie>` i
oddaje wynik przez `safeHttpsUrl`. Karta renderuje link tylko dla napisu. Treść wiersza
trafia wyłącznie do wartości parametru `query`.

## Phases at a Glance

| Faza                     | Co dostarcza                                              | Główne ryzyko                                                      |
| ------------------------ | --------------------------------------------------------- | ------------------------------------------------------------------ |
| 1. Reguła linku do mapy  | Czysta funkcja z testem jednostkowym i przeglądem mutacji | Wroga wartość z wiersza wychodząca poza parametr `query`           |
| 2. Link na karcie oferty | Link na karcie, stany na `/dev/offer-card`, test renderu  | Układ dwóch linków na 375 px sprawdzany tylko ręcznie (bez bramki) |

**Prerequisites:** S-02 (`paste-listing-to-card`) — zrobione; kolumny lokalizacji istnieją.
**Estimated effort:** jedna sesja, dwie krótkie fazy.

## Open Risks & Assumptions

- Google może źle dopasować nietypowy zapis ulicy; link jest z założenia zgrubnym
  sprawdzeniem okolicy, nie adresem.
- Założenie: format `maps/search/?api=1&query=` pozostaje wspierany; to udokumentowany,
  stabilny format Maps URLs.

## Success Criteria (Summary)

- Członek otwiera mapę okolicy ogłoszenia jednym kliknięciem z karty oferty.
- Oferta, która nie podaje miejscowości, nie dostaje linku zgadującego adres.
- Żadna wartość zapisana w wierszu nie zmienia celu linku ani nie staje się znacznikiem.
