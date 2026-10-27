-- Commute usage: the team's daily allowance of Google Routes calls (FR-016;
-- supabase/migrations/20261027081817_create_commute_usage.sql). A calculation reserves its calls through
-- `public.reserve_commute_calls(n)` before any request reaches Google; the day is Europe/Warsaw's, a day that
-- would go past 300 calls is refused with the project's own SQLSTATE `VP003` and changes nothing, yesterday's
-- calls do not count today, and no member writes the counter by hand. The day boundary depends on time and the
-- limit on 300 calls, which the publishable key can neither wait for nor spend in a smoke run, so
-- scripts/smoke.mjs cannot cover these rules.
--
-- The whole file is one transaction that ends in ROLLBACK: it leaves no trace, whether it passes or fails (psql
-- stops at the first error and the open transaction dies with the connection). Every check is a DO block that
-- raises `commute-usage: [<check name>] ...` when it does not hold. Inside the transaction `now()` stands still, so
-- "today" is one Warsaw date for the whole file.
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
    raise exception 'commute-usage: [seeded accounts exist] sigaretif1@vetpad.local and sigaretif2@vetpad.local are required - this is not a local database seeded by supabase/seed.sql, refusing to run';
  end if;
end $$;

-- A member's session, for the function that reads auth.uid(): the account's claims, or none for an empty email.
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
    raise exception 'commute-usage: [fixture: member session] auth.uid() is null under the claims of %', account;
  end if;
end $$;

-- The Warsaw day: 23:00 UTC is midnight in winter (CET, +01:00), 22:00 UTC in summer (CEST, +02:00). The
-- October date is the night the clocks go back, so the winter offset is the one that holds.
do $$
declare
  cases constant text[][] := array[
    array['2026-10-25 22:59:59+00', '2026-10-25'],
    array['2026-10-25 23:00:00+00', '2026-10-26'],
    array['2026-07-01 21:59:59+00', '2026-07-01'],
    array['2026-07-01 22:00:00+00', '2026-07-02']
  ];
  i integer;
  got date;
begin
  for i in 1 .. array_length(cases, 1) loop
    got := public.commute_usage_day(cases[i][1]::timestamptz);
    if got is distinct from cases[i][2]::date then
      raise exception 'commute-usage: [the day is Warsaw''s] % read as %, expected %', cases[i][1], got, cases[i][2];
    end if;
  end loop;
end $$;

-- Fixture: the counter starts empty for this transaction (the local database may hold a day a person spent), and
-- yesterday is spent to the limit.
do $$
begin
  delete from public.commute_usage;
  insert into public.commute_usage (day, calls) values (public.commute_usage_day(now()) - 1, 300);
end $$;

-- Yesterday's calls do not count today: with yesterday at the limit and no row for today, a reservation of 2
-- creates today's row and returns 2.
do $$
declare
  total integer;
begin
  perform pg_temp.sign_in('sigaretif1@vetpad.local');
  total := public.reserve_commute_calls(2);
  if total is distinct from 2 then
    raise exception 'commute-usage: [yesterday does not block today] a reservation of 2 returned %, expected 2', total;
  end if;
  if (select calls from public.commute_usage where day = public.commute_usage_day(now())) is distinct from 2 then
    raise exception 'commute-usage: [yesterday does not block today] today''s row does not read 2';
  end if;
  if (select calls from public.commute_usage where day = public.commute_usage_day(now()) - 1) is distinct from 300 then
    raise exception 'commute-usage: [yesterday does not block today] yesterday''s row changed';
  end if;
end $$;

-- Exactly the limit: today at 298, a reservation of 2 returns 300. One more call is refused with VP003, and the
-- refusal changes nothing.
do $$
declare
  total integer;
  refused text;
begin
  update public.commute_usage set calls = 298 where day = public.commute_usage_day(now());
  perform pg_temp.sign_in('sigaretif1@vetpad.local');

  total := public.reserve_commute_calls(2);
  if total is distinct from 300 then
    raise exception 'commute-usage: [a reservation up to the limit passes] 298 + 2 returned %, expected 300', total;
  end if;

  begin
    total := public.reserve_commute_calls(1);
  exception when others then
    refused := sqlstate;
  end;
  if refused is distinct from 'VP003' then
    raise exception 'commute-usage: [a reservation past the limit is refused] 300 + 1 expected VP003, got %', coalesce(refused, 'no error');
  end if;
  if (select calls from public.commute_usage where day = public.commute_usage_day(now())) is distinct from 300 then
    raise exception 'commute-usage: [a refused reservation changes nothing] today''s row no longer reads 300';
  end if;
end $$;

-- Past the limit by one: today at 299, a reservation of 2 is refused whole - never cut down to the one call left.
do $$
declare
  refused text;
