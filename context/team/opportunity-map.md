# Opportunity Map

## Context

- **Project / context**: Vetpad — zespół 3 osób (lead + 2 programistów), trzy osoby szukające mieszkania jako pierwsi użytkownicy. Scenariusz kursowy (10xDevs, M5L1).
- **Data constraint**: mock / lokalne / read-only — kod publicznego repo, historia gita, publiczne endpointy.
- **Date**: 2026-10-16

Ustalenie z repo przed klasyfikacją: część inwariantów „sprawdzanych ręcznie” jest już zakodowana — `tokensOnlyConfig` i `auditNoNotesConfig` (+ `refetch`/`archive`/`deleteNoNotesConfig`) w `eslint.config.js`, kanarki danych ogłoszeniodawcy w `tests/fixtures/otodom.ts`, `on delete` w `scripts/account-deletion.sql`, RLS istniejących tabel w `scripts/smoke.mjs`. Ręcznie zostaje to, co dotyczy **nowych** migracji i nowych ścieżek kodu.

## Map

| Signal                                                                               | Existing / default response                                                                                                 | Thin complement                                                                                                                              | First useful version                                                            | Data risk                                              | Direction if valuable            |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------ | -------------------------------- |
| Review wraca z tymi samymi uwagami; inwarianty CLAUDE.md sprawdzane ręcznie przy PR  | ESLint (tokeny, zakaz importu notatek), testy z kanarkami, smoke, `account-deletion.sql`, `/10x-impl-review` + `lessons.md` | Sprawdzenia na diffie dla niezakodowanych inwariantów (RLS w nowej migracji, `on delete` przy `auth.users`, `safeHttpsUrl`, pola sprzedawcy) | Lokalny skrypt na `git diff origin/master...`, puszczony wstecz na PR-y z F1/F4 | Kod publicznego repo — niewrażliwe                     | Internal tool → Review / CI gate |
| Status pracy w 4 miejscach; ~52/201 commitów to synchronizacja                       | `Closes #N` w PR, GitHub Projects; commity generują głównie skille                                                          | Usunąć 1–2 źródła prawdy zamiast je synchronizować                                                                                           | Spis: kto czyta każde źródło i po co                                            | Niewrażliwe                                            | Wait / no build                  |
| Zdrowie produkcji w 3 panelach; ciche awarie (1102, pauza Supabase, `__NEXT_DATA__`) | Maile GitHub Actions / Cloudflare / Supabase, darmowy uptime monitor, tabela objawów w `deployment-runbook.md`              | Ręczny health digest (ostatni run CI, `/auth/v1/health`, `/` i `/auth/signin`)                                                               | `node scripts/health.mjs` — 3 linie OK/FAIL z linkiem do runbooka               | Publiczne endpointy produkcji, bez danych użytkowników | Wait — najpierw gotowe narzędzia |

## Recommended First Candidate

```text
Candidate:
invariant-diff-check

Reads:
git diff origin/master... ; supabase/migrations/*.sql ; src/** ;
reguły z context/foundation/lessons.md i CLAUDE.md (jako źródło, nie parsowane automatycznie)

Returns:
listę trafień `plik:linia — reguła — odnośnik do lekcji/CLAUDE.md`, albo „brak trafień”:
- migracja z `create table` bez `enable row level security`, z `for all`, z `using (true)`,
  albo bez polityki na którąś z operacji select/insert/update/delete
- `references auth.users` bez `on delete`
- `href`/`src` z wartości z wiersza bazy bez `safeHttpsUrl`
- `phones` / `contacts` / `sellerPhone` / `agencyName` poza granicą fetcha w `src/lib/otodom/`

Does not do:
nie blokuje CI, nie komentuje PR-ów, nie woła modelu (regexy/dopasowania), nie zastępuje
ESLint ani /10x-impl-review, nie dubluje reguł, które lint już egzekwuje

Data risk:
publiczny kod, niewrażliwe; nic nie opuszcza maszyny

Direction if it proves valuable:
reguły o dobrym stosunku trafień do fałszywych alarmów przenieść do eslint.config.js
(wzór: tokensOnlyConfig) albo do kroku w .github/workflows/ci.yml — i skreślić je
z ręcznej listy review
```

## Why This Candidate

Powtarza się przy każdym PR, łączy dwa źródła (diff + reguły z `lessons.md`/CLAUDE.md), ma gotową miarę skuteczności (findingi F1 i F4 z impl-review `paste-listing-to-card` — czy skrypt złapałby je wstecz?), uzupełnia CI zamiast je zastępować i ma przetarty kierunek dalej — repo już raz przeszło tę drogę z `tokensOnlyConfig`. Sygnał 2 rozwiązuje się odejmowaniem źródeł, nie budowaniem synchronizatora (który byłby piątym źródłem). Sygnał 3 ma darmowe gotowe narzędzia, których jeszcze nie wypróbowano.

Zastrzeżenie do sygnału 3: cykliczny kanarek na otodom.pl koliduje z inwariantem „żadnego scrapowania w tle” i z `robots.txt` — to decyzja do podjęcia z leadem, nie domyślne uzupełnienie. Dziś zmiana `__NEXT_DATA__` objawia się jawnym błędem fetcha przy pierwszym wklejonym linku.

## Next Direction If Valuable

Review / CI gate. Ścieżka wybrana 2026-10-16: od razu budowa — `/10x-new` → `/10x-research` → `/10x-plan` → `/10x-implement`. Pierwszy krok walidacyjny mimo to tani: przejrzeć z dwoma programistami ostatnie uwagi z review i potwierdzić, że lista czterech sprawdzeń jest kompletna.
