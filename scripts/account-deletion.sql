-- Account deletion: what is left of a member once their account is gone (PRD, Non-Functional Requirements).
-- A saved offer and a note outlive the account, with no author, and nobody edits the note any more; the member's
-- additional requirements go with the account; the team's limits and audit settings stay as they were, signed by
-- nobody; an audit the member ran stays with its findings, dates and state, started and audited by nobody; every
-- other member's rows are untouched. These are the `on delete` actions hanging off auth.users, which the publishable
-- key cannot reach, so scripts/smoke.mjs cannot cover them. A freeze trigger that puts a deleted author back has
-- already blocked account deletion once (context/foundation/lessons.md, "Declare `on delete` on every author column").
--
-- The whole file is one transaction that ends in ROLLBACK: it deletes the third account from supabase/seed.sql and
-- leaves no trace, whether it passes or fails (psql stops at the first error and the open transaction dies with the
-- connection). Every check is a DO block that raises `account-deletion: [<check name>] ...` when it does not hold.
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
    where email in ('sigaretif1@vetpad.local', 'sigaretif3@vetpad.local')
  ) <> 2 then
    raise exception 'account-deletion: [seeded accounts exist] sigaretif1@vetpad.local and sigaretif3@vetpad.local are required - this is not a local database seeded by supabase/seed.sql, refusing to run';
  end if;
end $$;

-- Fixtures. "Leaving" is sigaretif3, the account deleted below; "staying" is sigaretif1. Two offers, one saved by
-- each; the leaving member has a note on both, the staying member has a note beside it on the leaving member's
-- offer; both have requirements (an upsert, because a local database may already hold some typed by hand). The
-- leaving member changed the limits and the audit settings last and audited both offers; the staying member is
-- re-running the audit of their own.
do $$
declare
  leaving uuid := (select id from auth.users where email = 'sigaretif3@vetpad.local');
  staying uuid := (select id from auth.users where email = 'sigaretif1@vetpad.local');
