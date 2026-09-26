# Zastosowanie migracji bazy w hostowanym Supabase

Schemat bazy Vetpadu leży w `supabase/migrations/`. Lokalnie migracje stosują się same
(`npx supabase start`, `npx supabase db reset`), ale do **hostowanego** projektu trafiają
poleceniem `npx supabase db push`. Możesz uruchomić je sam albo zlecić agentowi — agent
najpierw pokazuje listę z `--dry-run` i za każdym razem pyta o zgodę, zanim nałoży migracje. Ty robisz tylko jednorazowe kroki 1–2
(logowanie i połączenie repozytorium), bo wymagają przeglądarki albo hasła.

## Kiedy

Zawsze **przed** tym, jak kod, który potrzebuje nowej migracji, trafi na `master`.
Push na `master` od razu uruchamia deploy (Workers Builds —
`context/foundation/deployment-runbook.md`, „How a change reaches production”), więc:

- przy `/git-ship` — przed zmergowaniem PR-a,
- przy `/git-land` — przed uruchomieniem skryptu, bo on pushuje prosto na `master`.

Odwrotna kolejność nie psuje strony, ale nowa funkcja nie działa do czasu migracji —
np. po S-02 każde wklejenie URL-a kończy się komunikatem „Nie udało się zapisać oferty".

Pierwsza migracja do zastosowania: `20260922202756_create_offers.sql` (tabela `offers`
z RLS, S-02 `paste-listing-to-card`).

## Kroki

Wszystkie polecenia uruchamiaj w katalogu repozytorium. CLI Supabase jest zależnością
projektu, więc zawsze przez `npx` — samo `supabase` nie zadziała.

1. Zaloguj CLI (jednorazowo na komputer; logowanie w panelu przeglądarki się nie liczy):

   ```bash
   npx supabase login
   ```

   Sprawdzenie: `npx supabase projects list` pokazuje projekt Vetpad zamiast błędu
   `Access token not provided`.

2. Połącz repozytorium z hostowanym projektem (jednorazowo; poprosi o hasło bazy):

   ```bash
   npx supabase link --project-ref <ref>
   ```

   `<ref>` to identyfikator z adresu panelu: `https://supabase.com/dashboard/project/<ref>`.

3. Zobacz, co zostanie zastosowane:

   ```bash
   npx supabase db push --dry-run
   ```

   Lista powinna zawierać tylko migracje, których jeszcze nie ma w projekcie hostowanym.

4. Zastosuj:

   ```bash
   npx supabase db push
   ```

5. Sprawdź w panelu Supabase (**Authentication → Policies** lub **Database → Policies**),
   że nowa tabela ma włączony RLS i swoje polityki. Dla `offers`: cztery polityki,
   wszystkie dla roli `authenticated`, żadna dla `anon`.

6. Dopiero teraz zmerguj PR / uruchom `/git-land`. Po deployu sprawdź aplikację według
   `context/foundation/deployment-runbook.md`, „Verifying a deploy”.

## Zasady

- **Nigdy `npx supabase db reset --linked`.** Czyści hostowaną bazę i wgrywa do niej
  `supabase/seed.sql` z publicznymi hasłami kont testowych.
- `db push` nie uruchamia seeda — to zamierzone. Konta zespołu zakłada się osobno
  (`context/foundation/deployment-runbook.md`, „Team accounts”).
- Migracji nie pisze się ręcznie ani nie wkleja w SQL Editor hostowanego projektu —
  wtedy historia migracji w Supabase rozjedzie się z `supabase/migrations/` i następny
  `db push` się wyłoży.
- Nie używaj klucza `service_role` / `sb_secret_…`, żeby obejść odrzucone zapytanie po
  migracji — poprawia się politykę RLS w nowej migracji.

## Zobacz też

- `context/foundation/deployment-runbook.md` — „What only a human does”, „Two databases,
  never one”, „Rollback”.
- `README.md` — sekcja o bazie danych i migracjach.
