# Wklejony URL otodom.pl staje się zapisaną kartą oferty — Plan Brief

> Pełny plan: `context/changes/paste-listing-to-card/plan.md`

## What & Why

S-02 z roadmapy — north star całego MVP. Zespół ma przestać trzymać w arkuszu „ślepe linki": wklejony URL ogłoszenia otodom.pl ma się stać kartą z pełną treścią, parametrami i zdjęciami, czytelną bez otwierania portalu (US-01, FR-004, FR-005, FR-007). To pierwsze zetknięcie z ryzykiem ingestii, od którego zależy wszystko dalsze — audyt, notatki i tablica mają sens tylko wtedy, gdy wklejony link niezawodnie staje się zapisanym ogłoszeniem.

## Starting Point

Aplikacja ma dziś wyłącznie logowanie. `supabase/migrations/` **nie istnieje** — jedyny SQL w historii repo to seed z trzema kontami zespołu, a baza używa tylko `auth.users`. W `src/pages/api/` są dwie trasy autoryzacyjne, `dashboard.astro` to placeholder z e-mailem i przyciskiem wylogowania. Żadna wyspa React w repo nie używa `fetch()`; trasy formularzowe raportują błąd przekierowaniem z `?error=`. Dostęp do otodom.pl z egressu Cloudflare jest zweryfikowany end-to-end (200, `pageProps.ad`, parsowanie poniżej 1 ms na planie Free).

## Desired End State

Członek zespołu wkleja URL na dashboardzie, widzi „Pobieram ogłoszenie…", po chwili ląduje na `/offers/<id>` z opisem, tabelą parametrów i galerią. Ogłoszenie wynajmu, domu, obcy host, wygasła oferta i odmowa portalu dają cztery różne komunikaty i **zero wierszy w bazie**. Nieznany parametr czyta „nie podano w ogłoszeniu". Pola kontaktowe ogłoszeniodawcy (telefon, nazwisko) nie trafiają do bazy; tekst ogłoszenia jest zapisywany tak, jak go napisano.

## Key Decisions Made

| Decyzja | Wybór | Dlaczego |
| --- | --- | --- |
| Kształt przechowywania | Typowane, nullowalne kolumny na fakty + `raw jsonb` z białej listy kluczy | `null` w kolumnie wyraża guardrail „nieznane zamiast zera" strukturalnie, a `raw` karmi audyt S-04 i re-fetch S-09 bez ponownego pobierania. |
| Zakres ogłoszeń | Wyłącznie sprzedaż mieszkania | Produkt służy do kupowania mieszkania; karta i przyszły audyt mówią słownikiem mieszkaniowym, więc odmowa na granicy jest tańsza niż karta bez sensu. Nowa decyzja produktowa, zapisana w PRD → FR-005 i Non-Goals. |
| Dyskryminator transakcji | `ad.adCategory.type` / `.name`, kontrola krzyżowa `target.OfferType` | Zweryfikowane na żywo: `ad.transaction` nie istnieje na stronie oferty, a `ad.market` zwraca `ALL` dla wynajmu. |
| Opis ogłoszenia | Normalizacja do czystego tekstu przy pobraniu | Cytat audytu (FR-011) zgadza się znak w znak z tym, co widzi człowiek, i nie potrzeba sanitizera ani nowej zależności. |
| Prezentacja „nieznane" | Etykieta zawsze, wartość „nie podano w ogłoszeniu" | Rozstrzyga Open Question 2 z PRD: brak wiersza byłby nieodróżnialny od błędu mapowania. |
| UX dodawania | Zwykły POST formularza, limit 45 s po stronie serwera | Dokładnie istniejący wzorzec repo; zmierzony czas pobrania to ~1 s, więc pasek etapów byłby teatrem. |
| Walidacja URL | Ręcznie, bez `zod` | Reguła to `new URL()` i dwa porównania; twarde miejsca mappera to reguły biznesowe, których schema nie wyraża lepiej. Decyzja o bibliotece należy do S-04. |
| Duplikaty | Lookup po znormalizowanym URL-u **przed** pobraniem, unikalny indeks na `otodom_id`, `created_by` teraz; nazwanie autora w S-07 | Znana oferta otwiera kartę bez odpytywania portalu, także po wygaśnięciu; `otodom_id` łapie zmianę sluga, której URL nie złapie. S-07 dokłada tylko warstwę komunikatu. |
| Fallback Apify | Nie teraz; zamiast tego rozróżnialne tryby awarii | Ścieżka bezpośrednia jest zweryfikowana; rozróżnienie „odmowa HTTP" od „zmiana kształtu strony" mówi, kiedy fallback naprawdę staje się potrzebny. |
| Zakres smoke | Bez sieci do otodom.pl | Brama jakości nie może zależeć od cudzego portalu ani od reputacji IP runnera GitHuba; wszystkie ścieżki odmowy są i tak pokryte. |
| Debugowanie ingestii | `scripts/otodom-inspect.mjs` importujący prawdziwy mapper | Zamyka pętlę „to pole źle się przemapowało — oto URL" bez pisania skryptu od zera i bez kopii mappera, która się rozjedzie. |

## Scope

