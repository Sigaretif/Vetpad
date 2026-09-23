-- A saved offer outlives its author's account.
--
-- `created_by` referenced auth.users with the default NO ACTION, so deleting a member
-- who had saved an offer failed in Supabase Auth ("Database error deleting user"). The
-- offer belongs to the team, not to the member who pasted it: deleting the account now
-- leaves the offer in place and sets `created_by` to null, which means "the author's
-- account was deleted" and nothing else. Where the interface would name the author, it
-- reads „konto usunięte" (PRD, Non-Functional Requirements).
--
-- A new offer still always has an author: the insert policy requires
-- `created_by = auth.uid()`, which a null never satisfies.

alter table public.offers
  alter column created_by drop not null;

alter table public.offers
  drop constraint offers_created_by_fkey,
  add constraint offers_created_by_fkey
    foreign key (created_by) references auth.users (id) on delete set null;

-- Author freeze, revised
--
-- `on delete set null` is carried out as an UPDATE on offers, and the freeze trigger
-- would put the deleted author back, so deleting the account would still fail. The
-- trigger now lets `created_by` become null only when the author's account no longer
-- exists; any other change, a member's PATCH to null included, keeps the original
-- author. Reading auth.users needs `security definer`, which is why `search_path` is
-- pinned to empty and every name is schema-qualified.

create or replace function public.offers_freeze_created_by()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.created_by is null
    and old.created_by is not null
    and not exists (select 1 from auth.users where id = old.created_by) then
    return new;
  end if;
  new.created_by := old.created_by;
  return new;
end;
$$;

-- Anonymous sign-ins
--
-- The four policies from the creating migration test `auth.uid() is not null`. An
-- anonymous Supabase user also gets the `authenticated` role and a uid, so these
-- policies hold only while `enable_anonymous_sign_ins` stays false
-- (supabase/config.toml, and the hosted project's Auth settings). Turning it on
-- requires rewriting every policy on this table first.
