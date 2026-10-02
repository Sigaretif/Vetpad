# Dziennik mutantów — `testing-read-failure-states`

Wynik Strykera po każdej fazie obok wyniku bazowego i decyzja dla każdego
ocalałego mutanta w zakresie fazy. Kryterium ukończenia to brak mutanta bez
decyzji — nie próg liczbowy (`plan.md`, „Desired End State”).

Decyzje:

- **asercja** — zmiana zaszkodziłaby użytkownikowi; dopisana asercja zabija mutanta.
- **równoważny** — mutant nie zmienia obserwowalnego zachowania.
- **świadomie pominięty** — zmiana jest obserwowalna, ale nie warta asercji; powód w jednym zdaniu.

Raport (`reports/mutation/mutation.html`) jest nadpisywany przy każdym
przebiegu, więc liczby i decyzje trafiają tutaj przed kolejnym przebiegiem.

## Wynik bazowy (2026-10-01)

| Moduł | Wynik | Zabite | Ocalałe | Bez pokrycia | Razem |
|---|---|---|---|---|---|
| `src/lib/team-limits.ts` | 6,0% | 5 | 35 | 43 | 83 |
| `src/lib/offer-board.ts` | 0% | 0 | 13 | 35 | 48 |
| `src/lib/members.ts` | 0% | 0 | 3 | 126 | 129 |
| `src/lib/notes.ts` (cały plik) | 0% | 0 | 0 | 60 | 60 |
| `src/lib/notes.ts:1-99` (odczyt) | 0% | 0 | — | — | 40 |
| `src/lib/criteria.ts` (cały plik) | 22,35% (w `change.md`: 22,4%) | 59 | 42 | 163 | 264 |
| `src/lib/criteria.ts:151-285` (odczyt) | 0% | 0 | 1 | 137 | 138 |

## Faza 1: `src/lib/team-limits.ts`

Polecenie:

```
npx stryker run --mutate "src/lib/team-limits.ts"
```

Test fazy: `tests/lib/team-limits.test.ts`.

### Wynik po fazie

| Przebieg | Wynik | Zabite | Ocalałe | Bez pokrycia | Razem |
|---|---|---|---|---|---|
| Bazowy (2026-10-01) | 6,0% | 5 | 35 | 43 | 83 |
| Po fazie (2026-10-02) | 97,59% | 81 | 2 | 0 | 83 |

### Ocalałe mutanty

| Wiersz i mutacja | Decyzja | Powód |
|---|---|---|
| `team-limits.ts:51:9` — `limits.priceMin !== null` → `true` | równoważny | Przy `priceMin === null` porównanie `offer.price < null` czyta `null` jako 0, a cena oferty jest zawsze dodatnia (check tabeli `price is null or price > 0`), więc wynik to nadal brak znacznika. |
| `team-limits.ts:54:33` — `limits.areaMin !== null` → `true` | równoważny | To samo dla metrażu: `offer.area_m2 < null` jest fałszem dla każdego dodatniego metrażu, a check tabeli nie dopuszcza `area_m2 ≤ 0`. |

## Faza 2: `src/lib/offer-board.ts`

Polecenie:

```
npx stryker run --mutate "src/lib/offer-board.ts"
```

Test fazy: `tests/lib/offer-board.test.ts`.

Mutanty na `nullsFirst` nie istnieją w tym module: reguła „nieznane na końcu”
żyje w zapytaniu w `src/pages/dashboard.astro`, poza zakresem `mutate`. Pilnują
jej kroki `scripts/smoke.mjs` („board puts the offer without a price last…”,
„board puts the offer without an area last…”) na prawdziwej bazie — Stryker
widzi tylko `npm test`, więc te kroki nie zabijają żadnego mutanta.

`auditStatus`, `BOARD_COLUMNS` i `BOARD_SORT_COLUMN` nie mają własnych asercji
(`plan.md`, faza 2, zmiana 1); ich mutanty dostają decyzję w tabeli poniżej.

### Wynik po fazie

| Przebieg | Wynik | Zabite | Ocalałe | Bez pokrycia | Razem |
|---|---|---|---|---|---|
| Bazowy (2026-10-01) | 0% | 0 | 13 | 35 | 48 |
| Po fazie (2026-10-02) | 85,42% | 41 | 7 | 0 | 48 |

### Ocalałe mutanty