**In scope:** pierwsza migracja z RLS i unikalnym indeksem; moduł ingestii (normalizacja URL, pobranie, bramka sprzedaż-mieszkanie, mapowanie, odcięcie danych osobowych); trasa `POST /api/offers` z pełnym zestawem odmów; formularz na dashboardzie; karta `/offers/<id>` z parametrami, opisem i galerią; skrypt inspekcyjny; kroki smoke; aktualizacja PRD, CLAUDE.md, README, roadmapy i dokumentu ingestii.

**Out of scope:** tablica ofert (S-06), notatki (S-05), audyt AI (S-04), re-fetch i flaga nieaktualności (S-09), link do map (S-08), pełne powiadomienie o duplikacie z nazwiskiem autora (S-07), archiwizacja i usuwanie (S-10, S-11), fallback Apify, lightbox zdjęć, biblioteka walidacyjna, runner testów.

## Architecture / Approach

Ingestia to trzy czyste moduły w `src/lib/otodom/` — URL, pobranie, mapowanie — złożone jedną funkcją orkiestrującą, która zwraca zamknięty zbiór powodów odmowy. Trasa API tłumaczy te powody na polskie komunikaty i jest jedynym miejscem dotykającym Supabase; mapper nie wie nic o HTTP ani o bazie, dzięki czemu skrypt inspekcyjny ładuje go wprost w Node. Pobranie to jeden `fetch`, jeden ograniczony `RegExp` nad `__NEXT_DATA__` i jeden `JSON.parse` — żadnego parsowania HTML w Workerze. Guardraile produktowe mają po jednym miejscu egzekwowania: bramka kategorii, funkcja `numericOrUnknown`, usunięcie `owner`/`agency`/`contactDetails` przed powstaniem `raw`.

## Phases at a Glance

| Faza | Co dostarcza | Kluczowe ryzyko |
| --- | --- | --- |
| 1. Migracja `offers` z RLS | Pierwsza tabela domenowa, cztery polityki, unikalny indeks, zamrożony `created_by` | Brak lub zbyt luźna polityka to ekspozycja danych, nie usterka — a sygnaturą jest pusta tablica i HTTP 200, nie błąd |
| 2. Moduł ingestii + skrypt inspekcyjny | Normalizacja URL, pobranie, bramka, mapowanie, odcięcie danych osobowych | Trzy guardraile produktowe łamie się kodem, który wygląda poprawnie; to jedyna faza, w której da się je sprawdzić w izolacji |
| 3. Ścieżka zapisu | `POST /api/offers`, formularz, dziesięć rozróżnialnych odmów, kroki smoke | Nieudane pobranie nie może zostawić wiersza — ani pustego, ani częściowego |
| 4. Karta oferty | `/offers/<id>` z parametrami, opisem i galerią | „Nie podano" musi trafić wszędzie tam, gdzie wartość jest nieznana — jedno przeoczenie to sfabrykowany fakt |
| 5. Dokumentacja i domknięcie | Log weryfikacji ingestii, CLAUDE.md, PRD, README, roadmapa | Ustalenia o payloadzie przepadną, jeśli zostaną tylko w tym planie |

**Prerequisites:** S-01 (zamknięta rejestracja) — gotowe i zarchiwizowane. Lokalny Supabase uruchomiony (`npx supabase start`) do weryfikacji ręcznej.
**Estimated effort:** 5 faz, najcięższe są 2 i 3; faza 1 jest krótka, ale wymaga uwagi przy politykach.

## Open Risks & Assumptions

- **Dostęp do otodom.pl nie jest zagwarantowany.** Jedna udana sonda z egressu Cloudflare to nie gwarancja; blokowanie zakresów datacenter przychodzi stopniowo. Mitygacja: rozróżnialne tryby awarii i zaparkowany, udokumentowany fallback.
- **Kształt payloadu może się zmienić w każdej chwili.** Smoke nie dotyka portalu, więc regresję mapowania wykryje dopiero ręczne dodanie oferty. Mitygacja: skrypt inspekcyjny i jawny powód odmowy `shape_changed`, który nie udaje innego błędu.
- **Słownik etykiet enumów jest niepełny z definicji** — otodom może zwrócić token, którego nie znamy. Założenie: nieznany token renderuje się dosłownie, nigdy jako „nie podano", bo nieznany kod to nie brak danych.
- **Tekst ogłoszenia może nieść kontakt.** `raw` powstaje z białej listy, więc pola `owner`/`agency`/`contactDetails` i każdy nowy klucz otodomu zostają poza bazą. Opis i tytuł są jednak przechowywane dosłownie, także gdy ogłoszeniodawca wpisał w nie telefon — świadoma decyzja (dosłowne cytaty FR-011), zapisana w PRD w fazie 5.

## Success Criteria (Summary)

- Wklejony URL żywego ogłoszenia sprzedaży mieszkania staje się kartą z opisem, parametrami i zdjęciami — bez otwierania portalu.
- Wynajem, dom, obcy host, wygasła oferta i odmowa portalu dają rozróżnialne komunikaty i nie tworzą żadnego wiersza w bazie.
- Nieznany parametr czyta „nie podano w ogłoszeniu", a pola kontaktowe ogłoszeniodawcy (`owner`, `agency`, `contactDetails`) nie występują w bazie — również w `raw`, budowanym z białej listy.
