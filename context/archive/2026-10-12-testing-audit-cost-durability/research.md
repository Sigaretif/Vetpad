---
date: 2026-10-12T10:34:46+02:00
researcher: Wiktor Ortel (z Claude Code)
git_commit: aa082bd7e307fa782b761c89b24ade38d3747480
branch: master
repository: Sigaretif/Vetpad
topic: "Faza 3 planu testów — koszt i trwałość audytu (ryzyka #2 i #3): czego testy z S-04 nie dowodzą"
tags: [research, testing, audit, denial-of-wallet, durability, offer_audits, stryker]
status: complete
last_updated: 2026-10-12
last_updated_by: Wiktor Ortel (z Claude Code)
---

# Research: Faza 3 planu testów — koszt i trwałość audytu (ryzyka #2 i #3)

**Date**: 2026-10-12T10:34:46+02:00
**Researcher**: Wiktor Ortel (z Claude Code)
**Git Commit**: aa082bd7e307fa782b761c89b24ade38d3747480 (drzewo robocze: niezacommitowana zmiana statusu fazy 3 w `context/foundation/test-plan.md`)
**Branch**: master
**Repository**: Sigaretif/Vetpad

## Research Question

Ugruntować fazę 3 rolloutu z `context/foundation/test-plan.md` („Audit cost and durability").
S-04 dostarczyło już testy audytu i wypełniło §6.4. Co z intencji odpowiedzi na ryzyko #2
(Denial of Wallet) i #3 (utracony opłacony wynik) pozostaje **niedowiedzione**, na jakiej
warstwie najtaniej to dowieść i czego nie wolno dublować?

## Summary

Większość fazy 3 jest już dowiedziona. Ścieżki kodu obu ryzyk istnieją i są przypięte testami
z S-04; faza ma do dołożenia kilka wąskich dowodów, a nie nowy zestaw testów.

Przebieg Strykera zawężony do `src/pages/api/audits.ts`, `src/lib/audit/store.ts:1-243`
i `src/lib/audit/provider.ts` (2026-10-12, 731 mutantów, bez sieci): 599 zabitych, 1 timeout,
89 przeżyło, 42 bez pokrycia. To pierwszy taki przebieg dla tych plików — w S-04 Stryker
objął tylko `grounding.ts` i `input.ts` (`context/foundation/test-plan.md:1072-1075`), choć
§6.4 wskazuje `audits.ts` i `provider.ts` jako cel (`test-plan.md:626-627`).

Luki, które dotyczą #2 lub #3 (szczegóły w „Luki"):

1. **Wyjątek po przejęciu wiersza** — gałąź, która ma nie zostawić próby w stanie `running`
   (`src/pages/api/audits.ts:250-254`), nie ma żadnego pokrycia.
2. **Wyjątek przed przejęciem i `getSession`, które rzuca** (`audits.ts:317-321`, `:133`,
   `:354-360`) — brak scenariusza „0 wywołań dostawcy".
3. **Szew `23505`** — trasa przechodzi do przejęcia tylko po tym kodzie
   (`src/lib/audit/store.ts:96`), a ani `scripts/audit-state.sql`, ani `scripts/smoke.mjs`
   nie sprawdzają, że baza odpowiada nim na drugi insert dla tej samej oferty.
4. **Odpowiedź przejęcia bez czytelnego startu** — mutanty w `store.ts:68-71` przeżywają;
   zbadany jest tylko pusty wynik `[]`.
5. **Dwa żądania naraz** — żaden test trasy nie wysyła dwóch żądań; „drugie w trakcie
   pierwszego" jest dowiedzione w dwóch połówkach, nigdy razem.

Dwie rzeczy z intencji ryzyk nie są lukami testów, tylko stanem produktu — do decyzji
użytkownika, nie do „naprawienia testem" (patrz „Open Questions"): pętla kolejnych audytów
nie ma żadnego limitu poza blokadą jednoczesności, a opłacony wynik po dwóch nieudanych
zapisach nie jest odzyskiwalny — jest jawnie zgłaszany.

## Detailed Findings

### Ryzyko #2 — ścieżka w kodzie i co już jest dowiedzione

