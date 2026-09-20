-- Local development seed. Runs on `supabase db reset` and on a fresh `supabase start`.
--
-- These credentials are throwaways for a database that lives in a container on your
-- own machine. This file is committed, so they are public: never put a password here
-- that is used anywhere else.
--
-- WARNING: seeds are not automatically local-only. `supabase db reset --linked` wipes
-- the HOSTED database and runs this file against it, which would create these dev
-- accounts in production. Never run `db reset` with `--linked`. Migrations reach the
-- hosted project with `supabase db push`, which does not run seeds.
--
-- Three accounts mirror the three-person team the product is built for
-- (context/foundation/prd.md, FR-001 and Access Control), so note attribution
-- (FR-013) can be exercised locally.

do $$
declare
  acct record;
  uid uuid;
begin
  for acct in
    select * from (values
      ('sigaretif1@vetpad.local', 'qwerty123456'),
      ('sigaretif2@vetpad.local', 'qwerty123456'),
      ('sigaretif3@vetpad.local', 'qwerty123456')
    ) as t(email, password)
  loop
    if exists (select 1 from auth.users where email = acct.email) then
      continue;
    end if;

    uid := gen_random_uuid();

    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) values (
      '00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated',
      acct.email, crypt(acct.password, gen_salt('bf')),
      now(), now(), now(),
      '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
      '', '', '', ''
    );

    insert into auth.identities (
      id, user_id, provider_id, identity_data, provider,
      last_sign_in_at, created_at, updated_at
    ) values (
      gen_random_uuid(), uid, uid::text,
      jsonb_build_object(
        'sub', uid::text, 'email', acct.email,
        'email_verified', true, 'phone_verified', false
      ),
      'email', now(), now(), now()
    );
  end loop;
end $$;
