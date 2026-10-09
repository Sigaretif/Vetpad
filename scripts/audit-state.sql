-- Audit state: the moves public.offer_audits allows between "running", "completed" and "failed", and who owns the
-- dates and the people on the row (FR-010; supabase/migrations/20261007073300_create_offer_audits.sql). One offer has
-- one audit running at a time, an attempt whose request died can be taken over after 175 seconds and not a second
-- sooner, a failed re-run leaves the previous result alone, and nobody writes a result, a date or a signature by
-- hand. These rules live in triggers and depend on time, and the publishable key can neither age an attempt nor wait
-- three minutes for one, so scripts/smoke.mjs cannot cover them.
--
-- The whole file is one transaction that ends in ROLLBACK: it leaves no trace, whether it passes or fails (psql
-- stops at the first error and the open transaction dies with the connection). Every check is a DO block that
-- raises `audit-state: [<check name>] ...` when it does not hold. The checks build on one another: each starts from
-- the row the one before it left.
-- The first check refuses a database without the seeded accounts. That tests for the seed, not for the host: it
-- keeps the script off a database nobody seeded, and the ROLLBACK is what keeps any database unchanged.
-- No service_role / secret key: it connects to the local Postgres with its published local password.
-- Run against a local Supabase: npm run test:db (DB_URL overrides the Supabase CLI's default local address).

begin;

-- Refuse a database without the seeded accounts. Nothing has been written yet.
do $$
begin
  if (
    select count(*)
    from auth.users
    where email in ('sigaretif1@vetpad.local', 'sigaretif2@vetpad.local')
  ) <> 2 then
    raise exception 'audit-state: [seeded accounts exist] sigaretif1@vetpad.local and sigaretif2@vetpad.local are required - this is not a local database seeded by supabase/seed.sql, refusing to run';
  end if;
end $$;

-- A member's session, for the triggers that read auth.uid(): the account's claims, or none for an empty email.
-- The function lives in pg_temp and is created inside the transaction, so the ROLLBACK takes it too.
create function pg_temp.sign_in(account text)
returns void
language plpgsql
as $$
begin
  if account = '' then
    perform set_config('request.jwt.claims', '', true);
    return;
  end if;
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', (select id from auth.users where email = account), 'role', 'authenticated')::text,
    true
  );
  if auth.uid() is null then
    raise exception 'audit-state: [fixture: member session] auth.uid() is null under the claims of %', account;
  end if;
end $$;

-- Fixture. One offer, saved by the first member ("starter", sigaretif1); the second member is "other".
do $$
begin
  insert into public.offers (id, source_url, otodom_id, created_by, title, description, raw)
  values (
    'a0d17000-0000-4000-8000-000000000001', 'https://example.com/audit-state/offer', -740001,
    (select id from auth.users where email = 'sigaretif1@vetpad.local'),
    'Audit state fixture: the audited offer', 'Fixture description.', '{}'::jsonb
  );
end $$;

-- A row is created by a member starting an attempt, and in no other way: not outside a session, and not as a
-- result or a failure nobody produced.
do $$
declare
  refused text;
  forged_state text;
begin
  perform pg_temp.sign_in('');
  begin
    insert into public.offer_audits (offer_id, run_state) values ('a0d17000-0000-4000-8000-000000000001', 'running');
  exception when others then
    refused := sqlstate;
  end;
  if refused is distinct from '42501' then
    raise exception 'audit-state: [insert outside a member''s session is refused] expected 42501, got %', coalesce(refused, 'no error');
  end if;

  perform pg_temp.sign_in('sigaretif1@vetpad.local');
  foreach forged_state in array array['completed', 'failed'] loop
    refused := null;
    begin
      insert into public.offer_audits (
        offer_id, run_state, run_failure, findings, rejected_count, model, effort,
        criteria_revision, listing_fingerprint, had_limits, requirements_count
      )
      values (
        'a0d17000-0000-4000-8000-000000000001', forged_state, 'forged', '{"forged": true}'::jsonb, 0, 'forged', 'forged',
        1, 'forged', false, 0
      );
    exception when others then
      refused := sqlstate;
    end;
    if refused is distinct from '23514' then
      raise exception 'audit-state: [insert in a state other than running is refused] % expected 23514, got %', forged_state, coalesce(refused, 'no error');
    end if;
  end loop;

  if exists (select 1 from public.offer_audits where offer_id = 'a0d17000-0000-4000-8000-000000000001') then
    raise exception 'audit-state: [a refused insert stores nothing] an audit row is there';
  end if;
