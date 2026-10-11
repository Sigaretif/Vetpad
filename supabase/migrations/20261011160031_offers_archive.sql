-- Offers: the archive (FR-014).
--
-- A member moves an offer to the archive to take it off the board, and restores it from there.
-- The state is two columns: `archived_at` carries it (null = live), `archived_by` is the
-- signature — who hid a flat the others may still be considering, which the dashboard and the
-- card show so that an offer never disappears silently.
--
-- The client only states an intent. `offers_update_authenticated` lets every signed-in member
-- write every column of every offer through the Data API, so a signature the client set could
-- be forged. A member writes any non-null value to `archived_at` to archive and null to
-- restore; the triggers below replace that with the database's time and `auth.uid()`, and keep
-- both columns as they are for as long as the offer stays archived. They are the single gate
-- on the signature: no policy changes and no grant is needed, the existing update policy
-- already covers the new columns.
--
-- `archived_by` is `on delete set null`: an offer belongs to the team, so deleting the account
-- of the member who archived it leaves the offer in the archive, with the same date, signed
-- „przez osobę z usuniętym kontem" (PRD, FR-014 and Non-Functional Requirements). A null
-- `archived_by` beside a non-null `archived_at` means "the archiving member's account was
-- deleted" and nothing else, which is why an archiving without `auth.uid()` is refused.

alter table public.offers
  add column archived_at timestamptz,
  add column archived_by uuid references auth.users (id) on delete set null;

-- Nobody signs an offer that is not archived.
alter table public.offers
  add constraint offers_archived_by_only_when_archived
    check (archived_by is null or archived_at is not null);

-- A new offer is live
--
-- Whatever the client sent: an offer cannot be saved straight into the archive, and an insert
-- cannot carry a signature.

create function public.offers_archive_before_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.archived_at := null;
  new.archived_by := null;
  return new;
end;
$$;

create trigger offers_archive_before_insert
  before insert on public.offers
  for each row
  execute function public.offers_archive_before_insert();

-- The archive's state on update
--
-- The rules, in this order:
--
-- 1. Deleted account. `on delete set null` is carried out as an UPDATE on offers, and a
--    trigger that froze the signature would put the deleted id back, so deleting the account
--    would fail (as `offers_freeze_created_by` once did). `archived_by` goes from a value to
--    null, with `archived_at` unchanged, only when that account no longer exists. This branch
--    stands before every other rule. When the same member saved and archived the offer, the
--    deletion sends two UPDATEs, one per foreign key: the one that clears `created_by` still
--    carries the deleted id in `archived_by` and falls through to rule 4, which keeps it, and
--    the one that clears `archived_by` passes here.
-- 2. Archiving (`archived_at` from null to a value): the database's time and the caller.
--    Without `auth.uid()` the write is refused.
-- 3. Restoring (`archived_at` from a value to null): both columns are cleared. Who restored
--    is not recorded.
-- 4. Anything else keeps both columns as they were: a re-fetch that never mentions them, a
--    member's PATCH of the date or the signature of an archived offer, a signature sent for a
--    live one. The write is accepted and undone, as a PATCH of `created_by` is.
--
-- Reading auth.users needs `security definer`, which is why `search_path` is pinned to empty
-- and every name is schema-qualified. `offers_freeze_created_by` runs beside this trigger on
-- the same UPDATE; each touches only its own column, so their order does not matter.

create function public.offers_archive_before_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.archived_by is null
    and old.archived_by is not null
    and new.archived_at is not distinct from old.archived_at
    and not exists (select 1 from auth.users where id = old.archived_by) then
    return new;
  end if;

  if old.archived_at is null and new.archived_at is not null then
    if auth.uid() is null then
      raise exception 'an offer can only be archived by a signed-in member'
        using errcode = '42501';
    end if;
    new.archived_at := now();
    new.archived_by := auth.uid();
    return new;
  end if;

  if old.archived_at is not null and new.archived_at is null then
    new.archived_by := null;
    return new;
  end if;

  new.archived_at := old.archived_at;
  new.archived_by := old.archived_by;
  return new;
end;
$$;

-- Only the trigger calls the function.
revoke execute on function public.offers_archive_before_update() from public, anon, authenticated;

create trigger offers_archive_before_update
  before update on public.offers
  for each row
  execute function public.offers_archive_before_update();
