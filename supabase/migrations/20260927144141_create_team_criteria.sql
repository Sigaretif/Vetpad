-- Team search criteria: the shared hard limits and each member's own requirements
-- (FR-002), editable or removable at any time (FR-003), plus a revision counter the audit
-- is stamped with so an audit made under older criteria can be flagged stale (S-04, S-09).
--
-- Two kinds of criteria, split on purpose (PRD, FR-002): the hard limits — city, price
-- range, minimum square meters — are one shared row that governs the whole board, and any
-- member edits it (PRD, Access Control: flat roles). The soft requirements are free text,
-- one per member, and only their author writes, edits or deletes them; every member reads
-- every member's requirements, because surfacing disagreement is what the split is for.
-- There is no authorisation layer in application code: the policies below are the whole
-- of it.
--
-- `member_requirements.author_id ... on delete cascade`: when an account is deleted, its
-- requirements go with it. They are one person's wishes steering the audit; once that
-- person has left the team nobody else could edit or delete them, so they would steer
-- every later audit with no one able to take them back.
--
-- `team_criteria.updated_by ... on delete set null`: the limits belong to the team and
-- outlive whoever last changed them, as offers outlive their author
-- (20260923153747_offers_keep_after_author_deleted.sql). A null `updated_by` with a null
-- `updated_at` means "never set"; a null `updated_by` with a date means "the account that
-- last changed the limits was deleted" and nothing else.
--
-- Criteria, unlike notes, may leave the system: the limits and every member's
-- requirements are an input to the audit and are sent to the model provider (PRD,
-- Non-Functional Requirements). Nothing else a member writes belongs in these tables.

create table public.team_criteria (
  -- Singleton: the only possible key is `true`, and the row is inserted below.
  id boolean primary key default true,
  city text,
  price_min numeric,
  price_max numeric,
  area_min numeric,
  updated_at timestamptz,
  updated_by uuid references auth.users (id) on delete set null,

  constraint team_criteria_singleton check (id),

  -- An unset limit is null, never an empty string and never zero: "no limit" and
  -- "a limit of 0" must not look alike (PRD, Guardrails).
  --
  -- `numeric` also accepts 'NaN' and 'Infinity', and both pass `> 0`; the board compares
  -- offers with these limits, so a limit is a finite number. Postgres sorts NaN above
  -- Infinity, so `< 'Infinity'` rules out both.
  constraint team_criteria_city_not_blank
    check (city is null or (btrim(city) <> '' and char_length(city) <= 100)),
  constraint team_criteria_price_min_positive
    check (price_min is null or (price_min > 0 and price_min < 'Infinity')),
  constraint team_criteria_price_max_positive
    check (price_max is null or (price_max > 0 and price_max < 'Infinity')),
  constraint team_criteria_area_min_positive
    check (area_min is null or (area_min > 0 and area_min < 'Infinity')),
  constraint team_criteria_price_range
    check (price_min is null or price_max is null or price_min <= price_max)
);

-- The one row, with no limits set. "Clearing the limits" writes nulls into it; the row
-- itself is never inserted or deleted by a member.
insert into public.team_criteria (id) values (true);

-- Signature on update
--
-- An update policy cannot compare the new value with the old one, so the trigger decides
-- who changed the limits and when; whatever the client sends for `id`, `updated_by` and
-- `updated_at` is ignored.
--
-- 1. `on delete set null` is carried out as an UPDATE on team_criteria, and putting the
--    deleted account back would make deleting it fail. So `updated_by` may become null
--    only when that account no longer exists, and that branch changes nothing else —
--    deleting an account is not a change of the limits, so it neither re-signs the row
--    nor bumps the revision.
-- 2. A limit changed: the row is signed by the member writing it, dated now.
-- 3. No limit changed (saving the same values): the previous signature and date stay, so
--    re-saving the form is not reported as a change and does not make audits stale.
--
-- A limit changed outside a member's session (`auth.uid()` null — the SQL editor, a
-- secret key) is refused: a null signature would read as a deleted account, and keeping
-- the previous one would attribute the change to someone who did not make it.
--
-- Reading auth.users needs `security definer`, which is why `search_path` is pinned to
-- empty and every name is schema-qualified. The function is only ever called by the
-- trigger; execute is revoked so it cannot be reached through the Data API as an RPC.

