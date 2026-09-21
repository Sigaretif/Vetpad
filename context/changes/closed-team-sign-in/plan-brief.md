# Zamknięta rejestracja — logowanie tylko kontami zespołu — Plan Brief

> Full plan: `context/changes/closed-team-sign-in/plan.md`

## What & Why

Do Vetpad mają się logować wyłącznie trzy konta zespołu założone przez administratora; nikt nie może się zarejestrować (FR-001). To pierwszy slice roadmapy (S-01), bo po FR-013 każdy zalogowany czyta wszystkie oferty i notatki — dopóki rejestracja jest otwarta, każdy obcy dostaje pełny dostęp do danych zespołu.

## Starting Point

Aplikacja ma działającą stronę i trasę rejestracji (`/auth/signup`, `/api/auth/signup`, `/auth/confirm-email`) oraz linki do niej w topbarze, na stronie głównej i na `/auth/signin`. Niezależnie od tego Supabase Auth ma `enable_signup = true`, więc `/auth/v1/signup` przyjmuje klucz publishable z pominięciem aplikacji. Smoke zakłada swoje konto przez trasę rejestracji. Lokalnie i w CI istnieją trzy konta z `supabase/seed.sql`.

## Desired End State

Trasy rejestracji zwracają 404, a UI nigdzie jej nie obiecuje. Supabase Auth odrzuca rejestrację lokalnie, w CI i na produkcji. Trzy konta zespołu istnieją w projekcie hostowanym i każdy członek się loguje. Smoke loguje się kontem z seeda i dowodzi zamknięcia rejestracji na obu poziomach. README, runbook i CLAUDE.md opisują nowy stan.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Gdzie zamykamy rejestrację | Aplikacja + `enable_signup = false` w `config.toml` + przełącznik w dashboardzie | Sama trasa to fasada; dane chroni dopiero wyłączona rejestracja na serwerze Auth. |
| Konto dla smoke | `sigaretif1@vetpad.local` z `seed.sql`, nadpisywalne `SMOKE_EMAIL`/`SMOKE_PASSWORD` | Seed już tworzy konto w CI; nie trzeba nowego konta ani zmian w workflow. |
| Dowód zamknięcia w smoke | 404 na obu trasach + `signup_disabled` z `/auth/v1/signup` | Test pilnuje tego, co realnie chroni dane, a nie tylko UI. |
| Konta na produkcji | Ręczna faza w planie + procedura w runbooku | Slice nie jest zamknięty, dopóki produkcja przyjmuje rejestracje. |
| Los usuniętych stron | Usunięcie (404), bez przekierowań; `confirm-email` i `SignUpForm` też znikają | Jednoznaczna asercja w smoke, zero martwego kodu. |
| Dostęp smoke do `SUPABASE_URL`/`KEY` | `node --env-file-if-exists=.env` w skrypcie `smoke` | CI już zapisuje `.env`, więc workflow się nie zmienia. |
| Sprawdzenie produkcji | `GET /auth/v1/settings` → `disable_signup: true` | Próbny `POST` przy otwartej rejestracji założyłby konto w produkcji. |

## Scope

**In scope:**

- Usunięcie strony, trasy i formularza rejestracji, `confirm-email` i wszystkich linków „Sign up”
- `enable_signup = false` w `[auth]` i `[auth.email]` w `supabase/config.toml`
- Nowy smoke (10 kroków) i `--env-file-if-exists` w `package.json`
- Aktualizacja README, runbooka (konta, reset hasła SQL, weryfikacja) i CLAUDE.md
- Ręczne: wyłączenie rejestracji w dashboardzie, założenie trzech kont, weryfikacja produkcji

**Out of scope:**

- Reset hasła, hook `before_user_created`, migracje
- Osobne konto testowe w seedzie, zmiany w `ci.yml`, w middleware
- Smoke przeciwko produkcji; edycja historycznego `deployment-plan.md`, PRD i shape-notes

## Architecture / Approach

Rejestrację zamykamy na dwóch poziomach: aplikacja przestaje wystawiać trasy (404), a serwer Supabase Auth odrzuca `/auth/v1/signup` (`signup_disabled`). Konta powstają tylko poza rejestracją: lokalnie przez INSERT w `seed.sql`, na produkcji przez „Add user” w dashboardzie. Smoke ćwiczy oba poziomy na wyrzucanej bazie lokalnej.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Zamknięcie rejestracji w kodzie, konfiguracji lokalnej i smoke | Brak tras i linków, Auth odrzuca rejestrację, zielony smoke | Lokalny stack bez restartu nadal ma otwartą rejestrację |
| 2. Dokumentacja i zamknięcie rejestracji na produkcji | Aktualne README/runbook/CLAUDE.md, rejestracja wyłączona i trzy konta na hoście | Krok ręczny, którego nie zweryfikuje CI |

**Prerequisites:** lokalny Supabase (`npx supabase start`) z `.env` wskazującym na niego; dostęp administratora do dashboardu hostowanego projektu na fazę 2.
**Estimated effort:** ~1 sesja; faza 2 dodatkowo ~15 minut pracy ręcznej w dashboardzie.

## Open Risks & Assumptions

- GoTrue zwraca 422 z `error_code: "signup_disabled"`; asercja główna to `error_code`, status potwierdza implementer na lokalnym stacku.
- Kontrole produkcyjne tras wymagają, by faza 1 była już wdrożona na `master`.
- Jeśli ktoś zarejestrował się na produkcji przed wyłączeniem, administrator usuwa to konto w ramach bramki fazy 2.

## Success Criteria (Summary)

- Obca osoba nie założy konta ani przez UI, ani przez API Supabase — lokalnie, w CI i na produkcji.
- Każdy z trzech członków zespołu loguje się na produkcji swoim kontem.
- Job `smoke` jest zielony i pilnuje, żeby rejestracja nie wróciła.
