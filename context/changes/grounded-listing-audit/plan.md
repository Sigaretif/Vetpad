# Ugruntowany audyt AI zapisanego ogłoszenia (S-04) — Implementation Plan

## Overview

Członek zespołu naciska „Uruchom audyt AI" na karcie oferty i po najwyżej trzech minutach
czyta znaleziska: krytyczne braki z pytaniami do sprzedającego, warunki obowiązkowe, koszty
nazwane w ogłoszeniu i czerwone flagi. Każde znalezisko pozytywne niesie dosłowny cytat z
ogłoszenia, a znalezisko bez cytatu nie jest pokazywane. Audyt wykonuje model wybrany przez
zespół z zamkniętej listy, przez oficjalny SDK Anthropic, a jego wynik i stan próby żyją w
Postgresie.

Plan realizuje FR-010, FR-011 i US-01, zamyka trzy niewiadome S-04 z roadmapy i prowadzi
zmianę aż na produkcję, z pomiarem CPU i aktualizacją runbooka.

## Current State Analysis

- **Nie ma audytu.** `AuditStatus` to jeden literał `"not_audited"`, a `auditStatus()` jest
  stałą (`src/lib/offer-board.ts:72-81`). Karta ma oznaczone miejsce na audyt
  (`src/components/offers/OfferNotes.astro:46`).
- **Nie ma integracji z dostawcą modelu.** `astro.config.mjs:17-22` deklaruje tylko dwa
  sekrety Supabase, `src/lib/config-status.ts:11-19` ma jeden wpis, a `@anthropic-ai/sdk`
  nie ma w `package.json`.
- **Tekst odniesienia istnieje.** `offers.description` to zwykły tekst znormalizowany przy
  pobraniu (`src/lib/otodom/map.ts:127-146`), a niepodany atrybut jest `null` w swojej
  kolumnie. `raw.characteristics` nadal niesie zaślepki typu `rent: "0"`
  (`map.ts:11-32`), więc `raw` nie jest źródłem faktów.
- **Kryteria istnieją, ale nie w kształcie dla promptu.** `loadCriteria` nie zwraca rewizji,
  dzieli wymagania na własne i cudze i dokleja autorów z adresami e-mail
  (`src/lib/criteria.ts:163-172`, `:214-269`). `criteria_revision` ma politykę `select` i
  nikt jej jeszcze nie czyta
  (`supabase/migrations/20260927144141_create_team_criteria.sql:206-214`, `:340-351`).
- **Długa akcja ma jeden kształt:** blokujący POST formularza z limitem 45 s
  (`src/pages/api/offers.ts:175`). Żadna wyspa nie woła `fetch` i żadna trasa nie zwraca
  strumienia.
- **`/api/*` jest poza `PROTECTED_ROUTES`** (`src/middleware.ts:6`), więc trasa sama
  sprawdza `locals.user`.
- **Testy nie sięgną prawdziwego dostawcy:** `stubFetch` zastępuje `globalThis.fetch`, a
  `restoreFetch` wywraca test przy nieplanowanym żądaniu (`tests/fixtures/http.ts:39-72`).
- **Platforma:** 10 ms CPU na żądanie na Workers Free, bez limitu czasu trwania, o ile
  klient jest połączony. Adapter udostępnia `locals.cfContext.waitUntil`
  (`node_modules/@astrojs/cloudflare/dist/utils/cf-helpers.d.ts:2`).

Decyzje podjęte przed planem (`change.md`): dostawca Anthropic na przedpłaconych kredytach,
oficjalny SDK, domyślnie `claude-opus-5-5` z effort `medium`, żadna z tych wartości nie jest
wpisana na sztywno w miejscu wywołania.

Decyzje podjęte w wywiadzie do tego planu są w `plan-brief.md`, w tabeli „Key Decisions
Made".

## Desired End State

- Na `/offers/<id>` nad notatkami stoi sekcja „Audyt AI". Bez audytu pokazuje przycisk; w
  trakcie pokazuje etap i upływający czas; po sukcesie pokazuje cztery kategorie znalezisk,
  datę, osobę, model, effort i to, wobec jakich kryteriów audyt powstał.
- Każde znalezisko pozytywne ma cytat będący fragmentem tytułu albo opisu oferty. Liczba
  znalezisk odrzuconych za brak takiego cytatu jest widoczna.
- Dwa równoczesne żądania audytu tej samej oferty dają jedno wywołanie dostawcy. Żądanie bez
  sesji nie daje żadnego.
- Nieudane ponowienie zostawia poprzedni wynik nietknięty i mówi, dlaczego się nie udało.
- Na `/criteria` zespół wybiera model (`claude-opus-5-5`, `claude-sonnet-5-5`) i effort
  (`low`, `medium`, `high`). Zmiana nie podbija `criteria_revision`.
- Tablica pokazuje „Audytowano" albo „Nie audytowano", a przy nieudanym odczycie audytów
  mówi, że statusu nie udało się sprawdzić.
- Bez `ANTHROPIC_API_KEY` aplikacja startuje, buduje się i przechodzi testy, baner mówi o
  braku klucza, a przycisk audytu jest wyłączony z wyjaśnieniem.
- Na produkcji wykonano jeden prawdziwy audyt najdłuższego zapisanego ogłoszenia, a runbook
  niesie zmierzone CPU, liczbę tokenów i czas.

Weryfikacja: `npm test`, `npm run test:db`, `npm run smoke`, bramka wizualna oraz ręczny
audyt lokalny i produkcyjny opisane w fazach.

### Key Discoveries:

- Cytowania API nie łączą się z wyjściem wymuszonym schematem (żądanie dostaje 400), więc
  ugruntowanie to własny test podciągu (`research.md`, Summary 8).
- Dostawca nalicza opłatę za żądanie przerwane po stronie klienta, gdy „było na dobrej
  drodze", a SDK domyślnie ponawia dwukrotnie (`research.md`, „Billing meets retries").
- `on delete set null` wykonuje się jako UPDATE i przechodzi przez wyzwalacz zamrażający;
  bez gałęzi „konto już nie istnieje" usunięcie konta się wywraca
  (`context/foundation/lessons.md:12-17`).
- WITH CHECK polityki widzi wiersz po wyzwalaczach `before`, więc kolumna ustawiona przez
  wyzwalacz jest tym, co sprawdza polityka
  (`20260927144141_create_team_criteria.sql`, komentarz przy polityce update).
- Odmowa RLS przy odczycie to `[]` z HTTP 200, a przy zapisie zero wierszy
  (`tests/pages/api/criteria.test.ts` jest wzorcem).
- `decodeEntity` zamienia `&#160;` na U+00A0 (`src/lib/otodom/map.ts:113-120`), więc
  dosłowne porównanie odrzuciłoby poprawny cytat, w którym model wpisał zwykłą spację.
- SDK przyjmuje surowy JSON Schema przez `jsonSchemaOutputFormat`, działa to ze
  strumieniowaniem, a `effort` przyjmuje `low`, `medium`, `high`, `xhigh`, `max`
  (dokumentacja SDK, Context7, 2026-10-06).
- Drugi wpis w `configStatuses` pokaże baner na każdej stronie wszędzie tam, gdzie klucza
  nie ma, czyli także w zadaniu `smoke` w CI i na zrzutach bramki.

## What We're NOT Doing

- **Stan „nieaktualny" audytu.** S-04 zapisuje rewizję kryteriów i odcisk tekstu; porównanie
  i etykieta to S-09.
- **Historia audytów.** Jeden wynik na ofertę, zastępowany po udanym zapisie nowego.
- **Wybór modelu przy pojedynczym audycie** i modele spoza listy dwóch. Poziomy `xhigh` i
  `max` są poza listą.
- **Oznaczanie audytów jako nieaktualne po zmianie modelu albo effort.**
- **Biblioteka walidacji** (`zod`, `valibot`). Kształt wymusza API, treść sprawdza kod.
- **Limit liczby znalezisk** i dzienny limit audytów. Stratę ogranicza saldo przedpłacone i
  blokada współbieżności.
- **Zgłaszanie przez model przekroczeń limitów wyliczonych z parametrów.** To robi
  deterministycznie znacznik na tablicy (`src/lib/team-limits.ts`).
- **Dopisywanie braków przez kod.** Pusta kolumna nie dowodzi, że tekst milczy; kod tylko
  odrzuca, nigdy nie dodaje.
- **Ponowne sprawdzanie cytatów przy renderowaniu** i ochrona przed celowym nadpisaniem
  wyniku przez Data API. Decyzja o cytatach po zmianie tekstu należy do S-09.
- **Odpytywanie statusu przez innych oglądających.** Widzą „w toku" i link do odświeżenia.
- **Usuwanie audytu jako osobna akcja.** Audyt znika tylko z ofertą.
- **Analiza zdjęć**, wysyłanie `raw`, adresów zdjęć, identyfikatorów i adresów e-mail.
- **Test E2E audytu w Playwright.** Wymagałby płatnego wywołania.
- **Zakup Workers Paid.** Jeśli pomiar w fazie 7 przekroczy limit, decyzja wraca do
  użytkownika zgodnie z runbookiem.
- **Pomiar jakości modeli na złotym zestawie.** Zostaje opcjonalnym, ręcznym krokiem.
- **Wielokrotne płatne przebiegi tego samego testu** i płatne wywołania uruchamiane przez
  agenta. Budżet jest w „Critical Implementation Details".

## Implementation Approach

Zmiana idzie od bazy w górę. Najpierw stan i reguły, których nie da się obejść z poziomu
klienta (faza 1), potem ustawienie zespołu jako pierwszy pełny pionowy plaster (faza 2).
Rdzeń audytu powstaje jako czyste funkcje bez sieci i dostaje testy ugruntowania i
prywatności, zanim pojawi się jakiekolwiek płatne wywołanie (faza 3). Dostawca i trasa
dochodzą dopiero wtedy, z testami liczącymi wywołania na krawędzi HTTP (faza 4). Widok
powstaje na gotowej trasie (faza 5), dokumenty wiążące idą razem z kodem (faza 6), a
produkcja jest osobną fazą z udziałem człowieka (faza 7).

Przebieg jednego audytu:

1. Trasa sprawdza sesję, konfigurację i identyfikator oferty.
2. Czyta ofertę, kryteria z rewizją i ustawienia. Każdy nieudany odczyt to odmowa.
3. Przejmuje wiersz `offer_audits` na `running`. Odmowa przejęcia kończy żądanie.
4. Woła dostawcę strumieniowo, bez ponowień, z terminem 165 s.
5. Sprawdza `stop_reason`, kształt i cytaty; liczy odrzucone.
6. Zapisuje wynik warunkowo na własnym przejęciu. Nieudany zapis ponawia raz.
7. Przez cały czas odsyła do przeglądarki etap i sygnał życia.

## Critical Implementation Details

