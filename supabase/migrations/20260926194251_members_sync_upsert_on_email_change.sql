-- Members sync, revised (impl review of duplicate-listing-notice, F2).
--
-- Two gaps in 20260926185936_create_members.sql. The email trigger fired on every UPDATE
-- that named `email` in its SET clause, even when the value did not change. And its UPDATE
-- branch was a plain `update`, so an account whose `members` row was missing stayed
-- unnamed after an email change instead of getting the row back.
--
-- Both branches now upsert, and the email trigger fires only when the email actually
-- changes. The function keeps `security definer`, the empty `search_path` and the revoked
-- execute from the creating migration; `create or replace` preserves the revoke.

create or replace function public.members_sync_from_auth()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.members (id, email)
  values (new.id, new.email)
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

drop trigger members_on_auth_user_email_changed on auth.users;

create trigger members_on_auth_user_email_changed
  after update of email on auth.users
  for each row
  when (old.email is distinct from new.email)
  execute function public.members_sync_from_auth();