| Wiersz i mutacja | Decyzja | Powód |
|---|---|---|
| `offer-board.ts:36:10` — `value !== null` → `true` | równoważny | `Object.hasOwn(BOARD_SORT_COLUMN, null)` szuka klucza `"null"`, którego mapa nie ma, więc brak `sort` nadal daje domyślne sortowanie. |
| `offer-board.ts:21:10` — `added: "created_at"` → `""` | świadomie pominięty | Nazwa kolumny trafia wyłącznie do zapytania w `dashboard.astro`; pusta kolumna psuje odczyt tablicy, co łapie smoke (`data-board-state="ok"` dla domyślnego sortowania), a asercja na literał byłaby lustrem mapy. |
| `offer-board.ts:22:10` — `price: "price"` → `""` | świadomie pominięty | Jak wyżej; dodatkowo kroki smoke „board puts the offer without a price last…” wymagają działającego sortowania po cenie. |
| `offer-board.ts:23:9` — `area: "area_m2"` → `""` | świadomie pominięty | Jak wyżej; kroki smoke „board puts the offer without an area last…” wymagają działającego sortowania po metrażu. |
| `offer-board.ts:62:3` — `BOARD_COLUMNS` → `""` | świadomie pominięty | Lista kolumn to dane dla zapytania tablicy, nie reguła; jej brak psuje wiersze tablicy, które smoke znajduje po `href` i znaczniku limitu. |
| `offer-board.ts:79:66` — ciało `auditStatus` → `{}` | świadomie pominięty | Punkt wymiany S-04: dziś jedna stała, bez reguły do udowodnienia; asercje dostanie razem z prawdziwym statusem audytu. |
| `offer-board.ts:80:10` — `"not_audited"` → `""` | świadomie pominięty | Jak wyżej. |

## Faza 3: `src/lib/members.ts`

Polecenie:

```
npx stryker run --mutate "src/lib/members.ts"
```

Test fazy: `tests/lib/members.test.ts`.

Blok `catch` w `resolveSaver` (`members.ts:39-41`) jest nieosiągalny z krawędzi
HTTP: klient nie rzuca dla żadnej odpowiedzi, a `result.data?.email` nie wykłada
się na żadnym kształcie ciała `200`. Jego mutanty dostają decyzję w tabeli
poniżej, bez `vi.mock` modułów wewnętrznych (`plan.md`, „Critical Implementation
Details”). Blok `catch` w `readEmails` (`members.ts:81-83`) wywołuje odpowiedź
`200`, której ciało nie jest listą wierszy.

### Wynik po fazie

| Przebieg | Wynik | Zabite | Ocalałe | Bez pokrycia | Razem |
|---|---|---|---|---|---|
| Bazowy (2026-10-01) | 0% | 0 | 3 | 126 | 129 |
| Po fazie (2026-10-02) | 89,92% | 116 | 6 | 7 | 129 |

### Ocalałe mutanty i mutanty bez pokrycia

| Wiersz i mutacja | Decyzja | Powód |
|---|---|---|
| `members.ts:33:7` — `if (!supabase)` → `if (false)` | równoważny | Bez klienta `supabase.from` rzuca, a `catch` tej samej funkcji odpowiada tym samym `unknown`. |
| `members.ts:36:9` — `if (result.error)` → `if (false)` | równoważny | Przy błędzie `result.data` jest `null`, więc `data?.email` nie jest tekstem i wynik to nadal `unknown`. |
| `members.ts:37:28` — `result.data?.email` → `result.data.email` | równoważny | Dla `data: null` odczyt rzuca, a `catch` odpowiada tym samym `unknown`. |
| `members.ts:38:12` — `typeof email === "string"` → `true` | równoważny | E-mail niebędący tekstem rzuca na `.trim()`, a `catch` odpowiada tym samym `unknown`. |
| `members.ts:72:9` — `if (result.error)` → `if (false)` | równoważny | Przy błędzie `result.data` jest `null`, iteracja rzuca, a `catch` zwraca tę samą pustą mapę. |
| `members.ts:76:11` — `typeof id === "string"` → `true` | równoważny | Klucz niebędący tekstem trafiłby do mapy, ale wyszukiwanie idzie po tekstowych id autorów, więc nigdy go nie znajdzie. |
| `members.ts:39:11`, `40:12`, `40:20` — blok `catch` w `resolveSaver` (bez pokrycia) | świadomie pominięty | Nieosiągalne z krawędzi HTTP: żadna odpowiedź nie doprowadza do wyjątku, a `vi.mock` modułów wewnętrznych jest poza planem; blok zostaje jako siatka, na której opierają się cztery mutanty równoważne wyżej. |
| `members.ts:100:5`, `100:14` — gałąź `default` w `saverName` (bez pokrycia) | świadomie pominięty | Strażnik kompletności typu (`never`): nieosiągalny dla żadnej wartości `Saver`, pilnuje go `astro check`, nie test. |
| `members.ts:121:5`, `121:14` — gałąź `default` w `authorName` (bez pokrycia) | świadomie pominięty | Jak wyżej. |