end $$;

-- The starter starts the first attempt, sending another member as the starter and the auditor, dates of their own
-- and a whole result. The database keeps none of it.
do $$
declare
  starter uuid := (select id from auth.users where email = 'sigaretif1@vetpad.local');
  other uuid := (select id from auth.users where email = 'sigaretif2@vetpad.local');
  stored public.offer_audits;
begin
  perform pg_temp.sign_in('sigaretif1@vetpad.local');
  insert into public.offer_audits (
    offer_id, run_state, run_started_at, run_started_by, run_failure,
    findings, rejected_count, audited_at, audited_by, model, effort,
    criteria_revision, listing_fingerprint, had_limits, requirements_count
  )
  values (
    'a0d17000-0000-4000-8000-000000000001', 'running', '2000-01-01T00:00:00Z', other, 'forged',
    '{"forged": true}'::jsonb, 9, '2000-01-01T00:00:00Z', other, 'forged', 'forged',
    99, 'forged', true, 9
  );
  select * into stored from public.offer_audits where offer_id = 'a0d17000-0000-4000-8000-000000000001';

  if stored.run_started_at is distinct from now() or stored.run_started_by is distinct from starter then
    raise exception 'audit-state: [insert ignores the client''s start and starter] run_started_at is %, run_started_by is %, expected % and %',
      stored.run_started_at, stored.run_started_by, now(), starter;
  end if;
  if stored.run_failure is not null
    or stored.audited_by is not null
    or num_nulls(
      stored.findings, stored.rejected_count, stored.audited_at, stored.model, stored.effort,
      stored.criteria_revision, stored.listing_fingerprint, stored.had_limits, stored.requirements_count
    ) <> 9 then
    raise exception 'audit-state: [insert ignores the client''s result, auditor and failure] the row is %', to_jsonb(stored);
  end if;
end $$;

-- The lock. While the attempt runs, nobody starts another: not the other member, and not the starter, whose second
-- request is the double click the lock is there for. The row is the same afterwards.
do $$
declare
  before_row jsonb := (select to_jsonb(a) from public.offer_audits a where a.offer_id = 'a0d17000-0000-4000-8000-000000000001');
  claimant text;
  refused text;
begin
  foreach claimant in array array['sigaretif2@vetpad.local', 'sigaretif1@vetpad.local'] loop
    perform pg_temp.sign_in(claimant);
    refused := null;
    begin
      update public.offer_audits set run_state = 'running' where offer_id = 'a0d17000-0000-4000-8000-000000000001';
    exception when others then
      refused := sqlstate;
    end;
    if refused is distinct from 'VP001' then
      raise exception 'audit-state: [a running attempt cannot be taken over] as % expected VP001, got %', claimant, coalesce(refused, 'no error');
    end if;
  end loop;

  if (select to_jsonb(a) from public.offer_audits a where a.offer_id = 'a0d17000-0000-4000-8000-000000000001') is distinct from before_row then
    raise exception 'audit-state: [a refused takeover changes nothing] before: %, after: %',
      before_row, (select to_jsonb(a) from public.offer_audits a where a.offer_id = 'a0d17000-0000-4000-8000-000000000001');
  end if;
end $$;

