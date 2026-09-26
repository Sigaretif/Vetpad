-- A numeric fact the listing does not state is null, never zero.
--
-- The mapper already stores every `<= 0` as unknown (`numericOrUnknown` in
-- src/lib/otodom/map.ts): otodom sends `rent` as "0" when the advertiser left it blank.
-- But the update policy lets any member PATCH a column through PostgREST, and the stored
-- row — not the ingest — is what the card and the board render: a stored 0 would read
-- „0 zł” and sort as the cheapest offer, a fact the listing never gave (PRD, Guardrails).
-- These checks hold the mapper's rule in the table itself.
--
-- Rows that already carry a `<= 0` get it back as unknown first, the way the mapper would
-- have stored it — price and rent together with their currency — so the checks can be added.

update public.offers
set
  price = case when price <= 0 then null else price end,
  price_currency = case when price <= 0 then null else price_currency end,
  price_per_m = case when price_per_m <= 0 then null else price_per_m end,
  rent = case when rent <= 0 then null else rent end,
  rent_currency = case when rent <= 0 then null else rent_currency end,
  area_m2 = case when area_m2 <= 0 then null else area_m2 end,
  rooms = case when rooms <= 0 then null else rooms end,
  floors_total = case when floors_total <= 0 then null else floors_total end,
  build_year = case when build_year <= 0 then null else build_year end
where price <= 0
   or price_per_m <= 0
   or rent <= 0
   or area_m2 <= 0
   or rooms <= 0
   or floors_total <= 0
   or build_year <= 0;

alter table public.offers
  add constraint offers_price_positive check (price is null or price > 0),
  add constraint offers_price_per_m_positive check (price_per_m is null or price_per_m > 0),
  add constraint offers_rent_positive check (rent is null or rent > 0),
  add constraint offers_area_m2_positive check (area_m2 is null or area_m2 > 0),
  add constraint offers_rooms_positive check (rooms is null or rooms > 0),
  add constraint offers_floors_total_positive check (floors_total is null or floors_total > 0),
  add constraint offers_build_year_positive check (build_year is null or build_year > 0);
