---
change_id: offer-photo-lightbox
title: Sharp gallery thumbnails and an in-card photo lightbox
status: implemented
created: 2026-10-17
updated: 2026-10-17
archived_at: null
---

## Notes

Galeria zdjęć na karcie oferty (src/components/offers/OfferGallery.astro) ma dwa problemy:

1. Miniatury są rozmazane — siatka renderuje `image.thumbnail` (najmniejszy wariant z CDN otodom) rozciągnięty na komórkę 2–3 kolumn. Mapper (src/lib/otodom/map.ts, mapImages) zapisuje tylko { thumbnail, large }, odrzucając `small`/`medium`, które otodom zwraca (context/foundation/ingestion/otodom_fetching.md § 7.1/7.4).
2. Kliknięcie zdjęcia otwiera `large` w nowej karcie przeglądarki — przy ~20 zdjęciach na ofertę przeglądanie jest uciążliwe.

Cel zmiany: ostre miniatury w galerii oraz przeglądarka zdjęć (lightbox) wewnątrz karty — otwarcie kliknięciem, nawigacja poprzednie/następne (także klawiaturą), licznik „N z M”, zamknięcie Esc, z zachowaniem dostępności (fokus, aria).

Kontekst: ten temat jest w context/foundation/roadmap.md w sekcji Parked jako „Photo viewer inside the card (lightbox)” z warunkiem powrotu „gdy przeglądanie dwudziestu zdjęć stanie się realnym tarciem” — ten warunek właśnie zaszedł, zmiana zdejmuje go z parkingu. FR-007 w PRD (hotlinked photo gallery). Zdjęcia pozostają hotlinkowane (FR-004) — żadnego przechowywania plików, żadnej analizy Vision (Non-Goals).

Decyzja użytkownika: bez bramki wizualnej (bez macierzy 7 stanów i screenshotów) — zmiana nie jest gated. Nowe stany galerii/lightboxa i tak dostają wpis na /dev/offer-card.