-- An attempt completes only with a whole result: one column short, and the write is refused.
do $$
declare
  refused text;
begin
  perform pg_temp.sign_in('sigaretif1@vetpad.local');
  begin
    update public.offer_audits
    set run_state = 'completed', findings = '{"version": 1}'::jsonb, rejected_count = 0, model = 'claude-opus-5-5',
        effort = 'medium', criteria_revision = 7, listing_fingerprint = 'v1:fixture', had_limits = true
    where offer_id = 'a0d17000-0000-4000-8000-000000000001';
  exception when others then
    refused := sqlstate;
  end;
  if refused is distinct from '23514' then
    raise exception 'audit-state: [completing without a whole result is refused] expected 23514, got %', coalesce(refused, 'no error');
  end if;
  if (select run_state from public.offer_audits where offer_id = 'a0d17000-0000-4000-8000-000000000001') <> 'running' then
    raise exception 'audit-state: [a refused completion leaves the attempt running] run_state is %',
      (select run_state from public.offer_audits where offer_id = 'a0d17000-0000-4000-8000-000000000001');
  end if;
end $$;

-- An attempt is ended only by the member who started it: the other member's result, and the other member's
-- failure, are accepted and change nothing (supabase/migrations/20261009191000_offer_audits_ended_by_starter.sql).
-- Without this, findings a member wrote by hand would be stored under the starter's name.
do $$
declare
  before_row jsonb := (select to_jsonb(a) from public.offer_audits a where a.offer_id = 'a0d17000-0000-4000-8000-000000000001');
  touched integer;
begin
  if before_row ->> 'run_state' <> 'running' then
    raise exception 'audit-state: [fixture: a running attempt] the row is %', before_row;
  end if;

  perform pg_temp.sign_in('sigaretif2@vetpad.local');
  begin
    update public.offer_audits
    set run_state = 'completed', findings = '{"forged": true}'::jsonb, rejected_count = 0,
        model = 'claude-opus-5-5', effort = 'medium', criteria_revision = 1, listing_fingerprint = 'v1:forged',
        had_limits = false, requirements_count = 0
    where offer_id = 'a0d17000-0000-4000-8000-000000000001';
    get diagnostics touched = row_count;
  exception when others then
    raise exception 'audit-state: [another member''s result is accepted] the write was not undone, it failed with: % (%)', sqlerrm, sqlstate;
  end;
  if touched <> 1 then
    raise exception 'audit-state: [another member''s result is accepted] the update touched % row(s), expected 1 - nothing was attempted', touched;
  end if;
  if (select to_jsonb(a) from public.offer_audits a where a.offer_id = 'a0d17000-0000-4000-8000-000000000001') is distinct from before_row then
    raise exception 'audit-state: [another member cannot complete a running attempt] before: %, after: %',
      before_row, (select to_jsonb(a) from public.offer_audits a where a.offer_id = 'a0d17000-0000-4000-8000-000000000001');
  end if;

  update public.offer_audits set run_state = 'failed', run_failure = 'forged'
  where offer_id = 'a0d17000-0000-4000-8000-000000000001';
  get diagnostics touched = row_count;
  if touched <> 1 then
    raise exception 'audit-state: [another member''s failure is accepted] the update touched % row(s), expected 1 - nothing was attempted', touched;
  end if;
  if (select to_jsonb(a) from public.offer_audits a where a.offer_id = 'a0d17000-0000-4000-8000-000000000001') is distinct from before_row then
    raise exception 'audit-state: [another member cannot fail a running attempt] before: %, after: %',
      before_row, (select to_jsonb(a) from public.offer_audits a where a.offer_id = 'a0d17000-0000-4000-8000-000000000001');
  end if;
end $$;

-- running -> completed. The write comes from the starter's session and claims a date, another auditor and another
-- starter: the result is stored as sent, dated by the database and signed by the member who started the attempt.
do $$
declare
  starter uuid := (select id from auth.users where email = 'sigaretif1@vetpad.local');
  other uuid := (select id from auth.users where email = 'sigaretif2@vetpad.local');
  stored public.offer_audits;
