-- Offer audits: one row per offer, holding the last AI audit of the listing that succeeded
-- (FR-010, FR-011) and the state of the latest attempt to make one.
--
-- Two groups of columns share the row on purpose. The attempt (`run_*`) says whether an
-- audit is running, finished or failed, since when and started by whom. The result
-- (`findings` and everything after it) is what the last successful attempt found, and
-- under which model, effort, criteria and listing text. A re-run that fails changes the
-- attempt and leaves the result alone, so the team keeps reading the previous findings
-- next to the reason the new attempt failed. There is no history: a successful re-run
-- replaces the result.
--
-- The triggers below, not the client, own the dates, the people and the allowed moves
-- between states. That is what makes two things facts of the database rather than of
-- whoever is calling: one offer has at most one audit running at a time, whichever
-- request gets there first, and an attempt whose request died does not stay "running"
-- for ever.
--
-- `offer_id ... on delete cascade`: an audit goes with its offer, and that is the only
-- way one is removed — there is no delete policy, and nothing expires on its own (PRD,
-- Guardrails).
--
-- `run_started_by` and `audited_by ... on delete set null`: an audit belongs to the team
-- and outlives the account of whoever ran it, as an offer outlives its author
-- (20260923153747_offers_keep_after_author_deleted.sql). A null in either column means
-- "that member's account was deleted" and nothing else: a new attempt always has a
-- starter, and a result is always signed by the member whose attempt produced it.
--
-- `criteria_revision` and `listing_fingerprint` record what the audit was made against,
-- for S-09 to compare. Nothing in this migration flags an audit stale, re-runs one or
-- removes one.

create table public.offer_audits (
  offer_id uuid primary key references public.offers (id) on delete cascade,

  -- the latest attempt
  run_state text not null,
  run_started_at timestamptz not null,
  run_started_by uuid references auth.users (id) on delete set null,
  run_failure text,                      -- why the latest attempt failed; null otherwise

  -- the last successful result: null = this offer has never been audited
  findings jsonb,
  rejected_count integer,                -- findings dropped because their excerpt is not in the listing
  audited_at timestamptz,
  audited_by uuid references auth.users (id) on delete set null,
  model text,
  effort text,
  criteria_revision bigint,              -- criteria_revision.revision the audit was made under
  listing_fingerprint text,              -- of the listing text the audit read
  had_limits boolean,
  requirements_count integer,

  constraint offer_audits_run_state_known
    check (run_state in ('running', 'completed', 'failed')),

  -- A result is whole or absent: "audited" must never be read off a row that holds half
  -- of one. `audited_by` stays out of the count, because a deleted account leaves it null
  -- beside a result that is otherwise complete.
  constraint offer_audits_result_whole_or_absent
    check (
      num_nulls(
        findings, rejected_count, audited_at, model, effort,
        criteria_revision, listing_fingerprint, had_limits, requirements_count
      ) in (0, 9)
    )
);

-- Starting an attempt
--
-- A row is created by starting the offer's first attempt and in no other way: the state
-- is `running`, the start is `now()`, the starter is the member writing, and the result
-- is empty — whatever the client sent for any of them. A row arriving as `completed` or
-- `failed` would be a result or a failure nobody produced, and one written outside a
-- member's session (`auth.uid()` null — the SQL editor, a secret key) would be an attempt
-- with no starter, which reads as a deleted account; both are refused.
--
-- The offer's second and later attempts are updates of this row (below). The primary key
-- is what turns a second insert away, with a unique violation.
--
-- The function is only ever called by the trigger; execute is revoked so it cannot be
-- reached through the Data API as an RPC.

create function public.offer_audits_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'an audit can only be started by a signed-in member'
      using errcode = '42501';
  end if;
  if new.run_state is distinct from 'running' then
    raise exception 'an audit row is created by starting an attempt, in the state running'
      using errcode = '23514';
  end if;

  new.run_started_at := now();
  new.run_started_by := auth.uid();
  new.run_failure := null;

  new.findings := null;
  new.rejected_count := null;
  new.audited_at := null;
  new.audited_by := null;
  new.model := null;
  new.effort := null;
  new.criteria_revision := null;
  new.listing_fingerprint := null;
  new.had_limits := null;
  new.requirements_count := null;
  return new;
end;
$$;

revoke execute on function public.offer_audits_before_insert() from public, anon, authenticated;

create trigger offer_audits_before_insert
  before insert on public.offer_audits
  for each row
  execute function public.offer_audits_before_insert();

-- Allowed moves on update
--
-- An update policy cannot compare the new value with the old one, so the trigger decides
-- what an update may do. In the order the function checks them:
--
-- 1. Account deletion. `on delete set null` is carried out as an UPDATE on offer_audits,
--    and putting the deleted account back would make deleting it fail. So a person column
--    may become null only when that account no longer exists, and that branch changes
--    nothing else — no date, no state. This row has two such columns, and Postgres runs
--    one UPDATE per foreign key: during the first, the other column still holds the
--    deleted account's id. Each column is therefore judged on its own, and this branch
--    comes before every rule below — rule 6 would put the id back, and rule 2 would
--    refuse the UPDATE outright when the deleted member's attempt is still running.
-- 2. An update to `running` while an attempt has been running for less than 175 seconds
--    is refused with SQLSTATE `VP001`. This is the concurrency lock: of two requests to
--    audit one offer, the second gets this error instead of a second paid model call. It
--    holds for the member who started the attempt as much as for anyone else.
-- 3. Any other update to `running` takes the row over for a new attempt: the previous one
--    completed, failed, or has been running for 175 seconds or longer, which means its
--    request is gone. Start and starter are set as on insert, the failure is cleared, and
--    the result stays as it was.
-- 4. `running` to `completed` stores the result from the new row, dated now and signed by
--    the member who started the attempt — not by whoever sends the write. A result with
--    a column missing is refused.
-- 5. `running` to `failed` stores the reason, which must not be blank, and leaves the
--    result as it was.
-- 6. Anything else changes nothing: `offer_id`, the attempt and the result are put back
--    from the old row. A member's PATCH of `findings` on a completed audit is accepted
--    and undone, as a PATCH of a note's author is.
--
-- The 175 seconds stand between two other limits, and the order is what matters: the
-- model call is abandoned after 165 seconds, so a live request never loses its row to a
-- takeover, and the browser gives up after 180, so a card reloaded then reads the attempt
-- as interrupted and may start another. The three constants live in `src/lib/audit/`;
-- change this one only together with them.
--
-- `VP001` is this project's own SQLSTATE, the first one: the class `VP` is not used by
-- Postgres, and the Data API hands the code to the caller as it is, so the application
-- tells "an audit is already running" from every other refusal by the code alone.
--
-- A takeover outside a member's session is refused, as on insert. Reading auth.users
-- needs `security definer`, which is why `search_path` is pinned to empty and every name
-- is schema-qualified. The function is only ever called by the trigger; execute is
-- revoked so it cannot be reached through the Data API as an RPC.

