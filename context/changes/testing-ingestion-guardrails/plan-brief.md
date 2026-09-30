# Runner testów i strażnicy ingestii — Plan Brief

> Full plan: `context/changes/testing-ingestion-guardrails/plan.md`
> Research: `context/changes/testing-ingestion-guardrails/research.md`

## What & Why

To faza 1 rolloutu z `context/foundation/test-plan.md`. Chroni przed trzema ryzykami:

- **#1**: ingestia zapisuje fałszywą albo niepełną ofertę;
- **#6, połowa „zapis”**: dane sprzedawcy trafiają do bazy;
- **#7**: zapisany URL spoza https ląduje w `href`/`src`.

Strażnicy istnieją w kodzie, ale żaden nie ma testu. Nadchodzący kolejni zapisujący (re-fetch, fallback Apify, S-04 czytające `raw`) mogą ich po cichu obejść.

## Starting Point

W repo nie ma runnera ani żadnego testu. Mapper sprawdzono raz, ręcznie, na żywych ogłoszeniach.

Research zweryfikował dwie rzeczy o toolchainie:
- Vitest 5 z gołym `getViteConfig` pada, bo adapter Cloudflare uruchamia workerd;
- działa konfiguracja bez adaptera.

Research znalazł też dwie luki:
- `numericOrUnknown` przyjmuje `"1e3"`/`"0x10"`;
- `OfferGallery` wywraca się na `images: [null]`.

## Desired End State

`npm test` działa na świeżym klonie bez `.env` i bez sieci. Jest wymaganym krokiem w jobie `ci`. Każdy strażnik ma test, który zmienia się na czerwony po jego usunięciu:
- nieznane nigdy nie staje się zerem;
- bramka sprzedaży mieszkania;
- powody porażki fetcha;
- zapis tylko po sukcesie i bez danych sprzedawcy, z opisem zachowanym dosłownie;
- żaden widok nie wstawia URL-a spoza https.

Uszkodzony wpis zdjęć nie wywraca karty. `test-plan.md` §6 mówi kolejnemu agentowi, jak dodać test w tym projekcie.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Runner | Vitest 5 do wszystkiego, config bez adaptera | Jeden runner i jeden krok CI dla czystych modułów i renderu `.astro`; użytkownik dał zgodę wymaganą przez CLAUDE.md | Research / Plan |
| Źródło fixtur | Ręcznie napisane z `otodom_fetching.md` §7, syntetyczne kanarki | Nagrań nie ma, a nagrany payload to dane osób trzecich w publicznym repo | Research |
| „Nieparsowalne” | String liczy się tylko w zapisie dziesiętnym; `"1e3"`, `"0x10"`, `"12,5"` → nieznane | Fakt nigdy nie powstaje z interpretacji; granicę ustala guardrail PRD, nie `Number()` | Plan |
| Wynajmowany dom | Komunikat „wynajem” (pierwsza bramka), dopisane do FR-005 | Komunikat jest prawdziwy, a PRD przestaje być niejednoznaczne | Plan |
| Test route'u | Tak: jedna zaślepka `fetch` dla otodom i Supabase REST, bez mockowania modułów | Dowodzi tego, co faktycznie wychodzi do bazy, i łapie pola dopisane w route | Plan |
| Crash galerii | Naprawa w tej zmianie, bez bramki wizualnej | Test od razu zielony; poprawne dane renderują się identycznie | Plan |
| Dane osobowe w `otodom_apify.md` | Podmiana na kanarki, edycja w przód | Ta sama klasa danych co #6; przepisywanie historii jest zakazane | Plan |
| Mock `astro:env` | Domyślnie nieustawione sekrety w `setupFiles` | Prawdziwy `.env` inaczej wycieka do testów | Research |

## Scope

**In scope:**
- Vitest i `vitest.config.ts`, `npm test`, krok CI;
- testy `safeHttpsUrl`, mappera, fetcha, `ingestOffer` i `POST /api/offers`;
- render przez Container API: `OfferCard`, `OfferGallery`, `OfferBoardItem`;
- zaostrzenie `numericOrUnknown`, poprawka galerii, fixtura na `/dev/offer-card`;
- zdanie w FR-005;
- aktualizacja CLAUDE.md, README i `test-plan.md` §4/§5/§6;
- redakcja `otodom_apify.md`.

**Out of scope:**
- filtrowanie `raw.images` (Phase 4/S-04);
- host `source_url`;
- mapa S-08;
- testy re-fetch i Apify (wzorzec opisuje §6.1);
- prompt audytu;
- workerd pool, hooki, coverage;
- zmiany w smoke;
- kotwica w `lessons.md`.

## Architecture / Approach

Testy leżą w `tests/` i odwzorowują ścieżki `src/`. Wyrocznią są PRD i `otodom_fetching.md` §7, a wartości oczekiwane pisze się ręcznie. Sieć jest zaślepiona jednym `globalThis.fetch`, który rozdziela żądania po hoście:
- otodom dostaje HTML z `__NEXT_DATA__`;
- Supabase REST jest nagrywany.

Test route'u sprawdza więc faktyczne body `POST /rest/v1/offers`.

Testy #6 szukają kanarków w zserializowanym wierszu z usuniętym opisem i jednocześnie sprawdzają, że opis zachował kanarek dosłownie.

Testy #7 sprawdzają białą listę: każdy `href`/`src` zaczyna się od `https://` albo `/`.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Toolchain Vitest i bramka CI | `npm test` bez workerd i sekretów, test `safeHttpsUrl`, strażnik zero-config, krok w `ci` | Mock `astro:env` z setupu kontra nadpisanie w pliku |
| 2. Strażnicy mappera (#1, #6) | Fixtury z kanarkami; liczby, waluty, bramka, puste teksty, whitelist; zaostrzenie parsera; FR-005 | Zaostrzenie odrzuci prawdziwy format otodom (sprawdzamy `otodom:inspect`) |
| 3. Granica fetch → zapis (#1, #6) | Każdy powód porażki fetcha; route bez zapisu przy odmowie, jeden czysty zapis przy sukcesie | Kształt żądań supabase-js w zaślepce |
| 4. Strażnicy renderu (#7) | Container API na 3 widokach, poprawka galerii, fixtura | Container API jest eksperymentalne |
| 5. Dokumentacja i cookbook | CLAUDE.md, README, `test-plan.md` §4/§5/§6, redakcja `otodom_apify.md` | Dane osobowe zostają w historii git (redukcja, nie usunięcie) |

**Prerequisites:** zgoda na vitest (udzielona 2026-09-30), Node 22. Nie jest potrzebny Supabase ani sieć.

**Estimated effort:** ~3–4 sesje w 5 fazach. Faza 3 jest najdroższa.

## Open Risks & Assumptions

- Container API jest eksperymentalne i może pęknąć przy aktualizacji minor/patch Astro. Opisuje to §6.2.
- Config bez adaptera nie rozwiąże importu `cloudflare:*`. Dziś nic w `src/` go nie używa.
- Zakładamy, że otodom wysyła liczby w zapisie dziesiętnym. Kryterium 2.6 weryfikuje to na żywym ogłoszeniu.

## Success Criteria (Summary)

- `npm test` jest zielony lokalnie (z `.env` i bez) oraz w CI i nigdy nie dotyka sieci.
- Każda z wymienionych mutacji strażnika daje czerwony test.
- Kolejny agent dodaje test ingestii albo renderu na podstawie samego `test-plan.md` §6.
