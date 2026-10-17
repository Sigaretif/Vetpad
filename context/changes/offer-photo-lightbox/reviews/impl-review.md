<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Ostre miniatury galerii i lightbox zdjęć na karcie oferty

- **Plan**: context/changes/offer-photo-lightbox/plan.md
- **Scope**: Full plan (commity a082512..fe93bf5, baza 9fb0ecc)
- **Reviewed phases**: 1, 2, 3, 4
- **Date**: 2026-10-17
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 1 warning, 3 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | WARNING |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | WARNING |

Bramki uruchomione w przeglądzie: `npm test` (50 plików, 2547 testów), `npm run lint`, `npx astro sync && npx astro check` (0 błędów), `npm run build`, kontrola zależności z 3.5, `npx playwright test tests/e2e/photo-lightbox.spec.ts` (lokalnie, 2/2) — wszystkie zielone.

## Findings

### F1 — Przecinek na końcu URL-a wstrzykuje kandydata do `srcset`

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/offer-gallery.ts:43-50
- **Detail**: Komentarz `gridSrcset` twierdzi, że znormalizowany `href` „cannot split a candidate”. To prawda dla białych znaków (`%20`), ale `URL.href` zostawia przecinki: `new URL("https://x.pl/a,").href === "https://x.pl/a,"`. Parser `srcset` z HTML obcina końcowe przecinki i kończy na nich kandydata, więc wrogie `medium` = `https://x.pl/a,` (zapisane przez Data API) daje `https://x.pl/a, 655w, <large> 2048w` → `655w` staje się względnym URL-em kandydata (GET `/offers/655w` z tego samego originu). Schemat dalej chroni `safeHttpsUrl`, wstrzykiwany token jest stałym literałem, więc bez XSS — ale komentarz kłamie, a `srcsetUrls` w `tests/components/offers/render.test.ts` dzieli tylko po białych znakach i tego nie wykryje (test „space and a comma” pokrywa przecinek w środku).
- **Fix**: W `gridSrcset` kodować końcowe przecinki URL-a jako `%2C` (lub pomijać takiego kandydata), poprawić komentarz i dodać przypadek testowy z `medium`/`large` zakończonym przecinkiem w `tests/lib/offer-gallery.test.ts` i w renderze, z parsowaniem zgodnym z regułą końcowego przecinka.
- **Decision**: FIXED — `srcsetUrl` w `gridSrcset` koduje końcowe przecinki jako `%2C`, komentarz poprawiony; `srcsetUrls` w render.test.ts odrzuca URL kandydata zakończony przecinkiem; nowe przypadki w offer-gallery.test.ts i render.test.ts (break-check: oba czerwone na kodzie bez kodowania).

### F2 — Progress 4.5 odhaczony przez agenta, nie przez użytkownika

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: context/changes/offer-photo-lightbox/plan.md (Progress 4.5)
- **Detail**: Brief przeglądu mówi, że 4.5 miał czekać na potwierdzenie użytkownika. W tej sesji użytkownik polecił „sam potwierdź 4.5”, więc agent wykonał jeden ręczny re-fetch na lokalnym `npm run dev` + lokalnym Supabase (oferta `c1a66054…`, konto `sigaretif1@vetpad.local`, jedno żądanie do otodom.pl). Dowody: przed — 12 zdjęć bez `medium`, siatka tylko `s=2048x1536`; po — `?refetched=changed`, 8/8 zdjęć z `medium`, `srcset` = `medium 655w, large 2048w`. Wiersz audytu bajt w bajt ten sam (md5), audyt `stale` z powodu zmiany ogłoszenia na otodom (kolumny audytu), nie `images`. Niezweryfikowane: produkcja (zmiana niewdrożona) i nienaruszalność notatek (oferta nie miała notatek). Tego przeglądu nie powtarzano.
- **Fix**: Zostawić odhaczone z tym opisem albo odznaczyć i powtórzyć sprawdzenie samodzielnie / na produkcji po wdrożeniu.
- **Decision**: FIXED — 4.5 zostaje odhaczony; dowody (lokalny re-fetch) i to, czego nie sprawdzono, opisane wyżej.

### F3 — Wyspa importuje `Button` spoza kontraktu planu

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/components/offers/OfferPhotoViewer.tsx:3
- **Detail**: Kontrakt wymieniał tylko `@/lib/offer-gallery`, `@/lib/utils`, `@/components/ui/dialog` i ikony; wyspa importuje też `Button` z `@/components/ui/button` dla strzałek. Zgodne z regułą „komponenty tylko z `src/components/ui`”, nieszkodliwe.
- **Fix**: Brak zmiany w kodzie — uznać za dopuszczalne odchylenie (ewentualnie dopisek w planie).
- **Decision**: FIXED — uznane za dopuszczalne odchylenie, bez zmiany w kodzie.

### F4 — Zdanie o mapperze stoi w tabeli wyników wyszukiwania

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/foundation/ingestion/otodom_fetching.md:243
- **Detail**: Wiersz `images[]` należy do tabeli pól `searchAds.items[]` (wynik wyszukiwania, ścieżka niedozwolona dla Vetpada), a mapper czyta `ad.images` ze strony oferty (§ 7.1/7.4, linie ~482-483). Edycja wiernie wykonuje plan, ale „The mapper stores…” wisi przy niewłaściwym kształcie. Reszta 44-liniowego diffu to tylko wyrównanie tabeli przez prettier.
- **Fix**: Przenieść zmierzone rozmiary i odesłanie do `mapImages` do akapitu § 7 o `images[]` strony oferty (~:482), a w :243 zostawić same pola.
- **Decision**: FIXED — rozmiary, sufiks i odesłanie do `mapImages` przeniesione do akapitu o `images[]` strony oferty (§ 7.4); wiersz :243 wymienia pola i odsyła do niego.
