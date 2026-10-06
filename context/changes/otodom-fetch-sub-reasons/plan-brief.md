# Pod-powody na granicy pobrania z otodom — Plan Brief

> Full plan: `context/changes/otodom-fetch-sub-reasons/plan.md`

## What & Why

Pobranie ogłoszenia z otodom zwraca dziś jeden powód `shape_changed` dla czterech
różnych źródeł, więc blokada podana z kodem 200 jest logowana i pokazywana członkowi
jako „strona mogła zmienić format". To jest rozróżnienie, od którego
`context/foundation/deployment-runbook.md` uzależnia decyzję o przejściu na Apify.
Zmiana rozdziela źródła porażki, dokłada do wpisu to, co odpowiedź o sobie
powiedziała, i przestaje gubić wyjątek z pobrania.

Krok 2 z sekcji 6 raportu
`context/audits/observability/2026-10-05_verify-add-offer-from-otodom.md`; zamyka
A4, A6, A15 i resztę A3.

## Starting Point

`POST /api/offers` loguje już każdy wynik przez `src/lib/log.ts`, z etapem, powodem
i statusem. Wewnątrz etapu `fetch` moduł `src/lib/otodom/fetch.ts` oddaje tylko
`reason` i czasem `status`; jeden `try` obejmuje żądanie, sprawdzenie lądowania
i czytanie treści, a `catch` zostawia z błędu jedno słowo.

## Desired End State

Z jednego wpisu `offer_add` da się odczytać, czy otodom zablokował pobranie, przysłał
stronę bez danych, zmienił kształt danych, czy przekierował w nieznane miejsce — ze
statusem, hostem i ścieżką lądowania, typem i długością treści oraz nagłówkami
`cf-mitigated` i `retry-after`. Członek czyta „zmienić format" tylko wtedy, gdy dane
przyszły i są zepsute. Runbook opisuje te wpisy.

## Key Decisions Made

| Decision                                  | Choice                                                                                                                                       | Why (1 sentence)                                                                             |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Co znaczy „rozpoznana" strona anty-botowa | Wyłącznie nagłówek `cf-mitigated`, przy dowolnym statusie                                                                                    | Nikt nie widział strony wyzwania otodom, więc każda heurystyka po treści byłaby zgadywaniem. |
| Komunikat dla członka                     | Własne zdanie dla blokady, neutralne dla strony bez znacznika; „zmienić format" zostaje dla zepsutego JSON-a, braku `pageProps` i braku `ad` | Żadne zdanie nie twierdzi więcej, niż kod wie.                                               |
| Lądowanie na otodom poza ofertą           | `/wyniki` i `/pl/wyniki` to `not_found` na info; każda inna ścieżka to `unexpected_landing` na error, z tym samym zdaniem dla członka        | Nierozpoznane lądowanie nie może udawać wygasłej oferty.                                     |
| Co logujemy z adresu lądowania            | Host zawsze; ścieżka tylko poza stroną oferty; dla strony oferty sam token `ID…`                                                             | Ścieżka wyzwania jest w logu, słowa tytułu ogłoszenia nadal nie.                             |
| Runbook                                   | Nowa lista wpisów i wiersz w „Symptoms that lie"; sonda zostaje jako potwierdzenie                                                           | Dokument ma opisywać log, który istnieje, w tej samej zmianie co kod.                        |
| Kolejność sprawdzeń                       | `cf-mitigated` przed statusem                                                                                                                | 403 z nagłówkiem jest blokadą nazwaną, status i tak jest we wpisie.                          |
| Gdzie żyje pod-powód                      | Istniejące pole `detail`, jak w mapperze                                                                                                     | Jedno pole na pod-powód w całym wpisie, bez nowego klucza.                                   |
| Wyjątek z pobrania                        | Dwa wąskie `try`, faza `headers` / `body`, komunikat i przyczyna z wyciętymi adresami                                                        | `network` przestaje wchłaniać cudze wyjątki, a slug i query string nie wychodzą z modułu.    |
| Treść odpowiedzi spoza 2xx                | Nie jest czytana                                                                                                                             | Status i nagłówki wystarczą, a zmiana nie dokłada pracy przy blokadzie.                      |

## Scope

**In scope:**

