# Dziennik mutantów — `testing-audit-grounding-privacy`

Wynik zawężonego przebiegu Strykera po fazie 1 obok stanu z researchu
i decyzja dla każdego ocalałego i niepokrytego mutanta w zakresie. Kryterium
ukończenia to brak mutanta bez decyzji — nie próg liczbowy (`plan.md`,
faza 2).

Decyzje:

- **równoważny** — mutant nie zmienia obserwowalnego zachowania bramki; powód
  stoi przy nim.

Innych decyzji ten przebieg nie potrzebował: nie ma mutanta bez pokrycia ani
ocalałego, który zmienia zachowanie.

Raport (`reports/mutation/mutation.html`) jest lokalny, git-ignorowany
i nadpisywany przy każdym przebiegu, więc liczby i decyzje stoją tutaj.

## Przebieg (2026-10-12)

```
npx stryker run --mutate "src/lib/audit/grounding.ts,src/lib/audit/input.ts,src/lib/audit/prompt.ts,src/lib/audit/schema.ts" --reporters clear-text,html,json
```

Reporter `json` jest dodany w wierszu poleceń dla tego jednego przebiegu, żeby
odczytać pozycje timeoutów, których reporter tekstowy nie podaje;
`stryker.config.json` się nie zmienił. Testy, które Stryker widzi: `npm test`
— sieć na zaślepce `fetch`, bez klucza dostawcy. Żadne żądanie nie wyszło do
dostawcy modelu.

### Wynik

| Plik                         | Wynik  | Zabite | Timeout | Ocalałe | Bez pokrycia | Razem |
| ---------------------------- | ------ | ------ | ------- | ------- | ------------ | ----- |
| `src/lib/audit/grounding.ts` | 99,14% | 111    | 4       | 1       | 0            | 116   |
| `src/lib/audit/input.ts`     | 100%   | 181    | 0       | 0       | 0            | 181   |
| `src/lib/audit/prompt.ts`    | 100%   | 38     | 0       | 0       | 0            | 38    |
| `src/lib/audit/schema.ts`    | 100%   | 172    | 0       | 0       | 0            | 172   |
| Razem                        | 99,80% | 502    | 4       | 1       | 0            | 507   |

### Stan przed

Przebieg z researchu (2026-10-12, przed fazą 1) dał te same liczby w każdym
pliku: 507 mutantów, 502 zabite, 4 timeouty, 1 ocalały, 0 bez pokrycia. Tak
miało być: kod pod `src/` się nie zmienił, a mutanty, których dotyczą nowe
przypadki fazy 1, były już zabite przez testy z S-04. Faza 1 nie zabiła więc
żadnego mutanta — jej przypadki chronią przed zmianą, której Stryker nie
wytwarza (redakcja wzorca numeru w tytule), i przed usunięciem reguły lintu,
której Stryker nie mutuje (niżej).

Nowe względem researchu są tylko pozycje timeoutów.

## `src/lib/audit/grounding.ts` — ocalały

| Wiersz i mutacja                                        | Decyzja    | Powód                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `grounding.ts:73:10` — `index < original.length` → `<=` | równoważny | Dodatkowy obrót pętli w `collapse` czyta `charAt` za końcem tekstu, czyli `""`, które nie jest białym znakiem: do `parts` trafia pusty tekst, a do `starts` i `ends` po jednym wpisie. `text` po `join("")` jest taki sam. Dopisanych wpisów nikt nie czyta: `ground` indeksuje `starts[at]` i `ends[last]`, a `last = at + needle.length - 1` jest zawsze mniejsze od długości `text`, bo `indexOf` znalazło całe `needle` w `text` (`grounding.ts:109-112`). Po tym obrocie `index` przekracza długość i pętla kończy się. |

## `src/lib/audit/grounding.ts` — timeouty

Wszystkie cztery stoją w pętli `collapse` (`grounding.ts:73-86`) i każdy ją
zapętla, co potwierdza przypuszczenie z researchu. Stryker liczy timeout jako
wykryty; pozycje stoją tu, bo reporter tekstowy ich nie podaje.

| Wiersz i mutacja                                           | Dlaczego pętla się nie kończy                                                                                  |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `grounding.ts:73:35` — ciało pętli `while` → `{}`          | `index` nigdy nie rośnie.                                                                                      |
| `grounding.ts:75:15` — `index + 1` → `index - 1`           | `end` jest mniejsze od `index`, a `index = end` cofa pętlę; ujemny `index` jest zawsze mniejszy od długości.   |
| `grounding.ts:78:30` — `original.charAt(end)` → `original` | Warunek wewnętrznej pętli pyta o cały tekst zamiast o znak: dla tekstu z białym znakiem jest zawsze prawdziwy. |
| `grounding.ts:78:53` — `end += 1` → `end -= 1`             | W ciągu białych znaków `end` cofa się przed `index`, a `index = end` cofa pętlę zewnętrzną.                    |

## `input.ts`, `prompt.ts`, `schema.ts`

Brak ocalałych i brak mutantów bez pokrycia — nie ma czego osądzać. Dla
`prompt.ts` i `schema.ts` to pierwszy zapisany wynik; `grounding.ts`
i `input.ts` miały przebieg w S-04, ale bez dziennika.

## Poza tym przebiegiem

- **Wywołanie modelu** (`src/lib/audit/provider.ts`) — plik nie wchodzi
  w `--mutate` tego przebiegu. Odmowę odpowiedzi o złym kształcie
  (`provider.ts:343-344`) trzyma test trasy, a klasyfikacja błędów dostawcy
  stoi jako otwarta w dzienniku fazy 3
  (`context/archive/2026-10-12-testing-audit-cost-durability/mutation.md`).
- **Reguła lintu `auditNoNotesConfig`** — Stryker jej nie mutuje, bo
  `eslint.config.js` nie leży w `mutate` (`stryker.config.json`). Jej dowodem
  są zepsucia ręczne z fazy 1: usunięcie bloku z eksportu czerwieni sześć
  przypadków `tests/eslint.config.test.ts`, a wyrażenie zawężone do ścieżek
  względnych — dwa przypadki aliasu.
- **Kontakt w tytule** — nowe przypadki w `tests/lib/audit/input.test.ts`
  i `tests/lib/audit/prompt.test.ts` nie zabijają żadnego mutanta, którego nie
  zabijały testy z S-04. Ich dowodem jest zepsucie ręczne: redakcja wzorca
  numeru telefonu w tytule w `readAuditOffer` czerwieni oba przypadki,
  a w `buildAuditPrompt` — przypadek promptu; pozostałe testy audytu zostają
  przy tym zielone.
- **Jakość znalezisk** — czy model wskazuje to, co ważne — nie jest
  własnością żadnego z czterech modułów i żaden mutant jej nie mierzy.
  Narzędziem jest złoty zestaw, płatny i nieuruchomiony (`plan.md`,
  „What We're NOT Doing”).