create function public.team_criteria_before_update()
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

  if new.city is distinct from old.city
    or new.price_min is distinct from old.price_min
    or new.price_max is distinct from old.price_max
    or new.area_min is distinct from old.area_min then
    if auth.uid() is null then
      raise exception 'team limits can only be changed by a signed-in member'
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

revoke execute on function public.team_criteria_before_update() from public, anon, authenticated;

create trigger team_criteria_before_update
  before update on public.team_criteria
  for each row
  execute function public.team_criteria_before_update();

-- Member requirements: one free-text field per member (FR-002).

create table public.member_requirements (
  author_id uuid primary key references auth.users (id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- "No requirements" is no row, never an empty one: removing them is a delete.
  constraint member_requirements_not_blank check (body ~ '\S'),
  constraint member_requirements_body_length check (char_length(body) <= 2000)
);

-- Dates and author, as for notes (20260927133501_offer_notes_server_timestamps.sql)
--
-- Insert: both dates are `now()`, whatever the client sent. An upsert is an insert first,
-- so on a conflict the proposed row carries these values into the update trigger, which
-- then keeps `created_at` from the stored row.
--
-- Update: who wrote the requirements and when they were first written are put back from
-- the old row; `updated_at` is set by the database. There is no deleted-account branch:
-- `on delete cascade` deletes the row rather than updating it.
--
-- Neither function reads anything beyond the row it is given, so both run with the
-- caller's rights (no `security definer`). Execute is revoked all the same.

create function public.member_requirements_before_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.created_at := now();
  new.updated_at := now();
  return new;
end;
$$;

revoke execute on function public.member_requirements_before_insert() from public, anon, authenticated;

create trigger member_requirements_before_insert
  before insert on public.member_requirements
  for each row
  execute function public.member_requirements_before_insert();

create function public.member_requirements_before_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.author_id := old.author_id;
  new.created_at := old.created_at;
  new.updated_at := now();
  return new;
end;
$$;

revoke execute on function public.member_requirements_before_update() from public, anon, authenticated;

create trigger member_requirements_before_update
  before update on public.member_requirements
  for each row
  execute function public.member_requirements_before_update();

-- Criteria revision
--
-- A single counter that grows by one on every real change of the criteria: a limit
-- changed, requirements added, edited or deleted — account deletion included, since it
-- deletes that member's requirements. An audit records the revision it was made under;
-- a different revision later means the audit is stale (FR-003). The counter is a fact of
-- the database, not of any client: it is written only by the `security definer` function
-- below, fired from `after` triggers on both criteria tables, and only when a value
-- actually differs (`is distinct from`) — saving the same values changes nothing.
--
-- The counter lives in its own row rather than on team_criteria: there, the signature
-- trigger above would have to tell a member's write from the bump.

create table public.criteria_revision (
  id boolean primary key default true,
  revision bigint not null default 0,
  changed_at timestamptz not null default now(),

  constraint criteria_revision_singleton check (id)
);

insert into public.criteria_revision (id) values (true);

-- Members have no write policy on criteria_revision (below), so the function runs as its
-- owner: `security definer`, with `search_path` pinned to empty and every name
-- schema-qualified. It is only ever called by the triggers; execute is revoked so it
-- cannot be reached through the Data API as an RPC.

create function public.bump_criteria_revision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.criteria_revision
  set revision = revision + 1,
      changed_at = now()
  where id;
  return null;
end;
$$;

revoke execute on function public.bump_criteria_revision() from public, anon, authenticated;

create trigger team_criteria_bump_revision
  after update on public.team_criteria
  for each row
  when (
    old.city is distinct from new.city
    or old.price_min is distinct from new.price_min
    or old.price_max is distinct from new.price_max
    or old.area_min is distinct from new.area_min
  )
  execute function public.bump_criteria_revision();

create trigger member_requirements_bump_revision_on_insert
  after insert on public.member_requirements
  for each row
  execute function public.bump_criteria_revision();

create trigger member_requirements_bump_revision_on_update
  after update on public.member_requirements
  for each row
  when (old.body is distinct from new.body)
  execute function public.bump_criteria_revision();

create trigger member_requirements_bump_revision_on_delete
  after delete on public.member_requirements
  for each row
  execute function public.bump_criteria_revision();

-- Row Level Security
--
-- Supabase grants select/insert/update/delete on every new public table to `anon`
-- and `authenticated` automatically, so these policies are the single access gate.
--
-- There is intentionally no policy for `anon`: unauthenticated visitors get nothing.
-- Denial signature: with RLS on and no matching `select` policy a query returns an
-- empty array with HTTP 200, not a permission error; a blocked write fails with
-- "new row violates row-level security policy" (an update or delete with no matching
-- policy simply matches no row). Fix the policy, never reach for a secret /
-- service_role key.

alter table public.team_criteria enable row level security;
alter table public.member_requirements enable row level security;
alter table public.criteria_revision enable row level security;

-- team_criteria
--
-- There are intentionally no insert or delete policies: the singleton exists from this
-- migration, and removing the limits (FR-003) is an update that writes nulls. The denial
-- is the design, not a gap to fill.

-- FR-002: every signed-in member reads the team's limits.
create policy team_criteria_select_authenticated
  on public.team_criteria
  for select
  to authenticated
  using (auth.uid() is not null);

-- FR-002, FR-003, flat roles: any member edits the limits. The check deliberately does
-- not require `updated_by = auth.uid()`: WITH CHECK sees the row after the `before`
-- trigger, and saving the same values keeps the previous member's signature, which such a
-- check would reject. The trigger, not the policy, guarantees the signature.
create policy team_criteria_update_authenticated
  on public.team_criteria
  for update
  to authenticated
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

-- member_requirements

-- FR-002: every signed-in member reads every member's requirements.
--
-- Saving requirements is an upsert, and `INSERT ... ON CONFLICT DO UPDATE` checks the
-- `select` policy against both the existing and the new row. Narrowing this policy would
-- break saving with "new row violates row-level security policy".
create policy member_requirements_select_authenticated
  on public.member_requirements
  for select
  to authenticated
  using (auth.uid() is not null);

-- FR-002: a member's requirements are always written by that member.
create policy member_requirements_insert_own
  on public.member_requirements
  for insert
  to authenticated
  with check (author_id = auth.uid());

-- FR-003: only the author edits their requirements.
create policy member_requirements_update_own
  on public.member_requirements
  for update
  to authenticated
  using (author_id = auth.uid())
  with check (author_id = auth.uid());

-- FR-003: only the author deletes their requirements.
create policy member_requirements_delete_own
  on public.member_requirements
  for delete
  to authenticated
  using (author_id = auth.uid());

-- criteria_revision
--
-- There are intentionally no insert, update or delete policies: the counter is written
-- only by the `security definer` trigger function above. The denial is the design, not a
-- gap to fill.

-- Every signed-in member reads the revision (the audit records it, S-04).
create policy criteria_revision_select_authenticated
  on public.criteria_revision
  for select
  to authenticated
  using (auth.uid() is not null);

-- Anonymous sign-ins
--
-- The policies above test `auth.uid() is not null` or compare `author_id` with
-- `auth.uid()`. An anonymous Supabase user also gets the `authenticated` role and a uid,
-- so it could read every criterion, change the team's limits and write requirements of
-- its own; these policies hold only while `enable_anonymous_sign_ins` stays false
-- (supabase/config.toml, and the hosted project's Auth settings). Turning it on requires
-- rewriting every policy on these tables first, as for offers
-- (20260923153747_offers_keep_after_author_deleted.sql).
