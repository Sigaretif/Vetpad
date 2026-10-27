-- Commute points (FR-016): the team's named places — a workplace, a school, the parents' flat — to
-- which a member may ask for the travel time from an offer, on its card. Each point is a name and an
-- address. The team keeps at most six; the seventh is refused by the database, not only by the form.
--
-- A point belongs to the team, not to a member: any member adds, edits and deletes any point (prd.md,
-- FR-016; flat roles, as on `offers`). That is why the table has no author column and nothing here
-- references auth.users — there is no signature to keep and no account whose deletion could touch a
-- point.
--
-- Nothing Google returns is stored, here or anywhere: no place id, no coordinates, no time. A point is
-- what the member typed. Its address goes only to Google Routes, from the Worker, on a member's
-- deliberate calculation — never to the model provider: the audit cannot import the module that reads
-- this table (`auditNoNotesConfig` in eslint.config.js), and the audit's criteria are read through
-- `loadAuditCriteria` alone.
--
-- Points are not criteria: no trigger here touches `criteria_revision`, so adding or editing a point
-- never marks an audit stale.

create table public.commute_points (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- The name heads a row of the commute table on the card, so it is short and has no surrounding
  -- whitespace. Mirrored by COMMUTE_POINT_NAME_MAX_LENGTH in src/lib/commute/points.ts.
  constraint commute_points_name_length
    check (char_length(btrim(name)) between 1 and 60 and name = btrim(name)),
  -- Mirrored by COMMUTE_POINT_ADDRESS_MAX_LENGTH in src/lib/commute/points.ts.
  constraint commute_points_address_length
    check (char_length(btrim(address)) between 1 and 200)
);

-- The cap of six, and the dates
--
-- At most six points: each calculation asks Google twice per point (public transport and car), and
-- six points keep one press within the Worker's subrequest limit and the team's daily allowance
-- (supabase/migrations/20261027081817_create_commute_usage.sql). The cap stands in the database so the
-- Data API cannot walk around it: any member may insert through it with the publishable key.
--
-- Two members adding a point at the same moment must not both see five rows and make eight, so the
-- insert takes a transaction-level advisory lock before it counts: the second insert waits for the
-- first transaction to end and then counts its row. The count must see every row whatever a policy
-- would filter, so the function runs as its owner: `security definer`, with `search_path` pinned to
-- empty and every name schema-qualified. Execute is revoked so it cannot be reached through the Data
-- API as an RPC.
--
-- `VP002` is this project's own SQLSTATE, the second one (`VP001` is the audit's lock): the Data API
-- hands the code to the caller as it is, so POST /api/commute-points tells "the team already has six
-- points" from every other refusal by the code alone. Mirrored by COMMUTE_POINTS_MAX in
-- src/lib/commute/points.ts.
--
-- Insert: both dates are `now()`, whatever the client sent (as for notes,
-- 20260927133501_offer_notes_server_timestamps.sql).

create function public.commute_points_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtext('public.commute_points'));
  if (select count(*) from public.commute_points) >= 6 then
    raise exception 'the team already has the maximum number of commute points'
      using errcode = 'VP002';
  end if;
  new.created_at := now();
  new.updated_at := now();
  return new;
end;
$$;

revoke execute on function public.commute_points_before_insert() from public, anon, authenticated;

create trigger commute_points_before_insert
  before insert on public.commute_points
  for each row
  execute function public.commute_points_before_insert();

-- Update: a point keeps its id and the date it was added; the edit date is the database's.

create function public.commute_points_before_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.id := old.id;
  new.created_at := old.created_at;
  new.updated_at := now();
  return new;
end;
$$;

revoke execute on function public.commute_points_before_update() from public, anon, authenticated;

create trigger commute_points_before_update
  before update on public.commute_points
  for each row
  execute function public.commute_points_before_update();

-- Row Level Security
--
-- Supabase grants select/insert/update/delete on every new public table to `anon`
-- and `authenticated` automatically, so these policies are the single access gate.
--
-- There is intentionally no policy for `anon`: unauthenticated visitors get nothing.
-- Denial signature: with RLS on and no matching `select` policy a query returns an
-- empty array with HTTP 200, not a permission error; a blocked write fails with
-- "new row violates row-level security policy". Fix the policy, never reach for a
-- secret / service_role key.
--
-- Flat roles (prd.md, FR-016): every signed-in member has full CRUD on every point. A signed-in
-- session is the only restriction, exactly as on `offers`.

alter table public.commute_points enable row level security;

-- FR-016: every signed-in member reads the team's points.
create policy commute_points_select_authenticated
  on public.commute_points
  for select
  to authenticated
  using (auth.uid() is not null);

-- FR-016: any member adds a point, up to the cap the trigger above holds.
create policy commute_points_insert_authenticated
  on public.commute_points
  for insert
  to authenticated
  with check (auth.uid() is not null);

-- FR-016: any member edits any point.
create policy commute_points_update_authenticated
  on public.commute_points
  for update
  to authenticated
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

-- FR-016: any member deletes any point.
create policy commute_points_delete_authenticated
  on public.commute_points
  for delete
  to authenticated
  using (auth.uid() is not null);

-- Anonymous sign-ins
--
-- The policies above test `auth.uid() is not null`. An anonymous Supabase user also gets the
-- `authenticated` role and a uid, so they hold only while `enable_anonymous_sign_ins` stays false
-- (supabase/config.toml, and the hosted project's Auth settings). Turning it on requires rewriting
-- them first, as for offers (20260923153747_offers_keep_after_author_deleted.sql).