**Kolejność trzech progów czasu.** Termin dostawcy (165 s) < próg przerwanej próby w bazie
(175 s) < limit po stronie przeglądarki (180 s). Dzięki temu karta przeładowana po limicie 180 s
czyta próbę starszą niż 175 s jako przerwaną i dopiero wtedy oferuje ponowienie, które może
przejąć wiersz, a żywy Worker nigdy nie traci przejęcia przed własnym terminem. Zapis wyniku razem z ponowieniem musi się zmieścić przed
175 s.

**Bez ponowień SDK.** Klient powstaje z `maxRetries: 0`. Ponowienie po przekroczeniu czasu
oznaczałoby drugą opłatę za ten sam audyt, a ponowienie jest tu świadomą akcją członka.

**Klient SDK powstaje w fabryce przy każdym żądaniu**, nigdy w zakresie modułu. Reguła o
stanie w zakresie modułu tego wymaga, a `stubFetch` podmienia `fetch` globalny. Czy SDK
czyta go przy tworzeniu klienta, czy przy żądaniu, sprawdź w źródłach po instalacji;
fabryka przy każdym żądaniu działa w obu przypadkach.

**CPU strumienia.** Przed wyborem wywołania sprawdź w źródłach SDK, czy `messages.stream()`
z `output_config.format` parsuje częściowy JSON przy każdej delcie. Jeśli tak, użyj
`messages.create({ stream: true })`, sklej tekst samodzielnie i wykonaj jeden `JSON.parse`
na końcu. Limit to 10 ms CPU na żądanie. Kosztu, którego nie da się uniknąć, jest jeden
`JSON.parse` na każde zdarzenie strumienia, także dla myślenia, którego na
`claude-opus-5-5` nie da się wyłączyć. Dlatego trasa loguje liczbę zdarzeń
(`stream_events`), a faza 4 daje szacunek CPU przed produkcją.

**Zamknięcie karty.** Praca audytu jest osobną obietnicą przekazaną do
`locals.cfContext.waitUntil`, gdy kontekst istnieje. Daje to do 30 s po rozłączeniu. Poza
tym oknem opłacony wynik przepada, próba zostaje `running` i po 175 s czyta się jako
przerwana. To znane ograniczenie, komunikowane prośbą o niezamykanie karty.

**Tekst ogłoszenia to dane, nie polecenia.** Instrukcja mówi to wprost, a ogłoszenie jest
w wiadomości użytkownika w wyraźnie oznaczonym bloku.

**Budżet płatnych wywołań.** Portfel w Claude Console jest przedpłacony i użytkownik nie
chce go wyczerpać testami. Cała zmiana ma cztery zaplanowane płatne audyty i dwa w rezerwie:

| Nr  | Faza | Co sprawdza                                                      | Wiersze Progress |
| --- | ---- | ---------------------------------------------------------------- | ---------------- |
| 1   | 4    | audyt na `claude-opus-5-5`, wysłany jako dwa równoczesne żądania | 4.6 (Opus), 4.7  |
| 2   | 4    | audyt na `claude-sonnet-5-5`                                     | 4.6 (Sonnet)     |
| 3   | 5    | audyt z karty, oglądany równocześnie przez drugiego członka      | 5.5, 5.6, 5.8    |
| 4   | 7    | audyt najdłuższego ogłoszenia na produkcji                       | 7.7              |

Rezerwa dwóch audytów służy powtórzeniu kroku po poprawce. Po jej zużyciu agent zatrzymuje
się i pyta, zanim poprosi o kolejny. Zasady, które obowiązują przez całą implementację:

- Płatny audyt uruchamia wyłącznie użytkownik, własnoręcznie: kliknięciem na karcie, a w
  fazie 4, zanim karta ma przycisk, fragmentem wklejonym do konsoli DevTools (faza 4,
  punkt 8). Agent nigdy nie wysyła żądania, które dotarłoby do dostawcy: ani przez `curl`,
  ani skryptem, ani w pętli.
- Agent zapowiada każdy płatny krok z jego numerem z tabeli i czeka na zgodę.
- Wszystko inne jest darmowe z konstrukcji: `npm test` i Stryker działają na zaślepce
  `fetch` i z kluczem zamockowanym jako `undefined`, smoke wysyła tylko żądania odrzucane
  przed dostawcą, a wygląd każdego stanu sprawdza się na `/dev/offer-card` z fixtur.
- Błąd znaleziony podczas płatnego kroku jest najpierw odtwarzany testem na zaślepce i tam
  naprawiany. Płatny krok powtarza się raz, po zielonym teście.
- Krok 5.7 (błędny klucz) nie jest płatny: dostawca odrzuca żądanie przed pracą modelu.

## Phase 1: Schemat bazy

### Overview

Dwie tabele z RLS i wyzwalaczami, które czynią stan próby, daty i osoby faktami bazy, oraz
testy SQL i kroki smoke dowodzące tych reguł.

### Changes Required:

#### 1. Ustawienia audytu zespołu

**File**: `supabase/migrations/<ts>_create_audit_settings.sql` (przez
`supabase migration new create_audit_settings`)

**Intent**: Singleton z modelem i effort wspólnym dla zespołu, wzorowany na
`team_criteria`. Zmiana ustawień nie jest zmianą kryteriów, więc nic tu nie dotyka
`criteria_revision`.

**Contract**: `public.audit_settings (id boolean pk default true check (id), model text not
null, effort text not null, updated_at timestamptz, updated_by uuid references auth.users
(id) on delete set null)`. Checki: `model in ('claude-opus-5-5','claude-sonnet-5-5')`,
`effort in ('low','medium','high')`. Migracja wstawia jeden wiersz `claude-opus-5-5` /
`medium`. Wyzwalacz `before update` jak `team_criteria_before_update`: podpisuje realną
zmianę (`auth.uid()`, `now()`), zostawia podpis przy zapisie tych samych wartości, przyjmuje
gałąź usuniętego konta i odmawia zmiany bez sesji (`42501`). Polityki `select` i `update`
dla `authenticated`; brak `insert`, `delete` i polityk `anon`. `revoke execute` na funkcji.

#### 2. Audyty ofert

**File**: `supabase/migrations/<ts>_create_offer_audits.sql` (przez
`supabase migration new create_offer_audits`)

**Intent**: Jeden wiersz na ofertę trzyma ostatni udany wynik i stan ostatniej próby.
Wyzwalacze są właścicielami dat, osób i dozwolonych przejść, więc blokada współbieżności i
„próba nie wisi w nieskończoność" nie zależą od zegara ani uczciwości klienta.

**Contract**: `public.offer_audits`:

- klucz: `offer_id uuid primary key references public.offers (id) on delete cascade`;
- próba: `run_state text not null` (`running` | `completed` | `failed`), `run_started_at
timestamptz not null`, `run_started_by uuid references auth.users (id) on delete set
null`, `run_failure text`;
- wynik: `findings jsonb`, `rejected_count integer`, `audited_at timestamptz`, `audited_by
uuid references auth.users (id) on delete set null`, `model text`, `effort text`,
  `criteria_revision bigint`, `listing_fingerprint text`, `had_limits boolean`,
  `requirements_count integer`;
- check: kolumny wyniku poza `audited_by` są wszystkie puste albo wszystkie wypełnione.

Dozwolone przejścia, egzekwowane przez wyzwalacze `security definer` z pustym
`search_path`:

| Operacja                       | Warunek                                                               | Co ustawia baza                                                        |
| ------------------------------ | --------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| insert                         | `run_state = 'running'`, sesja istnieje                               | `run_started_at := now()`, `run_started_by := auth.uid()`, wynik pusty |
| update → `running` (przejęcie) | stary stan inny niż `running` albo `run_started_at` starsze niż 175 s | jak przy insert, `run_failure := null`, wynik bez zmian                |
| update → `running`             | próba trwa krócej niż 175 s                                           | odmowa z własnym SQLSTATE `VP001`                                      |
| `running` → `completed`        | komplet kolumn wyniku w nowym wierszu                                 | `audited_at := now()`, `audited_by := stare run_started_by`            |
| `running` → `failed`           | niepusty `run_failure`                                                | wynik bez zmian                                                        |
| każda inna zmiana              | —                                                                     | kolumny wyniku, próby i `offer_id` wracają do starych wartości         |
| usunięcie konta                | kolumna osoby staje się `null`, a konta już nie ma                    | tylko ta kolumna, żadna data ani stan                                  |

Polityki: `select` dla `authenticated`; `insert` z `with check (run_started_by =
auth.uid())`; `update` dla każdego zalogowanego (płaskie role); brak `delete` i brak polityk
`anon`. Komentarz migracji odsyła do stałych czasu w `src/lib/audit/`.

Dwie kolumny `on delete set null` w jednym wierszu to wzorzec, którego żadna istniejąca
tabela nie ma. Postgres wykonuje jeden UPDATE na klucz obcy, więc przy pierwszym z nich
druga kolumna nadal trzyma identyfikator usuniętego konta. Wyzwalacz sprawdza gałąź
usuniętego konta jako pierwszą, osobno dla `run_started_by` i dla `audited_by`, przed
regułą „każda inna zmiana", która inaczej przywróciłaby stary identyfikator i wywróciła
usunięcie konta. `VP001` to pierwszy własny SQLSTATE w migracjach; dotąd jest tylko
standardowy `42501`.

#### 3. Test tego, co zostaje po usunięciu konta

**File**: `scripts/account-deletion.sql`

**Intent**: Trzy nowe kolumny wskazują na `auth.users`, więc każda dostaje przypadek:
audyt i ustawienia zostają, podpisane przez nikogo, reszta wiersza bez zmian.

**Contract**: Fixtury dostają audyt ukończony przez odchodzącego członka i ustawienia
przez niego podpisane. Stała `count(*) <> 7` w sprawdzeniu kompletności migawki
(`:124`) rośnie o nowe wiersze. Nowe sprawdzenia: `audited_by` i `run_started_by` są
`null`, `findings`, daty i stan identyczne; `audit_settings.updated_by` jest `null`, model
i effort identyczne.

#### 4. Test stanów audytu

**File**: `scripts/audit-state.sql`, `package.json` (skrypt `test:db`)

**Intent**: Reguły zależne od czasu i od wyzwalaczy nie dają się sprawdzić kluczem
publikowalnym, więc dostają skrypt SQL w tej samej dyscyplinie co usunięcie konta.

**Contract**: Jedna transakcja zakończona `ROLLBACK`, odmowa bez zasianych kont, każde
sprawdzenie to blok `DO` z komunikatem `audit-state: [<nazwa>] …`. Przypadki: wstawienie
ignoruje podane daty i osoby; przejęcie trwającej próby daje `VP001`; przejęcie próby
postarzonej o 176 s się udaje i nie rusza wyniku; `running → completed` zapisuje wynik i
osobę; `running → failed` zostawia poprzedni wynik; zmiana `findings` w stanie `completed`
nic nie zmienia; delete jako członek dotyka zera wierszy. `npm run test:db` uruchamia oba
skrypty.