begin
  insert into public.offers (id, source_url, otodom_id, created_by, title, description, price, price_currency, raw)
  values
    (
      'acc0de1e-0000-4000-8000-000000000003', 'https://example.com/account-deletion/leaving', -730003, leaving,
      'Account deletion fixture: saved by the leaving member', 'Fixture description.', 510000, 'PLN', '{}'::jsonb
    ),
    (
      'acc0de1e-0000-4000-8000-000000000001', 'https://example.com/account-deletion/staying', -730001, staying,
      'Account deletion fixture: saved by the staying member', 'Fixture description.', 620000, 'PLN', '{}'::jsonb
    );

  insert into public.offer_notes (offer_id, author_id, pros, cons, observations)
  values
    ('acc0de1e-0000-4000-8000-000000000003', leaving, 'leaving: pros on own offer', 'leaving: cons', 'leaving: observations'),
    ('acc0de1e-0000-4000-8000-000000000001', leaving, 'leaving: pros on the other offer', '', 'leaving: observations'),
    ('acc0de1e-0000-4000-8000-000000000003', staying, 'staying: pros', 'staying: cons', 'staying: observations');

  insert into public.member_requirements (author_id, body)
  values
    (leaving, 'account-deletion fixture: requirements of the leaving member'),
    (staying, 'account-deletion fixture: requirements of the staying member')
  on conflict (author_id) do update set body = excluded.body;

  -- The limits' signature is set by a trigger from auth.uid(), and only when a limit really changes: the write
  -- carries the leaving member's claims and picks a value the row does not hold yet.
  perform set_config('request.jwt.claims', json_build_object('sub', leaving, 'role', 'authenticated')::text, true);
  update public.team_criteria
  set area_min = case when area_min is distinct from 41 then 41 else 42 end
  where id;
  -- The audit settings are signed the same way: the write picks a model the row does not hold yet.
  update public.audit_settings
  set model = case when model is distinct from 'claude-sonnet-5-5' then 'claude-sonnet-5-5' else 'claude-opus-5-5' end
  where id;

  -- An audit's people are set by triggers too: the starter is auth.uid() when the attempt starts, and the result is
  -- signed by that starter when the attempt completes. The leaving member starts and completes one on each offer.
  insert into public.offer_audits (offer_id, run_state)
  values
    ('acc0de1e-0000-4000-8000-000000000003', 'running'),
    ('acc0de1e-0000-4000-8000-000000000001', 'running');
  update public.offer_audits
  set run_state = 'completed', findings = '{"version": 1, "fixture": "account deletion"}'::jsonb, rejected_count = 1,
      model = 'claude-opus-5-5', effort = 'medium', criteria_revision = 1, listing_fingerprint = 'v1:fixture',
      had_limits = true, requirements_count = 2
  where offer_id in ('acc0de1e-0000-4000-8000-000000000003', 'acc0de1e-0000-4000-8000-000000000001');

  -- The staying member then starts a re-run on their own offer and it is still running: that row names two members,
  -- the staying one as the starter and the leaving one as the auditor of the result it still holds.
  perform set_config('request.jwt.claims', json_build_object('sub', staying, 'role', 'authenticated')::text, true);
  update public.offer_audits set run_state = 'running' where offer_id = 'acc0de1e-0000-4000-8000-000000000001';

  -- The deletion below is an administrator's action, outside any member's session.
  perform set_config('request.jwt.claims', '', true);

  if (select updated_by from public.team_criteria where id) is distinct from leaving then
    raise exception 'account-deletion: [fixture: limits signed by the leaving member] updated_by is %, expected %',
      (select updated_by from public.team_criteria where id), leaving;
  end if;
  if (select updated_by from public.audit_settings where id) is distinct from leaving then
    raise exception 'account-deletion: [fixture: audit settings signed by the leaving member] updated_by is %, expected %',
      (select updated_by from public.audit_settings where id), leaving;
  end if;
  if not exists (
    select 1
    from public.offer_audits
    where offer_id = 'acc0de1e-0000-4000-8000-000000000003'
      and run_state = 'completed' and run_started_by = leaving and audited_by = leaving
  ) then
    raise exception 'account-deletion: [fixture: audit started and completed by the leaving member] the row is %',
      (select to_jsonb(a) from public.offer_audits a where a.offer_id = 'acc0de1e-0000-4000-8000-000000000003');
  end if;
  if not exists (
    select 1
    from public.offer_audits
    where offer_id = 'acc0de1e-0000-4000-8000-000000000001'
      and run_state = 'running' and run_started_by = staying and audited_by = leaving
  ) then
    raise exception 'account-deletion: [fixture: audit by the leaving member, re-run by the staying member] the row is %',
      (select to_jsonb(a) from public.offer_audits a where a.offer_id = 'acc0de1e-0000-4000-8000-000000000001');
  end if;
end $$;

-- Snapshot before the deletion. The leaving member's rows are kept without the columns the PRD lets change or says
-- nothing about: the author, and a note's `updated_at` (`on delete set null` is an UPDATE, and the PRD does not
-- say what an orphaned note's date is). The audits and the audit settings are kept without the person columns the
-- deletion is expected to clear and with everything else, dates and state included. The staying member's rows are
-- kept whole.
create temporary table account_deletion_before (name text primary key, doc jsonb not null) on commit drop;

insert into account_deletion_before (name, doc)
select 'leaving offer', to_jsonb(o) - 'created_by'
from public.offers o
where o.id = 'acc0de1e-0000-4000-8000-000000000003'
union all
select
  'leaving notes',
  jsonb_agg(
    jsonb_build_object(
      'id', n.id, 'offer_id', n.offer_id, 'pros', n.pros, 'cons', n.cons,
      'observations', n.observations, 'created_at', n.created_at
    )
    order by n.id
  )
from public.offer_notes n
where n.author_id = (select id from auth.users where email = 'sigaretif3@vetpad.local')
  and n.offer_id in ('acc0de1e-0000-4000-8000-000000000003', 'acc0de1e-0000-4000-8000-000000000001')
union all
select
  'limits',
  jsonb_build_object('id', c.id, 'city', c.city, 'price_min', c.price_min, 'price_max', c.price_max, 'area_min', c.area_min)
