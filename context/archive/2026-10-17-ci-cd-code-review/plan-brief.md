# AI code review w CI jako bramka PR-ów — Plan Brief

> Full plan: `context/changes/ci-cd-code-review/plan.md`
> Research: `context/changes/ci-cd-code-review/research.md`

## What & Why

Agent code review z `packages/code-reviewer` zaczyna działać w GitHub Actions. Ocenia każdy otwarty PR do `master` według kryteriów Vetpad z `requirements.md` i zostawia na PR-ze:

- komentarz z werdyktem;
- etykietę `ai-cr:passed` albo `ai-cr:failed`;
- czerwony check przy `fail`.

Werdykt jest gotowy, żeby później stać się bramką merge'a.

## Starting Point

Reviewer działa lokalnie (`git diff | tsx src/cli.ts`). Klucz bierze tylko z `.env`, nie zna tytułu ani opisu PR-a i ma generyczny 6-liniowy prompt. Szablony M5L3 zakładają bundel `dist/review.js` i OpenRouter. Mają też dwie wady bramki. `master` nie ma branch protection.

## Desired End State

- **Przy otwarciu PR-a:** jeden płatny run z kluczem `CODE_REVIEWER_API_KEY`. Komentarz podaje werdykt, SHA ocenionego commita, sześć ocen i podsumowanie.
- **Ponowienie:** etykieta `ai-cr:review`, która po runie sama znika.
- **Push:** nie uruchamia review.
- **Dokumentacja:** `CLAUDE.md` zapisuje nazwany wyjątek od reguły płatnych wywołań i znane ryzyko bramki.

## Key Decisions Made

| Decision                                  | Choice                                                                                                                                                                                                           | Why (1 sentence)                                                                        | Source            |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ----------------- |
| Klucz w CI                                | Sekret `CODE_REVIEWER_API_KEY` → env `ANTHROPIC_API_KEY` akcji, nigdy aplikacyjny `ANTHROPIC_API_KEY`                                                                                                            | Osobny limit wydatków; reguła „six places” dla klucza audytu zostaje prawdziwa          | Plan (użytkownik) |
| Model i budżet                            | `claude-sonnet-5-5`, `maxBudgetUsd: 0.5` bez zmian                                                                                                                                                               | Zmiana modelu wymaga evali, których jeszcze nie ma                                      | Plan (użytkownik) |
| Triggery                                  | `opened`, `reopened`, etykieta `ai-cr:review`; bez `synchronize`                                                                                                                                                 | Jeden automatyczny koszt na PR; werdykt dotyczy commita z komentarza                    | Plan              |
| Wyjątek od „Nothing reaches the provider” | Nazwany wyjątek w `CLAUDE.md` dla `review.yml`                                                                                                                                                                   | Run jest płatny i automatyczny, więc reguła musi go znać                                | Plan              |
| Wada concurrency                          | `concurrency` na poziomie joba                                                                                                                                                                                   | Pominięty job nie wchodzi do grupy i nie anuluje review                                 | Plan              |
| Wada „pominięty job = Success”            | Akceptowana i opisana; bez `statuses: write`                                                                                                                                                                     | Bez wymaganego checku nic nie odblokowuje; wraca przy branch protection                 | Plan              |
| Prompt Vetpad                             | Przepisany w tej zmianie                                                                                                                                                                                         | Bramka ma od początku oceniać według reguł projektu; to punkt odniesienia dla evali     | Plan              |
| Opis PR-a                                 | Tak, przycięty do 4000 znaków, jako dane niezaufane                                                                                                                                                              | Kontekst intencji jest tani wobec diffu                                                 | Plan              |
| Uruchomienie agenta                       | `npm ci` w pakiecie + `node src/ci.ts`, bez bundla                                                                                                                                                               | Natywna binarka SDK nie przeżywa bundlowania                                            | Research          |
| Entrypoint                                | Nowy `src/ci.ts` (env), `cli.ts` bez zmian (`.env`)                                                                                                                                                              | Reguła klucza lokalnego CLI zostaje nietknięta                                          | Research          |
| Pinning w `ci.yml`                        | Osobna zmiana                                                                                                                                                                                                    | Bez ryzyka dla jobów `ci`/`smoke` w tej zmianie                                         | Plan              |
| Limit czasu joba                          | `timeout-minutes: 10` na jobie `review`                                                                                                                                                                          | Zawieszony subprocess SDK albo wolne `npm ci` nie trzyma runnera do domyślnych 6 godzin | Plan (korekta)    |
| Utrzymanie kryteriów                      | Reguła w `CLAUDE.md`: zmiana niezmiennika produktu, twardej reguły albo reguły bezpieczeństwa/testowania aktualizuje w tej samej zmianie `src/prompts/system.ts` (i `requirements.md`, póki zmiana jest otwarta) | Reviewer nie widzi `CLAUDE.md`, więc bez reguły jego kryteria rozjadą się z projektem   | Plan (korekta)    |

