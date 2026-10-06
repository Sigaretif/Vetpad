# Ugruntowany audyt AI zapisanego ogłoszenia (S-04) — Plan Brief

> Full plan: `context/changes/grounded-listing-audit/plan.md`
> Research: `context/changes/grounded-listing-audit/research.md`

## What & Why

Budujemy audyt AI zapisanej oferty: członek naciska przycisk na karcie i dostaje krytyczne
braki z pytaniami do sprzedającego, warunki obowiązkowe, koszty nazwane w ogłoszeniu i
czerwone flagi. To najtwardsza obietnica produktu (FR-010, FR-011): znalezisko, którego nie
da się dosłownie zacytować z ogłoszenia, nie jest pokazywane. Plan prowadzi zmianę aż na
produkcję, bo dopiero prawdziwy audyt pokaże, czy mieści się w limicie CPU darmowego planu.

## Starting Point

Oferta, kryteria zespołu z licznikiem rewizji, notatki i tablica już istnieją. Audytu nie
ma: `auditStatus()` zwraca stałą, karta ma oznaczone miejsce, w repozytorium nie ma
integracji z dostawcą modelu ani żadnego endpointu sterowanego `fetch` z wyspy.

## Desired End State

Na karcie oferty nad notatkami stoi sekcja „Audyt AI" z postępem na żywo podczas pracy
modelu i z czterema kategoriami znalezisk po zakończeniu, każde pozytywne z cytatem.
Zespół wybiera model i effort na stronie kryteriów, tablica odróżnia oferty audytowane od
nieaudytowanych, a runbook niesie zmierzone CPU, tokeny i czas z produkcji.

## Key Decisions Made

| Decision                        | Choice                                                                                                                                                                             | Why (1 sentence)                                                                             | Source   |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | -------- |
| Dostawca i integracja           | Anthropic bezpośrednio, przedpłacone kredyty, oficjalny SDK                                                                                                                        | Rachunek nie może przekroczyć wpłaty, a SDK wspiera Workers i wyjście wymuszone schematem.   | Research |
| Domyślny model i effort         | `claude-opus-5-5`, `medium`                                                                                                                                                        | Poprawność ponad koszt, z kompromisem użytkownika co do rozumowania.                         | Research |
| Tekst odniesienia cytatów       | Kolumny `title` i `description`, nigdy `raw`                                                                                                                                       | Opis jest znormalizowany przy pobraniu właśnie po to, by cytat zgadzał się z kartą.          | Research |
| Wybór modelu w aplikacji        | Wspólne ustawienie zespołu w Postgresie, edytowane na `/criteria`                                                                                                                  | Zmiana bez wdrożenia i spójność między ofertami.                                             | Plan     |
| Zmiana ustawień a nieaktualność | Nie oznacza audytów jako nieaktualne; audyt zapisuje model i effort                                                                                                                | Decyzja użytkownika: wystarczy ślad, czym audyt wykonano.                                    | Plan     |
| Zamknięta lista                 | Opus 5.5 i Sonnet 5.5; `low`, `medium`, `high`                                                                                                                                     | Realny wybór kosztu przy sześciu kombinacjach do sprawdzenia.                                | Plan     |
| Nacisk instrukcji               | Przygotowanie do oglądania: braki z pytaniami najdokładniej, reszta jako etykieta plus cytat                                                                                       | Trafia w główne kryterium sukcesu PRD i trzyma zasadę „zakreślacz, nie prawnik".             | Plan     |
| Braki krytyczne                 | Dziewięć atrybutów zawsze (cena, metraż, lokalizacja, piętro, ogrzewanie, forma własności, czynsz administracyjny, rok budowy, stan wykończenia) plus wymagania dodatkowe członków | Reguła nie zależy od tego, czy limit jest ustawiony, i daje się sprawdzić deterministycznie. | Plan     |
| Audyt bez kryteriów             | Zawsze dozwolony; nieudany odczyt kryteriów to odmowa                                                                                                                              | Nieustawiony limit znaczy „bez limitu", a US-01 działa od pierwszego dnia.                   | Plan     |
| Postęp i limit 3 minut          | Wyspa React plus strumień NDJSON z etapem i sygnałem życia                                                                                                                         | Ciągła widoczność postępu i brak cichego połączenia, które platforma mogłaby uciąć.          | Plan     |
| Ponowne uruchomienie            | Jeden audyt na ofertę; stary wynik znika dopiero po udanym zapisie nowego                                                                                                          | Nieudana próba nie niszczy opłaconego wyniku.                                                | Plan     |
| Walidacja odpowiedzi            | Bez biblioteki: kształt wymusza API, treść sprawdza kod                                                                                                                            | Ugruntowania i tak nie sprawdzi żadna biblioteka.                                            | Plan     |
| Usunięte konto                  | Audyt zostaje, podpisany „osoba z usuniętym kontem"                                                                                                                                | Spójne z ofertami i notatkami; audytu nie usuwa akcja maszynowa.                             | Plan     |
| Odrzucone znaleziska            | Nie są pokazywane; karta podaje ich liczbę                                                                                                                                         | PRD zabrania pokazywania nieugruntowanych znalezisk, a liczba nie ukrywa dowodu.             | Plan     |
| Ponowienia SDK                  | Wyłączone                                                                                                                                                                          | Dostawca nalicza opłatę za żądanie przerwane po czasie.                                      | Plan     |
| Bramka wizualna                 | Tak                                                                                                                                                                                | Sekcja audytu ma najwięcej stanów w aplikacji.                                               | Plan     |
| Budżet płatnych wywołań         | Cztery zaplanowane audyty w całej zmianie i dwa w rezerwie; uruchamia je tylko użytkownik                                                                                          | Portfel jest przedpłacony, a testy automatyczne i tak działają na zaślepce.                  | Plan     |

