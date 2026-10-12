# Faza 3 planu testów — koszt i trwałość audytu (#2, #3) — brief planu

> Full plan: `context/changes/testing-audit-cost-durability/plan.md`
> Research: `context/changes/testing-audit-cost-durability/research.md`

## What & Why

Faza 3 rolloutu z planu testów dokłada dowody dla ryzyk #2 (płatny audyt wywołany więcej niż raz) i #3 (opłacony wynik utracony) w miejscach, których testy z S-04 nie przypinają. Większość ochrony jest już dowiedziona; zostało sześć wąskich luk wskazanych przez przebieg Strykera z 2026-10-12. Druga połowa pracy to plan testów, który dziś obiecuje dwie rzeczy, jakich produkt nie daje.

## Starting Point

`tests/pages/api/audits.test.ts` liczy wywołania dostawcy w każdym scenariuszu, `scripts/audit-state.sql` dowodzi blokady i progu 175 s w triggerach. Bez dowodu zostały: oba `catch` trasy wokół przejęcia wiersza, kod `23505` po stronie bazy, nieczytelna odpowiedź przejęcia, wpis `attempt_taken_over` i `had_limits` przy częściowych limitach.

## Desired End State

Każda z sześciu luk ma test, który czerwienieje po zepsuciu chronionej linii, a każdy pozostały mutant w zakresie ma zapisaną decyzję. Plan testów mówi wprost: #2 chroni przed jednoczesnością i żądaniem bez sesji, #3 kończy się jawnym błędem po dwóch zapisach, a brak limitu kolejnych audytów jest świadomą decyzją. Kod pod `src/` i migracje pozostają bez zmian.

## Key Decisions Made

| Decyzja                                   | Wybór                                                                     | Dlaczego                                                                                              | Source   |
| ----------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | -------- |
| „Pętla" kolejnych audytów (#2)            | Nazwać w planie testów (§2, §7) jako niechronione; bez zmiany w produkcie | PRD: zaufany zespół, każdy audyt to celowe działanie; plan przestaje obiecywać ochronę, której nie ma | Plan     |
| „Odzyskiwalny" wynik (#3)                 | Doprecyzować §2 do stanu faktycznego: dwa zapisy, potem jawny błąd        | Plan testów ma opisywać to, co testy dowodzą                                                          | Plan     |
| G5 — dwa żądania naraz                    | Pominąć; szew zamyka G3 w `scripts/audit-state.sql`                       | Zaślepka udająca `VP001` przeszłaby przy zepsutej blokadzie w bazie                                   | Research |
| Klasyfikacja błędów dostawcy              | Poza fazą, odnotować w §6.6                                               | Wpływa na zdanie dla członka, nie na liczbę wywołań                                                   | Plan     |
| Gałąź `getSession`, które rzuca           | Pominąć, odnotować w §6.6 z obserwacją                                    | Jedyna krawędź, która ją wywołuje, zostawia nieobsłużone odrzucenia; test nie tłumi błędów            | Plan     |
| G7 — `had_limits`                         | Dołożyć jeden przypadek                                                   | Kilka linii przy gotowym wzorcu zabija mutanta, który fałszuje zapisany wynik                         | Plan     |
| Jak wywołać wyjątek bez mockowania modułu | Konsola przy wpisie `started`; `crypto.subtle.digest`                     | Obie są krawędziami platformy; sprawdzone jednorazowym testem 2026-10-12                              | Plan     |
| Warstwa dla szwu `23505`                  | `scripts/audit-state.sql`, w dwóch stanach wiersza                        | Zaślepka nie odpowie za klucz główny                                                                  | Research |

## Scope

**In scope:**

- Przypadki w `tests/pages/api/audits.test.ts`: G1 (dwa i kontrola), G2, G4, G6, G7
- Sprawdzenie G3 w `scripts/audit-state.sql`
- `mutation.md` w folderze zmiany
- `context/foundation/test-plan.md`: §2, §6.4, §6.6, §7, §8

**Out of scope:**

- Jakakolwiek zmiana w `src/`, migracjach, PRD, `scripts/smoke.mjs`, CI, `CLAUDE.md`
- G5, gałąź `getSession`, klasyfikacja błędów dostawcy
- Limit kolejnych audytów i odzyskiwanie opłaconego wyniku jako funkcje produktu
- Jakiekolwiek żądanie do dostawcy modelu

## Architecture / Approach

Dowód stoi na warstwie, która nie może skłamać. Kolejność trasy — co dzieje się z odpowiedzią bazy i z wyjątkiem — dowodzi test trasy zaślepiony na krawędzi HTTP, z konsolą i `crypto.subtle.digest` jako krawędziami platformy. To, co baza odpowiada, dowodzi skrypt SQL na lokalnej bazie w transakcji zakończonej `ROLLBACK`. Stryker na końcu potwierdza, że nowe przypadki zabijają wskazane mutanty; jego wynik nie jest celem.

## Phases at a Glance

| Faza                        | Co dostarcza                                                        | Główne ryzyko                                                                                     |
| --------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 1. Przypadki w teście trasy | G1, G2, G4, G6, G7 z liczbą wywołań dostawcy w każdym               | Konsola rzucająca szerzej niż przy `started` zawiesza test; szpieg przeciekający do innych testów |
| 2. Szew `23505` w bazie     | G3 w dwóch stanach wiersza, dla obu członków                        | Nowy blok zmienia wiersz dla sprawdzeń po nim                                                     |
| 3. Stryker i plan testów    | `mutation.md`, poprawione §2 i §7, wzorzec w §6.4, wpis fazy w §6.6 | Mutant nazwany równoważnym bez uzasadnienia                                                       |

**Prerequisites:** lokalny Supabase dla fazy 2 (`npx supabase start`); nic więcej — żadnych sekretów.
**Estimated effort:** około 2 sesji na 3 fazy.

## Open Risks & Assumptions

- Zakładam, że mutanty z linii G1, G2, G4, G6 i G7 padną od opisanych przypadków; jeśli któryś przeżyje, faza 3 odsyła go do fazy 1 albo wymaga uzasadnienia równoważności.
- Nieobsłużone odrzucenia przy `cookies.set`, które rzuca, pozostają niewyjaśnione — to otwarta pozycja w §6.6, nie część tej zmiany.
- Status wiersza fazy 3 w §3 planu testów zmienia orkiestrator (`/10x-test-plan`), nie ten plan.

## Success Criteria (Summary)

- `npm test` i `npm run test:db` przechodzą, a każdy nowy przypadek był raz czerwony na zepsutym systemie (Stryker dla trasy, kopia skryptu z usuniętym kluczem dla SQL).
- Plan testów nie obiecuje ochrony przed pętlą ani odzyskiwania wyniku.
- Żaden test ani krok nie wysłał żądania, na które dostawca modelu by odpowiedział.