begin
  perform pg_temp.sign_in('sigaretif1@vetpad.local');
  update public.offer_audits
  set run_state = 'completed', findings = '{"version": 1, "fixture": "first result"}'::jsonb, rejected_count = 2,
      model = 'claude-opus-5-5', effort = 'medium', criteria_revision = 7, listing_fingerprint = 'v1:fixture',
      had_limits = true, requirements_count = 3,
      audited_at = '2000-01-01T00:00:00Z', audited_by = other, run_started_by = other, run_started_at = '2000-01-01T00:00:00Z'
  where offer_id = 'a0d17000-0000-4000-8000-000000000001';
  select * into stored from public.offer_audits where offer_id = 'a0d17000-0000-4000-8000-000000000001';

  if stored.run_state <> 'completed' or stored.run_failure is not null then
    raise exception 'audit-state: [running to completed is stored] run_state is %, run_failure is %', stored.run_state, stored.run_failure;
  end if;
  if stored.findings is distinct from '{"version": 1, "fixture": "first result"}'::jsonb
    or stored.rejected_count is distinct from 2
    or stored.model is distinct from 'claude-opus-5-5'
    or stored.effort is distinct from 'medium'
    or stored.criteria_revision is distinct from 7
    or stored.listing_fingerprint is distinct from 'v1:fixture'
    or stored.had_limits is distinct from true
    or stored.requirements_count is distinct from 3 then
    raise exception 'audit-state: [completed stores the result as sent] the row is %', to_jsonb(stored);
  end if;
  if stored.audited_at is distinct from now() or stored.audited_by is distinct from starter then
    raise exception 'audit-state: [completed is dated by the database and signed by the starter] audited_at is %, audited_by is %, expected % and %',
      stored.audited_at, stored.audited_by, now(), starter;
  end if;
  if stored.run_started_at is distinct from now() or stored.run_started_by is distinct from starter then
    raise exception 'audit-state: [completed keeps the attempt''s start and starter] run_started_at is %, run_started_by is %',
      stored.run_started_at, stored.run_started_by;
  end if;
end $$;

-- A completed audit is not edited: a write to its findings, its signature and its dates that does not start a new
-- attempt is accepted and changes nothing, and so is a jump straight to "failed".
do $$
declare
  before_row jsonb := (select to_jsonb(a) from public.offer_audits a where a.offer_id = 'a0d17000-0000-4000-8000-000000000001');
  other uuid := (select id from auth.users where email = 'sigaretif2@vetpad.local');
  touched integer;
begin
  perform pg_temp.sign_in('sigaretif2@vetpad.local');
  begin
    update public.offer_audits
    set findings = '{"forged": true}'::jsonb, rejected_count = 0, audited_by = other, audited_at = '2099-01-01T00:00:00Z',
        run_started_by = other, offer_id = 'a0d17000-0000-4000-8000-0000000000ff'
    where offer_id = 'a0d17000-0000-4000-8000-000000000001';
    get diagnostics touched = row_count;
  exception when others then
    raise exception 'audit-state: [a write to a completed audit is accepted] the write was not undone, it failed with: % (%)', sqlerrm, sqlstate;
  end;
  if touched <> 1 then
    raise exception 'audit-state: [a write to a completed audit is accepted] the update touched % row(s), expected 1 - nothing was attempted', touched;
  end if;

  update public.offer_audits set run_state = 'failed', run_failure = 'forged'
  where offer_id = 'a0d17000-0000-4000-8000-000000000001';

  if (select to_jsonb(a) from public.offer_audits a where a.offer_id = 'a0d17000-0000-4000-8000-000000000001') is distinct from before_row then
    raise exception 'audit-state: [a write to a completed audit changes nothing] before: %, after: %',
      before_row, (select to_jsonb(a) from public.offer_audits a where a.offer_id = 'a0d17000-0000-4000-8000-000000000001');
  end if;