## Scope

**In scope:**

- Tabele `offer_audits` i `audit_settings` z RLS i wyzwalaczami.
- Ustawienia audytu na `/criteria`.
- Budowa promptu, schemat odpowiedzi, sprawdzanie cytatów, odcisk tekstu.
- Klucz dostawcy we wzorcu zero-config, klient SDK, strumieniowa trasa `POST /api/audits`.
- Sekcja audytu na karcie, status na tablicy, strony `/dev`, bramka wizualna.
- Testy ryzyk #2, #3, #4 i #6, kroki smoke, skrypty SQL.
- Aktualizacja PRD, `CLAUDE.md`, README, roadmapy, test-planu.
- Wdrożenie, jeden audyt na produkcji, aktualizacja runbooka.

**Out of scope:**

- Stan „nieaktualny" audytu (S-09) i historia audytów.
- Wybór modelu przy pojedynczym audycie, modele spoza listy, `xhigh` i `max`.
- Limit liczby znalezisk i dzienny limit audytów.
- Biblioteka walidacji, analiza zdjęć, test E2E audytu.
- Zakup Workers Paid i pomiar jakości modeli na złotym zestawie.

## Architecture / Approach

Stan żyje w Postgresie: `offer_audits` trzyma jeden wiersz na ofertę z ostatnim wynikiem i
stanem ostatniej próby, a wyzwalacze są właścicielami dat, osób i dozwolonych przejść.
Trasa sprawdza za darmo wszystko, co się da, potem przejmuje wiersz na `running`, dopiero
wtedy woła dostawcę (strumieniowo, bez ponowień, z terminem 165 s), sprawdza cytaty i
zapisuje wynik warunkowo na własnym przejęciu. Przeglądarka dostaje strumień linii z etapem
i sygnałem życia, a po sukcesie przeładowuje kartę, więc znaleziska renderuje wyłącznie
serwer. Notatki nie mają drogi do promptu: builder dostaje tylko ofertę i kryteria, a lint
zabrania modułowi audytu importu `@/lib/notes`.

## Phases at a Glance

