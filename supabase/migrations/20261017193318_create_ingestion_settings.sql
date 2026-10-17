-- Ingestion settings: which way an otodom.pl listing is fetched when a member adds an offer
-- (FR-004) or re-fetches one (FR-009).
--
-- `direct_with_fallback` fetches the offer page directly and, when that is turned away, makes
-- one run of the extraction service (Apify); `apify_only` makes no direct request; `direct_only`
-- never calls the extraction service and is the kill switch. Without APIFY_TOKEN every mode
-- runs as `direct_only` (src/lib/ingestion-settings.ts, resolveIngestionMode).
--
-- Why members only read this row: it is an operational setting, not team data. Each Apify run
-- is paid for from the owner's account, so the mode is a cost switch, and no member may flip it.
-- The owner changes it in Supabase Studio, as `postgres`. This is the narrow exception CLAUDE.md
-- states under "Secrets and data access": a table changed only by the owner, with a `select`
-- policy for `authenticated` and nothing else. It is never a pattern for data members are meant
-- to write — such a table still needs one policy per operation.
--
-- There is no `updated_by` column and no trigger: a Studio edit has no `auth.uid()`, so there is
-- nobody to sign the row with.

create table public.ingestion_settings (
  -- Singleton: the only possible key is `true`, and the row is inserted below.
  id boolean primary key default true,
  mode text not null,

  constraint ingestion_settings_singleton check (id),

  -- A closed list, held in the table itself. Mirrored by INGESTION_MODES in
  -- src/lib/ingestion-settings.ts; offering another mode is a migration that widens this check.
  constraint ingestion_settings_mode_known
    check (mode in ('direct_with_fallback', 'apify_only', 'direct_only'))
);

-- The one row, holding the default mode. It is never inserted or deleted by a member, and never
-- changed by one either.
insert into public.ingestion_settings (id, mode)
values (true, 'direct_with_fallback');

-- Row Level Security
--
-- Supabase grants select/insert/update/delete on every new public table to `anon`
-- and `authenticated` automatically, so these policies are the single access gate.
--
-- There is intentionally no policy for `anon`: unauthenticated visitors get nothing.
-- There are intentionally no insert, update or delete policies: nobody but the owner changes
-- the mode, and the owner does it in Supabase Studio as `postgres`, which has `bypassrls` and
-- needs no policy. The denial of every member's write is the design, not a gap to fill — do not
-- "fix" it with policies.
--
-- Denial signature: with RLS on and no matching `select` policy a query returns an
-- empty array with HTTP 200, not a permission error; a blocked insert fails with
-- "new row violates row-level security policy" (42501), and an update or delete with no
-- matching policy simply matches no row (200, 0 rows). Fix the policy, never reach for a
-- secret / service_role key.

alter table public.ingestion_settings enable row level security;

-- FR-004, FR-009: every signed-in member reads the mode the next add or re-fetch runs with, and
-- /criteria shows it.
create policy ingestion_settings_select_authenticated
  on public.ingestion_settings
  for select
  to authenticated
  using (auth.uid() is not null);

-- Anonymous sign-ins
--
-- The policy above tests `auth.uid() is not null`. An anonymous Supabase user also gets the
-- `authenticated` role and a uid, so it could read the mode; the policy holds only while
-- `enable_anonymous_sign_ins` stays false (supabase/config.toml, and the hosted project's Auth
-- settings). Turning it on requires rewriting the policy first, as for offers
-- (20260923153747_offers_keep_after_author_deleted.sql).
