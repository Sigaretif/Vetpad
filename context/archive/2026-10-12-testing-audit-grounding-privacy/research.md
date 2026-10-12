---
date: 2026-10-12T13:13:43+02:00
researcher: Wiktor Ortel (z Claude Code)
git_commit: 7586f8a685a0dea9300b416435d37bbe798d887a
branch: master
repository: Sigaretif/Vetpad
topic: "Faza 4 planu testów — ugruntowanie znalezisk i prywatność promptu (ryzyka #4 i #6 po stronie promptu): czego testy z S-04 nie dowodzą"
tags: [research, testing, audit, grounding, prompt-privacy, stryker]
status: complete
last_updated: 2026-10-12
last_updated_by: Wiktor Ortel (z Claude Code)
---

# Research: Faza 4 planu testów — ugruntowanie znalezisk i prywatność promptu (ryzyka #4 i #6)

**Date**: 2026-10-12T13:13:43+02:00
**Researcher**: Wiktor Ortel (z Claude Code)
**Git Commit**: 7586f8a685a0dea9300b416435d37bbe798d887a (drzewo robocze: niezacommitowana zmiana statusu fazy 4 w `context/foundation/test-plan.md`)
**Branch**: master
**Repository**: Sigaretif/Vetpad

## Research Question

Ugruntować fazę 4 rolloutu z `context/foundation/test-plan.md` („Audit grounding and prompt
privacy"). S-04 dostarczyło już testy audytu i wypełniło §6.5. Co z intencji odpowiedzi na
ryzyko #4 (nieugruntowane znalezisko) i #6 po stronie promptu (dane sprzedającego lub notatki
u dostawcy modelu) pozostaje **niedowiedzione**, na jakiej warstwie najtaniej to dowieść
i czego nie wolno dublować?

## Summary

Obie ochrony są dowiedzione testami z S-04. W zbadanym zakresie nie znalazłem luki, która
pozwalałaby nieugruntowanemu znalezisku trafić do zapisu albo zakazanej danej trafić do
żądania. Nie znalazłem też defektu w kodzie.

Dowód ilościowy: przebieg Strykera zawężony do `src/lib/audit/grounding.ts`, `input.ts`,
`prompt.ts` i `schema.ts` (2026-10-12, lokalnie, bez sieci, testy z `npm test`) dał 507
mutantów: 502 zabite, 4 timeouty, 1 ocalały, 0 bez pokrycia. Jedyny ocalały
(`grounding.ts:73`, `<` → `<=`) jest równoważny. Dla `prompt.ts` i `schema.ts` to pierwszy
taki przebieg; `grounding.ts` i `input.ts` miały go w S-04, ale bez zapisanego wyniku
(`test-plan.md:1106-1109`).

Zostają trzy drobne rzeczy do decyzji, żadna nie jest dziurą w ochronie:

| #   | Co                                                                            | Charakter                                   | Najtańsza warstwa                 |
| --- | ----------------------------------------------------------------------------- | ------------------------------------------- | --------------------------------- |
| L1  | Kontakt wpisany w **tytuł** nie ma własnego przypadku (jest tylko w opisie)   | dopowiedzenie wytycznej z §2, nie luka kodu | unit, 1–2 przypadki               |
| L2  | Reguła lintu `auditNoNotesConfig` nie ma automatycznego dowodu, że się zapala | dowód był ręczny, jednorazowy               | unit przez API ESLinta — do oceny |
| L3  | Dziennik mutantów dla czterech modułów nie istnieje w repozytorium            | dokumentacja                                | `mutation.md` w folderze zmiany   |