from public.team_criteria c
union all
select 'audit settings', to_jsonb(s) - 'updated_by'
from public.audit_settings s
union all
select 'leaving audit', to_jsonb(a) - 'run_started_by' - 'audited_by'
from public.offer_audits a
where a.offer_id = 'acc0de1e-0000-4000-8000-000000000003'
union all
-- The starter of the re-run is the staying member and stays in the snapshot: only the auditor may change.
select 'audit re-run by the staying member', to_jsonb(a) - 'audited_by'
from public.offer_audits a
where a.offer_id = 'acc0de1e-0000-4000-8000-000000000001'
union all
select 'staying offer', to_jsonb(o)
from public.offers o
where o.id = 'acc0de1e-0000-4000-8000-000000000001'
union all
select 'staying note', to_jsonb(n)
from public.offer_notes n
where n.author_id = (select id from auth.users where email = 'sigaretif1@vetpad.local')
  and n.offer_id = 'acc0de1e-0000-4000-8000-000000000003'
union all
select 'staying requirements', to_jsonb(r)
from public.member_requirements r
where r.author_id = (select id from auth.users where email = 'sigaretif1@vetpad.local')
union all
-- Kept so the checks after the deletion can still name the account that is gone.
select 'leaving id', to_jsonb(u.id)
from auth.users u
where u.email = 'sigaretif3@vetpad.local';

do $$
begin
  if (select count(*) from account_deletion_before) <> 10
    or (select jsonb_array_length(doc) from account_deletion_before where name = 'leaving notes') <> 2 then
    raise exception 'account-deletion: [fixture: snapshot is complete] a fixture row is missing from the snapshot - an empty "before" proves nothing';
  end if;
end $$;

-- The deletion itself. A freeze trigger that restores the deleted author makes it fail (lessons.md, F4).
do $$
declare
  deleted integer;
begin
  begin
    delete from auth.users where email = 'sigaretif3@vetpad.local';
    get diagnostics deleted = row_count;
  exception when others then
    raise exception 'account-deletion: [account deletion succeeds] deleting the account failed: % (%)', sqlerrm, sqlstate;
  end;

  if deleted <> 1 or exists (select 1 from auth.users where email = 'sigaretif3@vetpad.local') then
    raise exception 'account-deletion: [account deletion succeeds] % row(s) deleted from auth.users, the account must be gone', deleted;
  end if;
end $$;

-- The offer the deleted member saved belongs to the team: it stays, with no author and nothing else changed.
do $$
declare
  after_row jsonb;
begin
  select to_jsonb(o) into after_row from public.offers o where o.id = 'acc0de1e-0000-4000-8000-000000000003';

  if after_row is null then
    raise exception 'account-deletion: [deleted member''s offer stays] the offer is gone';
  end if;
  if after_row ->> 'created_by' is not null then
    raise exception 'account-deletion: [deleted member''s offer has no author] created_by is %', after_row ->> 'created_by';
  end if;
  if after_row - 'created_by' is distinct from (select doc from account_deletion_before where name = 'leaving offer') then
    raise exception 'account-deletion: [deleted member''s offer is otherwise unchanged] before: %, after: %',
      (select doc from account_deletion_before where name = 'leaving offer'), after_row - 'created_by';
  end if;
end $$;

-- Both of the deleted member's notes stay - the one on another member's offer included - with no author and the
-- text exactly as its author left it. They are found by id, so a note that kept its author still shows up here.
do $$
declare
  before_notes jsonb := (select doc from account_deletion_before where name = 'leaving notes');
  after_notes jsonb;
  authored integer;
begin
  select
    jsonb_agg(
      jsonb_build_object(
        'id', n.id, 'offer_id', n.offer_id, 'pros', n.pros, 'cons', n.cons,
        'observations', n.observations, 'created_at', n.created_at
      )
      order by n.id
    ),
    count(n.author_id)
  into after_notes, authored
  from public.offer_notes n
  where n.id in (select (note ->> 'id')::uuid from jsonb_array_elements(before_notes) as note);

  if after_notes is null or jsonb_array_length(after_notes) <> 2 then
    raise exception 'account-deletion: [deleted member''s notes stay] % of 2 notes left - deleting an account must not delete human-written text',
      coalesce(jsonb_array_length(after_notes), 0);
  end if;
  if authored <> 0 then
    raise exception 'account-deletion: [deleted member''s notes have no author] % note(s) still carry an author_id', authored;
  end if;
  if after_notes is distinct from before_notes then
    raise exception 'account-deletion: [deleted member''s notes keep their identity and text] before: %, after: %',
      before_notes, after_notes;
  end if;
