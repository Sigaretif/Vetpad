<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Ugruntowany audyt AI zapisanego ogłoszenia (S-04)

- **Plan**: context/changes/grounded-listing-audit/plan.md
- **Scope**: Fazy 1–6 z 7 (faza 7, wdrożenie, jest w toku i nie była przeglądana)
- **Reviewed phases**: 1, 2, 3, 4, 5, 6
- **Date**: 2026-10-09
- **Verdict**: NEEDS ATTENTION (przed triage; po triage wszystkie ustalenia zamknięte)
- **Findings**: 0 critical, 2 warnings, 8 observations

Faza 5 ma otwarty wiersz 5.10 celowo: zamyka go ten przegląd (powtórka bramki wizualnej, jeśli
triage zmieni widok).

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | WARNING |

## Success criteria — co uruchomiono w przeglądzie

| Polecenie                           | Wynik                                                          |
| ----------------------------------- | -------------------------------------------------------------- |
| `npm run lint`                      | przeszło                                                       |
| `npx astro sync && npx astro check` | przeszło, 0 błędów, 0 ostrzeżeń (154 pliki)                    |
| `npm test`                          | przeszło, 1635 testów                                          |
| `npm run test:db`                   | przeszło, oba skrypty, `ROLLBACK`                              |
| `npm run build`                     | przeszło                                                       |
| ścieżki nazwane w `CLAUDE.md`       | istnieją (poza skrótami typu `button.tsx` obok pełnej ścieżki) |
| zrzuty stanów audytu                | pliki są w `screenshots/`; nie były otwierane ani odtwarzane   |
| `npm run smoke`                     | **nie uruchomiono** — patrz F9                                 |
| `npx supabase db reset`             | **nie uruchomiono** — patrz F9                                 |

Kroki ręczne (Stryker, celowy błąd lintu, konsola dostawcy, trzy płatne audyty, akceptacja
instrukcji i PRD) są odhaczone w Progress i opisane w `change.md`; przegląd ich nie powtarzał.
Żadne żądanie nie dotarło do dostawcy modelu.

## Findings