#### 5. Kroki RLS w smoke

**File**: `scripts/smoke.mjs`

**Intent**: Dowieść ścieżką klucza publikowalnego, z obu zasianych kont, że nowe tabele są
zamknięte dla niezalogowanych i że podpisów nie da się podrobić.

**Contract**: Niezalogowany czyta `[]` z obu tabel. Członek czyta ustawienia; `insert` i
`delete` na `audit_settings` dotykają zera wierszy; PATCH `updated_by`/`updated_at` jest
ignorowany (porównanie całych wierszy przez `withSnapshot`). Członek wstawia próbę dla
oferty-fixtury; drugi członek nie może jej przejąć (`VP001`); delete dotyka zera wierszy;
usunięcie oferty-fixtury zabiera wiersz audytu. Sprzątanie przywraca ustawienia odczytane
na początku.

### Success Criteria:

#### Automated Verification:

- Migracje nakładają się na czystą bazę: `npx supabase db reset`
- `npm run test:db` przechodzi z nowymi przypadkami usunięcia konta i ze skryptem stanów audytu
- `npm run smoke` przechodzi z krokami RLS dla `offer_audits` i `audit_settings`
- `npm run lint`, `npx astro sync && npx astro check` i `npm test` przechodzą

#### Manual Verification:

- Użytkownik przejrzał obie migracje: jedna polityka na operację, brak `for all`, brak `using (true)`, brak polityk dla `anon`

**Implementation Note**: Po tej fazie i przejściu weryfikacji automatycznej zatrzymaj się
na ręczne potwierdzenie. Pola wyboru są w sekcji `## Progress`.

---

## Phase 2: Ustawienia audytu zespołu

### Overview

Zespół widzi i zmienia model oraz effort na `/criteria`. To pierwszy pełny plaster na nowym
schemacie i jedyne miejsce, z którego trasa audytu weźmie te wartości.

### Changes Required:

#### 1. Moduł ustawień

**File**: `src/lib/audit/settings.ts`

**Intent**: Jedno miejsce z zamkniętą listą, domyślnymi wartościami, etykietami, regułą
formularza i odczytem. Wyspa importuje ten moduł, więc `@/lib/supabase` wchodzi tylko przez
`import type`.

**Contract**: `AUDIT_MODELS`, `AUDIT_EFFORTS`, `DEFAULT_AUDIT_SETTINGS` (`claude-opus-5-5`,
`medium`), `parseAuditSettingsForm(values)` → ustawienia albo jeden komunikat na powód,
`loadAuditSettings(supabase, viewerId)` → `{ state: "ok", model, effort, changedBy: Saver |
null, changedAt } | { state: "error" }`. Brak klienta, błąd zapytania, brak wiersza albo
wartość spoza listy to `error`, nigdy wartość domyślna. Nie rzuca.

#### 2. Trasa zapisu

**File**: `src/pages/api/audit-settings.ts`

**Intent**: Zapis ustawień formularzem, według `src/pages/api/criteria.ts`, z wpisem do
logu na każdym wyjściu jak w `src/pages/api/offers.ts`.

**Contract**: `POST`, `FormData` z polami `model` i `effort`. Sukces przekierowuje na
`/criteria#audyt`, porażka na `/criteria?error=<komunikat>&form=audit#audyt`. Brak sesji
przekierowuje na `/auth/signin`. Wartość spoza listy jest odrzucana przed zapisem. Update
zwracający zero wierszy to nieudany zapis. Wpis `event: "audit_settings"`.

#### 3. Prymityw listy wyboru

**File**: `src/components/ui/select.tsx`, `package.json`

**Intent**: Lista wyboru z shadcn na Radix, zgodnie z regułą z 2026-09-26.

**Contract**: `npx shadcn add select`, potem rytuał z `CLAUDE.md`: `cn` z `@/lib/utils`,
bez `"use client"`, import z `@radix-ui/react-select`, bez pakietu zbiorczego `radix-ui`.
Nowa zależność: `@radix-ui/react-select`.

#### 4. Formularz i widok

**File**: `src/components/criteria/AuditSettingsForm.tsx`,
`src/components/criteria/CriteriaView.astro`, `src/pages/criteria.astro`

**Intent**: Trzecia karta na `/criteria`: bieżący model i effort z podpisem ostatniej
zmiany oraz formularz z dwóch list, złożony z kompozytów `src/components/form/`.

**Contract**: `CriteriaView` dostaje prop `auditSettings`; sekcja ma `id="audyt"` i
`data-audit-settings-state="ok"|"error"`. Przy `error` formularz się nie renderuje. Tekst
pomocniczy mówi, że zmiana dotyczy następnych audytów i nie oznacza istniejących jako
nieaktualne. `criteria.astro` czyta ustawienia równolegle z kryteriami i rozpoznaje
`form=audit`.

#### 5. Strony `/dev` i zrzuty

**File**: `src/pages/dev/criteria.astro`, `src/pages/dev/_criteria-fixtures.ts`,
`src/pages/dev/forms.astro`, `scripts/ui-screenshots.mjs`

**Intent**: Każdy stan nowej karty i formularza renderuje się przez komponenty produkcyjne
i ma zrzut.

**Contract**: Macierz 7 stanów formularza ustawień:

| Stan     | Co pokazuje                                                              |
| -------- | ------------------------------------------------------------------------ |
| default  | bieżące wartości z podpisem                                              |
| hover    | przycisk zapisu pod kursorem                                             |
| focus    | wyzwalacz listy z pierścieniem fokusu                                    |
| disabled | przycisk w trakcie wysyłki                                               |
| error    | komunikat serwera nad formularzem; osobno nieudany odczyt bez formularza |
| empty    | nie dotyczy: singleton zawsze ma model i effort                          |
| loading  | „Zapisywanie…" na przycisku                                              |

Zestawy `criteria` i `forms` w `scripts/ui-screenshots.mjs` dostają ujęcia tych stanów.
Zrzuty lądują w `context/changes/grounded-listing-audit/screenshots`.

#### 6. Testy i smoke

**File**: `tests/lib/audit/settings.test.ts`, `tests/pages/api/audit-settings.test.ts`,
`tests/fixtures/http.ts`, `scripts/smoke.mjs`

**Intent**: Każdy nieudany odczyt stoi obok udanego; zapis, który dotknął zera wierszy,
jest porażką.

**Contract**: Test odczytu według `tests/lib/criteria.test.ts` (klient budowany w teście,
sieć na krawędzi HTTP), w tym wartość spoza listy jako `error`. Test trasy według
`tests/pages/api/criteria.test.ts`, w tym brak żądania do bazy przy wartości spoza listy.
Smoke: brak sesji i podrobiona sesja dają przekierowanie na logowanie; zmiana ustawień
przez formularz jest widoczna na `/criteria` z `data-audit-settings-state="ok"`; sprzątanie
przywraca wartości początkowe.

### Success Criteria:

#### Automated Verification:

- `npm test` przechodzi z testami odczytu i trasy ustawień audytu
- `npm run lint`, `npx astro sync && npx astro check` i `npm run build` przechodzą
- `npm run smoke` przechodzi z krokami ustawień audytu i z `/dev/*` nadal odpowiadającym 404 na podglądzie produkcyjnym
- `node scripts/ui-screenshots.mjs criteria context/changes/grounded-listing-audit/screenshots` i zestaw `forms` tworzą zrzuty nowych stanów

#### Manual Verification:

- Zmiana modelu i effort na `/criteria` jest po zapisie widoczna z podpisem osoby i datą, a ponowny zapis tych samych wartości nie zmienia podpisu
- Zrzuty pokazują każdy wiersz macierzy formularza ustawień, lista wyboru działa klawiaturą, widok mobilny nie przewija się w poziomie

**Implementation Note**: Po tej fazie zatrzymaj się na ręczne potwierdzenie.

---

## Phase 3: Rdzeń audytu

### Overview

Czyste moduły, które decydują, co trafia do modelu i co z jego odpowiedzi wolno pokazać.
Bez sieci do dostawcy. Tu powstają dowody dla ryzyk #4 i #6.

### Changes Required:

#### 1. Odczyt kryteriów dla audytu

**File**: `src/lib/criteria.ts`

**Intent**: Audyt potrzebuje limitów, samych treści wymagań i rewizji z jednej spójnej
chwili, bez autorów i adresów e-mail.

**Contract**: `loadAuditCriteria(supabase)` → `{ state: "ok", limits: TeamLimits,
requirements: string[], revision: number } | { state: "error" }`. Wymagania w stałej
kolejności (`created_at`, potem `author_id`). Rewizja jest czytana przed odczytem kryteriów
i po nim; różnica powtarza całość raz, a druga różnica to `error`. Używa istniejącego
`readLimits`. Nie rzuca.

#### 2. Wejście audytu

**File**: `src/lib/audit/input.ts`

**Intent**: Zbudować wejście z jawnej białej listy kolumn oferty i z kryteriów, tak aby
niepodany fakt pozostał niepodanym, a nic poza tekstem ogłoszenia i kryteriami nie mogło
się tam znaleźć.