- Trzy nowe powody (`challenged`, `data_missing`, `unexpected_landing`) i trzy
  wartości `detail` dla `shape_changed` z etapu `fetch`.
- Dane o odpowiedzi i o wyjątku zwracane przez `fetchOfferAd`, logowane przez trasę.
- Jedenaście nowych kluczy na białej liście reportera, z przypadkiem testowym.
- Dwa nowe zdania dla członka; `http_denied` bez „(HTTP 200)".
- Testy na krawędzi HTTP, najpierw czerwone; syntetyczne fixture'y.
- Runbook, `otodom_fetching.md` §7.1, `scripts/otodom-inspect.mjs`, §6.9 planu testów.

**Out of scope:**

- Rozpoznawanie blokady po treści strony.
- Dryf mappera (A13, A14), odczyty karty i tablicy (A8, A9, P2), pozostałe trasy
  (P3, P6–P8), czasy trwania (P9), klient (P10), przejście na Apify.
- `scripts/smoke.mjs`, bramka wizualna, nowe zależności, parser HTML.

## Architecture / Approach

Moduł pobrania zostaje bez importów wykonywalnych i niczego nie loguje: zwraca powód,
opcjonalny `detail` i obiekt `FetchEvidence`. `ingestOffer` przepuszcza go dalej.
Trasa mapuje go jawnie na klucze reportera, tak jak `dbFields` robi to dla błędów
bazy, a reporter przepuszcza tylko klucze ze swojej listy. Poziom wpisu nadal wynika
z jednej tabeli powód → wynik.

## Phases at a Glance

| Phase                  | What it delivers                                                    | Key risk                                                                        |
| ---------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 1. Pola reportera      | Jedenaście kluczy na liście i przypadek testowy                     | Klucz pominięty na liście jest cicho gubiony w fazie 3                          |
| 2. Granica pobrania    | Nowe powody, `detail`, dane do wpisu, dwa wąskie `try`, nowe zdania | Kolejność sprawdzeń i przepisanie istniejących asercji całego wyniku            |
| 3. Wpis trasy          | Dane w logu, scenariusze prywatności dla etapu `fetch`              | Rozdzielenie listy zakazanych tekstów bez osłabienia jej dla reszty scenariuszy |
| 4. Runbook i narzędzia | Runbook, dokument ingestii, skrypt diagnostyczny, §6.9              | Opis w runbooku rozjeżdża się z kodem przy następnej zmianie pól                |

**Prerequisites:** czyste drzewo na `master`; nic poza tym — testy nie potrzebują
sieci, Supabase ani sekretów.
**Estimated effort:** ~2 sesje na 4 fazy; faza 2 jest największa.

## Open Risks & Assumptions

- Lista łagodnych lądowań ma jedną pozycję (`/wyniki`), wziętą z fixture'a, nie z
  obserwacji. Jeśli otodom przekierowuje wygasłe oferty gdzie indziej, powstaną wpisy
  `unexpected_landing` na error, dopóki ścieżka nie trafi na listę — z `landed_path`
  we wpisie widać, co dopisać.
- Blokada innego dostawcy niż Cloudflare, podana z kodem 200, nie zostanie nazwana
  `challenged`. Będzie `data_missing` z długością i typem treści.
- Ścieżka lądowania poza otodom jest logowana w całości. Gdyby obca strona niosła
  slug oferty w ścieżce zamiast w query stringu, jego słowa trafiłyby do logu.
- Wycinanie adresów z komunikatu błędu opiera się na wzorcu `http(s)://…`; adres
  zapisany inaczej przeszedłby. Limit 300 znaków reportera pozostaje drugą granicą.
- `cf-mitigated` jest sprawdzany przed statusem, więc zapytanie liczące blokady po
  `http_denied` musi objąć też `challenged`. Runbook to mówi.

## Success Criteria (Summary)

- Każdy wiersz kontraktu powodów ma test, który porównuje cały wpis i zdanie dla
  członka.
- W logu nie ma treści strony, adresu oferty, słów jej sluga ani query stringa — dla
  żadnego nowego scenariusza.
- Z samej sekcji runbooka da się odróżnić blokadę od zmienionego formatu bez
  wdrażania sondy.
