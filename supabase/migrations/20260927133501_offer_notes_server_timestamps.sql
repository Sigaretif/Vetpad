-- Offer notes: the database, never the client, sets a note's identity and dates.
--
-- The freeze trigger from 20260926202537_create_offer_notes.sql ran only on update, so a
-- member could insert their own note through the Data API with any `created_at` and
-- `updated_at` (a note „edytowano" in 2099 would sit at the top of the list, which is
-- sorted by `updated_at`), and a PATCH could change the note's `id`. Nobody could touch
-- another member's note — RLS still holds — but the edit date on the card has to be a
-- fact, not the author's claim. Found in the implementation review of S-05 (F2).
--
-- Insert: both dates are `now()`, whatever the client sent. An upsert from /api/notes is
-- an insert first, so on a conflict the proposed row carries these values into the update
-- trigger, which then keeps `created_at` from the stored row.
--
-- Update: the same freeze as before, plus `id`.

create function public.offer_notes_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.created_at := now();
  new.updated_at := now();
  return new;
end;
$$;

revoke execute on function public.offer_notes_before_insert() from public, anon, authenticated;

create trigger offer_notes_before_insert
  before insert on public.offer_notes
  for each row
  execute function public.offer_notes_before_insert();

-- Freeze on update, revised: `id` joins `offer_id` and `created_at`. The account-deletion
-- branch and everything else are unchanged (20260926202537_create_offer_notes.sql).

create or replace function public.offer_notes_before_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.id := old.id;
  new.offer_id := old.offer_id;
  new.created_at := old.created_at;

  if new.author_id is null
    and old.author_id is not null
    and not exists (select 1 from auth.users where id = old.author_id) then
    new.updated_at := old.updated_at;
    return new;
  end if;

  new.author_id := old.author_id;
  new.updated_at := now();
  return new;
end;
$$;