create function public.offer_audits_before_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  starter_deleted boolean;
  auditor_deleted boolean;
  failure text;
begin
  starter_deleted := new.run_started_by is null
    and old.run_started_by is not null
    and not exists (select 1 from auth.users where id = old.run_started_by);
  auditor_deleted := new.audited_by is null
    and old.audited_by is not null
    and not exists (select 1 from auth.users where id = old.audited_by);

  if starter_deleted or auditor_deleted then
    new := old;
    if starter_deleted then
      new.run_started_by := null;
    end if;
    if auditor_deleted then
      new.audited_by := null;
    end if;
    return new;
  end if;

  if new.run_state = 'running' then
    if old.run_state = 'running'
      and old.run_started_at > now() - interval '175 seconds' then
      raise exception 'an audit of this offer is already running'
        using errcode = 'VP001';
    end if;
    if auth.uid() is null then
      raise exception 'an audit can only be started by a signed-in member'
        using errcode = '42501';
    end if;
    new := old;
    new.run_state := 'running';
    new.run_started_at := now();
    new.run_started_by := auth.uid();
    new.run_failure := null;
    return new;
  end if;

  if old.run_state = 'running' and new.run_state = 'completed' then
    if num_nulls(
      new.findings, new.rejected_count, new.model, new.effort,
      new.criteria_revision, new.listing_fingerprint, new.had_limits, new.requirements_count
    ) > 0 then
      raise exception 'a completed audit carries its whole result'
        using errcode = '23514';
    end if;
    new.offer_id := old.offer_id;
    new.run_started_at := old.run_started_at;
    new.run_started_by := old.run_started_by;
    new.run_failure := null;
    new.audited_at := now();
    new.audited_by := old.run_started_by;
    return new;
  end if;

  if old.run_state = 'running' and new.run_state = 'failed' then
    if new.run_failure is null or new.run_failure !~ '\S' then
      raise exception 'a failed audit attempt names its failure'
        using errcode = '23514';
    end if;
    failure := new.run_failure;
    new := old;
    new.run_state := 'failed';
    new.run_failure := failure;
    return new;
  end if;

  new := old;
  return new;
end;
$$;

revoke execute on function public.offer_audits_before_update() from public, anon, authenticated;

create trigger offer_audits_before_update
  before update on public.offer_audits
  for each row
  execute function public.offer_audits_before_update();

-- Row Level Security
--
-- Supabase grants select/insert/update/delete on every new public table to `anon`
-- and `authenticated` automatically, so these policies are the single access gate.
--
-- There is intentionally no policy for `anon`: unauthenticated visitors get nothing.
-- There is intentionally no delete policy: an audit is removed only with its offer, by
-- the cascade. The denial is the design, not a gap to fill.
--
-- Denial signature: with RLS on and no matching `select` policy a query returns an
-- empty array with HTTP 200, not a permission error; a blocked write fails with
-- "new row violates row-level security policy" (an update or delete with no matching
-- policy simply matches no row). Fix the policy, never reach for a secret /
-- service_role key.

alter table public.offer_audits enable row level security;

-- FR-011: every signed-in member reads every audit, and sees an attempt in progress.
create policy offer_audits_select_authenticated
  on public.offer_audits
  for select
  to authenticated
  using (auth.uid() is not null);

-- FR-010: the starter of an attempt is always the member starting it. WITH CHECK sees the
-- row after the `before` trigger, which has already set `run_started_by` from
-- `auth.uid()`; the check holds the same rule in the policy.
create policy offer_audits_insert_authenticated
  on public.offer_audits
  for insert
  to authenticated
  with check (run_started_by = auth.uid());

-- FR-010, flat roles: any member re-runs an audit, whoever ran the previous one. The
-- check deliberately does not require `run_started_by = auth.uid()`: an update the
-- trigger undoes keeps the previous starter, and so does the write that completes or
-- fails an attempt. The trigger, not the policy, guarantees who started and who audited.
create policy offer_audits_update_authenticated
  on public.offer_audits
  for update
  to authenticated
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

-- Anonymous sign-ins
--
-- The policies above test `auth.uid() is not null` or compare `run_started_by` with
-- `auth.uid()`. An anonymous Supabase user also gets the `authenticated` role and a uid,
-- so it could read every audit and start attempts of its own; these policies hold only
-- while `enable_anonymous_sign_ins` stays false (supabase/config.toml, and the hosted
-- project's Auth settings). Turning it on requires rewriting every policy on this table
-- first, as for offers (20260923153747_offers_keep_after_author_deleted.sql).