| Phase                                   | What it delivers                                                          | Key risk                                                      |
| --------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------- |
| 1. Schemat bazy                         | Dwie tabele z RLS, wyzwalacze stanów, testy SQL i kroki smoke             | Wyzwalacz zamrażający blokuje usunięcie konta                 |
| 2. Ustawienia audytu zespołu            | Model i effort na `/criteria`                                             | Pierwsza lista wyboru na Radix w repozytorium                 |
| 3. Rdzeń audytu                         | Prompt, schemat, sprawdzanie cytatów z testami prywatności i ugruntowania | Zbyt ostre albo zbyt luźne dopasowanie cytatu                 |
| 4. Dostawca i trasa                     | Klucz, klient SDK, strumieniowa trasa, testy liczące wywołania            | Pierwsze płatne wywołanie; SDK w workerd                      |
| 5. Karta i tablica                      | Sekcja audytu, wyspa z postępem, status na tablicy, bramka wizualna       | Cztery kategorie przy trzech rolach koloru w wąskiej kolumnie |
| 6. Dokumentacja i reguły                | PRD, `CLAUDE.md`, README, roadmapa, test-plan                             | Reguły rozjeżdżające się z kodem                              |
| 7. Wdrożenie i weryfikacja na produkcji | Migracje, sekrety, wdrożenie, jeden audyt, runbook                        | CPU ponad 10 ms na najdłuższym ogłoszeniu                     |

**Prerequisites:** lokalny Supabase i `psql`; kredyty Anthropic kupione (są od 2026-10-06).
Fazy 1–3 nie potrzebują klucza. Przed pierwszym prawdziwym audytem w fazie 4 użytkownik
ustawia konsolę (auto-reload wyłączony, limit wydatków), tworzy klucz i wpisuje
`ANTHROPIC_API_KEY` do lokalnych `.env` i `.dev.vars`. W fazie 7 ten sam sekret trafia do
Workers Secrets i sekretów GitHuba, a `supabase login` i `supabase link` muszą być wykonane.
**Estimated effort:** około 7–9 sesji w 7 fazach. Płatnych audytów jest cztery w całej
zmianie plus dwa w rezerwie; każdy uruchamia użytkownik, nigdy agent.

## Open Risks & Assumptions

- **CPU nie jest zmierzone.** Jeśli audyt przekroczy 10 ms, decyzja o Workers Paid wraca do
  użytkownika; plan jej nie podejmuje.
- **Zamknięcie karty w trakcie audytu** może kosztować opłacony wynik. `waitUntil` daje do
  30 s, potem próba czyta się jako przerwana.
- **Sonnet 5.5 nie był sprawdzony** pod kątem przyjmowania `effort` i jakości na polskiej
  terminologii. Faza 4 wykonuje na nim jeden prawdziwy audyt.
- **Żaden poziom effort nie był mierzony na polskich ogłoszeniach.** Porównanie zostaje
  krokiem opcjonalnym.
- **Rozpoznanie wyczerpanego salda** opiera się na treści komunikatu dostawcy opisanej w
  `provider-selection.md`.
- **Baner o braku klucza** pojawi się na każdej stronie w CI i na zrzutach robionych bez
  klucza.
- **Członek może celowo nadpisać wynik przez Data API.** Wyzwalacz blokuje zmianę
  przypadkową; zaufany zespół z płaskimi rolami jest założeniem PRD.
- **`street_name` i pozostałe parametry trafiają do dostawcy** jako „stated parameters" z
  PRD (Business Logic).

## Success Criteria (Summary)

- Członek uruchamia audyt z karty, widzi postęp przez cały czas i czyta znaleziska, z
  których każde pozytywne ma cytat dający się znaleźć w ogłoszeniu.
- Podwójne kliknięcie, żądanie bez sesji i nieudane ponowienie nie kosztują dodatkowego
  wywołania i nie niszczą istniejącego wyniku.
- Runbook mówi, ile CPU, tokenów i czasu zajął prawdziwy audyt najdłuższego ogłoszenia na
  produkcji.
