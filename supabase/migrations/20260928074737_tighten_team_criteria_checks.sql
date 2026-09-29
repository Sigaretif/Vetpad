-- The checks on public.team_criteria now accept exactly what parseLimitsForm (src/lib/criteria.ts)
-- accepts, and nothing more.
--
-- The checks in 20260927144141_create_team_criteria.sql were looser than the form. Any member can
-- PATCH the row through the Data API with the publishable key (flat roles, RLS lets every member
-- update it), and three kinds of value got past the database while the app cannot read them back:
--   * a city of tabs or non-breaking spaces: `btrim` strips only spaces, JS `trim()` strips them all;
--   * a numeric too large for a JS number, e.g. 1e400, which JSON.parse turns into Infinity;
--   * a fractional price, or an area with more than two decimals, which the form pre-fills and then
--     refuses to save unchanged.
-- A row the app cannot read is a failed read, never "no limits": /criteria renders no form and the
-- board stops comparing offers — and with no form, nobody can repair the row from the UI.
-- Source: impl-review of team-search-criteria, finding F2 (2026-09-28).
--
-- The constraint names stay the same, so references to them keep working.
--
-- Rows already stored were written through the form, so they satisfy the new checks; if one does not,
-- this migration fails as a whole and changes nothing.

alter table public.team_criteria
  drop constraint team_criteria_city_not_blank,
  drop constraint team_criteria_price_min_positive,
  drop constraint team_criteria_price_max_positive,
  drop constraint team_criteria_area_min_positive;

alter table public.team_criteria
  -- Blank means blank to JS `String.prototype.trim()`: ASCII whitespace, the line terminators, every
  -- Unicode space separator (NBSP and the narrow U+202F among them) and U+FEFF. `char_length` counts
  -- code points, and the form counts them the same way. A comma is refused: the board compares the
  -- city with each comma-separated part of an offer's location, so „Warszawa, mazowieckie" would
  -- match no part and mark every offer (impl-review F3).
  add constraint team_criteria_city_not_blank
    check (
      city is null
      or (
        city !~ '^[ \t\n\r\v\f\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]*$'
        and position(',' in city) = 0
        and char_length(city) <= 100
      )
    ),
  -- A price is whole złoty, no larger than Number.MAX_SAFE_INTEGER, so it reads back into JS as the
  -- same number. NaN sorts above every number in Postgres, so the upper bound rules it out along with
  -- Infinity.
  add constraint team_criteria_price_min_positive
    check (
      price_min is null
      or (price_min > 0 and price_min <= 9007199254740991 and price_min = trunc(price_min))
    ),
  add constraint team_criteria_price_max_positive
    check (
      price_max is null
      or (price_max > 0 and price_max <= 9007199254740991 and price_max = trunc(price_max))
    ),
  -- An area has at most two decimals, under the same upper bound.
  add constraint team_criteria_area_min_positive
    check (
      area_min is null
      or (area_min > 0 and area_min <= 9007199254740991 and area_min = round(area_min, 2))
    );

-- Requirements keep their date on a save that changes nothing, as the limits do. Before, the update
-- trigger set `updated_at := now()` on every update, so re-saving the same text moved "edytowano"
-- although the criteria revision rightly stayed put. The author and creation date stay frozen as
-- before. Source: impl-review of team-search-criteria, finding F6 (2026-09-28).
create or replace function public.member_requirements_before_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.author_id := old.author_id;
  new.created_at := old.created_at;
  if new.body is distinct from old.body then
    new.updated_at := now();
  else
    new.updated_at := old.updated_at;
  end if;
  return new;
end;
$$;

revoke execute on function public.member_requirements_before_update() from public, anon, authenticated;