begin
  update public.commute_usage set calls = 299 where day = public.commute_usage_day(now());
  perform pg_temp.sign_in('sigaretif2@vetpad.local');

  begin
    perform public.reserve_commute_calls(2);
  exception when others then
    refused := sqlstate;
  end;
  if refused is distinct from 'VP003' then
    raise exception 'commute-usage: [a reservation that would pass the limit is refused whole] 299 + 2 expected VP003, got %', coalesce(refused, 'no error');
  end if;
  if (select calls from public.commute_usage where day = public.commute_usage_day(now())) is distinct from 299 then
    raise exception 'commute-usage: [a refused reservation changes nothing] today''s row no longer reads 299';
  end if;
end $$;

-- Outside a member's session the reservation is refused (42501), and a number of calls outside 1..12 is refused
-- (22023) - none of them changes the row.
do $$
declare
  refused text;
  asked integer;
begin
  update public.commute_usage set calls = 10 where day = public.commute_usage_day(now());

  perform pg_temp.sign_in('');
  begin
    perform public.reserve_commute_calls(2);
  exception when others then
    refused := sqlstate;
  end;
  if refused is distinct from '42501' then
    raise exception 'commute-usage: [a reservation outside a session is refused] expected 42501, got %', coalesce(refused, 'no error');
  end if;

  perform pg_temp.sign_in('sigaretif1@vetpad.local');
  foreach asked in array array[0, 13] loop
    refused := null;
    begin
      perform public.reserve_commute_calls(asked);
    exception when others then
      refused := sqlstate;
    end;
    if refused is distinct from '22023' then
      raise exception 'commute-usage: [a reservation outside 1..12 is refused] n = % expected 22023, got %', asked, coalesce(refused, 'no error');
    end if;
  end loop;

  refused := null;
  begin
    perform public.reserve_commute_calls(null);
  exception when others then
    refused := sqlstate;
  end;
  if refused is distinct from '22023' then
    raise exception 'commute-usage: [a reservation of no number is refused] n = null expected 22023, got %', coalesce(refused, 'no error');
  end if;

  if (select calls from public.commute_usage where day = public.commute_usage_day(now())) is distinct from 10 then
    raise exception 'commute-usage: [a refused reservation changes nothing] today''s row no longer reads 10';
  end if;
end $$;

-- `anon` cannot execute the function at all; a signed-in member can.
do $$
begin
  if has_function_privilege('anon', 'public.reserve_commute_calls(integer)', 'execute') then
    raise exception 'commute-usage: [anon cannot reserve] anon holds execute on reserve_commute_calls';
  end if;
  if not has_function_privilege('authenticated', 'public.reserve_commute_calls(integer)', 'execute') then
    raise exception 'commute-usage: [a member can reserve] authenticated lacks execute on reserve_commute_calls';
  end if;
end $$;

do $$
begin
  perform pg_temp.sign_in('');
end $$;

set local role anon;

do $$
declare
  refused text;
begin
  begin
    perform public.reserve_commute_calls(2);
  exception when others then
    refused := sqlstate;
  end;
  -- 42501 is also the code of the function's own refusal outside a session, so the message tells which one it was.
  if refused is distinct from '42501' then
    raise exception 'commute-usage: [anon cannot reserve] a call as anon expected 42501, got %', coalesce(refused, 'no error');
  end if;
end $$;

reset role;

-- A member reads the counter and cannot write it. As a signed-in member (role `authenticated`), the member sees
-- both rows, so an update or delete that touches zero rows is the missing write policy refusing, not a filter that
-- matched nothing; an insert fails with 42501.
do $$
begin
  perform pg_temp.sign_in('sigaretif1@vetpad.local');
end $$;

set local role authenticated;

do $$
declare
  touched integer;
  refused text;
begin
  select count(*) into touched from public.commute_usage;
  if touched <> 2 then
    raise exception 'commute-usage: [a member reads the counter] % of 2 rows visible to a signed-in member', touched;
  end if;

  update public.commute_usage set calls = 0;
  get diagnostics touched = row_count;
  if touched <> 0 then
    raise exception 'commute-usage: [a member cannot reset the counter] an update touched % row(s)', touched;
  end if;

  delete from public.commute_usage;
  get diagnostics touched = row_count;
  if touched <> 0 then
    raise exception 'commute-usage: [a member cannot delete the counter] a delete touched % row(s)', touched;
  end if;

  begin
    insert into public.commute_usage (day, calls) values (public.commute_usage_day(now()) + 1, 0);
  exception when others then
    refused := sqlstate;
  end;
  if refused is distinct from '42501' then
    raise exception 'commute-usage: [a member cannot insert a day] expected 42501, got %', coalesce(refused, 'no error');
  end if;
end $$;

reset role;

do $$
begin
  if (select calls from public.commute_usage where day = public.commute_usage_day(now())) is distinct from 10
    or (select calls from public.commute_usage where day = public.commute_usage_day(now()) - 1) is distinct from 300
    or (select count(*) from public.commute_usage) <> 2 then
    raise exception 'commute-usage: [a member''s writes change nothing] the counter is not as the fixture left it';
  end if;
end $$;

\echo 'commute-usage: every check passed; rolling back, nothing is kept'

rollback;
