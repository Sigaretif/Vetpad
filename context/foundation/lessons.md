# Lessons Learned

> Append-only register of recurring rules and patterns. Re-read at start by /10x-frame, /10x-research, /10x-plan, /10x-plan-review, /10x-implement, /10x-impl-review.

## Render URLs from database rows only through `safeHttpsUrl`

- **Context**: `src/components/offers/OfferGallery.astro`, `src/pages/offers/[id].astro` — impl review of `paste-listing-to-card`, finding F1 (2026-09-23).
- **Problem**: The card rendered `images[].large`, `images[].thumbnail` and `source_url` straight into `href`/`src`. Astro escapes attribute values but never checks the URL scheme, and RLS lets any signed-in member PATCH any `offers` column through PostgREST with the publishable key — so a stored `javascript:` link would run in another member's session on click. Filtering only in the mapper does not help: the stored row, not the ingest, is the attack surface.
- **Rule**: Every URL read from a database row and placed in `href` or `src` goes through `safeHttpsUrl` from `@/lib/safe-url`; a `null` result renders no link/image. The offer card is the reference.
- **Applies to**: S-06 (shared offer board — thumbnails and links to the card/original), S-08 (map link built from stored data), and any later view rendering stored URLs.

## Declare `on delete` on every author column that references `auth.users`

- **Context**: `supabase/migrations/20260922202756_create_offers.sql:17`, fixed by `supabase/migrations/20260923153747_offers_keep_after_author_deleted.sql` — impl review of `paste-listing-to-card`, finding F4 (2026-09-23).
- **Problem**: `created_by uuid not null references auth.users (id)` took the default `NO ACTION`, so deleting a member who had saved an offer failed in Supabase Auth ("Database error deleting user"). A plain `on delete set null` is not enough on its own: Postgres carries it out as an UPDATE, and a `before update` trigger that freezes the author puts the deleted id back, so the deletion still fails.
- **Rule**: Every column pointing at `auth.users` states its `on delete` in the creating migration, chosen from the PRD rather than left to the default. For offers the PRD says the row outlives its author (`set null`, rendered „konto usunięte"); a freeze trigger on such a column lets it become null only when the author's account no longer exists — `offers_freeze_created_by` is the reference.
- **Applies to**: S-05 (notes and their author — the PRD has yet to decide what happens to a deleted member's notes), S-07 (rendering the saving member, including the deleted-account case), and any later table with an author column.

## Kolory widoku tylko z tokenów ról, komponenty tylko z `src/components/ui`

- **Context**: Każdy plan i review, które dotykają UI — S-03 team-search-criteria (formularz) jako pierwszy. Incydent: ui-offer-card, archiwum 2026-09-23.
- **Problem**: Plik tokenów istniał, ale żaden widok go nie czytał — ok. 100 literałów w 13 plikach, więc zmiana presetu shadcn zmieniała na ekranie tylko przycisk; blok `.dark` był martwy; „nie podano w ogłoszeniu" (guardrail z PRD) miał ~3,5:1 kontrastu; `backdrop-blur` na 5 panelach dawał ~9 fps przy przewijaniu bez GPU.
- **Rule**: Widok bierze kolory wyłącznie z tokenów ról w `src/styles/global.css` (`bg-card`, `text-muted-foreground`, `text-link`, `border-border`, `bg-info`/`text-info-foreground`, `bg-warning`, `destructive`…) i komponenty wyłącznie z `src/components/ui`. Literał koloru w klasie — paleta Tailwinda (`bg-white/10`, `text-blue-100/80`, `bg-purple-600`), dowolny hex (`text-[#…]`), `bg-cosmic`, `backdrop-blur` — to błąd, nie styl. Wykrywa go `npm run lint`: `tokensOnlyConfig` w `eslint.config.js` odrzuca takie klasy w `src/`. Lista `ignores` to niezmigrowane widoki: zmiana, która migruje plik, usuwa go z listy; nic się do niej nie dopisuje. Błąd lintu naprawia się tokenem albo nowym tokenem roli w `global.css` (z parą `-foreground` i kontrastem ≥4,5:1), nigdy wyjątkiem. Pułapka przy nowych widokach: nie reużywać `FormField` / `SubmitButton` / `PasswordToggle` / `ServerError` z `src/components/auth`, dopóki są na liście `ignores` — przenoszą stary styl (fiolet na sztywno). Nowy formularz bierze prymitywy z shadcn (`npx shadcn add input label …` + rytuał z CLAUDE.md `### UI`).
- **Applies to**: plan, implement, impl-review