end $$;

-- A finished audit is re-run at once, by any member: the other member takes the row over for a new attempt, and
-- the result of the previous one stays.
do $$
declare
  before_row jsonb := (select to_jsonb(a) from public.offer_audits a where a.offer_id = 'a0d17000-0000-4000-8000-000000000001');
  other uuid := (select id from auth.users where email = 'sigaretif2@vetpad.local');
  after_row jsonb;
begin
  perform pg_temp.sign_in('sigaretif2@vetpad.local');
  update public.offer_audits set run_state = 'running', findings = '{"forged": true}'::jsonb
  where offer_id = 'a0d17000-0000-4000-8000-000000000001';
  select to_jsonb(a) into after_row from public.offer_audits a where a.offer_id = 'a0d17000-0000-4000-8000-000000000001';

  if after_row ->> 'run_state' <> 'running' or (after_row ->> 'run_started_by')::uuid is distinct from other then
    raise exception 'audit-state: [a completed audit is re-run at once] run_state is %, run_started_by is %, expected running and %',
      after_row ->> 'run_state', after_row ->> 'run_started_by', other;
  end if;
  if after_row - 'run_state' - 'run_started_by' is distinct from before_row - 'run_state' - 'run_started_by' then
    raise exception 'audit-state: [a re-run keeps the previous result] before: %, after: %', before_row, after_row;
  end if;
end $$;

-- Ageing the attempt. `run_started_at` is the database's, so no write a member can make moves it back: the script
-- switches the update trigger off as the table's owner, for one statement. One second short of the threshold the
-- lock still holds.
alter table public.offer_audits disable trigger offer_audits_before_update;
update public.offer_audits set run_started_at = now() - interval '174 seconds'
where offer_id = 'a0d17000-0000-4000-8000-000000000001';
alter table public.offer_audits enable trigger offer_audits_before_update;

do $$
declare
  refused text;
begin
  perform pg_temp.sign_in('sigaretif1@vetpad.local');
  begin
    update public.offer_audits set run_state = 'running' where offer_id = 'a0d17000-0000-4000-8000-000000000001';
  exception when others then
    refused := sqlstate;
  end;
  if refused is distinct from 'VP001' then
    raise exception 'audit-state: [an attempt 174 seconds old cannot be taken over] expected VP001, got %', coalesce(refused, 'no error');
  end if;
end $$;

-- One second past it, the attempt reads as interrupted: the starter takes the row over, the start is now again,
-- and the result of the last successful attempt is exactly as it was.
alter table public.offer_audits disable trigger offer_audits_before_update;
update public.offer_audits set run_started_at = now() - interval '176 seconds'
where offer_id = 'a0d17000-0000-4000-8000-000000000001';
alter table public.offer_audits enable trigger offer_audits_before_update;

do $$
declare
  before_row jsonb := (select to_jsonb(a) from public.offer_audits a where a.offer_id = 'a0d17000-0000-4000-8000-000000000001');
  starter uuid := (select id from auth.users where email = 'sigaretif1@vetpad.local');
  stored public.offer_audits;
