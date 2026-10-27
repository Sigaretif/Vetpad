-- The team's daily allowance of Google Routes calls (FR-016, prd.md Non-Functional Requirements).
--
-- Google's daily quotas cannot be lowered on this pay-as-you-go account, and Billing's spend caps do
-- not cover Google Maps Platform (context/foundation/user-manual/set-up-google-maps.md, step 5), so the
-- application keeps its own cap: at most 300 Routes calls a day, the day being Europe/Warsaw's. A
-- calculation reserves its 2N calls (N points, public transport and car) here before the first request
-- reaches Google, and is refused before any request when the reservation would take the day past the
-- limit. 31 × 300 = 9 300 calls a month stays under the free allowance of 10 000.
--
-- One row per Warsaw day; no row means no calls yet. A reservation is never given back: calls Google
-- failed, rejected or never answered stay counted.
--
-- Members read the counter and cannot write it: the table is written only by the `security definer`
-- function below, the way `members` is written only by its trigger
-- (20260926185936_create_members.sql). A member who calls the function through the Data API only spends
-- the team's allowance — nobody but the owner can reset or raise it. That is accepted: the same member
-- can already press the button.
--
-- The owner's levers, in Supabase Studio as `postgres` (which has `bypassrls`): reset or lower today's
-- count in the Table Editor, which lets the team calculate again today. A permanent change of the limit
-- is a new migration that replaces `reserve_commute_calls`, together with COMMUTE_DAILY_CALL_LIMIT in
-- src/lib/commute/failure.ts.

create table public.commute_usage (
  day date primary key,
  calls integer not null check (calls >= 0),
  updated_at timestamptz not null default now()
);

-- Row Level Security
--
-- Supabase grants select/insert/update/delete on every new public table to `anon`
-- and `authenticated` automatically, so these policies are the single access gate.
--
-- There is intentionally no policy for `anon`: unauthenticated visitors get nothing.
-- There are intentionally no insert, update or delete policies: the counter is written only by
-- `reserve_commute_calls` below, which runs as its owner, and by the owner in Supabase Studio. The
-- denial of every member's direct write is the design, not a gap to fill — do not "fix" it with
-- policies.
--
-- Denial signature: with RLS on and no matching `select` policy a query returns an
-- empty array with HTTP 200, not a permission error; a blocked insert fails with
-- "new row violates row-level security policy" (42501), and an update or delete with no
-- matching policy simply matches no row (200, 0 rows). Fix the policy, never reach for a
-- secret / service_role key.

alter table public.commute_usage enable row level security;

-- Every signed-in member reads how much of the day's allowance is spent.
create policy commute_usage_select_authenticated
  on public.commute_usage
  for select
  to authenticated
  using (auth.uid() is not null);

-- The Warsaw day of a moment. A function of its own so that `npm run test:db`
-- (scripts/commute-usage.sql) can check the day boundary in both seasons without moving the clock.

create function public.commute_usage_day(at timestamptz)
returns date
language sql
stable
set search_path = ''
as $$
  select (at at time zone 'Europe/Warsaw')::date;
$$;

-- The reservation
--
-- Adds `n` calls to today's row in one statement and returns the day's new total. The day is taken in
-- the database, from `now()`, never from the caller. The `where` of the conflict branch is the limit:
-- when the day would go past it, the statement changes nothing and returns no row, and the function
-- raises `VP003` — this project's own SQLSTATE, the third one — which the route reads as "the team's
-- daily limit is spent". Its message carries no number: the route never shows it.
--
-- `n` is at most 12, two calls for each of at most six points (COMMUTE_POINTS_MAX in
-- src/lib/commute/points.ts, and the cap in 20261027081815_create_commute_points.sql). A reservation
-- outside a member's session is refused (42501), so the publishable key alone cannot spend the
-- allowance.
--
-- `security definer`, because the table has no write policy; `search_path` pinned to empty and every
-- name schema-qualified. Execute is revoked from `public` and `anon` and granted to `authenticated`:
-- the route calls it with the member's session.

create function public.reserve_commute_calls(n integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  total integer;
begin
  if auth.uid() is null then
    raise exception 'route calls can only be reserved by a signed-in member'
      using errcode = '42501';
  end if;
  if n is null or n < 1 or n > 12 then
    raise exception 'a reservation asks for between 1 and 12 route calls'
      using errcode = '22023';
  end if;

  -- 300: the daily limit. Mirrored by COMMUTE_DAILY_CALL_LIMIT in src/lib/commute/failure.ts; change
  -- the two together.
  insert into public.commute_usage (day, calls, updated_at)
  values (public.commute_usage_day(now()), n, now())
  on conflict (day) do update
    set calls = public.commute_usage.calls + excluded.calls,
        updated_at = now()
    where public.commute_usage.calls + excluded.calls <= 300
  returning public.commute_usage.calls into total;

  if total is null then
    raise exception 'the team''s daily allowance of route calculations is spent'
      using errcode = 'VP003';
  end if;

  return total;
end;
$$;

revoke execute on function public.reserve_commute_calls(integer) from public, anon;
grant execute on function public.reserve_commute_calls(integer) to authenticated;

-- Anonymous sign-ins
--
-- The policy and the function above test `auth.uid()`. An anonymous Supabase user also gets the
-- `authenticated` role and a uid, so they hold only while `enable_anonymous_sign_ins` stays false
-- (supabase/config.toml, and the hosted project's Auth settings). Turning it on requires rewriting
-- them first, as for offers (20260923153747_offers_keep_after_author_deleted.sql).
