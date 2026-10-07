-- Audit settings: the model and the reasoning effort the team's AI audits run with (FR-010).
--
-- One shared row, as the team's limits are (20260927144141_create_team_criteria.sql): any
-- member changes it (PRD, Access Control: flat roles), and the next audit anyone starts
-- runs with what it holds. There is no authorisation layer in application code: the
-- policies below are the whole of it.
--
-- The settings are not criteria. Changing them does not touch `criteria_revision`, so it
-- flags no existing audit stale: an audit records the model and the effort it was made
-- with (20261007073300_create_offer_audits.sql), and the criteria it was made against are
-- the same as before.
--
-- `updated_by ... on delete set null`: the settings belong to the team and outlive whoever
-- last changed them, as the limits do. A null `updated_by` with a null `updated_at` means
-- "never changed since this migration"; a null `updated_by` with a date means "the account
-- that last changed the settings was deleted" and nothing else.

create table public.audit_settings (
  -- Singleton: the only possible key is `true`, and the row is inserted below.
  id boolean primary key default true,
  model text not null,
  effort text not null,
  updated_at timestamptz,
  updated_by uuid references auth.users (id) on delete set null,

  constraint audit_settings_singleton check (id),

  -- A closed list, held in the table itself: any member can PATCH the row through the Data
  -- API with the publishable key, and whatever is stored here is sent to the model
  -- provider as it stands. Offering another model or effort is a migration that widens
  -- these checks, never a value a client may pick.
  constraint audit_settings_model_known
    check (model in ('claude-opus-5-5', 'claude-sonnet-5-5')),
  constraint audit_settings_effort_known
    check (effort in ('low', 'medium', 'high'))
);

-- The one row, holding the defaults. The row itself is never inserted or deleted by a
-- member; choosing another model or effort is an update.
insert into public.audit_settings (id, model, effort)
values (true, 'claude-opus-5-5', 'medium');

-- Signature on update, as for the team's limits
-- (20260927144141_create_team_criteria.sql)
--
-- An update policy cannot compare the new value with the old one, so the trigger decides
-- who changed the settings and when; whatever the client sends for `id`, `updated_by` and
-- `updated_at` is ignored.
--
-- 1. `on delete set null` is carried out as an UPDATE on audit_settings, and putting the
--    deleted account back would make deleting it fail. So `updated_by` may become null
--    only when that account no longer exists, and that branch changes nothing else —
--    deleting an account is not a change of the settings, so it does not re-sign the row.
-- 2. The model or the effort changed: the row is signed by the member writing it, dated
--    now.
-- 3. Neither changed (saving the same values): the previous signature and date stay, so
--    re-saving the form is not reported as a change.
--
-- A setting changed outside a member's session (`auth.uid()` null — the SQL editor, a
-- secret key) is refused: a null signature would read as a deleted account, and keeping
-- the previous one would attribute the change to someone who did not make it.
--
-- Reading auth.users needs `security definer`, which is why `search_path` is pinned to
-- empty and every name is schema-qualified. The function is only ever called by the
-- trigger; execute is revoked so it cannot be reached through the Data API as an RPC.

create function public.audit_settings_before_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.updated_by is null
    and old.updated_by is not null
    and not exists (select 1 from auth.users where id = old.updated_by) then
    new := old;
    new.updated_by := null;
    return new;
  end if;

  new.id := old.id;

  if new.model is distinct from old.model
    or new.effort is distinct from old.effort then
    if auth.uid() is null then
      raise exception 'audit settings can only be changed by a signed-in member'
        using errcode = '42501';
    end if;
    new.updated_by := auth.uid();
    new.updated_at := now();
    return new;
  end if;

  new.updated_by := old.updated_by;
  new.updated_at := old.updated_at;
  return new;
end;
$$;

revoke execute on function public.audit_settings_before_update() from public, anon, authenticated;

create trigger audit_settings_before_update
  before update on public.audit_settings
  for each row
  execute function public.audit_settings_before_update();

-- Row Level Security
--
-- Supabase grants select/insert/update/delete on every new public table to `anon`
-- and `authenticated` automatically, so these policies are the single access gate.
--
-- There is intentionally no policy for `anon`: unauthenticated visitors get nothing.
-- There are intentionally no insert or delete policies: the singleton exists from this
-- migration and always holds a model and an effort. The denial is the design, not a gap
-- to fill.
--
-- Denial signature: with RLS on and no matching `select` policy a query returns an
-- empty array with HTTP 200, not a permission error; a blocked write fails with
-- "new row violates row-level security policy" (an update or delete with no matching
-- policy simply matches no row). Fix the policy, never reach for a secret /
-- service_role key.

alter table public.audit_settings enable row level security;

-- FR-010: every signed-in member reads the settings the next audit will run with.
create policy audit_settings_select_authenticated
  on public.audit_settings
  for select
  to authenticated
  using (auth.uid() is not null);

-- FR-010, flat roles: any member changes the settings. The check deliberately does not
-- require `updated_by = auth.uid()`: WITH CHECK sees the row after the `before` trigger,
-- and saving the same values keeps the previous member's signature, which such a check
-- would reject. The trigger, not the policy, guarantees the signature.
create policy audit_settings_update_authenticated
  on public.audit_settings
  for update
  to authenticated
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

-- Anonymous sign-ins
--
-- The policies above test `auth.uid() is not null`. An anonymous Supabase user also gets
-- the `authenticated` role and a uid, so it could read the settings and change the model
-- every audit runs with; these policies hold only while `enable_anonymous_sign_ins` stays
-- false (supabase/config.toml, and the hosted project's Auth settings). Turning it on
-- requires rewriting both policies first, as for offers
-- (20260923153747_offers_keep_after_author_deleted.sql).
