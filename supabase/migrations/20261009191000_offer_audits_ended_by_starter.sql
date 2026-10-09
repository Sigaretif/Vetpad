-- An audit attempt is ended by the member who started it
--
-- `supabase/migrations/20261007073300_create_offer_audits.sql` let any signed-in member
-- move a running attempt to `completed` or `failed`. The result was signed by the member
-- who started the attempt, not by whoever sent the write, so inside the 175 seconds an
-- attempt is protected for, another member could store findings of their own under the
-- starter's name through the Data API — and the starter's request, coming back with the
-- result it paid for, found the row already ended. Failing somebody's attempt and
-- starting one's own in the next request also walked around the lock (`VP001`).
--
-- The function below is the one from that migration with one rule added, between its
-- rules 3 and 4: an update that ends a running attempt, sent by anyone but the member who
-- started it, is accepted and undone — as a PATCH of a note's author is. The application
-- always ends an attempt in the session that claimed the row (`src/pages/api/audits.ts`),
-- so nothing it does is refused. An attempt whose starter's account is gone can be ended
-- by nobody; it reads as interrupted after 175 seconds and is taken over like any other.
--
-- Everything else stands as the first migration states it: the order of the checks, the
-- 175 seconds, `VP001`, `security definer` with an empty `search_path`, and no execute
-- for anyone, since only the trigger calls the function.

create or replace function public.offer_audits_before_update()
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

  if old.run_state = 'running' and new.run_state in ('completed', 'failed')
    and (auth.uid() is null or old.run_started_by is distinct from auth.uid()) then
    new := old;
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