Poza zakresem fazy, ale warte decyzji użytkownika (sekcja „Open Questions"): cytat może
zaczynać się w połowie zdania i uciąć przeczenie, a treść ogłoszenia może zawierać znacznik
zamykający blok promptu. Opcjonalny złoty zestaw nadal nie był uruchomiony i wymaga płatnych
audytów — to krok użytkownika.

Wniosek dla planu: faza 4 jest bliska zamknięcia jako „pokryta". Plan, jeśli powstanie, jest
mały: L1, ewentualnie L2, `mutation.md` i wpis w §6.6.

## Detailed Findings

### Ryzyko #4 — ścieżka w kodzie

- Odpowiedź modelu przechodzi przez dwa etapy. Najpierw `readAuditOutput` sprawdza kształt
  i zwraca `null` dla atrybutu spoza listy; wtedy cały audyt kończy się jako
  `provider_malformed` (`src/lib/audit/schema.ts:122-127`, `:156-164`;
  `src/lib/audit/provider.ts:343-344`). Znalezisko o braku spoza dziewięciu atrybutów nie
  dochodzi więc do bramki.
- Potem `groundFindings` jest jedynym miejscem między odpowiedzią a zapisem
  (`src/pages/api/audits.ts:227`, zapis w `:235-244`). Trasa zapisuje `findings` z bramki,
  nigdy `run.output`.
- Dopasowanie cytatu jest deterministyczne: zwinięcie białych znaków po obu stronach,
  potem `indexOf` znak po znaku, z wielkością liter (`src/lib/audit/grounding.ts:105-115`).
  Zapisywany jest fragment wycięty z tekstu ogłoszenia, nie tekst modelu (`:112`).
- Tekstem odniesienia są `input.title` i `input.description` (`grounding.ts:173-176`),
  czyli kolumny `title` i `description` wiersza odczytanego na początku żądania
  (`audits.ts:140-158`, `:177`). `raw` nie jest czytane.
- Znalezisko o braku nie ma pola cytatu w żadnym z dwóch kształtów (`schema.ts:23-28`,
  `:171-180`), a oba czytniki odbudowują obiekt ze znanych pól, więc dopisane `excerpt`
  nie przechodzi dalej (`schema.ts:126`, `:218-219`).

Weryfikacja wytycznej z §2: „odrzucone bez cytatu lub z cytatem, który nie jest dosłownym
fragmentem" — potwierdzone. „Znalezisko o braku nie niesie cytatu" — potwierdzone, i to
strukturalnie. Doprecyzowanie: brak spoza listy nie jest odrzucany pojedynczo, tylko
unieważnia całą odpowiedź (§6.5 mówi to samo, `test-plan.md:732-734`).

### Ryzyko #4 — istniejące testy

- `tests/lib/audit/grounding.test.ts` (773 linie). Szesnaście wariantów cytatu odrzuconego
  obok cytatu przyjętego: parafraza, poprawiona literówka, brak znaków diakrytycznych, inna
  wielkość liter, cudzysłowy, sklejone fragmenty, wielokropek, koniec tytułu sklejony
  z początkiem opisu, wartość parametru, tekst wymagania (`:117-140`). Do tego pusty cytat
  (`:142`), same białe znaki (`:146`), białe znaki jako jedyna dozwolona różnica
  (`:166-241`), próg 10 znaków z obu stron (`:243-286`), braki (`:288-419`), wymagania
  (`:421-553`), limity etykiety i pytania (`:555-630`), oba liczniki (`:647`).
- `tests/lib/audit/schema.test.ts`: `readAuditOutput` i `readFindings`, każda odmowa obok
  odczytu udanego; atrybut spoza listy (`:231`, `:355`, `:535`); „passes on nothing but the
  fields it knows" (`:434`, `:609`).
- `tests/pages/api/audits.test.ts:1249-1289`: w teście trasy sparafrazowany koszt nie trafia
  do zapisu, `rejected_count` wynosi 1, a obok stoi kontrola z cytatem dosłownym.
- Widok: `tests/components/offers/render.test.ts:467-512` (znalezisko jako tekst).

Żaden z tych testów nie używa modelu do oceny cytatu — zgodnie z anty-wzorcem z §2.

### Ryzyko #6 (prompt) — ścieżka w kodzie

- Trasa prosi bazę tylko o kolumny z białej listy i `archived_at`
  (`src/pages/api/audits.ts:48`, `:142`). `raw`, `images`, `source_url`, `id`, `created_by`
  nie są pobierane.
- `readAuditOffer` czyta wyłącznie klucze z `AUDIT_OFFER_COLUMNS`
  (`src/lib/audit/input.ts:45-71`, `:226-230`), a `buildAuditInput` tylko nazwane pola
  kryteriów (`:310-331`).
- Żądanie do dostawcy składa się z `system`, jednej wiadomości `user`, modelu, wysiłku,
  limitu tokenów i schematu (`src/lib/audit/provider.ts:295-300`). Brak `metadata`.
- Tytuł i opis idą do promptu bez zmian (`src/lib/audit/prompt.ts:142-143`). Nic w tych
  modułach nie redaguje tekstu ogłoszenia.
- Kryteria: `loadAuditCriteria` pobiera z `member_requirements` tylko `body`
  (`src/lib/criteria.ts:396-399`).
- Notatki: w zbadanych plikach (`src/lib/audit/*.ts`, `src/pages/api/audits.ts`) nie ma
  odczytu `offer_notes`; import modułu notatek blokuje `auditNoNotesConfig`
  (`eslint.config.js:121-137`).

Weryfikacja założenia „biała lista mappera wystarczy": jest fałszywe i kod na nim nie
polega. Fikstura niesie dane sprzedającego w `raw` właśnie po to, by dowieść, że audyt ma
własną białą listę (`tests/fixtures/audit.ts:140-154`).

### Ryzyko #6 (prompt) — istniejące testy

Szukanie kanarków odbywa się na czterech etapach, każde z kontrolą, że źródło je zawiera:

- wynik `readAuditOffer` — `tests/lib/audit/input.test.ts:139-146`;
- wynik `buildAuditInput` — `input.test.ts:503-510`;
- obie części promptu — `tests/lib/audit/prompt.test.ts:504-512`;
- ciało żądania nagranego pod adresem dostawcy — `tests/pages/api/audits.test.ts:1237-1246`.

Obok nich: zestawy kluczy pisane ręcznie (`input.test.ts:109-137`, `:522-535`;
`prompt.test.ts:531`; `audits.test.ts:1163-1170`), parametr `select` żądania do bazy
(`audits.test.ts:590-604`), brak żądań do `offer_notes` (`audits.test.ts:999`; zaślepka
rzuca przy nieplanowanym żądaniu, `tests/fixtures/http.ts:70`), instrukcja niezależna od
ogłoszenia (`prompt.test.ts:264-291`).

Druga połowa — kontakt wpisany przez ogłoszeniodawcę zostaje dosłownie — jest sprawdzana
dla **opisu** na trzech etapach: `input.test.ts:514-520`, `prompt.test.ts:521-529`,
`audits.test.ts:1229-1231`.

### Przebieg Strykera (2026-10-12)

```
npx stryker run --mutate "src/lib/audit/grounding.ts,src/lib/audit/input.ts,src/lib/audit/prompt.ts,src/lib/audit/schema.ts"
```

| Plik           | Zabite | Timeout | Ocalałe | Bez pokrycia |
| -------------- | ------ | ------- | ------- | ------------ |
| `grounding.ts` | 111    | 4       | 1       | 0            |
| `input.ts`     | 181    | 0       | 0       | 0            |
| `prompt.ts`    | 38     | 0       | 0       | 0            |
| `schema.ts`    | 172    | 0       | 0       | 0            |
| Razem (507)    | 502    | 4       | 1       | 0            |

- Ocalały: `grounding.ts:73:10`, `while (index < original.length)` → `<=`. Dodatkowy obrót
  pętli dopisuje pusty tekst do `parts` i po jednym wpisie do `starts` i `ends`; `text` po
  `join("")` jest taki sam, a dopisanych wpisów nikt nie indeksuje, bo `at` i `last`
  mieszczą się w długości `text` (`grounding.ts:109-112`). Równoważny.
- Timeouty: reporter tekstowy nie podał ich pozycji. Wszystkie cztery są w `grounding.ts`;
  przypuszczam, że to mutacje pętli w `collapse` (`:73-86`), które ją zapętlają — to
  wniosek, nie obserwacja. Stryker liczy timeout jako wykryty.
- `reports/mutation/mutation.json` w drzewie pochodzi z innego przebiegu i nie opisuje tego.

### Luki

**L1 — kontakt w tytule.** Wytyczna z §2 mówi „w tytule lub opisie". `TYPED_PHONE`
i `TYPED_NAME` stoją tylko w opisie (`tests/fixtures/audit.ts:85`). Że tytuł wychodzi bez
zmian, dowodzą testy ogólne (`input.test.ts:148-155`, `prompt.test.ts:374-376`), więc
redakcja tytułu byłaby wykryta tylko wtedy, gdyby dotknęła tekstu fikstury — a ta nie ma
w tytule nic, co wygląda jak kontakt. Jeden przypadek z numerem w tytule (w `input.test.ts`
i `prompt.test.ts`, przez `auditOfferRow({ title: … })`) zamyka wytyczną dosłownie.

**L2 — reguła lintu.** `auditNoNotesConfig` potwierdzono raz, ręcznie
(`test-plan.md:771-775`). W `tests/` i `scripts/` nie ma testu, który uruchamia ESLint na
próbce. Ograniczenia samej reguły: łapie import modułu o nazwie `notes`
(`eslint.config.js:129`), nie zapytanie `.from("offer_notes")` — to drugie na ścieżce trasy
łapie test trasy (`audits.test.ts:999`). Czy test przez API ESLinta mieści się w `npm test`
(czas, konfiguracja pod Vitest), nie sprawdzałem; to pytanie do planu.

**L3 — dziennik mutantów.** S-04 nie zostawiło zapisu wyników. Tabela wyżej nadaje się do
`mutation.md` na wzór `context/archive/2026-10-12-testing-audit-cost-durability/mutation.md`.

### Czego nie dublować

- Kolejnych wariantów odrzuconego cytatu w teście trasy: szew trasa–bramka jest dowiedziony
  jednym przypadkiem z kontrolą, reszta jest w teście jednostkowym.
- Kanarków w `raw` — fikstura je ma i cztery etapy ich szukają.
- Testów logu (`audits.test.ts:2119-2198`) — to strona logu ryzyka #6, nie promptu.

### Dowody mylące

- Katalog `src/lib/otodom/` z listy hot-spotów nie leży na ścieżce żadnego z dwóch ryzyk
  w tej fazie: audyt bierze z niego etykiety i typy (`input.ts:20-37`), nie dane. Strona
  zapisu ryzyka #6 została zamknięta w fazie 1.

## Code References

- `src/lib/audit/grounding.ts:105-115` — dopasowanie cytatu
- `src/lib/audit/grounding.ts:172-222` — `groundFindings`, oba liczniki
- `src/lib/audit/schema.ts:156-164` — `readAuditOutput`
- `src/lib/audit/input.ts:45-71`, `:220-233`, `:310-331` — biała lista i budowa wejścia
- `src/lib/audit/prompt.ts:124-126`, `:138-161` — bloki wiadomości
- `src/lib/audit/provider.ts:295-300`, `:343-344` — żądanie i odmowa złego kształtu
- `src/pages/api/audits.ts:48`, `:140-158`, `:177-178`, `:227-244` — odczyt, prompt, bramka, zapis
- `eslint.config.js:121-137` — `auditNoNotesConfig`
- `tests/fixtures/audit.ts:52-68` — `FORBIDDEN_IN_AUDIT`

## Architecture Insights

- Ochrona #4 stoi na jednej czystej funkcji i jednym czytniku kształtu; trasa nie ma
  własnej logiki ugruntowania. Dlatego warstwa jednostkowa jest tu właściwa i wystarczająca.
- Ochrona #6 jest podwójną białą listą (kolumny w `select`, klucze w `readAuditOffer`),
  a testy szukają nieobecności na każdym etapie z kontrolą obecności w źródle.

## Historical Context (from prior changes)

- `context/foundation/test-plan.md:1036-1129` — wpis S-04: testy #4 i #6 powstały z kodem;
  decyzję, czy fazę 4 zamknąć jako pokrytą, zostawiono orkiestratorowi. Potwierdzone tym
  researchem.
- `context/foundation/test-plan.md:1106-1109` — „Stryker na `grounding.ts` i `input.ts`,
  bez dziennika". Potwierdzone: w archiwum S-04 nie ma `mutation.md`.
- `context/foundation/test-plan.md:1118-1121` — złoty zestaw nie był uruchomiony. Nadal
  prawda.
- `context/foundation/test-plan.md:1124-1127` — członek może nadpisać zapisany wynik przez
  Data API; przyjęte w planie S-04. Karta nie ugruntowuje wyniku ponownie przy odczycie
  (`readFindings` sprawdza kształt, `schema.ts:247-255`). Poza zakresem tej fazy.

## Related Research

- `context/archive/2026-10-12-testing-audit-cost-durability/research.md` — faza 3, ta sama metoda.

## Open Questions

1. **Zamknąć fazę jako pokrytą czy dołożyć L1 i L2?** Decyzja użytkownika. L1 to kilka
   linii; L2 wymaga sprawdzenia, czy ESLint da się tanio uruchomić pod Vitest.
2. **Cytat urwany w połowie.** `indexOf` nie zna granic słów ani zdań
   (`grounding.ts:109`): fragment „ma hipoteki" z „nie ma hipoteki" jest dosłowny i ma ponad
   10 znaków, więc przejdzie. Instrukcja prosi o cytat zrozumiały samodzielnie
   (`prompt.ts:111`), ale bramka tego nie wymusza i żaden test nie przypina zachowania w
   żadną stronę. To pytanie produktowe do PRD (FR-011), nie brak testu; zmiana bramki nie
   należy do fazy testowej.
3. **Znacznik zamykający w treści.** `block()` nie zmienia treści (`prompt.ts:124-126`),
   więc opis zawierający `</opis>` zamyka blok wcześniej. Test przypina tylko polecenie
   w opisie (`prompt.test.ts:283-290`). Bramka cytatów działa niezależnie od tego, a zmiana
   treści łamałaby dosłowność, więc to obserwacja poza #4 i #6, do ewentualnej osobnej zmiany.
4. **Złoty zestaw.** Jedyne narzędzie do oceny, czy model wskazuje to, co ważne. Każde
   ogłoszenie to płatny audyt, więc uruchamia go użytkownik, gdy zechce.