- Brak sesji kończy się przekierowaniem przed czymkolwiek innym
  (`src/pages/api/audits.ts:297-301`). Dowód: `tests/pages/api/audits.test.ts:446-468`
  (0 wywołań, ciało nieprzeczytane, kontrola z sesją = 1) oraz kroki smoke na żywym serwerze
  (`scripts/smoke.mjs:1237`, `:1292` — bez sesji i z podrobioną sesją).
- Kolejność darmowych sprawdzeń przed przejęciem: `audits.ts:132-178`. Dowód:
  `audits.test.ts:537-832` (zły identyfikator, brak oferty, oferta w archiwum, brak klucza,
  nieudany odczyt kryteriów i ustawień — każdy z „0 provider calls").
- Blokada to wiersz w bazie: insert, a po `23505` update do `running`, który trigger odrzuca
  kodem `VP001` (`src/lib/audit/store.ts:83-117`). Dowód po stronie trasy:
  `audits.test.ts:851-871` (`VP001` → `busy`, 0 wywołań, brak zapisu kończącego cudzą próbę)
  i `:891-931` (pięć wariantów `claim_failed`, każdy 0 wywołań). Dowód po stronie bazy:
  `scripts/audit-state.sql:140-165` (ani inny członek, ani sam starter nie przejmie trwającej
  próby) i `scripts/smoke.mjs:2172-2185` (to samo przez Data API).
- Jedno wywołanie, bez ponowień: `maxRetries: 0` (`src/lib/audit/provider.ts:117`). Mutant
  tej linii nie przeżył przebiegu z 2026-10-12; tabela `FAILURES` i dwa przypadki terminu
  (`audits.test.ts:1457`, `:1549`, `:1585`) liczą wywołania.
- Podwójne kliknięcie w przeglądarce: wyspa ma własną straż `if (run.current !== null) return`
  (`src/components/offers/AuditRunner.tsx:134`) i wyłącza przycisk (`:249`). To wygoda, nie
  dowód — gwarancją jest blokada w bazie. Żaden test nie naciska przycisku (CLAUDE.md
  `## Testing`), i tak ma zostać.

### Ryzyko #3 — ścieżka w kodzie i co już jest dowiedzione

- Zapis wyniku jest próbowany dwa razy; zapis, który nie trafił w wiersz, to `claim_lost`;
  po nieudanym pierwszym zapisie czytany jest wiersz (`storedAlready`)
  (`src/lib/audit/store.ts:174-225`). Dowód: `audits.test.ts:1638-1775` — w tym drugi zapis
  po błędzie i po braku odpowiedzi, `save_failed` z oznaczeniem próby jako nieudanej, oraz
  pięć stanów wiersza po ponowionym zapisie.
- Nieudane wywołanie modelu zostawia próbę `failed` z powodem (`audits.ts:210-224`). Dowód:
  `audits.test.ts:1239-1636`, w tym próba, której nie dało się oznaczyć (`:1612`).
- „W toku" nie wisi bez końca: próg 175 s (`src/lib/audit/failure.ts:20`). Dowód:
  `tests/lib/audit/store.test.ts:345-393` (odczyt z zegarem z argumentu),
  `scripts/audit-state.sql:326-385` (174 s — nie, 176 s — tak),
  `tests/lib/audit/failure.test.ts:207-226` (kolejność 165 < 175 < 180).
- Audyt przeżywa zamknięcie karty i odświeżenie sesji: `audits.test.ts:1777-1915`.
- Przeglądarka nie proponuje ponowienia po urwanym strumieniu: `src/lib/audit/stream.ts:84-93`,
  dowód `tests/lib/audit/stream.test.ts`.

### Luki — czego istniejące testy nie dowodzą

Każda pozycja wynika z mutanta, który przeżył lub nie miał pokrycia w przebiegu z 2026-10-12,
albo z braku asercji potwierdzonego wyszukiwaniem we wskazanych plikach.

| #   | Luka                                                                                                                                                | Dowód luki                                                                                                                                             | Ryzyko                                     | Najtańsza warstwa                                                                    |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------ | ------------------------------------------------------------------------------------ |
| G1  | Wyjątek po przejęciu wiersza: próba ma zostać oznaczona `failed` z powodem `unexpected`, nie zostać `running`                                       | `audits.ts:250-253` — 5 mutantów bez pokrycia; w `audits.test.ts` nie ma słowa `unexpected`                                                            | #3                                         | test trasy                                                                           |
| G2  | Wyjątek przed przejęciem (`audits.ts:354-360`) i `getSession`, które rzuca (`:317-321` → `:133`): odpowiedź `unexpected`, 0 wywołań, brak przejęcia | mutanty `audits.ts:133`, `:319`, `:356-358` bez pokrycia; `:318:9` i `:356:7` przeżyły                                                                 | #2                                         | test trasy                                                                           |
| G3  | Drugi insert dla oferty, która ma już wiersz, dostaje `23505` i niczego nie zmienia                                                                 | brak `23505` w `scripts/audit-state.sql` i `scripts/smoke.mjs` (wyszukiwanie w obu plikach); test trasy wpisuje ten kod ręcznie (`audits.test.ts:835`) | #2                                         | `scripts/audit-state.sql`                                                            |
| G4  | Przejęcie, na które baza odpowiada wierszem bez czytelnego `run_started_at` (pusty tekst, nie-tekst, dwa wiersze): `claim_failed`, 0 wywołań        | 12 mutantów przeżyło w `store.ts:68-71`; zbadany jest tylko wynik `[]` (`audits.test.ts:907-911`, `:917`)                                              | #2                                         | test trasy                                                                           |
| G5  | Dwa żądania do trasy: drugie, gdy pierwsze czeka na model, kończy się `busy`; razem 1 wywołanie; pierwsze zapisuje wynik                            | każdy scenariusz w `audits.test.ts` to jedno żądanie; `stubNetwork` (`:183-217`) jest bezstanowy                                                       | #2                                         | test trasy (zaślepka musi sama udawać `VP001` — dowodzi złożenia trasy, nie blokady) |
| G6  | Po nieudanym wywołaniu modelu zapis „nieudana" nie trafia w wiersz: wpis w logu niesie `detail: attempt_taken_over`                                 | `audits.ts:91:7` i `:91:24` przeżyły                                                                                                                   | #3                                         | test trasy (jeden przypadek)                                                         |
| G7  | `had_limits` przy częściowo ustawionych limitach (`.some` → `.every` przeżywa)                                                                      | `audits.ts:242:18` przeżył; fixture ma wszystkie limity albo żadnego (`audits.test.ts:132`, `:1059`)                                                   | poza #2/#3 — prawdziwość zapisanego wyniku | test trasy (jeden przypadek)                                                         |

G5 ma najsłabszy stosunek wartości do kosztu: blokady dowodzi baza (`audit-state.sql:140-165`),
a test trasy z zaślepką, która sama odpowiada `VP001`, powtarza to, co już stoi w `:851-871`.
Jedyna nowa rzecz, jaką wnosi, to że pierwsze żądanie kończy się zapisem mimo drugiego.

### Przeżyli, ale nie są lukami tej fazy

- `store.ts:57-58`, `:114-115`, `:162-163`, `:180-181` (bez pokrycia): gałęzie `catch` na
  wypadek, gdyby klient Supabase rzucił. W testach odrzucony `fetch` wraca jako błąd, nie
  wyjątek (`audits.test.ts:902-906` — `db_status: 0`). Dojście do nich wymagałoby mockowania
  modułu wewnętrznego, czego §2 zakazuje (`test-plan.md:67`).
- `store.ts:224:19` i `:242:40` (`state: "error"` → `""`): trasa traktuje każdy stan inny niż
  `saved` i `claim_lost` jak błąd (`audits.ts:245-249`, `:89-93`), więc mutant jest
  równoważny na poziomie trasy.
- `store.ts:89`, `:105`, `:157`, `:176` (tekst `select`): zaślepka odpowiada niezależnie od
  kolumn. `expectOwnAttemptOnly` sprawdza tylko, że `select` nie jest `null`
  (`audits.test.ts:443`), więc pusty tekst przechodzi. Zaostrzenie asercji jest tanie, ale
  nie zmienia liczby wywołań ani losu wyniku.
- `provider.ts:149-157`, `:162-254` (43 przeżyło, 10 bez pokrycia): przypisanie powodu do
  błędu dostawcy, w tym błędów wewnątrz strumienia. Wpływa na zdanie, które czyta członek,
  nie na liczbę wywołań. Poza zakresem #2/#3; kandydat do osobnej decyzji.
- `audits.ts:338-348`, `:369` (strumień po odejściu czytelnika): zachowanie obserwowalne jest
  to samo — audyt kończy się zapisem (`audits.test.ts:1794-1832`).

### Weryfikacja wskazówek z §2 planu testów

| Wskazówka (`test-plan.md:66-67`)                          | Werdykt                                                                                                                                                                                                                   |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #2: drugie żądanie w trakcie pierwszego nie woła dostawcy | Dowiedzione w połówkach (trasa + baza). Brakuje szwu `23505` (G3) i scenariusza łącznego (G5).                                                                                                                            |
| #2: żądanie bez sesji nigdy nie woła dostawcy             | Dowiedzione, w teście trasy i na żywym serwerze. Nic do dodania.                                                                                                                                                          |
| #2: liczona jest liczba wywołań, nie status 200           | Dowiedzione w każdym scenariuszu `audits.test.ts`. Nowe przypadki mają to powtórzyć.                                                                                                                                      |
| #2: „pętla"                                               | **Do korekty w planie testów.** Kolejne audyty tej samej oferty nie mają limitu: zakończony audyt można uruchomić ponownie od razu (`audit-state.sql:304-323`). Blokada chroni tylko przed jednoczesnością.               |
| #3: wynik jest odzyskiwalny albo błąd jest jawny          | Jawny — dowiedzione. Odzyskiwalny nie jest: wynik „nie istnieje nigdzie indziej" (`store.ts:192-193`), a komunikat `save_failed` mówi o nowym płatnym zapytaniu (`failure.ts:113`).                                       |
| #3: „w toku" nie wisi bez końca                           | Dowiedzione dla zabitego żądania (próg 175 s). Brakuje wyjątku po przejęciu (G1).                                                                                                                                         |
| #3: ponowienie nie płaci za wynik, który już istnieje     | Dowiedzione dla ponowionego zapisu (`storedAlready`) i dla urwanego strumienia (czyste funkcje). Karta bez przycisku przy nieudanym odczycie — twierdzenie z CLAUDE.md, w tym researchu niesprawdzane w `render.test.ts`. |
| #3: stubowane krawędzie, nie moduły wewnętrzne            | Spełnione: `audits.test.ts:48-51`. G1 i G2 trzeba wywołać z krawędzi (patrz „Architecture Insights").                                                                                                                     |

## Code References

- `src/pages/api/audits.ts:129-255` — jeden audyt: darmowe sprawdzenia, przejęcie, wywołanie, zapis
- `src/pages/api/audits.ts:250-254` — `catch` po przejęciu; bez pokrycia (G1)
- `src/pages/api/audits.ts:317-327`, `:353-360` — przygotowanie żądania i `catch` przed przejęciem (G2)
- `src/lib/audit/store.ts:67-72` — odczyt startu próby z odpowiedzi przejęcia (G4)
- `src/lib/audit/store.ts:83-117` — `claimAudit`: insert, `23505`, przejęcie, `VP001`
- `src/lib/audit/store.ts:198-225` — `completeAudit`: dwa zapisy i `storedAlready`
- `src/lib/audit/provider.ts:117` — `maxRetries: 0`
- `src/lib/audit/failure.ts:12-30` — trzy limity czasu i ich kolejność
- `tests/pages/api/audits.test.ts:183-217` — `stubNetwork`, bezstanowa zaślepka całej sieci
- `tests/pages/api/audits.test.ts:834-932` — przejęcie przed płatnością
- `tests/pages/api/audits.test.ts:1638-1775` — opłacony wynik, którego nie da się zapisać
- `scripts/audit-state.sql:140-165`, `:326-385` — blokada i próg 175 s w triggerach
- `scripts/smoke.mjs:2172-2185` — `VP001` przez Data API
- `reports/mutation/mutation.html` — raport przebiegu z 2026-10-12 (lokalny, git-ignorowany)

## Architecture Insights

- Wiersz `public.offer_audits` jest jednocześnie blokadą i wynikiem. Dlatego dowód #2 dzieli
  się z natury na dwie warstwy: trasa (co robi z odpowiedzią bazy) i SQL (co baza odpowiada).
  Łączy je kod błędu — `23505` i `VP001` — wpisany ręcznie po obu stronach. `VP001` ma dowód
  po stronie bazy, `23505` nie ma (G3).
- G1 i G2 da się wywołać z krawędzi, bez mockowania `@/lib/*` — do potwierdzenia w planie:
  - G1: `report("started", …)` stoi wewnątrz `try` (`audits.ts:198-200`), a log wychodzi przez
    `console`. Konsola, która rzuca przy tym wpisie, jest krawędzią — test dowiódłby wtedy
    także „0 wywołań dostawcy" i zapisu `failed`/`unexpected`.
  - G2: `getSession` odświeża wygasłą sesję i przed wyjściem odpowiedzi zapisuje ciasteczko
    (`audits.ts:309-313`); `cookies.set`, które rzuca, jest krawędzią. Czy wyjątek dochodzi
    wtedy do `catch` w `:319`, trzeba sprawdzić — klient Supabase może go połknąć.
- Wynik mutacyjny nie jest celem (CLAUDE.md `## Testing`). Liczby powyżej służą wskazaniu
  gałęzi, nie progowi do osiągnięcia.

## Historical Context (from prior changes)

- `context/archive/2026-10-06-grounded-listing-audit/plan.md:165-168` — zamknięcie karty:
  `waitUntil` daje do 30 s po rozłączeniu; poza tym oknem „opłacony wynik przepada, próba
  zostaje `running` i po 175 s czyta się jako przerwana. To znane ograniczenie". Werdykt:
  zgodne z kodem (`audits.ts:292-294`, `:375`). Limitu 30 s zaślepka nie odtworzy — to
  własność platformy, nie luka testu.
- `context/archive/2026-10-06-grounded-listing-audit/reviews/impl-review.md:46` (F1) i `:89`
  (F4) — dwa znaleziska dotyczące #2/#3, oba naprawione w S-04: próbę kończy tylko jej starter
  (`supabase/migrations/20261009191000_offer_audits_ended_by_starter.sql`), a ponowiony zapis
  odróżnia „zapisano, odpowiedź zginęła" od `claim_lost` (`store.ts:174-183`).
- `context/foundation/test-plan.md:1002-1011` — wpis S-04 zostawia orkiestratorowi decyzję,
  czy fazy 3 i 4 zamknąć jako pokryte, czy otworzyć w poszukiwaniu braków. Ta zmiana jest tym
  drugim.
- `context/foundation/test-plan.md:1090-1093` — członek może nadpisać wynik przez Data API,
  kończąc własną próbę ręcznie; zaakceptowane w S-04 w ramach zaufanego zespołu. Ta sama
  droga pozwala starterowi zakończyć własną trwającą próbę i uruchomić drugą, gdy pierwsze
  żądanie jeszcze czeka na model — wniosek z kodu triggera opisanego w `audit-state.sql:190-192`,
  nie zaobserwowany w teście.

## Related Research

- `context/archive/2026-10-06-grounded-listing-audit/research.md` — badania przed S-04
  (m.in. „Billing meets retries", przywołane w `plan.md:77`)

## Open Questions

1. **Pętla kolejnych audytów (#2).** Produkt nie ogranicza liczby audytów tej samej oferty
   jeden po drugim. Czy faza ma to tylko nazwać w planie testów jako świadomie niechronione
   (PRD: zaufany zespół, każdy audyt to celowe działanie), czy to osobna zmiana w produkcie?
   Test tego nie rozstrzyga.
2. **„Odzyskiwalny" w #3.** Kod wybrał „jawny". Czy sformułowanie w §2 planu testów zostaje
   jako alternatywa, czy ma zostać doprecyzowane do stanu faktycznego?
3. **G5 — czy warto.** Scenariusz dwóch żądań wymaga stanowej zaślepki i dowodzi niewiele
   ponad to, co już stoi. Rekomendacja: pominąć na rzecz G3, który zamyka prawdziwy szew.
4. **Klasyfikacja błędów dostawcy** (`provider.ts:149-254`, 53 mutanty bez zabicia) — poza
   #2/#3. Włączyć do tej fazy, odłożyć do fazy 4, czy zostawić?
5. **G7** leży poza ryzykami fazy; czy dołożyć przy okazji, skoro to jeden przypadek?
