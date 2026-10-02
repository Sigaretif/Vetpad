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