## Scope

**In scope:**

- `ReviewOptions.pr` i `buildReviewPrompt` z tytułem i opisem;
- prompt systemowy Vetpad;
- `src/ci.ts` i `src/report.ts`;
- `.github/actions/ai-reviewer/action.yml` i `.github/workflows/review.yml` z `timeout-minutes: 10`;
- wyjątek, referencje i reguła utrzymania kryteriów reviewera w `CLAUDE.md`;
- sekcja CI w README.

**Out of scope:**

- review na `synchronize`;
- własny commit status i branch protection;
- przypięcia w `ci.yml`;
- zmiana modelu i budżetu;
- próg liczbowy werdyktu;
- komentarz przy braku werdyktu;
- PR-y z forków (czerwone);
- escaping tagów;
- promptfoo i test runner;
- `/10x-impl-review-ci`.

## Architecture / Approach

Workflow obsługuje zdarzenia, liczy diff (bez `package-lock.json`), publikuje komentarz z head SHA, ustawia etykiety i failuje check, gdy werdykt to nie `pass`. Akcja kompozytowa przygotowuje Node 24, robi `npm ci` w pakiecie, uruchamia `node src/ci.ts` i wyciąga `verdict` z JSON-a. Pakiet odpowiada za prompt, schemat, model i budżet. Tekst PR-a idzie wyłącznie przez `env:`, nigdy przez interpolację w `run:`.

## Phases at a Glance

| Phase                    | What it delivers                                                                                       | Key risk                                                                     |
| ------------------------ | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| 1. Reviewer gotowy na CI | Tytuł i opis w prompcie, kryteria Vetpad, entrypoint `ci.ts` z env                                     | Prompt bez evali: brak pomiaru jakości                                       |
| 2. Akcja i workflow      | `action.yml` + `review.yml`: triggery, limit 10 min, komentarz z SHA, etykiety, bramka                 | Założenie, że pominięty job nie zajmuje grupy concurrency (sprawdzane w 3.7) |
| 3. Dokumentacja i PR     | Wyjątek i reguła utrzymania kryteriów w `CLAUDE.md`, README, płatne runy uruchamiane przez użytkownika | Ścieżka `max_budget` nigdy nieuruchomiona; duży diff może dać brak werdyktu  |

**Prerequisites:** sekret `CODE_REVIEWER_API_KEY` w repozytorium (krok 2.6); docker do `actionlint`.
**Estimated effort:** ~1–2 sesje na 3 fazy, plus 2 płatne runy na PR-ze.

## Open Risks & Assumptions

- **Pominięty job raportuje Success.** Bramka da się obejść obcą etykietą, gdy check stanie się wymagany. Przed włączeniem branch protection trzeba przejść na własny status.
- **PR z forka** zawsze dostanie czerwony check, bo nie ma sekretu.
- **Zakładamy, że job-level concurrency nie anuluje review przy obcej etykiecie.** Nie potwierdza tego dokumentacja, a krok 3.7 to weryfikuje.
- **Przekroczenie budżetu** (`max_budget`) daje brak werdyktu i czerwony job bez komentarza. Tej ścieżki nikt dotąd nie uruchomił.

## Success Criteria (Summary)

- Otwarty PR dostaje komentarz z werdyktem dla wskazanego commita, właściwą etykietę i check zgodny z werdyktem.
- Push nie kosztuje nic, ponowienie działa etykietą, a obca etykieta nie przerywa płatnego runu.
- `CLAUDE.md` mówi wprost, kiedy CI może wołać providera i jakim kluczem.