### F1 — Inny członek może zakończyć cudzą trwającą próbę audytu

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20261007073300_create_offer_audits.sql:216-243
- **Detail**: Gałęzie `running → completed` i `running → failed` wyzwalacza nie sprawdzają, kto pisze. W oknie 175 s członek B może przez Data API (a) zapisać `completed` z własnymi `findings` — wiersz dostaje `audited_by = A` i `audited_at = now()`, a opłacony wynik A kończy jako `claim_lost`; (b) zapisać `failed`, a potem `running`, czyli obejść `VP001` dwoma żądaniami. Plan przyjął celowe nadpisanie wyniku przez Data API (wiersz „What We're NOT Doing"), ale tam podrabiający podpisuje się sam; tu podpis jest cudzy, wbrew intencji fazy 1 („podpisów nie da się podrobić"). To wada planu, nie odejście od niego: tabela przejść tak to opisuje, a `scripts/audit-state.sql:190-191` sprawdza to jako zamierzone. Poboczne w tym samym wyzwalaczu: PATCH bez `run_state` na próbie starszej niż 175 s staje się cichym przejęciem (gałąź `new.run_state = 'running'`, linia 198), a nie „zmianą, która nic nie zmienia".
- **Fix**: Nowa migracja (obie obecne są już na hostowanym projekcie, więc nie edytujemy istniejącej) zastępująca funkcję `offer_audits_before_update`: obie gałęzie wymagają `auth.uid() = old.run_started_by`, w przeciwnym razie zapis jest cofany (`new := old`); przejęcie tylko wtedy, gdy `run_state` rzeczywiście się zmienia albo próba jest przeterminowana i żądanie niesie `running` świadomie. Do tego odwrócony przypadek w `scripts/audit-state.sql` i krok smoke z drugiego konta.
  - Strength: Trasa zawsze pisze w sesji osoby, która przejęła wiersz (`src/pages/api/audits.ts`), więc nic poprawnego nie przestaje działać.
  - Tradeoff: Trzecia migracja i kolejny `db push` (dry-run, zgoda) przed wdrożeniem Workera.
  - Confidence: HIGH — ścieżka potwierdzona w kodzie wyzwalacza.
  - Blind spot: Rozróżnienie „PATCH bez `run_state`" od świadomego przejęcia w wyzwalaczu `before update` nie jest możliwe wprost (wyzwalacz widzi tylko nowy wiersz); ta część może zostać poza poprawką.
- **Decision**: FIXED — `supabase/migrations/20261009191000_offer_audits_ended_by_starter.sql` (nałożona lokalnie; hostowany projekt czeka na `db push` za zgodą), nowy przypadek w `scripts/audit-state.sql`, dwa kroki w `scripts/smoke.mjs`, zdania w `README.md` i `CLAUDE.md`. `npm run test:db` przechodzi. Ciche przejęcie przez PATCH bez `run_state` po 175 s zostaje poza poprawką.

### F2 — Zapisany wynik, który się nie czyta, zamyka kartę bez wyjścia

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/lib/audit/store.ts:342-345, :385-387; src/components/offers/OfferAudit.astro:163-170
- **Detail**: Wyzwalacz sprawdza tylko, że kolumny wyniku nie są puste. Wiersz `completed` z `findings`, których `readFindings` nie przyjmuje (obcy kształt, inna `version`, ujemny licznik), daje `{ state: "error" }`, a karta przy `error` celowo nie renderuje przycisku. Polityki `delete` nie ma, więc z interfejsu nie ma wyjścia; tablica mówi w tym czasie „Audytowano". Ten sam stan dostanie każdy zapisany audyt w dniu podniesienia `FINDINGS_VERSION`.
- **Fix A ⭐ Recommended**: `loadOfferAudit` odróżnia „odczyt się nie udał" (bez przycisku, jak dziś) od „wiersz jest, ale wynik się nie czyta" — osobny stan z komunikatem i przyciskiem ponowienia.
  - Strength: Obejmuje też zmianę wersji znalezisk; ponowienie zastępuje tylko wynik, którego i tak nie da się pokazać.
  - Tradeoff: Nowy stan karty: fixtura na `/dev/offer-card`, test renderu, wartość `data-audit-state`, powtórka bramki wizualnej (5.10).
  - Confidence: HIGH — przejęcie wiersza `completed` jest już dozwolone przez wyzwalacz.
  - Blind spot: Jak ten stan ma czytać tablica („Audytowano" czy „nie udało się sprawdzić") — do ustalenia.
- **Fix B**: Checki na tabeli w nowej migracji (`jsonb_typeof(findings) = 'object'`, liczniki `>= 0`, niepuste `model`/`effort`).
  - Strength: Mała zmiana, zamyka przypadkowe śmieci u źródła.
  - Tradeoff: Nie rozwiązuje zmiany wersji ani błędnego kształtu wewnątrz obiektu.
  - Confidence: MEDIUM — zawęża problem, nie usuwa go.
  - Blind spot: Check nie zna schematu znalezisk.
- **Decision**: FIXED via Fix A — `loadOfferAudit` zwraca `{ state: "broken", attempt }` dla wiersza, którego próba się czyta, a wynik nie; karta pokazuje komunikat i przycisk „Uruchom ponownie", `data-audit-state="broken"`. Fixtura i stan `audit-result-broken` na `/dev/offer-card`, zrzut `gate-audit-result-broken.png`, testy w `tests/lib/audit/store.test.ts` i `tests/components/offers/render.test.ts`. Tablica nadal pokazuje dla takiej oferty „Audytowano".

### F3 — Powód `interrupted` opisuje „poprzednią próbę" przy błędach bieżącej

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/pages/api/audits.ts:115, :222-223, :327; src/lib/audit/failure.ts:112-113
- **Detail**: Trasa używa `interrupted` także dla nieudanego odświeżenia sesji przed przejęciem i dla nieoczekiwanego wyjątku. Członek czyta wtedy „Poprzednia próba audytu została przerwana…", choć zawiodła próba, którą właśnie uruchomił. Log rozróżnia przypadki po `stage`.
- **Fix**: Osobny powód (np. `unexpected`) z własnym zdaniem dla bieżącej próby; `interrupted` zostaje dla próby przeterminowanej czytanej z wiersza.
- **Decision**: FIXED — nowy powód `unexpected` z własnym zdaniem („Audyt przerwał nieoczekiwany błąd aplikacji…"); trasa używa go w trzech miejscach zamiast `interrupted`, które zostaje słowem karty dla próby przeterminowanej. Testy w `tests/lib/audit/failure.test.ts`; samych ścieżek wyjątku w trasie żaden test nie wywołuje (tak jak przed zmianą).

### F4 — Ponowiony zapis wyniku myli „zapisano, odpowiedź zginęła" z `claim_lost`

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/audit/store.ts:160, :196-200
- **Detail**: Gdy pierwszy zapis się zatwierdził, ale odpowiedź nie dotarła, drugi filtruje po `run_state = running`, trafia w zero wierszy i zwraca `claim_lost`. Wynik jest zapisany, a członek czyta, że ofertę przejęła inna próba; log mówi `failed`.
- **Fix**: Po zerze wierszy w drugiej próbie odczytać wiersz i uznać `completed` z tym samym `run_started_at` za zapisany.
- **Decision**: FIXED — `completeAudit` po zerze wierszy w ponowionym zapisie czyta wiersz (`storedAlready`); `completed` z tym samym `run_started_at` to `saved`. Sześć przypadków w `tests/pages/api/audits.test.ts`.

### F5 — Etykiety i pytania modelu nie mają granicy długości, a tekst ogłoszenia może udawać bloki wiadomości

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/lib/audit/grounding.ts:120-122; src/lib/audit/schema.ts:225; src/lib/audit/prompt.ts:142-143
- **Detail**: Brama sprawdza cytat, nie etykietę: `label` i `question` są zapisywane tak, jak napisał je model, bez limitu, a `label` może być pusta. Tytuł i opis trafiają do wiadomości bez neutralizacji znaczników bloków, więc opis może zamknąć blok ogłoszenia i otworzyć fałszywy blok wymagań. Skutek jest ograniczony (cytat musi być w ogłoszeniu, `Wn` musi istnieć, render jest tekstem), ale etykieta obok prawdziwego cytatu może nieść dowolne twierdzenie.
- **Fix**: `groundFindings` odrzuca znalezisko z pustą etykietą albo dłuższą niż ustalony limit (brama nadal tylko zabiera); osobno decyzja, czy neutralizować znaczniki bloków w tekście ogłoszenia.
  - Strength: Mieści się w regule „tylko odrzuca".
  - Tradeoff: Limit to decyzja produktowa; zmiana w `prompt.ts` dotyka instrukcji zatwierdzonej słowo w słowo i układu wiadomości.
  - Confidence: MEDIUM — ryzyko realne, ale wąskie.
  - Blind spot: Nie mierzono, jak długie etykiety model faktycznie zwraca.
- **Decision**: FIXED — `groundFindings` odrzuca znalezisko pozytywne z pustą etykietą albo dłuższą niż 200 znaków i brak z pytaniem dłuższym niż 400 (limity wybrane przez użytkownika 2026-10-09; zmierzone lokalnie: etykiety 33–51 znaków, pytania do 86). Liczone w `dropped` (log), nie w `rejected` (karta). Testy w `tests/lib/audit/grounding.test.ts`. Neutralizacja znaczników bloków w `prompt.ts` nie była ruszana.

### F6 — `provider_error_message` przepuszcza cytat krótszy niż 12 znaków

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/audit/provider.ts:201-213
- **Detail**: Wyjątek zatwierdzony 2026-10-09 jest tak wąski, jak opisuje `change.md` (tylko 400 `invalid_request_error` poza stanem rozliczeń, 300 znaków, nigdy do członka). Zostaje krawędź: fragment ogłoszenia krótszy niż 12 znaków (telefon `600 700 800` ma 11) albo zacytowany w formie z ucieczkami przechodzi do logu. Test `tests/pages/api/audits.test.ts:1420` utrwala próg jako zamierzony.
- **Fix**: Zaakceptować jako znane ograniczenie zatwierdzonego wyjątku albo zaostrzyć: odrzucać komunikat zawierający cudzysłów lub ciąg cyfr.
- **Decision**: FIXED — `rejectionMessage` odrzuca cały komunikat z ciągiem 7 lub więcej cyfr (spacje i myślniki pomiędzy); testy obok kontrolnego komunikatu z liczbami limitu.

### F7 — Nieudane odczyty przed płatnym wywołaniem nie zostawiają przyczyny w logu

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/api/audits.ts:139-143; src/lib/criteria.ts (`loadAuditCriteria`); src/lib/audit/settings.ts (`loadAuditSettings`); src/lib/audit/store.ts:399
- **Detail**: `criteria_read_failed` i `settings_read_failed` są logowane samym etapem; funkcje odczytu gubią kod bazy, status i nazwę błędu w `catch`. `loadOfferAudit` nie loguje niczego. Odczyt oferty obok niesie `db_code`. To zgodne ze starszymi wzorcami (`loadCriteria`, `loadNotes`), ale wbrew regule debugowania „no dropped error causes".
- **Fix**: Stan `error` tych odczytów niesie kod, status i nazwę błędu, a trasa dopisuje je do wpisu z białej listy reportera.
- **Decision**: FIXED — stan `error` z `loadAuditCriteria` i `loadAuditSettings` niesie `failure` (krok, kod i status bazy, nazwa wyjątku — bez `message`/`details`), a trasa dopisuje go do wpisu jako `detail`, `db_code`, `db_status`, `error_name`. Testy w `tests/pages/api/audits.test.ts` i `tests/lib/criteria.test.ts`. `loadOfferAudit` (czytany przez stronę karty) bez zmian.

### F8 — Dwa dokumenty nadal opisują S-04 jako nierozpoczęte

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/foundation/roadmap.md:232; context/foundation/test-plan.md:83-84, :88-89
- **Detail**: Wiersz backlogu roadmapy mówi „planned … run `/10x-implement grounded-listing-audit`", choć tabela plastrów ma `in-progress`. Test-plan §3 mówi, że fazy 3 i 4 czekają na S-04, a §6.6 już opisuje, że ich testy powstały. Kontrakt fazy 6 tych wierszy nie wymieniał.
- **Fix**: Uzgodnić oba miejsca ze stanem po S-04.
- **Decision**: FIXED częściowo — wiersz backlogu w `roadmap.md` ma `in-progress` i stan po fazach 1–6. `test-plan.md` §3 zostaje bez zmian: §6.6 zapisuje wprost, że fazy 3 i 4 zostają, jak stoją, a decyzja o ich zamknięciu należy do `/10x-test-plan` — to nie było przeoczenie.

### F9 — `npm run smoke` i `npx supabase db reset` nie zostały powtórzone w przeglądzie

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: N/A (kryteria 1.1, 1.3, 2.3, 4.4, 5.3)
- **Detail**: Sprzątanie smoke usuwa wymagania kont `sigaretif1`/`sigaretif2`, a `sigaretif1` ma w lokalnej bazie jedno wymaganie wpisane ręcznie. `db reset` skasowałby dwie lokalne oferty z wynikami opłaconych audytów. Oba kryteria są odhaczone w Progress z commitami faz; zadanie `smoke` w CI powtórzy je na czystej bazie przy wyjściu zmiany.
- **Fix**: Uruchomić smoke za zgodą użytkownika (wymaganie przepadnie) albo zostawić to zadaniu CI; `db reset` pominąć.
- **Decision**: FIXED — `npm run smoke` uruchomiony za zgodą użytkownika na podglądzie produkcyjnym po wszystkich poprawkach triage: wszystkie kroki przeszły, w tym dwa nowe z F1. Lokalne wymaganie konta `sigaretif1` zostało usunięte przez sprzątanie smoke, zgodnie z decyzją. `npx supabase db reset` świadomie pominięty (lokalne oferty z opłaconymi audytami); trzecia migracja została nałożona przez `supabase migration up`.

### F10 — Ustalenie sesji przed odpowiedzią i porzucanie ciasteczek po niej nie są nigdzie zapisane

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: src/pages/api/audits.ts:278-289; tests/pages/api/audits.test.ts:1686-1726
- **Detail**: Trasa woła `getSession()` przed wysłaniem odpowiedzi i odrzuca zapisy ciasteczek po niej. To chroni zapis opłaconego wyniku, ale nie ma tego ani w planie, ani w `change.md`. Niepotwierdzone ryzyko: token wygasający między ok. 90 a 170 sekundą audytu zostanie odświeżony w trakcie, a obrócony refresh token nie trafi do przeglądarki; czy członek zostanie wtedy wylogowany, zależy od tego, jak Auth traktuje ponowne użycie starego tokenu.
- **Fix**: Dopisać decyzję do `change.md`; ryzyko sprawdzić lokalnie na zaślepce dostawcy z krótkim `jwt_expiry` (bez płatnego wywołania).
- **Decision**: FIXED — mechanizm i wynik sprawdzenia zapisane w `change.md`. Ryzyko sprawdzone na lokalnym Supabase Auth bez zmiany konfiguracji: stary refresh token odtworzony 13 i 26 s po rotacji, której przeglądarka nie zobaczyła, dostał bieżący token (200) — członek nie jest wylogowywany. Niesprawdzone: ustawienia Auth hostowanego projektu.

## Sprawdzone i bez zastrzeżeń

- Każda zaplanowana zmiana faz 1–6 istnieje i robi to, co mówi jej kontrakt; nic nie przekracza „What We're NOT Doing". Pliki spoza planu (`SelectField.tsx`, `stream.ts`, `format.ts`, dodatkowe testy, `isAuditAvailable()`, `auditDataState()`) to uzasadnione części zaplanowanych zmian.
- RLS: włączone na obu tabelach, jedna polityka na operację, nic dla `anon`, bez `for all` i `using (true)`; funkcje `security definer` z pustym `search_path` i `revoke execute`.
- Gałęzie usuniętego konta stoją pierwsze, osobno dla każdej kolumny.
- Każde wyjście trasy po przejęciu kończy próbę w bazie; płatne wywołanie nie jest ponawiane (`maxRetries: 0`, klient na żądanie); terminy i sygnał życia są sprzątane.
- Prywatność: `select` trasy to `AUDIT_OFFER_COLUMNS`, wymagania jako sama treść, zakaz importu notatek w lincie; logi niosą tylko identyfikatory, kody i liczniki.
- CPU: delty sklejane raz, jeden `JSON.parse`, tekst zwijany raz na audyt.
- Widoki: bez `set:html`; nic ze znaleziska nie trafia do atrybutu ani do wyspy.
- Smoke nie może dotrzeć do dostawcy.

Drobiazgi niezgłoszone jako ustalenia: `loadAuditIndex` czyta bez zakresu (ponad 1000 audytowanych
ofert odpowiedź byłaby obcięta przez `max_rows`); sygnał życia płynie tylko podczas wywołania
modelu, nie „przez cały czas"; `cfContext` jest czytany przez lokalny typ zamiast
`Partial<App.Locals>`.