end $$;

-- The deleted member's requirements go with the account, and so does the row that named them.
do $$
declare
  leaving uuid := (select (doc #>> '{}')::uuid from account_deletion_before where name = 'leaving id');
begin
  if exists (select 1 from public.member_requirements where author_id = leaving) then
    raise exception 'account-deletion: [deleted member''s requirements are gone] the requirements row is still there';
  end if;
  if exists (select 1 from public.members where id = leaving) then
    raise exception 'account-deletion: [deleted member''s members row is gone] the members row is still there';
  end if;
end $$;

-- The team's limits outlive whoever changed them last: same values, signed by nobody.
do $$
declare
  after_limits jsonb;
  signed_by uuid;
begin
  select
    jsonb_build_object('id', c.id, 'city', c.city, 'price_min', c.price_min, 'price_max', c.price_max, 'area_min', c.area_min),
    c.updated_by
  into after_limits, signed_by
  from public.team_criteria c;

  if after_limits is distinct from (select doc from account_deletion_before where name = 'limits') then
    raise exception 'account-deletion: [limits keep their values] before: %, after: %',
      (select doc from account_deletion_before where name = 'limits'), after_limits;
  end if;
  if signed_by is not null then
    raise exception 'account-deletion: [limits are signed by nobody] updated_by is %', signed_by;
  end if;
end $$;

-- The audit settings outlive whoever changed them last, as the limits do: same model, effort and date, signed by
-- nobody.
do $$
declare
  after_settings jsonb;
begin
  select to_jsonb(s) into after_settings from public.audit_settings s;

  if after_settings - 'updated_by' is distinct from (select doc from account_deletion_before where name = 'audit settings') then
    raise exception 'account-deletion: [audit settings keep their model, effort and date] before: %, after: %',
      (select doc from account_deletion_before where name = 'audit settings'), after_settings - 'updated_by';
  end if;
  if after_settings ->> 'updated_by' is not null then
    raise exception 'account-deletion: [audit settings are signed by nobody] updated_by is %', after_settings ->> 'updated_by';
  end if;
end $$;

-- The audit the deleted member ran belongs to the team: it stays, started and audited by nobody, with the findings,
-- the dates and the state exactly as they were. The row holds the deleted account in two columns, and Postgres
-- clears each with an UPDATE of its own - a trigger that put either id back would have failed the deletion above.
do $$
declare
  after_row jsonb;
begin
  select to_jsonb(a) into after_row from public.offer_audits a where a.offer_id = 'acc0de1e-0000-4000-8000-000000000003';

  if after_row is null then
    raise exception 'account-deletion: [deleted member''s audit stays] the audit is gone';
  end if;
  if after_row ->> 'run_started_by' is not null or after_row ->> 'audited_by' is not null then
    raise exception 'account-deletion: [deleted member''s audit is started and audited by nobody] run_started_by is %, audited_by is %',
      after_row ->> 'run_started_by', after_row ->> 'audited_by';
  end if;
  if after_row - 'run_started_by' - 'audited_by' is distinct from (select doc from account_deletion_before where name = 'leaving audit') then
    raise exception 'account-deletion: [deleted member''s audit keeps its findings, dates and state] before: %, after: %',
      (select doc from account_deletion_before where name = 'leaving audit'), after_row - 'run_started_by' - 'audited_by';
  end if;
end $$;

-- The audit the staying member is re-running loses its auditor and nothing else: the attempt is still running,
-- started by the staying member at the same moment, beside the same result. The UPDATE that cleared the auditor
-- reached a running row, which a member's write could not have touched.
do $$
declare
  after_row jsonb;
begin
  select to_jsonb(a) into after_row from public.offer_audits a where a.offer_id = 'acc0de1e-0000-4000-8000-000000000001';

  if after_row is null then
    raise exception 'account-deletion: [audit re-run by another member stays] the audit is gone';
  end if;
  if after_row ->> 'audited_by' is not null then
    raise exception 'account-deletion: [audit re-run by another member has no auditor] audited_by is %', after_row ->> 'audited_by';
  end if;
  if after_row - 'audited_by' is distinct from (select doc from account_deletion_before where name = 'audit re-run by the staying member') then
    raise exception 'account-deletion: [audit re-run by another member keeps its starter, result, dates and state] before: %, after: %',
      (select doc from account_deletion_before where name = 'audit re-run by the staying member'), after_row - 'audited_by';
  end if;
end $$;

-- The staying member's offer, note and requirements are the same rows, every column and date included.
do $$
declare
  staying uuid := (select id from auth.users where email = 'sigaretif1@vetpad.local');
  checked record;
begin
  for checked in
    select b.name, b.doc as before_row, a.doc as after_row
    from account_deletion_before b
    left join (
      select 'staying offer' as name, to_jsonb(o) as doc
      from public.offers o
      where o.id = 'acc0de1e-0000-4000-8000-000000000001'
      union all
      select 'staying note', to_jsonb(n)
      from public.offer_notes n
      where n.author_id = staying and n.offer_id = 'acc0de1e-0000-4000-8000-000000000003'
      union all
      select 'staying requirements', to_jsonb(r)
      from public.member_requirements r
      where r.author_id = staying
    ) a using (name)
    where b.name in ('staying offer', 'staying note', 'staying requirements')
  loop
    if checked.after_row is distinct from checked.before_row then
      raise exception 'account-deletion: [other member''s rows are identical: %] before: %, after: %',
        checked.name, checked.before_row, checked.after_row;
    end if;
  end loop;
end $$;

-- Nobody edits an orphaned note any more. As a signed-in member (role `authenticated`, the staying member's
-- claims), an edit, a takeover and a delete of the deleted member's notes each touch zero rows. The member does
-- see the notes (FR-013), so a zero here is the write policies refusing, not a filter that matched nothing.
do $$
begin
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', (select id from auth.users where email = 'sigaretif1@vetpad.local'), 'role', 'authenticated')::text,
    true
  );
end $$;

set local role authenticated;

do $$
declare
  fixture_offers uuid[] := array['acc0de1e-0000-4000-8000-000000000003', 'acc0de1e-0000-4000-8000-000000000001']::uuid[];
  touched integer;
begin
  if auth.uid() is null then
    raise exception 'account-deletion: [fixture: member session] auth.uid() is null under the staying member''s claims';
  end if;

  select count(*) into touched from public.offer_notes where author_id is null and offer_id = any (fixture_offers);
  if touched <> 2 then
    raise exception 'account-deletion: [member reads the orphaned notes] % of 2 visible to a signed-in member', touched;
  end if;

  update public.offer_notes set pros = 'edited by another member'
  where author_id is null and offer_id = any (fixture_offers);
  get diagnostics touched = row_count;
  if touched <> 0 then
    raise exception 'account-deletion: [nobody edits an orphaned note] an update touched % row(s)', touched;
  end if;

  begin
    update public.offer_notes set author_id = auth.uid()
    where author_id is null and offer_id = any (fixture_offers);
    get diagnostics touched = row_count;
  exception when others then
    raise exception 'account-deletion: [nobody takes over an orphaned note] the takeover was not filtered out, it failed with: % (%)', sqlerrm, sqlstate;
  end;
  if touched <> 0 then
    raise exception 'account-deletion: [nobody takes over an orphaned note] an update of author_id touched % row(s)', touched;
  end if;

  delete from public.offer_notes
  where author_id is null and offer_id = any (fixture_offers);
  get diagnostics touched = row_count;
  if touched <> 0 then
    raise exception 'account-deletion: [nobody deletes an orphaned note] a delete touched % row(s)', touched;
  end if;
end $$;

reset role;

\echo 'account-deletion: every check passed; rolling back, nothing is kept'

rollback;