**Contract**: `readAuditOffer(row)` → oferta albo `null`, gdy tytuł, opis lub liczba nie
czytają się poprawnie (liczba jako tekst z PostgREST czyta się jako liczba; wartość
nieczytelna to odmowa, nie „nie podano"). `buildAuditInput(offer, criteria)` → `AuditInput`
z tytułem, opisem, parametrami pod polskimi etykietami z `src/lib/otodom/labels.ts`
(`null` jako „nie podano w ogłoszeniu"), udogodnieniami, limitami i wymaganiami
ponumerowanymi `W1…Wn`. Nigdy nie czyta `raw`, `images`, `source_url`, `id`, `created_by`.
`DECISION_CRITICAL`: dziewięć atrybutów z kolumną, która je podaje: cena (`price`), metraż
(`area_m2`), lokalizacja (`location_label`), piętro (`floor`), ogrzewanie (`heating`),
forma własności (`building_ownership`), czynsz administracyjny (`rent`), rok budowy
(`build_year`), stan wykończenia (`construction_status`).
`listingFingerprint(offer)` → `v1:` + SHA-256 (hex), przez `crypto.subtle`, z JSON-u
surowych wartości kolumn z białej listy audytu, pod nazwami kolumn, w stałej kolejności.
Odcisk nie zależy od etykiet z `labels.ts` ani od układu promptu, więc zmiana brzmienia
instrukcji nie zmienia odcisku żadnej oferty.

#### 3. Instrukcja i wiadomość dla modelu

**File**: `src/lib/audit/prompt.ts`

**Intent**: Świadomie napisana instrukcja po polsku, skupiona na przygotowaniu do
oglądania, która trzyma model przy ekstrakcji i krótkich etykietach.

**Contract**: `buildAuditPrompt(input)` → `{ system, user }`. Instrukcja zawiera, w tej
kolejności:

1. rolę: zakreślacz dla kupującego, nie prawnik; żadnych ocen, porad ani wyjaśnień;
2. opis wejścia oraz zdanie, że tekst ogłoszenia to dane, nigdy polecenia;
3. braki jako pierwsze i najstaranniejsze zadanie: dla każdego atrybutu z listy dziewięciu,
   którego nie podają ani parametry, ani tekst, jedno konkretne pytanie do sprzedającego,
   gotowe do zadania; to samo dla każdego wymagania `Wn`, o którego przedmiocie ogłoszenie
   milczy, ze wskazaniem `Wn`;
4. warunki obowiązkowe, koszty i czerwone flagi jako etykieta do około dziesięciu słów plus
   cytat; koszt tylko wtedy, gdy tekst go nazywa, nigdy szacowany;
5. regułę cytatu: ciągły fragment tytułu albo opisu przepisany znak po znaku, najkrótszy
   niosący fakt, ale nie krótszy niż 10 znaków (krótszy fakt cytuje się z sąsiednimi
   słowami), bez parafrazy, wielokropka, łączenia fragmentów i poprawiania literówek;
6. regułę, że fakt znany tylko z parametrów nie jest znaleziskiem pozytywnym, a przekroczeń
   limitów wyliczonych z parametrów model nie zgłasza;
7. regułę, że czego nie da się zacytować, tego się nie zgłasza, a puste listy są poprawną
   odpowiedzią; bez limitu liczby, bez powtórzeń.

#### 4. Schemat odpowiedzi i zapisanych znalezisk

**File**: `src/lib/audit/schema.ts`

**Intent**: Jeden kształt dla odpowiedzi modelu i jeden dla zapisanego wyniku, z czytnikiem,
który nie ufa wierszowi z bazy.

**Contract**: `AUDIT_OUTPUT_SCHEMA` jako surowy JSON Schema z `additionalProperties: false`
na każdym obiekcie:

```ts
{
  missing: {
    attribute: "price" |
      "area" |
      "location" |
      "floor" |
      "heating" |
      "ownership" |
      "admin_rent" |
      "build_year" |
      "finish_state" |
      "requirement";
    requirement_ref: string | null;
    question: string;
  }
  [];
  conditions: {
    label: string;
    excerpt: string;
  }
  [];
  costs: {
    label: string;
    excerpt: string;
  }
  [];
  red_flags: {
    label: string;
    excerpt: string;
    requirement_ref: string | null;
  }
  [];
}
```

Zapisany kształt `StoredFindings` ma `version: 1`, przy cytacie pole `source: "title" |
"description"`, a przy znalezisku z wymagania migawkę treści wymagania zamiast `Wn`.
`readFindings(value)` → `StoredFindings | null`; `null` to nieudany odczyt, nigdy „brak
znalezisk". Test pilnuje zgodności typu TypeScript ze schematem.

#### 5. Ugruntowanie

**File**: `src/lib/audit/grounding.ts`

**Intent**: Jedyna brama między odpowiedzią modelu a tym, co widzi zespół. Odrzuca, nigdy
nie poprawia i nigdy nie dodaje.

**Contract**: `groundFindings(output, input)` → `{ findings: StoredFindings, rejected:
number, dropped: number }`. Znalezisko pozytywne zostaje, gdy cytat ma co najmniej 10 znaków i po zwinięciu
każdego ciągu białych znaków (w tym U+00A0) do jednej spacji występuje w tytule albo
opisie zwiniętym tak samo, z zachowaniem wielkości liter. Zapisywany jest oryginalny
fragment ogłoszenia, nie tekst modelu. Brak zostaje, gdy ma niepuste pytanie i albo jego
atrybut jest z listy dziewięciu, a kolumna tego atrybutu jest pusta, albo jest typu
`requirement` z `Wn` wskazującym istniejące wymaganie. Powtórzony atrybut zostaje raz.
Czerwona flaga z `requirement_ref` wskazującym nieistniejące `Wn` zostaje, jeśli jej cytat
przechodzi; znika samo odwołanie. `rejected` liczy wyłącznie znaleziska pozytywne
odrzucone za cytat i tylko ta liczba trafia na kartę. Pozostałe odrzucenia (powtórzony
atrybut, brak przy wypełnionej kolumnie, brak bez pytania, brak ze złym `Wn`) liczy
`dropped`, który idzie do logu, nie na kartę.

#### 6. Powody niepowodzenia

**File**: `src/lib/audit/failure.ts`

**Intent**: Jeden powód, jeden rozróżnialny komunikat, współdzielony przez trasę i kartę.

**Contract**: `AuditFailureReason` oraz wyczerpujące `auditFailureMessage(reason)` i
`AUDIT_OUTCOME: Record<AuditFailureReason, "refused" | "failed">`, jak `failureMessage` i
`INGEST_OUTCOME` w `src/pages/api/offers.ts`. Powody: `unconfigured_supabase`,
`unconfigured_provider`, `invalid_offer`, `offer_not_found`, `offer_read_failed`,
`criteria_read_failed`, `settings_read_failed`, `busy`, `claim_failed`, `provider_auth`,
`provider_credit`, `provider_rate_limited`, `provider_unavailable`, `provider_rejected`,
`provider_refused`, `provider_truncated`, `provider_malformed`, `provider_timeout`,
`provider_network`, `save_failed`, `claim_lost`, `interrupted`. Stałe czasu (165 s, 175 s,
180 s, sygnał życia co 5 s) stoją w module bez importów wykonawczych, bo czyta je wyspa.

#### 7. Zakaz importu notatek

**File**: `eslint.config.js`

**Intent**: RLS nie utrzyma notatek poza audytem, więc robi to struktura kodu.

**Contract**: `no-restricted-imports` dla `src/lib/audit/**` i `src/pages/api/audits.ts`:
import `@/lib/notes` jest błędem.

#### 8. Testy

**File**: `tests/lib/audit/input.test.ts`, `tests/lib/audit/prompt.test.ts`,
`tests/lib/audit/grounding.test.ts`, `tests/lib/audit/schema.test.ts`,
`tests/lib/criteria.test.ts`, `tests/fixtures/audit.ts`

**Intent**: Dowody dla ryzyk #4 i #6 pisane ręcznie, z zakazanymi wartościami obecnymi w
fixturach.

**Contract**:

- Prywatność: fixtura niesie kanarki sprzedającego w `raw`, notatki, adresy e-mail i
  identyfikatory członków; zserializowane wejście i prompt nie zawierają żadnego z nich,
  a telefon wpisany przez ogłoszeniodawcę w opis zostaje dosłownie.
- Niepodane: `rent: "0"` w `raw` przy `rent: null` w kolumnie daje „nie podano w
  ogłoszeniu", nigdy zero.
- Odcisk: zmiana opisu albo parametru zmienia odcisk; zmiana etykiety i kolejności kluczy
  wiersza go nie zmienia; odcisk zaczyna się od `v1:`.
- Ugruntowanie, każdy przypadek odrzucony obok przyjętego: cytat dosłowny; cytat ze spacją
  w miejscu U+00A0 (przyjęty, zapisany z U+00A0); parafraza; cytat sklejony z dwóch
  fragmentów; cytat pusty i krótszy niż 10 znaków; cytat z tytułu; brak piętra przy pustej
  i przy wypełnionej kolumnie; brak z `W2` przy jednym wymaganiu; brak bez pytania;
  powtórzony atrybut; czerwona flaga z `W2` przy jednym wymaganiu (zostaje bez odwołania).
  `rejected` rośnie tylko przy odrzuconym cytacie, a `dropped` przy każdym innym
  odrzuceniu.
- Kryteria: rewizja zmieniona między odczytami raz (powtórka, sukces) i dwa razy (`error`);
  każdy nieudany odczyt obok udanego.
- `readFindings`: kształt poprawny, obcy, pusty obiekt, tablica.

### Success Criteria:

#### Automated Verification:

- `npm test` przechodzi z testami wejścia, promptu, ugruntowania, schematu i odczytu kryteriów dla audytu
- `npm run lint` przechodzi z regułą zakazującą importu `@/lib/notes` w module audytu
- `npx astro sync && npx astro check` przechodzi

#### Manual Verification:

- Użytkownik przeczytał i zaakceptował treść instrukcji dla modelu
- `npx stryker run --mutate "src/lib/audit/grounding.ts"` i to samo dla `src/lib/audit/input.ts`: każdy ocalały mutant oceniony według sekcji o Strykerze w `CLAUDE.md`
- Celowe dodanie importu `@/lib/notes` w `src/lib/audit/` wywraca `npm run lint`, po czym import znika

**Implementation Note**: Po tej fazie zatrzymaj się na ręczne potwierdzenie.

---

## Phase 4: Dostawca i trasa

### Overview

Klucz dostawcy we wzorcu zero-config, klient SDK, przejęcie i zapis w bazie oraz
strumieniowa trasa audytu. Tu powstają dowody dla ryzyk #2 i #3 i pierwsze płatne
wywołanie.

### Changes Required:

#### 1. Klucz dostawcy we wzorcu zero-config

**File**: `astro.config.mjs`, `src/lib/config-status.ts`, `.env.example`, `tests/setup.ts`,
`.github/workflows/ci.yml`

**Intent**: Brak klucza to wspierany stan: aplikacja działa, baner mówi o braku, audyt jest
wyłączony.

**Contract**: `ANTHROPIC_API_KEY: envField.string({ context: "server", access: "secret",
optional: true })`. Wpis `ConfigStatus` „Anthropic" z komunikatem o wyłączonym audycie AI.
`.env.example` dostaje linię. `tests/setup.ts` mockuje klucz jako `undefined`. Zadanie `ci`
dostaje `ANTHROPIC_API_KEY` w `env` kroku budowania; zadanie `smoke` celowo go nie dostaje.
`.env`, `.dev.vars`, Workers Secrets i sekrety GitHuba ustawia człowiek. Testy, które
podmieniają mock `astro:env/server` własną fabryką (`tests/pages/api/offers.test.ts` jest
wzorcem takiej fabryki), dostają w niej `ANTHROPIC_API_KEY`, gdy zaczną importować moduł,
który go czyta. Jeśli nowy wpis banera ma link, ujęcie `gate-focus-banner` w
`scripts/ui-screenshots.mjs` wskazuje baner jednoznacznie, a nie pierwszy `.banner a` na
stronie.

#### 1a. Konsola dostawcy i klucz lokalny (człowiek)

**File**: brak w repozytorium (Claude Console; lokalne, ignorowane przez git `.env` i
`.dev.vars`)

**Intent**: Portfel jest ograniczony, zanim padnie pierwsze płatne wywołanie, a klucz jest
tam, gdzie czyta go lokalny serwer. Agent nie tworzy klucza, nie widzi go i nie prosi o
wklejenie go do rozmowy.

**Contract**: Agent zatrzymuje się po testach automatycznych tej fazy, przed pierwszym
prawdziwym audytem, i prosi użytkownika o cztery kroki:

1. Claude Console → Settings → Billing: auto-reload wyłączony.
2. Claude Console → Settings → Billing → Spend limits: miesięczny limit ustawiony. Limitu
   nie da się ustawić na domyślnym workspace, więc najlepiej utworzyć workspace dla Vetpad.
3. Claude Console → API keys: nowy klucz w tym workspace.
4. Linia `ANTHROPIC_API_KEY=<klucz>` dopisana do `.env` i do `.dev.vars` w katalogu
   projektu, potem restart `npm run dev`.

Po potwierdzeniu agent sprawdza skutek, nie wartość: baner o braku klucza dostawcy znika z
lokalnej strony.

#### 2. Klient dostawcy

**File**: `src/lib/audit/provider.ts`, `package.json`

**Intent**: Jedna funkcja wykonująca wywołanie modelu i tłumacząca każdy jego koniec na
powód z `AuditFailureReason`, bez wycieku treści do logu.

**Contract**: Zależność `@anthropic-ai/sdk`. `createAuditProvider()` zwraca `null` bez
klucza. `runAudit({ model, effort, system, user, signal })` → `{ ok: true, output, usage,
requestId, stopReason } | { ok: false, reason, status?, requestId?, errorType?, errorName?
}`. Żądanie niesie `output_config: { effort, format: jsonSchemaOutputFormat(
AUDIT_OUTPUT_SCHEMA) }`, `max_tokens` ze stałej w `src/lib/audit/settings.ts` (start:
16000), bez budżetu myślenia, strumieniowo, z `maxRetries: 0`. `stop_reason` jest czytany
przed wynikiem: `refusal` → `provider_refused`, `max_tokens` → `provider_truncated`.
Klasyfikacja błędów: 401/403 → `provider_auth`; 400 z komunikatem o limicie użycia albo
niskim saldzie oraz 429 z `enforced_spend_limit_reached` → `provider_credit`; inne 429 →
`provider_rate_limited`; inne 400 → `provider_rejected`; 5xx i 529 →
`provider_unavailable`; przerwanie własnym terminem → `provider_timeout`; błąd połączenia →
`provider_network`. Uzupełnienia klasyfikacji: 402 (`billing_error`) → `provider_credit`;
każdy status bez własnej gałęzi (404 przy złym identyfikatorze modelu, 413 i inne) →
`provider_rejected`, więc żaden koniec nie zostaje bez powodu; błąd, który przychodzi w
strumieniu po statusie 200, jest klasyfikowany tak samo jak błąd przed strumieniem;
`APIConnectionTimeoutError` jest sprawdzany przed `APIConnectionError`, po którym
dziedziczy. Schemat wysłany dostawcy jest tym, co napisano: pomocnik
`jsonSchemaOutputFormat` domyślnie przekształca schemat, więc test porównuje
`output_config.format` z ciała zarejestrowanego żądania z `AUDIT_OUTPUT_SCHEMA` (w tym
`enum` atrybutów), a jeśli pomocnik go zmienia, wywołanie dostaje `{ transform: false }`.
Fabryka zwraca `null` przed wywołaniem konstruktora i zawsze podaje `apiKey` jawnie, bo
konstruktor SDK sam sięga po `ANTHROPIC_API_KEY` ze środowiska. Treść komunikatu dostawcy
nie opuszcza funkcji.

#### 3. Przejęcie, zapis i odczyt

**File**: `src/lib/audit/store.ts`

**Intent**: Wszystkie operacje na `offer_audits` w jednym miejscu, z odmową rozpoznawaną po
kodzie i po liczbie wierszy.

**Contract**: `claimAudit(supabase, offerId)` → `{ state: "claimed", startedAt } | { state:
"busy" } | { state: "error", … }`: insert, przy `23505` update na `running`, `VP001` to
`busy`. `completeAudit(supabase, offerId, startedAt, result)` i `failAudit(…, reason)`
filtrują po `run_state = running` i `run_started_at = startedAt`; zero wierszy to
`claim_lost`. `completeAudit` ponawia nieudany zapis raz.

#### 4. Trasa audytu

**File**: `src/pages/api/audits.ts`

**Intent**: Pierwszy endpoint sterowany `fetch` z wyspy. Sprawdza wszystko, co da się
sprawdzić za darmo, zanim przejmie wiersz, i przejmuje wiersz, zanim zapłaci.

**Contract**: `POST`, `FormData` z polem `offer_id` (formularz zachowuje sprawdzanie
`Origin` przez Astro). Brak sesji przekierowuje na `/auth/signin`, przed czymkolwiek innym.
Każda inna odpowiedź to `200` z `Content-Type: application/x-ndjson; charset=utf-8` i
`Cache-Control: no-store`, po jednym obiekcie JSON na linię:

```json
{"type":"stage","stage":"reading"}
{"type":"alive"}
{"type":"stage","stage":"model"}
{"type":"stage","stage":"saving"}
{"type":"done"}
{"type":"failed","reason":"busy","message":"…"}
```

Ostatnia linia to zawsze `done` albo `failed`. Kolejność wyjść: sesja → konfiguracja
Supabase → identyfikator → oferta → klucz dostawcy → kryteria → ustawienia → przejęcie →
dostawca → ugruntowanie → zapis. Klucz dostawcy stoi za identyfikatorem i ofertą, żeby
odpowiedź na zły identyfikator nie zależała od tego, czy środowisko ma klucz: zadanie
`smoke` w CI go nie ma, a lokalny `.dev.vars` może go mieć. Wynik zapisuje `findings`, `rejected_count`, model, effort,
rewizję, odcisk, `had_limits` i `requirements_count`. Praca jest przekazana do
`locals.cfContext.waitUntil`, gdy kontekst istnieje. Adapter typuje `cfContext` jako zawsze
obecny, a testy tras budują `locals: { user }`, więc trasa czyta go przez
`Partial<App.Locals>`, jak `src/middleware.ts` czyta `user` w przebiegu strony 500. Jeden wpis `event: "offer_audit"` na
każde wyjście oraz `started` po przejęciu, przed wywołaniem dostawcy; odmowa to `info`,
porażka to `error`.

#### 5. Pola logu

**File**: `src/lib/log.ts`, `tests/lib/log.test.ts`

**Intent**: Wpis audytu ma pozwolić policzyć koszt i rozpoznać przyczynę bez treści
ogłoszenia.

**Contract**: Nowe pola na białej liście: `model`, `effort`, `provider_request_id`,
`provider_error_type`, `stop_reason`, `input_tokens`, `output_tokens`, `duration_ms`,
`findings_count`, `rejected_count`, `dropped_count`, `criteria_revision`, `listing_chars`,
`stream_events`
(liczba zdarzeń strumienia dostawcy w jednym audycie). Wpis nigdy nie
niesie promptu, tekstu ogłoszenia, cytatów, treści wymagań ani komunikatu dostawcy.

#### 6. Testy trasy i fixtury dostawcy

**File**: `tests/pages/api/audits.test.ts`, `tests/pages/api/audits.unconfigured.test.ts`,
`tests/fixtures/anthropic.ts`, `tests/fixtures/http.ts`

**Intent**: Dowody dla ryzyk #2 i #3 na krawędzi HTTP, z licznikiem płatnych wywołań w
każdym scenariuszu.

**Contract**: Fixtura odpowiada na `POST https://api.anthropic.com/v1/messages`
strumieniem zdarzeń i błędami dostawcy; komentarz opisuje żądanie SDK tak, jak
`tests/fixtures/http.ts` opisuje supabase-js. Scenariusze i liczba wywołań dostawcy:

| Scenariusz                              | Wywołań | Co jeszcze                                                                    |
| --------------------------------------- | ------- | ----------------------------------------------------------------------------- |
| brak sesji                              | 0       | przekierowanie, brak żądań do bazy                                            |
| brak klucza (stan zero-config)          | 0       | `unconfigured_provider`                                                       |
| zły identyfikator, brak oferty          | 0       | brak przejęcia                                                                |
| nieudany odczyt kryteriów albo ustawień | 0       | brak przejęcia                                                                |
| próba w toku (`VP001`)                  | 0       | `busy`                                                                        |
| sukces                                  | 1       | zapis niesie model, effort, rewizję, odcisk; żadnego żądania do `offer_notes` |
| odpowiedź z parafrazą zamiast cytatu    | 1       | `completed`, `rejected_count` 1, znalezisko nie zapisane                      |
| 429, 5xx, przekroczony termin           | 1       | brak ponowienia, próba `failed`, poprzedni wynik nietknięty                   |
| 402                                     | 1       | `provider_credit`                                                             |
| status bez własnej gałęzi (404)         | 1       | `provider_rejected`                                                           |
| błąd w strumieniu po statusie 200       | 1       | próba `failed` z powodem jak dla tego samego błędu przed strumieniem          |
| `refusal`, `max_tokens`, zły kształt    | 1       | właściwy powód, nic nie zapisane jako wynik                                   |
| zapis nieudany dwa razy                 | 1       | `save_failed`, drugi zapis był próbowany                                      |
| zapis dotknął zera wierszy              | 1       | `claim_lost`                                                                  |

Ciało zarejestrowanego żądania do dostawcy nie zawiera kanarków notatek, sprzedającego,
adresów e-mail ani identyfikatorów. Żaden wpis logu nie zawiera tekstu ogłoszenia.

Fixtura potrafi wygenerować strumień o zadanej liczbie zdarzeń. Czas obsługi takiego
strumienia przez `runAudit` w Node agent mierzy jednorazowo, bez asercji i bez stałego
miejsca w `npm test`: to szacunek CPU, nie test.

#### 7. Smoke

**File**: `scripts/smoke.mjs`

**Intent**: Powierzchnia `src/pages/api/` się zmienia, więc smoke ją odzwierciedla, nigdy
nie docierając do dostawcy, także gdy lokalny `.env` ma klucz.

**Contract**: Brak sesji i podrobiona sesja na `POST /api/audits` dają przekierowanie na
logowanie. Zalogowany członek ze zniekształconym identyfikatorem dostaje `invalid_offer`, a
z losowym UUID `offer_not_found`. Smoke nie wysyła żadnego żądania audytu dla istniejącej
oferty.

#### 8. Uruchomienie płatnych kroków bez widoku (człowiek)

**File**: brak w repozytorium

**Intent**: Przycisk audytu powstaje dopiero w fazie 5, a płatne kroki tej fazy mają
dowieść integracji z dostawcą i blokady współbieżności, zanim powstanie widok. Uruchamia je
użytkownik, nie agent.

**Contract**: Agent podaje fragment do konsoli DevTools w dwóch wariantach: dwa równoczesne
`fetch` z `FormData` (`offer_id`) na `POST /api/audits` dla kroku nr 1 i jedno takie
żądanie dla kroku nr 2. Fragment wypisuje w konsoli każdą linię NDJSON obu odpowiedzi.
Użytkownik wkleja go w zalogowanej karcie pod `npm run preview`. Agent fragmentu nie
uruchamia i nie wysyła tych żądań żadną inną drogą. Znaleziska z tych audytów użytkownik
czyta w wierszu `offer_audits` w lokalnym Supabase Studio, bo karta ich jeszcze nie
pokazuje. Fragment nie trafia do repozytorium.

### Success Criteria:

#### Automated Verification:

- `npm test` przechodzi z testami trasy audytu, w tym z liczbą wywołań dostawcy w każdym scenariuszu tabeli
- `npm test` przechodzi z testem stanu zero-config trasy i z przypadkami nowych pól w `tests/lib/log.test.ts`
- `npm run lint`, `npx astro sync && npx astro check` i `npm run build` przechodzą z `@anthropic-ai/sdk`
- `npm run smoke` przechodzi z krokami `POST /api/audits`, bez klucza dostawcy w środowisku

#### Manual Verification:

- Użytkownik potwierdził w konsoli wyłączony auto-reload i limit wydatków, utworzył klucz i wpisał `ANTHROPIC_API_KEY` do lokalnych `.env` i `.dev.vars`
- Jeden prawdziwy audyt pod `npm run preview` kończy się `done` na `claude-opus-5-5` i jeden na `claude-sonnet-5-5`, a wpisy logu niosą tokeny, czas i identyfikator żądania
- Dwa równoczesne żądania audytu tej samej oferty dają jedno żądanie widoczne w konsoli dostawcy, a drugie kończy się `busy`

**Implementation Note**: Po tej fazie zatrzymaj się na ręczne potwierdzenie. Kroki ręczne
to płatne audyty nr 1 i 2 z budżetu w „Critical Implementation Details". Po płatnym
audycie nr 1 agent czyta `stream_events` z wpisu logu, odtwarza tyle zdarzeń z fixtury i
podaje szacunek CPU jednego audytu. Szacunek ponad 10 ms wraca do użytkownika jako decyzja
z sekcji „The CPU ceiling is reached" runbooka przed fazą 7, a nie po nieudanym audycie na
produkcji.

---

## Phase 5: Karta i tablica

### Overview

Sekcja audytu na karcie z wyspą uruchamiającą, status na tablicy, fixtury i bramka
wizualna.

### Changes Required:

#### 1. Odczyt audytu dla widoków

**File**: `src/lib/audit/store.ts`

**Intent**: Nieudany odczyt jest własnym stanem, nigdy „nie audytowano", a próba trwająca
dłużej niż próg czyta się jako przerwana.

**Contract**: `loadOfferAudit(supabase, offerId, viewerId, now)` → `{ state: "error" } | {
state: "ok", attempt, result }`, gdzie `attempt` to `none` | `running` (od kiedy, kto) |
`failed` (powód, komunikat) | `interrupted`, a `result` to `null` albo znaleziska z
`rejectedCount`, datą, osobą (`Saver` przez `resolveAuthors`), modelem, effort,
`hadLimits` i `requirementsCount`. Wiersz z nieczytelnymi `findings` to `error`.
`loadAuditIndex(supabase)` → `{ ok: true, audited: Set<string> } | { ok: false }`. Żadna
nie rzuca.

#### 2. Sekcja audytu

**File**: `src/components/offers/OfferAudit.astro`,
`src/components/offers/OfferView.astro`, `src/components/offers/OfferNotes.astro`,
`src/pages/offers/[id].astro`

**Intent**: Sekcja „Audyt AI" w kolumnie zespołu nad notatkami, renderowana przez serwer,
niezależnie od stanu odczytu notatek.

**Contract**: `OfferView` dostaje propsy `audit` i `auditAvailable`; sekcja ma `id="audyt"`
i `data-audit-state` (`none` | `running` | `done` | `failed` | `error`), który opisuje
wyłącznie dane audytu, oraz `data-audit-available="true"|"false"`, który mówi, czy jest
klucz dostawcy. Brak klucza nigdy nie zmienia `data-audit-state`.
Komentarz-znacznik w `OfferNotes.astro` znika. Strona czyta audyt równolegle z autorem i
notatkami. Cztery kategorie mają własny nagłówek, ikonę i rolę koloru: braki `info`,
warunki neutralna, koszty `warning`, flagi `destructive`. Cytat jest w `<blockquote>`,
renderowany jako tekst. Pusta kategoria mówi, że model nie wskazał w tekście nic do
zacytowania i że to nie znaczy, że tego nie ma. Wiersz meta podaje datę, osobę, model,
effort oraz kryteria, wobec których audyt powstał („bez limitów zespołu", „bez wymagań",
liczba wymagań). Liczba odrzuconych znalezisk jest widoczna, gdy jest większa od zera.
Przy `error` nie ma przycisku.

#### 3. Wyspa uruchamiająca

**File**: `src/components/offers/AuditRunner.tsx`

**Intent**: Przycisk, który wysyła żądanie, czyta strumień i przez cały czas pokazuje, że
audyt trwa.

**Contract**: Eksport domyślny, montowany z `client:load`. Wysyła `FormData` przez `fetch`,
czyta linie NDJSON, pokazuje etap, upływający czas i prośbę o niezamykanie karty. Po `done`
przeładowuje kartę na `#audyt`. Po `failed` pokazuje komunikat i przycisk ponowienia. Zerwany
strumień i limit 180 s nie mówią, czy audyt się zapisał (Worker pracuje do 30 s po
rozłączeniu), więc wyspa nie oferuje wtedy ponowienia, tylko przeładowuje kartę na
`#audyt`, a stan pokazuje serwer: wynik, „w toku" z linkiem odświeżenia albo „przerwana" z
przyciskiem. Brak sesji to wyłącznie odpowiedź przekierowana
(`response.redirected`): wtedy wyspa przechodzi na `/auth/signin`. Status inny niż 200 albo
inny typ treści bez przekierowania (strona 503, którą middleware oddaje przy awarii Auth,
albo strona 500) to komunikat w sekcji i link odświeżenia karty, bez nawigacji do
logowania: awaria Auth nigdy nie staje się przekierowaniem na logowanie. Etykieta to „Uruchom audyt AI" albo „Uruchom ponownie". Bez
klucza dostawcy przycisk jest wyłączony z wyjaśnieniem. Prop wymuszający stan początkowy
służy stronie `/dev`.

#### 4. Status na tablicy

**File**: `src/lib/offer-board.ts`, `src/components/offers/AuditStatusBadge.astro`,
`src/components/offers/OfferBoardItem.astro`, `src/components/offers/OfferBoard.astro`,
`src/pages/dashboard.astro`

**Intent**: `auditStatus()` dostaje regułę i źródło danych, a nieudany odczyt nie udaje
faktu.

**Contract**: `AuditStatus = "not_audited" | "audited" | "unknown"`. `auditStatus(offer,
index)` zwraca `audited`, gdy oferta ma zapisany wynik, `unknown`, gdy odczyt indeksu się
nie udał. Etykiety: „Nie audytowano", „Audytowano", „Nie udało się sprawdzić audytu".
`dashboard.astro` czyta indeks równolegle z ofertami i limitami. Kontener tablicy niesie
`data-audits-state="ok"|"error"`.

#### 5. Strony `/dev` i zrzuty

**File**: `src/pages/dev/offer-card.astro`, `src/pages/dev/_offer-fixtures.ts`,
`src/pages/dev/board.astro`, `scripts/ui-screenshots.mjs`

**Intent**: Każdy stan sekcji audytu i znaczka renderuje się przez komponenty produkcyjne.

**Contract**: Macierz 7 stanów sekcji audytu:

| Stan     | Co pokazuje                                                                                                                                             |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| default  | wynik z czterema kategoriami, wierszem meta i liczbą odrzuconych                                                                                        |
| hover    | przycisk uruchomienia pod kursorem                                                                                                                      |
| focus    | przycisk uruchomienia z pierścieniem fokusu                                                                                                             |
| disabled | brak klucza dostawcy; próba w toku widziana przez innego członka                                                                                        |
| error    | nieudana próba przy zachowanym wyniku; nieudana próba bez wyniku; przerwana próba; nieudany odczyt audytu; odpowiedź, która nie jest strumieniem audytu |
| empty    | brak audytu; wynik z pustą kategorią                                                                                                                    |
| loading  | audyt w toku z etapem i licznikiem czasu                                                                                                                |

Macierz znaczka na tablicy: default („Audytowano", „Nie audytowano"), error („Nie udało
się sprawdzić audytu"); hover, focus, disabled, empty i loading nie dotyczą, bo znaczek nie
jest interaktywny i nie ma własnego stanu ładowania. Zestawy `gate` i `board` w
`scripts/ui-screenshots.mjs` dostają ujęcia tych stanów, w tym długi cytat i długą
etykietę w wąskiej kolumnie.

#### 6. Testy i smoke

**File**: `tests/lib/audit/store.test.ts`, `tests/lib/offer-board.test.ts`,
`tests/components/offers/render.test.ts`,
`tests/components/offers/offer-board-item.test.ts`, `scripts/smoke.mjs`

**Intent**: Reguły odczytu i renderowania mają testy, a smoke widzi stan w znacznikach.

**Contract**: Odczyt audytu: każdy nieudany odczyt obok udanego, próba `running` młodsza i
starsza niż próg, nieczytelne `findings`. `auditStatus`: trzy wyniki, każdy z ręcznie
napisanym oczekiwaniem. Render: cytat zawierający znaczniki HTML wychodzi jako tekst; pusta
kategoria ma swoje zdanie; stan `error` nie renderuje przycisku; wiersz z zapisanym
wynikiem renderuje wynik bez komunikatu o błędzie, bo to stan, który członek widzi po
przeładowaniu karty po zerwanym strumieniu. Smoke: karta
tej oferty-fixtury, na której smoke nie wstawia próby w krokach RLS z fazy 1, ma
`data-audit-state="none"`, z kluczem dostawcy i bez niego, a `/dashboard` ma
`data-audits-state="ok"`.

### Success Criteria:

#### Automated Verification:

- `npm test` przechodzi z testami odczytu audytu, `auditStatus` i renderowania sekcji audytu
- `npm run lint`, `npx astro sync && npx astro check` i `npm run build` przechodzą
- `npm run smoke` przechodzi ze sprawdzeniem `data-audit-state` i `data-audits-state`
- `node scripts/ui-screenshots.mjs gate context/changes/grounded-listing-audit/screenshots` i zestaw `board` tworzą zrzuty nowych stanów

#### Manual Verification:

- Audyt uruchomiony z karty pokazuje etap i płynący czas, po zakończeniu karta pokazuje znaleziska z cytatami, a tablica „Audytowano"
- Każdy pokazany cytat da się znaleźć w opisie albo tytule oferty na tej samej karcie
- Ponowienie z celowo błędnym kluczem pokazuje komunikat o niepowodzeniu, a poprzednie znaleziska zostają
- Drugi członek otwierający kartę w trakcie audytu widzi „w toku" z osobą i godziną oraz wyłączony przycisk
- Zrzuty pokazują każdy wiersz obu macierzy, cztery kategorie są rozróżnialne bez polegania na samym kolorze, kontrast co najmniej 4,5:1, widok mobilny bez poziomego przewijania
- Bramka wizualna powtórzona po triage z `/10x-impl-review`, jeśli zmienił widok

**Implementation Note**: Po tej fazie zatrzymaj się na ręczne potwierdzenie.

---

## Phase 6: Dokumentacja i reguły

### Overview

Dokumenty wiążące dostają to, co wywiad i implementacja rozstrzygnęły, tak aby wyszły z
kodem w jednej zmianie.

### Changes Required:

#### 1. PRD

**File**: `context/foundation/prd.md`

**Intent**: Decyzje produktowe, których PRD nie miał, trafiają do PRD, nie do reguł.

**Contract**: FR-010: zespół wybiera model i effort z zamkniętej listy, zmiana nie oznacza
audytów jako nieaktualne, audyt jest dozwolony bez kryteriów. FR-011: lista dziewięciu
atrybutów krytycznych plus wymagania członków. FR-009: nieudane ponowienie zostawia
poprzedni wynik. Non-Functional Requirements: audyt i ustawienia zostają po usunięciu
konta, podpisane „osoba z usuniętym kontem". Blok rozstrzygnięć w Open Questions dostaje
wpis z datą.

#### 2. Reguły projektu

**File**: `CLAUDE.md`

**Intent**: Reguły wskazują nowe wzorce po nazwie pliku i przestają opisywać stan sprzed
S-04.

**Contract**: Product invariants: pakiet `@anthropic-ai/sdk`, moduł
`src/lib/audit/settings.ts` jako miejsce wartości domyślnych, ustawienie zespołu w
`audit_settings`; linia o brakach przestaje wymieniać trzy atrybuty („floor, heating,
ownership form") i odsyła do dziewięciu atrybutów i wymagań członków z FR-011. Structure: moduł `src/lib/audit/`, obie migracje jako wzorce,
`loadAuditCriteria`, miejsce audytu na karcie, `auditStatus()` z regułą. Conventions:
`src/pages/api/audits.ts` jako wzorzec endpointu sterowanego `fetch`. UI: `AuditRunner` i
`AuditSettingsForm` na listach stron `/dev`. Testing: `scripts/audit-state.sql`, nowe kroki
smoke, wzorce testów trasy i fixtury dostawcy, zakaz docierania smoke do dostawcy oraz reguła, że płatny audyt uruchamia tylko użytkownik,
a agent nigdy nie wysyła żądania, które dotarłoby do dostawcy.

#### 3. README, roadmapa, test-plan

**File**: `README.md`, `context/foundation/roadmap.md`, `context/foundation/test-plan.md`

**Intent**: Konfiguracja, stan roadmapy i przepisy testowe zgadzają się z kodem.

**Contract**: README: `ANTHROPIC_API_KEY` i odesłanie do sześciu miejsc, `npm run test:db`
z dwoma skryptami. Roadmapa: niewiadome S-04 o postępie i walidacji zamknięte, pytanie
otwarte 3 rozstrzygnięte (bez biblioteki), notatka dla S-09 o odcisku tekstu (ma wersję;
odcisk w innej wersji to „nie wiadomo", nie „nieaktualny"), rewizji i o tym, że zmiana
ustawień nie jest nieaktualnością; niewiadoma o CPU i pytanie 5 zostają do
fazy 7. Test-plan: §6.4 i §6.5 dostają przepisy z tej zmiany, §6.6 notatkę, że testy ryzyk
#2, #3, #4 i #6 powstały w S-04.

### Success Criteria:

#### Automated Verification:

- `npm run lint`, `npx astro sync && npx astro check` i `npm test` przechodzą po zmianach w dokumentach
- Każda ścieżka pliku nazwana w nowych wpisach `CLAUDE.md` istnieje w repozytorium

#### Manual Verification:

- Użytkownik przeczytał i zaakceptował zmiany w `context/foundation/prd.md`

**Implementation Note**: Po tej fazie zatrzymaj się na ręczne potwierdzenie.

---

## Phase 7: Wdrożenie i weryfikacja na produkcji

### Overview

Zmiana trafia na produkcję w kolejności z runbooka, jeden prawdziwy audyt mierzy CPU, a
runbook dostaje to, co wdrożenie pokazało.

### Changes Required:

#### 1. Sekrety produkcyjne (człowiek)

**File**: brak (Workers Secrets, sekrety repozytorium GitHub)

**Intent**: Klucz istnieje tam, gdzie czyta go wdrożony Worker i zadanie budowania w CI.

**Contract**: Konsola jest już ustawiona w fazie 4. Tu klucz trafia w dwa ostatnie z
sześciu miejsc, oba rękami użytkownika, we własnym terminalu albo w panelu:

- Workers Secrets: `npx wrangler secret put ANTHROPIC_API_KEY` (pyta o wartość) albo panel
  Cloudflare → Worker `vetpad` → Settings → Variables and Secrets;
- sekrety repozytorium GitHub: `gh secret set ANTHROPIC_API_KEY` albo Settings → Secrets and
  variables → Actions.

Agent zatrzymuje się przed tym krokiem, podaje obie komendy i czeka na potwierdzenie.
Sprawdza je `npx wrangler secret list` (pokazuje nazwy, nigdy wartości). Klucz ustawiony
przed kodem niczego nie zmienia; kod bez klucza pokazuje baner.

#### 2. Migracje na hostowanym projekcie

**File**: brak (`npx supabase db push`)

**Intent**: Schemat dociera przed Workerem, który go potrzebuje.

**Contract**: Agent uruchamia `npx supabase db push --dry-run`, pokazuje listę, pyta o
zgodę i wypycha tylko po „tak". Lista zawierająca cokolwiek poza dwiema migracjami tej
zmiany zatrzymuje krok bez pytania.

#### 3. Wyjście kodu i wdrożenie

**File**: brak (`/git-ship` albo `/git-land`)

**Intent**: Kod wychodzi przez skill wybrany przez użytkownika, a Workers Builds wdraża po
pushu na `master`.

**Contract**: Agent pyta, który skill, i nie wybiera sam. Po `/git-ship` scalenie PR jest
krokiem użytkownika, a `/git-sync` wyrównuje lokalny `master` przed dalszą pracą.

#### 4. Weryfikacja

**File**: brak

**Intent**: Najpierw to, co nic nie kosztuje, potem jeden audyt.

**Contract**: Przebieg z sekcji „Verifying a deploy" runbooka plus `POST /api/audits` bez
sesji dający przekierowanie na logowanie i brak banera o kluczu dostawcy. Potem człowiek
uruchamia jeden audyt najdłuższego zapisanego ogłoszenia i odczytuje: CPU żądania w
panelu Workers, wpisy `event: "offer_audit"` w `npx wrangler tail --format json`
(`listing_chars`, `input_tokens`, `output_tokens`, `duration_ms`, `stream_events`),
płynność etapów i
licznika. Wynik `1102` albo CPU ponad limit wraca do użytkownika jako decyzja z sekcji
„The CPU ceiling is reached", nie jako samodzielna zmiana planu.

#### 5. Runbook i domknięcie niewiadomych

**File**: `context/foundation/deployment-runbook.md`, `context/foundation/roadmap.md`,
`context/changes/grounded-listing-audit/research.md`

**Intent**: Runbook opisuje to, co platforma zrobiła, a nie to, co przewidywano.

**Contract**: „Current state": trzeci sekret. „Logs": zdarzenia `offer_audit` i
`audit_settings` z polami. „Verifying a deploy": krok trasy audytu. „Symptoms that lie":
wyczerpane saldo albo limit wydatków wyglądają jak zepsuta funkcja (`provider_credit`), a
baner się nie pojawia. „The CPU ceiling is reached": zmierzone CPU zamiast przewidywania.
„Adding the model provider key (FR-010)": stan po wdrożeniu. Roadmapa: niewiadoma S-04 o
CPU i pytanie otwarte 5 dostają zmierzoną odpowiedź. `research.md`: Open Questions 1 i 3
dostają dopisek z liczbami. Ta aktualizacja wychodzi drugim przejściem przez skill wybrany
przez użytkownika.

### Success Criteria:

#### Automated Verification:

- `npx supabase db push --dry-run` wymienia dokładnie dwie migracje tej zmiany
- Oba zadania CI przechodzą na zmianie zawierającej kod
- Przebieg weryfikacji z runbooka daje oczekiwane wyniki, a `POST /api/audits` bez sesji przekierowuje na `/auth/signin`

#### Manual Verification:

- Użytkownik ustawił `ANTHROPIC_API_KEY` w Workers Secrets i w sekretach repozytorium GitHub, a baner o braku klucza zniknął z produkcji
- Użytkownik zgodził się na `db push` i migracje są na hostowanym projekcie
- Użytkownik wybrał `/git-ship` albo `/git-land`, a nowa wersja obsługuje 100% ruchu
- Jeden audyt najdłuższego ogłoszenia zakończył się na produkcji, etap i licznik były widoczne na żywo, a CPU, tokeny i czas zostały odczytane
- Runbook, roadmapa i `research.md` niosą zmierzone wartości, a aktualizacja wyszła na `master`

**Implementation Note**: Ta faza wymaga człowieka w każdym kroku poza `--dry-run` i
odczytem wyników.

---

## Testing Strategy

### Unit Tests:

- Wejście i prompt: brak notatek, danych sprzedającego, adresów e-mail i identyfikatorów
  przy fixturze, która je wszystkie niesie; niepodane zostaje niepodanym.
- Ugruntowanie: każdy odrzucony przypadek obok przyjętego, oczekiwania pisane ręcznie.
- Odczyty (`loadAuditCriteria`, `loadAuditSettings`, `loadOfferAudit`): każdy nieudany
  odczyt obok udanego, który nic nie znalazł.
- `auditStatus` i `readFindings`.

### Integration Tests:

- Trasa audytu na krawędzi HTTP, z licznikiem wywołań dostawcy w każdym scenariuszu.
- Trasa ustawień, w tym zapis, który dotknął zera wierszy.
- `scripts/audit-state.sql` i `scripts/account-deletion.sql` na lokalnej bazie.
- Smoke: RLS obu tabel z dwóch kont, odmowy trasy audytu przed dostawcą, znaczniki stanu.

### Manual Testing Steps:

Płatne kroki są policzone w budżecie w „Critical Implementation Details"; każdy wykonuje
się raz.

1. Płatny nr 1: uruchom na Opus 5.5 fragment z konsoli DevTools w wariancie z dwoma
   równoczesnymi żądaniami (faza 4, punkt 8), potwierdź jedno żądanie w konsoli dostawcy i
   sprawdź każdy cytat z wiersza `offer_audits` w tekście oferty.
2. Płatny nr 2: przełącz zespół na Sonnet 5.5 i uruchom ten sam fragment w wariancie z
   jednym żądaniem.
3. Płatny nr 3: uruchom audyt z gotowej karty, z drugim członkiem patrzącym na tę samą
   ofertę.
4. Darmowy: podmień klucz na błędny, ponów audyt i potwierdź, że stare znaleziska zostały.
5. Darmowy: stan „przerwana" obejrzyj na `/dev/offer-card`; regułę czasu dowodzi
   `scripts/audit-state.sql`. Zamykanie karty w trakcie prawdziwego audytu nie jest
   krokiem planu, bo kosztuje audyt, który przepada.
6. Poza budżetem, tylko na Twoje wyraźne życzenie: ten sam listing na `low`, `medium` i
   `high`, z ręcznym porównaniem znalezisk.

## Performance Considerations

- **CPU:** limit 10 ms na żądanie. Koszt to obsługa strumienia dostawcy, jeden
  `JSON.parse`, zwinięcie białych znaków w opisie raz, test podciągu na znalezisko i jeden
  SHA-256. Sygnał życia co 5 s to kilkadziesiąt krótkich zapisów. Pomiar jest w fazie 7.
- **Czas:** oczekiwanie na `fetch` nie zużywa CPU. Termin 165 s po stronie serwera mieści
  się w limicie trzech minut z PRD.
- **Koszt:** szacunek około 0,10 USD za audyt na Opus 5.5 jest założeniem, nie pomiarem
  (`provider-selection.md`). Wpis logu niesie tokeny, więc faza 7 daje pierwszą prawdziwą
  liczbę.
- **`max_tokens`:** 16000 na start. Obcięta odpowiedź jest jawną porażką, a wartość
  koryguje się po pomiarze.

## Migration Notes

- Obie migracje tylko dodają tabele. Istniejące oferty nie dostają wierszy audytu i czytają
  się jako „Nie audytowano".
- Kolejność na produkcji: migracje, potem Worker. Stary Worker nie zna nowych tabel i ich
  nie dotyka.
- Wycofanie kodu (`npx wrangler rollback`) zostawia tabele; stary kod ich nie czyta, więc
  nic się nie psuje.
- `supabase db reset --linked` nie jest uruchamiany nigdy.

## References

- Research: `context/changes/grounded-listing-audit/research.md`
- Dostawca i rozliczenia: `context/changes/grounded-listing-audit/provider-selection.md`
- Decyzje sprzed planu: `context/changes/grounded-listing-audit/change.md`
- Wymagania: `context/foundation/prd.md` (FR-010, FR-011, Non-Functional Requirements)
- Ryzyka #2, #3, #4, #6: `context/foundation/test-plan.md:49-53`, `:66-70`
- Wzorzec trasy formularza: `src/pages/api/offers.ts`, `src/pages/api/criteria.ts`
- Wzorzec singletonu: `supabase/migrations/20260927144141_create_team_criteria.sql`
- Wzorzec wyzwalaczy dat i zamrożenia:
  `supabase/migrations/20260927133501_offer_notes_server_timestamps.sql`
- Wzorzec odczytu ze stanem błędu: `src/lib/criteria.ts`, `src/lib/notes.ts`
- Runbook: `context/foundation/deployment-runbook.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Schemat bazy

#### Automated

- [x] 1.1 Migracje nakładają się na czystą bazę: `npx supabase db reset` — d7fc7c5
- [x] 1.2 `npm run test:db` przechodzi z nowymi przypadkami usunięcia konta i ze skryptem stanów audytu — d7fc7c5
- [x] 1.3 `npm run smoke` przechodzi z krokami RLS dla `offer_audits` i `audit_settings` — d7fc7c5
- [x] 1.4 `npm run lint`, `npx astro sync && npx astro check` i `npm test` przechodzą — d7fc7c5

#### Manual

- [x] 1.5 Użytkownik przejrzał obie migracje: jedna polityka na operację, brak `for all`, brak `using (true)`, brak polityk dla `anon` — d7fc7c5

### Phase 2: Ustawienia audytu zespołu

#### Automated

- [x] 2.1 `npm test` przechodzi z testami odczytu i trasy ustawień audytu — 8be2696
- [x] 2.2 `npm run lint`, `npx astro sync && npx astro check` i `npm run build` przechodzą — 8be2696
- [x] 2.3 `npm run smoke` przechodzi z krokami ustawień audytu i z `/dev/*` nadal odpowiadającym 404 na podglądzie produkcyjnym — 8be2696
- [x] 2.4 `node scripts/ui-screenshots.mjs criteria context/changes/grounded-listing-audit/screenshots` i zestaw `forms` tworzą zrzuty nowych stanów — 8be2696

#### Manual

- [x] 2.5 Zmiana modelu i effort na `/criteria` jest po zapisie widoczna z podpisem osoby i datą, a ponowny zapis tych samych wartości nie zmienia podpisu — 8be2696
- [x] 2.6 Zrzuty pokazują każdy wiersz macierzy formularza ustawień, lista wyboru działa klawiaturą, widok mobilny nie przewija się w poziomie — 8be2696

### Phase 3: Rdzeń audytu

#### Automated

- [x] 3.1 `npm test` przechodzi z testami wejścia, promptu, ugruntowania, schematu i odczytu kryteriów dla audytu — ca623e1
- [x] 3.2 `npm run lint` przechodzi z regułą zakazującą importu `@/lib/notes` w module audytu — ca623e1
- [x] 3.3 `npx astro sync && npx astro check` przechodzi — ca623e1

#### Manual

- [x] 3.4 Użytkownik przeczytał i zaakceptował treść instrukcji dla modelu — ca623e1
- [x] 3.5 `npx stryker run --mutate "src/lib/audit/grounding.ts"` i to samo dla `src/lib/audit/input.ts`: każdy ocalały mutant oceniony według sekcji o Strykerze w `CLAUDE.md` — ca623e1
- [x] 3.6 Celowe dodanie importu `@/lib/notes` w `src/lib/audit/` wywraca `npm run lint`, po czym import znika — ca623e1

### Phase 4: Dostawca i trasa

#### Automated

- [x] 4.1 `npm test` przechodzi z testami trasy audytu, w tym z liczbą wywołań dostawcy w każdym scenariuszu tabeli — 64256f4
- [x] 4.2 `npm test` przechodzi z testem stanu zero-config trasy i z przypadkami nowych pól w `tests/lib/log.test.ts` — 64256f4
- [x] 4.3 `npm run lint`, `npx astro sync && npx astro check` i `npm run build` przechodzą z `@anthropic-ai/sdk` — 64256f4
- [x] 4.4 `npm run smoke` przechodzi z krokami `POST /api/audits`, bez klucza dostawcy w środowisku — 64256f4

#### Manual

- [x] 4.5 Użytkownik potwierdził w konsoli wyłączony auto-reload i limit wydatków, utworzył klucz i wpisał `ANTHROPIC_API_KEY` do lokalnych `.env` i `.dev.vars` — 64256f4
- [x] 4.6 Jeden prawdziwy audyt pod `npm run preview` kończy się `done` na `claude-opus-5-5` i jeden na `claude-sonnet-5-5`, a wpisy logu niosą tokeny, czas i identyfikator żądania — 64256f4
- [x] 4.7 Dwa równoczesne żądania audytu tej samej oferty dają jedno żądanie widoczne w konsoli dostawcy, a drugie kończy się `busy` — 64256f4

### Phase 5: Karta i tablica

#### Automated

- [x] 5.1 `npm test` przechodzi z testami odczytu audytu, `auditStatus` i renderowania sekcji audytu
- [x] 5.2 `npm run lint`, `npx astro sync && npx astro check` i `npm run build` przechodzą
- [x] 5.3 `npm run smoke` przechodzi ze sprawdzeniem `data-audit-state` i `data-audits-state`
- [x] 5.4 `node scripts/ui-screenshots.mjs gate context/changes/grounded-listing-audit/screenshots` i zestaw `board` tworzą zrzuty nowych stanów

#### Manual

- [x] 5.5 Audyt uruchomiony z karty pokazuje etap i płynący czas, po zakończeniu karta pokazuje znaleziska z cytatami, a tablica „Audytowano"
- [x] 5.6 Każdy pokazany cytat da się znaleźć w opisie albo tytule oferty na tej samej karcie
- [x] 5.7 Ponowienie z celowo błędnym kluczem pokazuje komunikat o niepowodzeniu, a poprzednie znaleziska zostają
- [x] 5.8 Drugi członek otwierający kartę w trakcie audytu widzi „w toku" z osobą i godziną oraz wyłączony przycisk
- [x] 5.9 Zrzuty pokazują każdy wiersz obu macierzy, cztery kategorie są rozróżnialne bez polegania na samym kolorze, kontrast co najmniej 4,5:1, widok mobilny bez poziomego przewijania
- [ ] 5.10 Bramka wizualna powtórzona po triage z `/10x-impl-review`, jeśli zmienił widok

### Phase 6: Dokumentacja i reguły

#### Automated

- [ ] 6.1 `npm run lint`, `npx astro sync && npx astro check` i `npm test` przechodzą po zmianach w dokumentach
- [ ] 6.2 Każda ścieżka pliku nazwana w nowych wpisach `CLAUDE.md` istnieje w repozytorium

#### Manual

- [ ] 6.3 Użytkownik przeczytał i zaakceptował zmiany w `context/foundation/prd.md`

### Phase 7: Wdrożenie i weryfikacja na produkcji

#### Automated

- [ ] 7.1 `npx supabase db push --dry-run` wymienia dokładnie dwie migracje tej zmiany
- [ ] 7.2 Oba zadania CI przechodzą na zmianie zawierającej kod
- [ ] 7.3 Przebieg weryfikacji z runbooka daje oczekiwane wyniki, a `POST /api/audits` bez sesji przekierowuje na `/auth/signin`

#### Manual

- [ ] 7.4 Użytkownik ustawił `ANTHROPIC_API_KEY` w Workers Secrets i w sekretach repozytorium GitHub, a baner o braku klucza zniknął z produkcji
- [ ] 7.5 Użytkownik zgodził się na `db push` i migracje są na hostowanym projekcie
- [ ] 7.6 Użytkownik wybrał `/git-ship` albo `/git-land`, a nowa wersja obsługuje 100% ruchu
- [ ] 7.7 Jeden audyt najdłuższego ogłoszenia zakończył się na produkcji, etap i licznik były widoczne na żywo, a CPU, tokeny i czas zostały odczytane
- [ ] 7.8 Runbook, roadmapa i `research.md` niosą zmierzone wartości, a aktualizacja wyszła na `master`
