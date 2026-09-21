# Ręczna zmiana hasła użytkownika w Supabase

Vetpad nie ma resetu hasła ani opcji „zapomniałem hasła” (FR-001). Gdy członek zespołu
zapomni hasła albo trzeba je zmienić, nowe hasło ustawia administrator bezpośrednio
w hostowanym projekcie Supabase.

## Kroki

1. Wejdź na <https://supabase.com/dashboard> i wybierz **hostowany** projekt Vetpad.
2. W lewym pasku kliknij **SQL Editor**, a potem **New query**.
3. Wklej polecenie, podmieniając `<nowe hasło>` i `<adres>`:

   ```sql
   update auth.users
   set encrypted_password = crypt('<nowe hasło>', gen_salt('bf')), updated_at = now()
   where email = '<adres>';
   ```

4. Kliknij **Run**. Wynik powinien brzmieć `Success. 1 row affected` (albo pokazać jeden
   zmieniony wiersz).
   - `0 rows` oznacza literówkę w adresie — sprawdź go w **Authentication → Users**.
5. Przekaż nowe hasło członkowi zespołu prywatnie, poza repozytorium i poza czatem
   zespołu, jeśli się da.
6. Członek zespołu loguje się na <https://vetpad.vetpad.workers.dev/auth/signin>.

## Zasady

- Nowe hasło musi być mocne i nieużywane gdzie indziej. Nigdy nie używaj haseł
  z `supabase/seed.sql` (np. `qwerty123456`) — repozytorium jest publiczne.
- Hasła nie zapisuj w żadnym pliku repozytorium ani w `seed.sql`.
- Zmiana hasła nie wylogowuje otwartych sesji. Jeśli hasło zmieniasz, bo mogło wyciec,
  wyloguj też sesje: w **SQL Editor** uruchom
  `delete from auth.sessions where user_id = (select id from auth.users where email = '<adres>');`
  Sesja wygasa wtedy najpóźniej po wygaśnięciu bieżącego tokenu dostępu (domyślnie do godziny).
- Nie zmieniaj haseł kluczem `service_role` / `sb_secret_…` ani przez aplikację — to
  robota wyłącznie dla administratora w dashboardzie.

## Zobacz też

- `context/foundation/deployment-runbook.md`, sekcja „Team accounts” — zakładanie kont,
  zamknięcie rejestracji i usuwanie kont.
