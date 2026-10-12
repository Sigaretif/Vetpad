# Dziennik mutantów — `testing-audit-cost-durability`

Wynik zawężonego przebiegu Strykera po fazach 1 i 2 obok stanu z researchu
i decyzja dla każdego ocalałego i niepokrytego mutanta w zakresie. Kryterium
ukończenia to brak mutanta bez decyzji — nie próg liczbowy (`plan.md`,
„Desired End State”).

Decyzje:

- **równoważny** — mutant nie zmienia obserwowalnego zachowania trasy; powód
  stoi przy każdym.
- **świadomie pominięty** — zmiana jest obserwowalna albo osiągalna tylko dla
  wartości, której żadna krawędź nie poda; powód w jednym zdaniu.
- **poza zakresem fazy** — gałąź albo asercja, którą plan odłożył
  (`plan.md`, „What We're NOT Doing”), albo mutant, którego research nie
  osądził i który nie leży w liniach luk G1–G7. Zostaje otwarty.

Raport (`reports/mutation/mutation.html`) jest lokalny, git-ignorowany
i nadpisywany przy każdym przebiegu, więc liczby i decyzje stoją tutaj.

## Przebieg (2026-10-12)

```
npx stryker run --mutate "src/pages/api/audits.ts,src/lib/audit/store.ts:1-243"
```

Testy, które Stryker widzi: `npm test` — sieć na zaślepce `fetch`, bez klucza
dostawcy. `scripts/audit-state.sql` (G3) biegnie na prawdziwej bazie i nie
zabija żadnego mutanta.

### Wynik po fazie

| Plik (zakres)                  | Wynik  | Zabite | Timeout | Ocalałe | Bez pokrycia | Razem |
| ------------------------------ | ------ | ------ | ------- | ------- | ------------ | ----- |
| `src/pages/api/audits.ts`      | 92,09% | 256    | 0       | 15      | 7            | 278   |
| `src/lib/audit/store.ts:1-243` | 82,74% | 138    | 1       | 16      | 13           | 168   |
| Razem                          | 88,57% | 394    | 1       | 31      | 20           | 446   |

Timeout to `store.ts:216:51` (`attempt += 1` → `attempt -= 1`, pętla zapisu
bez końca) — Stryker liczy go jako wykryty.

### Stan przed — czego nie da się odtworzyć

Przebieg z researchu (2026-10-12, przed fazą 1) objął trzy pliki razem,
z `src/lib/audit/provider.ts`: 731 mutantów, 599 zabitych, 1 timeout, 89
ocalałych, 42 bez pokrycia. `research.md` nie podaje podziału na pliki,
a raport tamtego przebiegu został nadpisany, więc wyniku „przed” dla samych
`audits.ts` i `store.ts:1-243` nie ma. Wiadomo tyle:

- Kod pod `src/` nie zmienił się między przebiegami, więc na
  `provider.ts` przypadało 731 − 446 = 285 mutantów.
- `research.md` wymienia w `provider.ts:149-254` 43 ocalałe i 10 bez
  pokrycia. Na dwa pliki tego przebiegu przypadało więc najwyżej 46 ocalałych
  i najwyżej 32 bez pokrycia — to górne granice, nie liczby: research nie
  mówi, że poza tym zakresem `provider.ts` nie miał innych.

Stan „przed” jest znany tylko dla linii luk, tak jak zapisał je research:

| Luka | Linie               | Przed (research)                                              | Po — zabite / ocalałe / bez pokrycia |
| ---- | ------------------- | ------------------------------------------------------------- | ------------------------------------ |
| G1   | `audits.ts:250-253` | 5 bez pokrycia                                                | 5 / 0 / 0                            |
| G2   | `audits.ts:354-360` | `:356-358` bez pokrycia, `:356:7` ocalały (liczby nie podano) | 5 / 0 / 0                            |
| G6   | `audits.ts:91`      | ocalałe w `:91:7` i `:91:24`                                  | 6 / 0 / 0                            |
| G7   | `audits.ts:242`     | 1 ocalały (`:242:18`)                                         | 5 / 0 / 0                            |
| G4   | `store.ts:67-72`    | 12 ocalałych w `:68-71`                                       | 23 / 1 / 0                           |

Jedyny ocalały w liniach luk to `store.ts:70:17`, równoważny (niżej). Żaden
przypadek nie wrócił do fazy 1.

Gałąź `getSession` — poza zakresem fazy, wymieniona w kryterium jako wyjątek:

| Linie               | Przed (research)                      | Po — zabite / ocalałe / bez pokrycia |
| ------------------- | ------------------------------------- | ------------------------------------ |
| `audits.ts:133`     | bez pokrycia (liczby nie podano)      | 2 / 1 / 3                            |
| `audits.ts:317-321` | `:319` bez pokrycia, `:318:9` ocalały | 2 / 1 / 1                            |

## `src/lib/audit/store.ts:1-243` — ocalałe i bez pokrycia

| Wiersz i mutacja                                                                                                                                                   | Decyzja             | Powód                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `store.ts:70:17` — `typeof row === "object"` → `true`                                                                                                              | równoważny          | Zostaje `row !== null`. Dla każdego elementu, który nie jest obiektem ani `null` — tekstu, liczby, wartości logicznej — odczyt `.run_started_at` nie rzuca i daje `undefined`, czyli to samo, co gałąź „nie obiekt”: `startedAt` zwraca `null`, a trasa odpowiada `claim_failed` bez wywołania dostawcy. `null` nadal zatrzymuje drugi warunek.                                                                          |
| `store.ts:94:20`, `:113:18` — `state: "claimed"` → `""`                                                                                                            | równoważny          | Trasa pyta wynik przejęcia tylko o `busy` i o `error` (`audits.ts:188-189`); każdy inny stan idzie dalej z `startedAt`, więc pusty tekst zachowuje się jak `claimed`. Nikt poza trasą nie woła `claimAudit`.                                                                                                                                                                                                             |
| `store.ts:224:19`, `:242:40` — `state: "error"` → `""`                                                                                                             | równoważny          | Trasa traktuje każdy stan zapisu inny niż `saved` i `claim_lost` jak błąd (`audits.ts:245-249`, `:90-92`): ta sama odpowiedź `save_failed` i ten sam wpis `attempt_not_marked`. Osąd z researchu, potwierdzony.                                                                                                                                                                                                          |
| `store.ts:177:9` — `read.error \|\| !Array.isArray(read.data)` → `false` oraz `\|\|` → `&&`                                                                        | równoważny          | Przy błędzie `read.data` jest `null`, a `null.length` rzuca do `catch` tej samej funkcji, który odpowiada tym samym `false`. Ciało niebędące listą nie ma długości 1 (albo, dla jednoznakowego tekstu, jego „wiersz” nie ma `run_state`), więc wynik to nadal `false`.                                                                                                                                                   |
| `store.ts:177:9` — cały warunek → `false`; `(a \|\| b) \|\| c` → `(a \|\| b) && c`; `:177:52` — `read.data.length !== 1` → `false`                                 | świadomie pominięty | Dla błędu, ciała niebędącego listą i pustej listy wynik jest ten sam: odczyt `rows[0].run_state` rzuca do `catch`, który odpowiada `false`. Różnią się tylko dla listy dwóch i więcej wierszy, której odczyt z filtrem po `offer_id` nie zwróci — `offer_id` jest kluczem głównym tabeli.                                                                                                                                |
| `store.ts:180:11`, `:181:12` — blok `catch` w `storedAlready` (bez pokrycia)                                                                                       | świadomie pominięty | W niezmienionym kodzie dochodzi do niego tylko lista, której jedyny element nie jest wierszem (`[null]`) — kształt, jakiego PostgREST nie odsyła. Blok zostaje jako siatka, na której opierają się mutanty z wiersza 177.                                                                                                                                                                                                |
| `store.ts:57:46`, `:58:10`, `:58:61` — `threw()` (bez pokrycia)                                                                                                    | świadomie pominięty | Wołane tylko z bloków `catch` poniżej, nieosiągalnych z krawędzi HTTP.                                                                                                                                                                                                                                                                                                                                                   |
| `store.ts:114:19`, `:115:12`, `:115:21` — blok `catch` w `claimAudit` (bez pokrycia)                                                                               | świadomie pominięty | Nieosiągalne z krawędzi HTTP: odrzucony `fetch` wraca z klienta jako błąd z `db_status: 0`, nie jako wyjątek (przypadek `claim_failed` w `tests/pages/api/audits.test.ts`), a `startedAt` nie rzuca dla żadnego kształtu ciała. Dojście wymagałoby `vi.mock` modułu wewnętrznego, którego §2 planu testów zakazuje. Osąd z researchu.                                                                                    |
| `store.ts:162:19`, `:163:12`, `:163:21` — blok `catch` w `endAttempt` (bez pokrycia)                                                                               | świadomie pominięty | Jak wyżej: klient nie rzuca, a ciało niebędące listą zatrzymuje wiersz 160.                                                                                                                                                                                                                                                                                                                                              |
| `store.ts:89:15`, `:105:15` — `select("run_started_at")` → `""`; `:157:15` — `select("offer_id")` → `""`; `:176:52` — `select("run_state, run_started_at")` → `""` | świadomie pominięty | Lista kolumn to dane dla zapytania: zaślepka odpowiada niezależnie od niej, a `expectOwnAttemptOnly` sprawdza, że `select` jest, nie co zawiera. Asercja na literał byłaby lustrem kodu i nie zmienia liczby wywołań ani losu wyniku (osąd z researchu). Żadna warstwa nie puszcza tych zapytań na prawdziwą bazę — smoke nigdy nie prosi o audyt istniejącej oferty — więc literału pilnuje tylko celowy, płatny audyt. |
| `store.ts:160:9` — `!Array.isArray(written.data)` → `false` (ocalały); `:160:46`, `:160:55` — wynik tej gałęzi (bez pokrycia)                                      | poza zakresem fazy  | Żaden test nie odpowiada na zapis kończący próbę statusem `200` z ciałem niebędącym listą. Mutant nie jest równoważny: dla `null` odczyt `.length` rzuca i wynik to nadal `failed`, ale dla obiektu wynik to `claim_lost` — zapis opłaconego wyniku nie zostałby ponowiony. PostgREST odsyła na taki zapis listę, więc to gałąź obronna; research jej nie wymienił, nie leży w liniach luk i zostaje otwarta.            |
| `store.ts:176:84` — `.eq("offer_id", …)` → `.eq("", …)` w `storedAlready`                                                                                          | poza zakresem fazy  | Filtr odczytu po nieudanym zapisie nie ma asercji; zaślepka odpowiada niezależnie od niego. Na prawdziwej bazie odczyt bez tego filtra zwróciłby wiersze wszystkich ofert, więc mutant nie jest równoważny. Research go nie wymienił; zostaje otwarty.                                                                                                                                                                   |

## `src/pages/api/audits.ts` — ocalałe i bez pokrycia

| Wiersz i mutacja                                                                                                                                            | Decyzja             | Powód                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `audits.ts:315:17` — `let offerId = ""` → `"Stryker was here!"`                                                                                             | równoważny          | Wartość zostaje tylko wtedy, gdy formularz nie niesie tekstowego `offer_id`. Każdy tekst, który nie jest uuid, kończy się tym samym `invalid_offer`, a sama wartość nie trafia ani do wpisu, ani do odpowiedzi (`audits.ts:134-135`).                                                                                                                      |
| `audits.ts:324:9` — `typeof sent === "string"` → `true`                                                                                                     | równoważny          | Pole, które nie jest tekstem, to `null` albo plik. `isUuid` robi z wartości tekst (`"null"`, `"[object File]"`) i odpowiada `false` bez wyjątku, więc trasa odmawia tym samym `invalid_offer`.                                                                                                                                                             |
| `audits.ts:318:9` — `if (supabase)` → `if (true)`                                                                                                           | równoważny          | Bez klienta `supabase.auth` rzuca, `catch` zapisuje `unprepared`, ale `audit()` sprawdza brak klienta wcześniej (`audits.ts:132`) i odpowiada tym samym `unconfigured_supabase` z tym samym wpisem.                                                                                                                                                        |
| `audits.ts:345:7` — `lines?.enqueue` → `lines.enqueue`; `:369:22` — `lines?.close` → `lines.close`                                                          | równoważny          | `lines` przypisuje `start()`, które konstruktor `ReadableStream` woła synchronicznie, zanim `send` może zostać wywołane; `lines` nigdy nie jest `undefined`.                                                                                                                                                                                               |
| `audits.ts:338:14`, `:339:19` — `cancel()` nie gasi `listening`; `:343:9` — `if (!listening) return` → `if (false)`                                         | równoważny          | Po odejściu czytelnika `enqueue` na anulowanym strumieniu rzuca, a `catch` w `send` (`:346-349`) gasi `listening` — przed `if (listening) lines?.close()`, bo ostatnia linia jest zawsze wysyłana wcześniej. Audyt kończy się zapisem tak samo (`describe` „the audit outlives the member's connection (#3)” w teście trasy). Osąd z researchu.            |
| `audits.ts:221:15` — `run.errorName === undefined` → `false`                                                                                                | równoważny          | Mutant dopisuje `error_name: undefined`. `logEvent` pomija klucz o takiej wartości (`src/lib/log.ts`), a wcześniejsze `error_name` z `unmarked(marked)`, które mógłby zasłonić, pochodzi wyłącznie z bloków `catch` w `store.ts` — nieosiągalnych z krawędzi (wyżej). Każde osiągalne wyjście zostawia ten sam wpis.                                       |
| `audits.ts:78:13`, `:79:14`, `:80:16`, `:81:17` — `failure?.x` → `failure.x`                                                                                | świadomie pominięty | Różnią się tylko dla nieudanego odczytu bez `failure`. Typ ustawień na to pozwala (`failure?`), ale każde wyjście `loadAuditSettings` i `loadAuditCriteria` je podaje, więc żadna krawędź takiej wartości nie wytworzy.                                                                                                                                    |
| `audits.ts:346:13`, `:348:19` — blok `catch` w `send` (bez pokrycia)                                                                                        | świadomie pominięty | Dochodzi do niego tylko strumień zerwany bez wywołania `cancel()`; czytelnik w teście zawsze je woła, więc `send` wychodzi wcześniej. Blok zostaje jako siatka dla mutantów z wierszy 338–343.                                                                                                                                                             |
| `audits.ts:57:48` — `"NonError"` → `""` (bez pokrycia)                                                                                                      | świadomie pominięty | Etykieta `error_name` dla rzuconej wartości, która nie jest błędem. Obie krawędzie fazy rzucają `Error`; etykieta nie wpływa na liczbę wywołań ani na los próby.                                                                                                                                                                                           |
| `audits.ts:133:7` — `unprepared !== undefined` → `false` (ocalały); `:133:47`, `:133:61`, `:133:70` (bez pokrycia); `:319:19` — blok `catch` (bez pokrycia) | poza zakresem fazy  | Gałąź `getSession`, które rzuca (`plan.md`, „What We're NOT Doing”). Jedyna krawędź, która ją wywołuje — `cookies.set` rzucające przy odświeżeniu sesji — dochodzi do `catch` w `:319`, ale zostawia dwa nieobsłużone odrzucenia obietnicy z klienta Supabase, które Vitest liczy jako błąd przebiegu; test nie tłumi błędów. Otwarte w §6.6 planu testów. |
| `audits.ts:231:9` — `missing.length + conditions.length` → `−`                                                                                              | poza zakresem fazy  | `findings_count` we wpisie logu: każdy przypadek z asercją tej liczby ma zero w jednej z dwóch list, więc suma i różnica są równe. Mutant nie jest równoważny — zmienia liczbę w logu, nie zapisany wynik ani liczbę wywołań. Research go nie wymienił; zostaje otwarty.                                                                                   |

## Poza tym przebiegiem

- **Klasyfikacja błędów dostawcy** (`src/lib/audit/provider.ts:149-254`, w
  researchu 43 ocalałe i 10 bez pokrycia) — plik nie wchodzi w `--mutate`
  tego przebiegu. Wpływa na zdanie, które czyta członek, nie na liczbę
  wywołań (`plan.md`, „What We're NOT Doing”).
- **G5 — dwa żądania naraz w teście trasy** — brak testu, więc brak mutantów
  do osądu: zaślepka musiałaby sama udawać `VP001`, a test przeszedłby przy
  zepsutej blokadzie. Blokady dowodzi baza, połówki trasy — przypadek `busy`,
  szwu — G3 w `scripts/audit-state.sql`.
- **G3** — sprawdzenie w SQL; czerwone na kopii skryptu z usuniętym kluczem
  głównym (`plan.md`, faza 2), nie na mutancie.
