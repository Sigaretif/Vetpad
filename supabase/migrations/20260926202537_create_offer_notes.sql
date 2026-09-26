-- Offer notes: one note per member per offer — Pros, Cons and General Observations
-- (FR-012), readable by every signed-in member (FR-013).
--
-- Authorship is the only restriction (PRD, Access Control: flat roles, no restricted
-- destructive actions). Any member reads every note; only the author writes, edits or
-- deletes their own. There is no authorisation layer in application code: the policies
-- below are the whole of it.
--
-- `offer_id ... on delete cascade`: deleting an offer takes every member's notes with it,
-- a cost the PRD weighed and accepted (FR-015).
--
-- `author_id ... on delete set null`: a deleted member's notes stay, signed
-- „osoba z usuniętym kontem", and nobody edits them any more (PRD, Non-Functional
-- Requirements, resolved 2026-09-26 in S-05). A null `author_id` means "the author's
-- account was deleted" and nothing else, as `offers.created_by` does
-- (20260923153747_offers_keep_after_author_deleted.sql). A new note still always has an
-- author: the insert policy requires `author_id = auth.uid()`, which a null never
-- satisfies.
--
-- Notes never leave the system (PRD, Non-Functional Requirements): they are the members'
-- conclusions about an audit, never an input to it, and no part of them is ever sent to
-- the model provider.

create table public.offer_notes (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references public.offers (id) on delete cascade,
  author_id uuid references auth.users (id) on delete set null,
  pros text not null default '',
  cons text not null default '',
  observations text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- One note per member per offer. Its index also serves reading an offer's notes by
  -- `offer_id`. Nulls are distinct, so several deleted accounts' notes may sit on one
  -- offer.
  constraint offer_notes_offer_id_author_id_key unique (offer_id, author_id),

  -- A note says something: at least one field holds a non-whitespace character.
  constraint offer_notes_not_blank
    check (pros ~ '\S' or cons ~ '\S' or observations ~ '\S'),

  constraint offer_notes_pros_length check (char_length(pros) <= 5000),
  constraint offer_notes_cons_length check (char_length(cons) <= 5000),
  constraint offer_notes_observations_length check (char_length(observations) <= 5000)
);

-- Freeze on update
--
-- An update policy cannot compare the new value with the old one, so the trigger keeps
-- what a note is about and who wrote it: `offer_id`, `created_at` and `author_id` are
-- put back from the old row regardless of what the client sends, and `updated_at` is
-- set by the database, never by the client.
--
-- `on delete set null` is carried out as an UPDATE on offer_notes, and putting the
-- deleted author back would make deleting the account fail. So `author_id` may become
-- null only when the author's account no longer exists — and that branch leaves
-- `updated_at` as it was, because deleting an account is not an edit of the note. Any
-- other change, a member's PATCH to null included, keeps the original author. Reading
-- auth.users needs `security definer`, which is why `search_path` is pinned to empty and
-- every name is schema-qualified. The function is only ever called by the trigger;
-- execute is revoked so it cannot be reached through the Data API as an RPC.

create function public.offer_notes_before_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
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

revoke execute on function public.offer_notes_before_update() from public, anon, authenticated;

create trigger offer_notes_before_update
  before update on public.offer_notes
  for each row
  execute function public.offer_notes_before_update();

-- Row Level Security
--
-- Supabase grants select/insert/update/delete on every new public table to `anon`
-- and `authenticated` automatically, so these policies are the single access gate.
--
-- There is intentionally no policy for `anon`: unauthenticated visitors get nothing.
-- Denial signature: with RLS on and no matching `select` policy a query returns an
-- empty array with HTTP 200, not a permission error; a blocked write fails with
-- "new row violates row-level security policy" (an update or delete of another
-- member's note simply matches no row). Fix the policy, never reach for a secret /
-- service_role key.

alter table public.offer_notes enable row level security;

-- FR-013: every signed-in member reads every note.
--
-- Saving a note from /api/notes is an upsert, and `INSERT ... ON CONFLICT DO UPDATE`
-- checks the `select` policy against both the existing and the new row. Narrowing this
-- policy would break saving notes with "new row violates row-level security policy".
create policy offer_notes_select_authenticated
  on public.offer_notes
  for select
  to authenticated
  using (auth.uid() is not null);

-- FR-012: the author of a note is always the member writing it.
create policy offer_notes_insert_own
  on public.offer_notes
  for insert
  to authenticated
  with check (author_id = auth.uid());

-- FR-012: only the author edits their note. A deleted member's note (`author_id` null)
-- matches no one, so nobody edits it any more.
create policy offer_notes_update_own
  on public.offer_notes
  for update
  to authenticated
  using (author_id = auth.uid())
  with check (author_id = auth.uid());

-- FR-015: only the author deletes their note (UI in S-11).
create policy offer_notes_delete_own
  on public.offer_notes
  for delete
  to authenticated
  using (author_id = auth.uid());

-- Anonymous sign-ins
--
-- The select policy above tests `auth.uid() is not null`, and the write policies compare
-- `author_id` with `auth.uid()`. An anonymous Supabase user also gets the `authenticated`
-- role and a uid, so it could read every note and write notes of its own; these policies
-- hold only while `enable_anonymous_sign_ins` stays false (supabase/config.toml, and the
-- hosted project's Auth settings). Turning it on requires rewriting every policy on this
-- table first, as for offers (20260923153747_offers_keep_after_author_deleted.sql).