## Faza 4: `src/lib/notes.ts:1-99`

Polecenie:

```
npx stryker run --mutate "src/lib/notes.ts:1-99"
```

Test fazy: `tests/lib/notes.test.ts`.

Zakres `1-99` to odczyt (`loadNotes` i etykiety pól). Wiersze `100-113`
(`noteError`, `NOTE_BLANK`, `NOTE_TOO_LONG`) są poza zakresem tej zmiany
(`plan.md`, „What We're NOT Doing”): ich 20 mutantów nie dostaje decyzji, a
wynik całego pliku nie jest celem.

Blok `catch` w `loadNotes` (`notes.ts:95-97`) wywołuje odpowiedź `200`, której
ciało nie jest listą wierszy — `rows.map` wykłada się na obiekcie i na `null`.

### Wynik po fazie

| Przebieg | Wynik | Zabite | Ocalałe | Bez pokrycia | Razem |
|---|---|---|---|---|---|
| Bazowy, cały plik (2026-10-01) | 0% | 0 | 0 | 60 | 60 |
| Bazowy, zakres `1-99` (2026-10-01) | 0% | 0 | — | — | 40 |
| Po fazie, zakres `1-99` (2026-10-02) | 82,50% | 33 | 7 | 0 | 40 |

### Ocalałe mutanty i mutanty bez pokrycia

| Wiersz i mutacja | Decyzja | Powód |
|---|---|---|
| `notes.ts:60:7` — `if (!supabase)` → `if (false)` | równoważny | Bez klienta `supabase.from` rzuca już wewnątrz `try`, a `catch` odpowiada tym samym `{ state: "error" }`. |
| `notes.ts:67:9` — `if (result.error)` → `if (false)` | równoważny | Przy błędzie `result.data` jest `null`, `rows.map` rzuca, a `catch` odpowiada tym samym `{ state: "error" }`. |
| `notes.ts:88:11` — `row.author_id !== null` → `true` | równoważny | `viewerId` to tekst albo `undefined`, nigdy `null`, więc `null === viewerId` jest fałszem i notatka bez autora nadal trafia do `others`. |
| `notes.ts:23:61` — `NOTE_FIELD_LABELS` → `{}` | świadomie pominięty | Etykiety pól to kopia interfejsu, nie reguła odczytu; `loadNotes` ich nie używa, a asercja na literał byłaby lustrem mapy. |
| `notes.ts:24:9` — `pros: "Zalety"` → `""` | świadomie pominięty | Jak wyżej. |
| `notes.ts:25:9` — `cons: "Wady"` → `""` | świadomie pominięty | Jak wyżej. |
| `notes.ts:26:17` — `observations: "Obserwacje ogólne"` → `""` | świadomie pominięty | Jak wyżej. |

## Faza 5: `src/lib/criteria.ts:151-285`

Polecenie:

```
npx stryker run --mutate "src/lib/criteria.ts:151-285"
```

Test fazy: `tests/lib/criteria.test.ts`.

Zakres `151-285` to odczyt (`limitNumber`, `readLimits`, `loadCriteria`,
`loadTeamLimits`). Wiersze `1-150` (`parseNumber`, `parseLimitsForm`,
`requirementsError` i ich stałe) są poza zakresem tej zmiany (`plan.md`, „What
We're NOT Doing”): ich 126 mutantów nie dostaje decyzji, a wynik całego pliku
nie jest celem.

Blok `catch` w `loadCriteria` (`criteria.ts:266-268`) wywołuje odpowiedź `200`
na `member_requirements`, której ciało nie jest listą wierszy — `rows.map`
wykłada się na obiekcie i na `null`, a odczyt `author_id` na elemencie `null`.
Blok `catch` w `loadTeamLimits` (`criteria.ts:282-284`) jest nieosiągalny z
krawędzi HTTP: klient nie rzuca dla żadnej odpowiedzi, a `readLimits` czyta
tylko pola wartości, która przeszła `!result.data` — żaden kształt ciała `200`
nie doprowadza do wyjątku. Jego mutanty dostają decyzję w tabeli poniżej, bez
`vi.mock` modułów wewnętrznych (`plan.md`, „Critical Implementation Details”).

### Wynik po fazie

| Przebieg | Wynik | Zabite | Ocalałe | Bez pokrycia | Razem |
|---|---|---|---|---|---|
| Bazowy, cały plik (2026-10-01) | 22,35% | 59 | 42 | 163 | 264 |
| Bazowy, zakres `151-285` (2026-10-01) | 0% | 0 | 1 | 137 | 138 |
| Po fazie, zakres `151-285` (2026-10-02) | 86,23% | 119 | 16 | 3 | 138 |

Trzy przebiegi po fazie, wynik wyżej to ostatni:

1. 80,43% (111 / 24 / 3). Dwa mutanty z wiersza `181:54` czytały wartość
   logiczną `true` w kolumnie liczbowej jako limit `1` — wymyślony limit —
   więc doszła **asercja**: `true` w `price_min`, `price_max` i `area_min` to
   nieudany odczyt (R13).
2. 81,88% (113 / 22 / 3).
3. 86,23% (119 / 16 / 3), po decyzji użytkownika z 2026-10-02 o dwóch regułach
   zapisanych w CLAUDE.md (`## Structure`): liczba wysłana tekstem czyta się
   jako ta liczba (**asercja** zabiła trzy mutanty z wiersza `181`), a
   wymagania członków są czytane od ostatnio edytowanych (**asercja** na
   `order=updated_at.desc` zabiła trzy mutanty z wiersza `225`).

### Ocalałe mutanty i mutanty bez pokrycia

| Wiersz i mutacja | Decyzja | Powód |
|---|---|---|
| `criteria.ts:190:43` — `typeof row.city === "string"` → `true` | równoważny | Miasto niebędące tekstem rzuca na `.trim()`, a `catch` obu funkcji odpowiada tym samym stanem błędu. |
| `criteria.ts:194:7` — `city === undefined \|\|` → `false \|\|` | równoważny | `undefined.trim()` rzuca, a `catch` odpowiada tym samym stanem błędu. |
| `criteria.ts:218:7` — `if (!supabase)` → `if (false)` (`loadCriteria`) | równoważny | Bez klienta `supabase.from` rzuca wewnątrz `try`, a `catch` odpowiada tym samym `{ state: "error" }`. |
| `criteria.ts:227:9` — cztery mutacje warunku `criteria.error \|\| requirements.error \|\| !criteria.data` (`false`, `false \|\| !criteria.data`, `(a \|\| b) && !data`, `a && b \|\| !data`) | równoważny | Przy każdym z trzech powodów porażki odpowiednie `data` jest `null`, więc dalszy kod rzuca (`readLimits(null)` albo `rows.map`), a `catch` odpowiada tym samym `{ state: "error" }`. |
| `criteria.ts:238:9` — `if (changedAt !== null)` → `if (true)` | równoważny | Wynik się nie zmienia: `limitsChangedBy` i tak jest `null`, gdy brak daty (wiersz 261); dodatkowy wpis na liście autorów nikogo nie nazywa. |
| `criteria.ts:276:7` — `if (!supabase)` → `if (false)` (`loadTeamLimits`) | równoważny | Bez klienta `supabase.from` rzuca wewnątrz `try`, a `catch` odpowiada tym samym `{ ok: false }`. |
| `criteria.ts:279:9` — dwie mutacje warunku `result.error \|\| !result.data` (`false`, `&&`) | równoważny | Przy błędzie i przy braku wiersza `data` jest `null`, `readLimits(null)` rzuca, a `catch` odpowiada tym samym `{ ok: false }`. |
| `criteria.ts:232:23` — `typeof row.updated_at === "string"` → `true` | świadomie pominięty | Różni się tylko dla wartości, która nie jest ani tekstem, ani `null`; kolumna `timestamptz` takiej nie zwraca. |
| `criteria.ts:233:23` — `typeof row.updated_by === "string"` → `true` | świadomie pominięty | Jak wyżej dla kolumny `uuid`. |
| `criteria.ts:176:23` — `LIMIT_COLUMNS` → `""` | świadomie pominięty | Lista kolumn to dane dla zapytania; zaślepka odpowiada niezależnie od `select`, a na prawdziwej bazie pilnuje jej smoke (`data-criteria-state="ok"`, znacznik limitu na tablicy). Asercja na literał byłaby lustrem. |
| `criteria.ts:221:45` — `select` dla `team_criteria` → pusty | świadomie pominięty | Jak wyżej. |
| `criteria.ts:224:17` — `select` dla `member_requirements` → `""` | świadomie pominięty | Jak wyżej. |
| `criteria.ts:282:11`, `283:12`, `283:18` — blok `catch` w `loadTeamLimits` (bez pokrycia) | świadomie pominięty | Nieosiągalne z krawędzi HTTP: żaden kształt odpowiedzi nie doprowadza do wyjątku, a `vi.mock` modułów wewnętrznych jest poza planem; blok zostaje jako siatka, na której opierają się mutanty równoważne z wierszy 190, 194, 276 i 279. |
