# Zamknięta rejestracja — logowanie tylko kontami zespołu: plan implementacji

## Overview

Zamykamy rejestrację zgodnie z FR-001: do Vetpad logują się wyłącznie trzy konta utworzone przez administratora, a obca osoba nie założy konta ani przez UI, ani bezpośrednio przez Supabase Auth. Test smoke przestaje zakładać konto inline, loguje się kontem z `supabase/seed.sql` i dowodzi, że rejestracja jest zamknięta. Slice idzie przed jakimikolwiek danymi zespołu, bo po FR-013 każdy zalogowany czyta wszystko — otwarta rejestracja to otwarty dostęp do ofert i notatek.

## Current State Analysis

- Rejestracja w aplikacji: strona `src/pages/auth/signup.astro`, formularz `src/components/auth/SignUpForm.tsx`, trasa `src/pages/api/auth/signup.ts` (przekierowuje na `/auth/confirm-email`), strona `src/pages/auth/confirm-email.astro` (osiągalna tylko po rejestracji).
- Linki do rejestracji: `src/components/Topbar.astro:27-29`, `src/components/Welcome.astro:35-40` (przycisk „Sign Up”) i `:64` (opis karty „sign in, sign up”), `src/pages/auth/signin.astro:15-20` („Don't have an account? Sign up”).
- Serwer Auth jest otwarty niezależnie od aplikacji: `supabase/config.toml:169` (`[auth] enable_signup = true`) i `:204` (`[auth.email] enable_signup = true`). Endpoint `/auth/v1/signup` przyjmuje klucz publishable, więc usunięcie trasy z aplikacji samo w sobie niczego nie zamyka. W projekcie hostowanym to samo steruje przełącznik w dashboardzie.
- `scripts/smoke.mjs:41-55` zakłada konto przez `/api/auth/signup` i na nim wykonuje kroki logowania — po usunięciu trasy smoke będzie czerwony.
- `supabase/seed.sql` tworzy trzy potwierdzone konta `sigaretif{1,2,3}@vetpad.local` (hasło `qwerty123456`) przez bezpośredni INSERT do `auth.users`; seed działa przy świeżym `supabase start`, także w jobie `smoke` w CI, i nie zależy od `enable_signup`.
- Job `smoke` (`.github/workflows/ci.yml:35-40`) już zapisuje `SUPABASE_URL` i `SUPABASE_KEY` lokalnego stacku do `.env`.
- Dokumentacja opisuje stary stan: README (tabela tras `:147-153`, sekcja „Email confirmation in local development” `:135-143`, opis smoke `:181-189`), runbook (`context/foundation/deployment-runbook.md:216` — smoke „registers a fresh account”), CLAUDE.md (Conventions: „`signup.ts` follows it”; Testing: punkt „Concretely: FR-001…”).

## Desired End State

- `GET /auth/signup` i `POST /api/auth/signup` zwracają 404; `/auth/confirm-email` nie istnieje; w UI nie ma żadnego odnośnika do rejestracji.
- Lokalny i CI-owy Supabase odrzuca `POST /auth/v1/signup` z kodem `signup_disabled`; hostowany projekt ma wyłączone „Allow new users to sign up”.
- Trzy konta zespołu istnieją w projekcie hostowanym i każdy członek loguje się na produkcji.
- `npm run smoke` loguje się kontem z seeda i przechodzi, w CI bez zmian w workflow.
- README, runbook i CLAUDE.md opisują nowy stan, a runbook zawiera procedurę zakładania kont i ponownego wydania hasła.

Weryfikacja: kryteria sukcesu obu faz poniżej.

### Key Discoveries:

- `.github/workflows/ci.yml:37-40` — `.env` z `SUPABASE_URL`/`SUPABASE_KEY` już istnieje w jobie `smoke`, więc wystarczy, że skrypt `smoke` go wczyta; workflow się nie zmienia.
- `supabase/seed.sql:21-58` — konta seedowane INSERT-em do `auth.users`/`auth.identities` omijają rejestrację, więc `enable_signup = false` ich nie blokuje.
- `context/foundation/deployment-runbook.md:203-206` — zakładanie kont i konfiguracja dashboardu to czynności wyłącznie ludzkie; agent ich nie wykonuje.
- `src/pages/api/auth/signin.ts` pozostaje wzorcem tras formularzowych (`?error=` w przekierowaniu).

## What We're NOT Doing

- Resetu hasła ani „zapomniałem hasła” — FR-001 go wyklucza; hasło wydaje ponownie administrator poleceniem SQL (opisanym w runbooku).
- Hooka `before_user_created` ani migracji — przy trzech użytkownikach wystarcza wyłączenie rejestracji na serwerze Auth.
- Osobnego konta testowego w `seed.sql` — smoke używa `sigaretif1@vetpad.local`, seed dalej odzwierciedla trzyosobowy zespół.
- Zmian w `.github/workflows/ci.yml`.
- Zmian w middleware i liście `PROTECTED_ROUTES`.
- Uruchamiania smoke przeciwko produkcji — konto z seeda istnieje tylko lokalnie.
- Edycji `context/changes/deployment/deployment-plan.md` — to zapis historyczny innej zmiany.
- Zmian w PRD, shape-notes ani w treści roadmapy poza statusem S-01.

## Implementation Approach

Faza 1 zamyka rejestrację w kodzie, w lokalnej konfiguracji Auth i przepina smoke w jednej jednostce pracy, żeby CI ani przez chwilę nie było czerwone. Faza 2 aktualizuje dokumentację i kończy się ręczną bramką po stronie produkcji: wyłączenie rejestracji w dashboardzie, założenie trzech kont i weryfikacja. Kontrole produkcyjne tras aplikacji wymagają, by kod z fazy 1 był już wdrożony na `master`.

## Critical Implementation Details

- **Restart lokalnego stacku.** Zmiana `supabase/config.toml` działa dopiero po `npx supabase stop && npx supabase start`; bez restartu lokalny smoke zobaczy otwartą rejestrację i poprawnie się wysypie. CI zawsze startuje na świeżo.
- **Sprawdzenie produkcji bez skutków ubocznych.** W runbooku otwartość rejestracji na hoście sprawdzamy przez `GET $SUPABASE_URL/auth/v1/settings` (pole `disable_signup`), a nie próbnym `POST /auth/v1/signup` — ten przy otwartej rejestracji założyłby konto w produkcji. Próbny `POST` jest dopuszczalny tylko w smoke, na wyrzucanej bazie lokalnej.

## Faza 1: Zamknięcie rejestracji w kodzie, konfiguracji lokalnej i smoke

### Overview

Usuwa całą powierzchnię rejestracji z aplikacji, wyłącza rejestrację w lokalnym Supabase Auth i przepisuje smoke tak, by logował się kontem z seeda i dowodził zamknięcia rejestracji na obu poziomach.

### Changes Required:

#### 1. Usunięcie powierzchni rejestracji

**File**: `src/pages/auth/signup.astro`, `src/pages/api/auth/signup.ts`, `src/pages/auth/confirm-email.astro`, `src/components/auth/SignUpForm.tsx`

**Intent**: Usunąć pliki, aby trasy rejestracji przestały istnieć, a Astro odpowiadało na nie 404. `confirm-email` jest osiągalny wyłącznie po rejestracji, więc znika razem z nią.

**Contract**: Po zmianie `/auth/signup`, `/api/auth/signup` i `/auth/confirm-email` → 404. Komponenty współdzielone (`FormField`, `PasswordToggle`, `SubmitButton`, `ServerError`) zostają, bo używa ich `SignInForm.tsx`.

#### 2. Usunięcie odnośników do rejestracji

**File**: `src/components/Topbar.astro`, `src/components/Welcome.astro`, `src/pages/auth/signin.astro`

**Intent**: Żaden ekran nie może prowadzić do nieistniejącej rejestracji ani jej obiecywać.

**Contract**: Topbar dla niezalogowanego pokazuje tylko „Sign in”. Welcome ma jeden przycisk „Sign In”; opis karty „Authentication Ready” mówi o logowaniu kontami zespołu i chronionych trasach, bez „sign up”. Na `/auth/signin` akapit „Don't have an account? Sign up” zastępuje jedno zdanie: „Accounts are created by the team's administrator.” (UI pozostaje po angielsku).

#### 3. Wyłączenie rejestracji w lokalnym Supabase Auth

**File**: `supabase/config.toml`

**Intent**: Zamknąć rejestrację na serwerze Auth, bo to on, a nie aplikacja, decyduje, czy klucz publishable wystarczy do założenia konta.

**Contract**: `[auth] enable_signup = false` i `[auth.email] enable_signup = false`. Pozostałe ustawienia (`enable_confirmations`, `[db.seed]`) bez zmian.

#### 4. Przepięcie testu smoke

**File**: `scripts/smoke.mjs`

**Intent**: Smoke loguje się kontem z seeda zamiast zakładać własne i dowodzi FR-001: trasy rejestracji zniknęły, a Supabase Auth odrzuca rejestrację.

**Contract**: Dane logowania z `SMOKE_EMAIL`/`SMOKE_PASSWORD`, domyślnie `sigaretif1@vetpad.local` / `qwerty123456` (z komentarzem, że pochodzą z `supabase/seed.sql`). Kolejność kroków:

1. `GET /` → 200
2. `GET /dashboard` anonimowo → 302 `/auth/signin`
3. `GET /auth/signup` → 404
4. `POST /api/auth/signup` (formularz z e-mailem i hasłem) → 404
5. `POST ${SUPABASE_URL}/auth/v1/signup` z nagłówkiem `apikey: ${SUPABASE_KEY}` i JSON-em ze świeżym adresem `smoke-<timestamp>@example.com` → odrzucone, `error_code === "signup_disabled"` (GoTrue zwraca 422; implementer potwierdza status na lokalnym stacku i asercją główną jest `error_code`)
6. logowanie złym hasłem → 302 `/auth/signin?error=`
7. logowanie poprawnym hasłem → 302 `/`
8. `GET /dashboard` → 200
9. `POST /api/auth/signout` → 302 `/`
10. `GET /dashboard` → 302 `/auth/signin`

Krok 5 wymaga `SUPABASE_URL` i `SUPABASE_KEY`; gdy ich brak, krok kończy się błędem `FAIL` z komunikatem, że trzeba je ustawić (np. w `.env`) — nigdy nie jest cicho pomijany. Kształt kroku (`[name, run, expected]`) może zostać rozszerzony tak, by krok 5 porównywał `error_code` z treści odpowiedzi; skrypt dalej nie ma zależności.

#### 5. Wczytanie `.env` przez skrypt smoke

**File**: `package.json`

**Intent**: Dać smoke dostęp do `SUPABASE_URL`/`SUPABASE_KEY` lokalnie i w CI bez zmiany workflow.

**Contract**: `"smoke": "node --env-file-if-exists=.env scripts/smoke.mjs"`. Zmienne ustawione w środowisku (np. `BASE_URL`) mają pierwszeństwo przed plikiem.

### Success Criteria:

#### Automated Verification:

- Generowanie typów przechodzi: `npx astro sync`
- Lint przechodzi: `npm run lint`
- Sprawdzenie typów przechodzi: `npx astro check`
- Build przechodzi bez `.env` i `.dev.vars` (zero-config): `npm run build`
- W `src/` nie ma odwołań do rejestracji: `grep -rniE "signup|sign up|confirm-email" src` nic nie zwraca
- Smoke przechodzi wszystkie 10 kroków na lokalnym stacku po restarcie Supabase: `npx supabase stop && npx supabase start`, `npm run build && npm run preview`, `BASE_URL=http://localhost:4321 npm run smoke`
- Job `smoke` i `ci` w GitHub Actions są zielone na PR/pushu tej zmiany

#### Manual Verification:

- Strona główna i topbar nie pokazują „Sign Up”; `/auth/signin` pokazuje zdanie o administratorze zamiast linku do rejestracji
- Logowanie w przeglądarce jako `sigaretif1@vetpad.local` prowadzi na `/` i pozwala otworzyć `/dashboard`
- Wejście na `/auth/signup` w przeglądarce pokazuje 404

**Implementation Note**: Po przejściu weryfikacji automatycznej zatrzymaj się na ręczne potwierdzenie przez człowieka, zanim przejdziesz do fazy 2.

---

## Faza 2: Dokumentacja i zamknięcie rejestracji na produkcji

### Overview

Dostosowuje dokumentację do nowego stanu, dopisuje do runbooka procedurę zakładania kont, ponownego wydania hasła i sprawdzenia, że rejestracja jest zamknięta, po czym człowiek wykonuje te kroki w projekcie hostowanym.

### Changes Required:

#### 1. README

**File**: `README.md`

**Intent**: README nie może opisywać rejestracji, której nie ma.

**Contract**: Tabela „Auth routes” bez wierszy `/auth/signup` i `/auth/confirm-email`. Sekcja „Email confirmation in local development” zastąpiona krótkim opisem kont: lokalnie trzy konta z `supabase/seed.sql`, w projekcie hostowanym zakłada je administrator według runbooka, rejestracja jest wyłączona (FR-001). Sekcja „Smoke test”: smoke loguje się kontem z seeda i sprawdza, że rejestracja jest zamknięta; wymaga lokalnego Supabase uruchomionego z seedem oraz `SUPABASE_URL`/`SUPABASE_KEY` w `.env`; nie uruchamia się go przeciw produkcji.

#### 2. Runbook

**File**: `context/foundation/deployment-runbook.md`

**Intent**: Zapisać ludzką procedurę kont zespołu i uzupełnić weryfikację wdrożenia o zamkniętą rejestrację.

**Contract**:

- W „Verifying a deploy”: sprawdzenie, że `/auth/signup` → 404, oraz odczyt `GET $SUPABASE_URL/auth/v1/settings` z nagłówkiem `apikey` (klucz publishable), gdzie oczekiwane jest `"disable_signup": true`. Z adnotacją, dlaczego nie próbny `POST /auth/v1/signup`.
- Nowa sekcja o kontach zespołu: wyłączenie „Allow new users to sign up” (Authentication → Sign In / Providers), zakładanie konta przez Authentication → Users → Add user → Create new user z „Auto Confirm User”, ponowne wydanie hasła poleceniem SQL w SQL Editorze (`update auth.users set encrypted_password = crypt('<nowe>', gen_salt('bf')), updated_at = now() where email = '<adres>';`). Konta nigdy nie trafiają do `seed.sql`.
- Zdanie w „Two databases, never one” (`:216`): smoke loguje się kontem z seeda i próbuje rejestracji, więc wymaga bazy lokalnej — tylko tam to konto istnieje i tylko tam próba rejestracji jest nieszkodliwa.

#### 3. CLAUDE.md

**File**: `CLAUDE.md`

**Intent**: Reguły muszą wskazywać istniejące pliki i nie opisywać zmiany, która już się wydarzyła.

**Contract**: W Conventions usunąć „and `signup.ts` follows it” (wzorcem pozostaje `src/pages/api/auth/signin.ts`). W Testing punkt „Concretely: FR-001…” zastąpić regułą: `scripts/smoke.mjs` loguje się kontem z `supabase/seed.sql` i sprawdza, że rejestracja jest zamknięta w trasach aplikacji i w Supabase Auth (FR-001); zmiana, która ponownie włącza rejestrację albo usuwa to konto z seeda, ma czerwony smoke. We wpisie o `supabase/seed.sql` w „Forward-looking” dopisać, że smoke zależy od tego konta.

### Success Criteria:

#### Automated Verification:

- W README nie ma tras rejestracji: `grep -nE "/auth/signup|/auth/confirm-email" README.md` nic nie zwraca
- CLAUDE.md nie wskazuje usuniętego pliku: `grep -n "signup.ts" CLAUDE.md` nic nie zwraca
- Runbook nie opisuje rejestrującego smoke: `grep -n "registers a fresh account" context/foundation/deployment-runbook.md` nic nie zwraca
- Formatowanie przechodzi: `npm run lint`

#### Manual Verification:

- W dashboardzie hostowanego projektu „Allow new users to sign up” jest wyłączone, a `GET $SUPABASE_URL/auth/v1/settings` zwraca `"disable_signup": true`
- Trzy konta zespołu istnieją w hostowanym projekcie i każdy członek zalogował się na `https://vetpad.vetpad.workers.dev`
- Po wdrożeniu fazy 1 na produkcji `/auth/signup` zwraca 404, a kontrole z „Verifying a deploy” dają oczekiwane wyniki

**Implementation Note**: Kroki ręczne na produkcji wykonuje wyłącznie człowiek (runbook, „What only a human does”). Agent przygotowuje dokumentację i czeka na potwierdzenie.

---

## Testing Strategy

### Unit Tests:

- Brak — projekt nie ma runnera testów jednostkowych (CLAUDE.md, Testing).

### Integration Tests:

- `scripts/smoke.mjs` na lokalnym stacku i w jobie `smoke`: 10 kroków z fazy 1, w tym dwa 404 na trasach rejestracji i `signup_disabled` z Supabase Auth.

### Manual Testing Steps:

1. Lokalnie po restarcie Supabase: strona główna, topbar i `/auth/signin` bez odnośników do rejestracji; `/auth/signup` → 404.
2. Lokalnie: logowanie jako `sigaretif1@vetpad.local`, wejście na `/dashboard`, wylogowanie.
3. Produkcja: wyłączenie rejestracji w dashboardzie, `GET /auth/v1/settings` → `disable_signup: true`.
4. Produkcja: założenie trzech kont, logowanie każdym z nich.

## Migration Notes

- Brak migracji bazy. Konta zakładane dotąd lokalnie przez `/auth/signup` (np. `smoke-…@example.com`) zostają w lokalnym `auth.users` do najbliższego `supabase db reset`; nie przeszkadzają.
- Hostowany projekt: jeśli ktoś zdążył się zarejestrować przed wyłączeniem, administrator usuwa takie konto w Authentication → Users w ramach ręcznej bramki fazy 2.

## References

- Roadmapa: `context/foundation/roadmap.md` — S-01 `closed-team-sign-in`
- PRD: `context/foundation/prd.md` — FR-001, Access Control
- Runbook: `context/foundation/deployment-runbook.md` — „What only a human does”, „Two databases, never one”
- Wzorzec trasy formularzowej: `src/pages/api/auth/signin.ts`
- Konta lokalne: `supabase/seed.sql:21-58`
- Konfiguracja CI: `.github/workflows/ci.yml:25-51`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Zamknięcie rejestracji w kodzie, konfiguracji lokalnej i smoke

#### Automated

- [x] 1.1 Generowanie typów przechodzi: `npx astro sync` — 2e4fc69
- [x] 1.2 Lint przechodzi: `npm run lint` — 2e4fc69
- [x] 1.3 Sprawdzenie typów przechodzi: `npx astro check` — 2e4fc69
- [x] 1.4 Build przechodzi bez `.env` i `.dev.vars` (zero-config): `npm run build` — 2e4fc69
- [x] 1.5 W `src/` nie ma odwołań do rejestracji: `grep -rniE "signup|sign up|confirm-email" src` nic nie zwraca — 2e4fc69
- [x] 1.6 Smoke przechodzi wszystkie 10 kroków na lokalnym stacku po restarcie Supabase: `npx supabase stop && npx supabase start`, `npm run build && npm run preview`, `BASE_URL=http://localhost:4321 npm run smoke` — 2e4fc69
- [ ] 1.7 Job `smoke` i `ci` w GitHub Actions są zielone na PR/pushu tej zmiany

#### Manual

- [x] 1.8 Strona główna i topbar nie pokazują „Sign Up”; `/auth/signin` pokazuje zdanie o administratorze zamiast linku do rejestracji — 2e4fc69
- [x] 1.9 Logowanie w przeglądarce jako `sigaretif1@vetpad.local` prowadzi na `/` i pozwala otworzyć `/dashboard` — 2e4fc69
- [x] 1.10 Wejście na `/auth/signup` w przeglądarce pokazuje 404 — 2e4fc69

### Phase 2: Dokumentacja i zamknięcie rejestracji na produkcji

#### Automated

- [x] 2.1 W README nie ma tras rejestracji: `grep -nE "/auth/signup|/auth/confirm-email" README.md` nic nie zwraca
- [x] 2.2 CLAUDE.md nie wskazuje usuniętego pliku: `grep -n "signup.ts" CLAUDE.md` nic nie zwraca
- [x] 2.3 Runbook nie opisuje rejestrującego smoke: `grep -n "registers a fresh account" context/foundation/deployment-runbook.md` nic nie zwraca
- [x] 2.4 Formatowanie przechodzi: `npm run lint`

#### Manual

- [x] 2.5 W dashboardzie hostowanego projektu „Allow new users to sign up” jest wyłączone, a `GET $SUPABASE_URL/auth/v1/settings` zwraca `"disable_signup": true`
- [x] 2.6 Trzy konta zespołu istnieją w hostowanym projekcie i każdy członek zalogował się na `https://vetpad.vetpad.workers.dev`
- [ ] 2.7 Po wdrożeniu fazy 1 na produkcji `/auth/signup` zwraca 404, a kontrole z „Verifying a deploy” dają oczekiwane wyniki
