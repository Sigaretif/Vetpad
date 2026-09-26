-- Members: one row per account in auth.users, so one member can see another's name.
--
-- `offers.created_by` holds a uuid from auth.users, and auth.users is not exposed
-- through the Data API: without this table the app cannot say which member saved an
-- offer (FR-005, the duplicate notice). `members` is the single source of a member's
-- name — the email address — readable with the publishable key and the member's own
-- session, never with a secret / service_role key. It is the pattern S-05 (note author,
-- FR-013) and S-10 (who archived an offer, FR-014) reuse instead of building a second.
--
-- The table is kept in step with auth.users by the triggers below and nothing else.
-- `email` is nullable because auth.users.email can be null (phone or anonymous
-- accounts): the trigger runs inside Supabase Auth's own insert, so an error there
-- would block creating the account. A null email is "name not known", never
-- "account deleted" — that one is `created_by is null` on the referencing row.
--
-- `on delete cascade`: the row describes an account and goes with it. Referencing
-- rows decide for themselves what a deleted account means (offers: `set null`,
-- 20260923153747_offers_keep_after_author_deleted.sql).

create table public.members (
  id uuid primary key references auth.users (id) on delete cascade,
  email text
);

-- Sync from auth.users
--
-- Supabase Auth inserts and updates auth.users as its own role, which has no rights on
-- public tables, and the table has no write policies (below), so the function runs as
-- its owner: `security definer`, with `search_path` pinned to empty and every name
-- schema-qualified. It is only ever called by the triggers; execute is revoked so it
-- cannot be reached through the Data API as an RPC.

create function public.members_sync_from_auth()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.members (id, email)
    values (new.id, new.email)
    on conflict (id) do update set email = excluded.email;
  elsif tg_op = 'UPDATE' then
    update public.members
    set email = new.email
    where id = new.id;
  end if;
  return new;
end;
$$;

revoke execute on function public.members_sync_from_auth() from public, anon, authenticated;

create trigger members_on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.members_sync_from_auth();

create trigger members_on_auth_user_email_changed
  after update of email on auth.users
  for each row
  execute function public.members_sync_from_auth();

-- Accounts that existed before this migration (the hosted project). Locally the seed
-- runs after migrations, so the insert trigger fills the table on its own.

insert into public.members (id, email)
select id, email
from auth.users
on conflict (id) do nothing;

-- Row Level Security
--
-- Supabase grants select/insert/update/delete on every new public table to `anon`
-- and `authenticated` automatically, so these policies are the single access gate.
--
-- There is intentionally no policy for `anon`: unauthenticated visitors get nothing.
-- There are intentionally no insert, update or delete policies: the table is written
-- only by the `security definer` trigger above, and the email belongs to Supabase Auth,
-- not to the member. The denial is the design, not a gap to fill.
--
-- Denial signature: with RLS on and no matching `select` policy a query returns an
-- empty array with HTTP 200, not a permission error; a blocked write fails with
-- "new row violates row-level security policy" (an update or delete simply matches no
-- row). Fix the policy, never reach for a secret / service_role key.

alter table public.members enable row level security;

-- FR-013: every signed-in member reads every member's name.
create policy members_select_authenticated
  on public.members
  for select
  to authenticated
  using (auth.uid() is not null);

-- Anonymous sign-ins
--
-- The policy above tests `auth.uid() is not null`. An anonymous Supabase user also gets
-- the `authenticated` role and a uid, so it holds only while `enable_anonymous_sign_ins`
-- stays false (supabase/config.toml, and the hosted project's Auth settings). Turning it
-- on requires rewriting this policy first, as for offers
-- (20260923153747_offers_keep_after_author_deleted.sql).
