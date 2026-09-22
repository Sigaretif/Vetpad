-- Offers: one row per otodom listing saved by a team member (FR-004).
--
-- Nullability is the product rule "unknown, never zero" expressed in the schema:
-- every fact column below that the listing may omit is nullable, and `null` means
-- "the listing did not state it" — never "zero", never "no". Mapping code must write
-- `null` for an absent or placeholder value (otodom sends `characteristics.rent` as
-- the string "0"), not a falsy default.
--
-- The advertiser's phone number and name are deliberately absent: no column stores
-- them (CLAUDE.md, Secrets and data access).

create table public.offers (
  -- identity and provenance
  id uuid primary key default gen_random_uuid(),
  source_url text not null,              -- normalised offer URL
  otodom_id bigint not null,             -- otodom `ad.id`, stable across slug redirects
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  fetched_at timestamptz not null default now(),
  listed_at timestamptz,
  listing_modified_at timestamptz,

  -- content
  title text not null,
  description text not null,             -- plain text, markup stripped

  -- numeric facts: null = not stated by the listing
  price numeric,
  price_currency text,
  price_per_m numeric,
  area_m2 numeric,
  rooms integer,
  floors_total integer,
  build_year integer,
  rent numeric,
  rent_currency text,

  -- enumerated facts: raw otodom tokens (e.g. `floor_1`, `ground_floor`); null = not stated
  floor text,
  market text,
  building_type text,
  construction_status text,
  building_ownership text,
  heating text,
  windows_type text,
  building_material text,
  energy_certificate text,
  advert_type text,
  free_from date,

  -- location
  location_label text,
  street_name text,
  latitude numeric,
  longitude numeric,

  -- structures
  features jsonb not null default '[]'::jsonb,
  images jsonb not null default '[]'::jsonb,
  raw jsonb not null
);

-- `ad.id` is the listing's identity: otodom changes the URL slug and redirects, so
-- the URL cannot be the uniqueness key.
create unique index offers_otodom_id_key on public.offers (otodom_id);

-- Duplicate lookup by URL before fetching.
create index offers_source_url_idx on public.offers (source_url);

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
-- Roles are flat (PRD, Access Control): every signed-in member has full CRUD on
-- offers. The only restriction is authorship on insert, frozen by the trigger below.

alter table public.offers enable row level security;

-- FR-006, FR-013: every signed-in member reads every offer.
create policy offers_select_authenticated
  on public.offers
  for select
  to authenticated
  using (auth.uid() is not null);

-- The author of a saved offer is always the member saving it.
create policy offers_insert_authenticated
  on public.offers
  for insert
  to authenticated
  with check (created_by = auth.uid());

-- Flat roles: any member may update an offer (re-fetch, S-09).
create policy offers_update_authenticated
  on public.offers
  for update
  to authenticated
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

-- FR-015: any member may delete an offer.
create policy offers_delete_authenticated
  on public.offers
  for delete
  to authenticated
  using (auth.uid() is not null);

-- Author freeze
--
-- `created_by` is who saved the offer. An update policy cannot compare the new value
-- with the old one, so immutability is enforced by a trigger: every update keeps the
-- original author regardless of what the client sends.

create function public.offers_freeze_created_by()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.created_by := old.created_by;
  return new;
end;
$$;

create trigger offers_freeze_created_by
  before update on public.offers
  for each row
  execute function public.offers_freeze_created_by();