begin
  if (before_row ->> 'run_started_at')::timestamptz is distinct from now() - interval '176 seconds' then
    raise exception 'audit-state: [fixture: the attempt is 176 seconds old] run_started_at is %, now is %', before_row ->> 'run_started_at', now();
  end if;

  perform pg_temp.sign_in('sigaretif1@vetpad.local');
  begin
    update public.offer_audits set run_state = 'running', findings = '{"forged": true}'::jsonb
    where offer_id = 'a0d17000-0000-4000-8000-000000000001';
  exception when others then
    raise exception 'audit-state: [an attempt 176 seconds old is taken over] the takeover failed: % (%)', sqlerrm, sqlstate;
  end;
  select * into stored from public.offer_audits where offer_id = 'a0d17000-0000-4000-8000-000000000001';

  if stored.run_state <> 'running'
    or stored.run_started_by is distinct from starter
    or stored.run_started_at is distinct from now()
    or stored.run_failure is not null then
    raise exception 'audit-state: [a takeover starts the attempt anew] run_state is %, run_started_by is %, run_started_at is %, run_failure is %',
      stored.run_state, stored.run_started_by, stored.run_started_at, stored.run_failure;
  end if;
  if to_jsonb(stored) - 'run_started_by' - 'run_started_at' is distinct from before_row - 'run_started_by' - 'run_started_at' then
    raise exception 'audit-state: [a takeover leaves the result alone] before: %, after: %', before_row, to_jsonb(stored);
  end if;
end $$;

-- running -> failed. A failure names its reason; with one, the attempt is failed and the previous result - the
-- one the team is still reading - is the same, whatever the write sent for it.
do $$
declare
  before_row jsonb := (select to_jsonb(a) from public.offer_audits a where a.offer_id = 'a0d17000-0000-4000-8000-000000000001');
  after_row jsonb;
  refused text;
begin
  if before_row ->> 'run_state' <> 'running' or before_row ->> 'findings' is null then
    raise exception 'audit-state: [fixture: a running attempt beside a previous result] the row is % - with no result to keep, "the same" proves nothing', before_row;
  end if;

  perform pg_temp.sign_in('sigaretif1@vetpad.local');
  begin
    update public.offer_audits set run_state = 'failed', run_failure = '   '
    where offer_id = 'a0d17000-0000-4000-8000-000000000001';
  exception when others then
    refused := sqlstate;
  end;
  if refused is distinct from '23514' then
    raise exception 'audit-state: [failing without a reason is refused] expected 23514, got %', coalesce(refused, 'no error');
  end if;

  update public.offer_audits
  set run_state = 'failed', run_failure = 'provider_timeout', findings = '{"forged": true}'::jsonb, audited_at = null
  where offer_id = 'a0d17000-0000-4000-8000-000000000001';
  select to_jsonb(a) into after_row from public.offer_audits a where a.offer_id = 'a0d17000-0000-4000-8000-000000000001';

  if after_row ->> 'run_state' <> 'failed' or after_row ->> 'run_failure' is distinct from 'provider_timeout' then
    raise exception 'audit-state: [running to failed stores the reason] run_state is %, run_failure is %',
      after_row ->> 'run_state', after_row ->> 'run_failure';
  end if;
  if after_row - 'run_state' - 'run_failure' is distinct from before_row - 'run_state' - 'run_failure' then
    raise exception 'audit-state: [a failed re-run keeps the previous result] before: %, after: %', before_row, after_row;
  end if;
end $$;

-- Nobody deletes an audit: it goes only with its offer. As a signed-in member (role `authenticated`, the starter's
-- claims), a delete touches zero rows. The member does see the row (FR-011), so a zero here is the missing delete
-- policy refusing, not a filter that matched nothing.
do $$
begin
  perform pg_temp.sign_in('sigaretif1@vetpad.local');
end $$;

set local role authenticated;

do $$
declare
  touched integer;
begin
  select count(*) into touched from public.offer_audits where offer_id = 'a0d17000-0000-4000-8000-000000000001';
  if touched <> 1 then
    raise exception 'audit-state: [member reads the audit] % of 1 visible to a signed-in member', touched;
  end if;

  delete from public.offer_audits where offer_id = 'a0d17000-0000-4000-8000-000000000001';
  get diagnostics touched = row_count;
  if touched <> 0 then
    raise exception 'audit-state: [nobody deletes an audit] a delete touched % row(s)', touched;
  end if;
end $$;

reset role;

\echo 'audit-state: every check passed; rolling back, nothing is kept'

rollback;
