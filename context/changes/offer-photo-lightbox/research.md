---
date: 2026-10-17T17:54:12+02:00
researcher: Claude (Opus 5.5) for Wiktor Ortel
git_commit: 9fb0ecc
branch: master
repository: Sigaretif/Vetpad
topic: "Sharp gallery thumbnails and an in-card photo lightbox — code and data"
tags: [research, offer-card, gallery, lightbox, otodom-images, radix-dialog]
status: complete
last_updated: 2026-10-17
last_updated_by: Claude (Opus 5.5)
---

# Research: Sharp gallery thumbnails and an in-card photo lightbox

**Date**: 2026-10-17T17:54:12+02:00
**Researcher**: Claude (Opus 5.5) for Wiktor Ortel
**Git Commit**: 9fb0ecc (working tree clean apart from this change folder)
**Branch**: master
**Repository**: Sigaretif/Vetpad

## Research Question

For the change in `context/changes/offer-photo-lightbox/change.md`, answer, each grounded in file:line or verified data:

1. The real pixel sizes of otodom's `thumbnail`/`small`/`medium`/`large`, whether the CDN URL encodes and honours a size, and which variant suits the grid cell and the lightbox.
2. What the stored `images` and `raw.images` hold locally, and the options for existing rows (a) `medium` in the mapper + re-fetch, (b) read from `raw`, (c) `large` + `srcset` — each against the audit fingerprint, the lost-facts rule and the mapper tests.
3. Every place that renders photos, how each filters through `safeHttpsUrl`, and what may reach a React island.
4. The CLAUDE.md-compliant path to a dialog primitive and a lightbox island (data in, no-JS fallback, keys, counter, focus return), and any existing precedent.
5. Tests and kitchen sink: what covers the gallery today, how to test the island, smoke/E2E, and the `/dev/offer-card` entry for the new state.

## Summary

- **Sizes (verified, 1 offer from the local DB, fetched from the CDN on 2026-10-17):** the size is encoded in the URL suffix `/image;s=WxH;q=80`. On the 2 local offers (21 photos), each variant carries one fixed suffix: `thumbnail` 184×138, `small` 314×236, `medium` 655×491, `large` 2048×1536. On that one photo the CDN returned JPEGs of those sizes (`medium` came back 654×491). It also honoured two sizes the payload never names (1024×768, 1280×960) — the CDN resizes on request, but that is undocumented behaviour.
- **Grid cell:** on `/offers/[id]` at `lg`+ the gallery is ~694 CSS px wide, so a 3-column cell is ~223 CSS px and a single photo ~694 CSS px (calculation below). `thumbnail` (184 px) is upscaled even at DPR 1 — that is the blur. `medium` (655 px) covers a 3-column cell up to DPR ~2.9 and a single photo only at DPR ≤ ~0.94, so the single-photo case wants `large`. **Lightbox:** `large` (2048×1536).
- **Stored data:** the `images` column holds only `{large, thumbnail}` (both local rows); `raw.images` holds otodom's whole objects `{large, small, medium, thumbnail, isExterior}`, copied unfiltered (`src/lib/otodom/map.ts:11-22`, `:148-161`). So `medium` is already stored in `raw`, but unvalidated and writable by any member.
- **No audit or re-fetch side effects:** `images` is outside `AUDIT_OFFER_COLUMNS` (`src/lib/audit/input.ts:4-7`, `:45-71`), so no change to `images` moves `listingFingerprint`, flags an audit stale, or enters `lostFacts` (`src/lib/offer-refetch.ts:22-27`). A re-fetch replaces `images` and `raw` whole (`src/pages/api/offer-refetch.ts:186`).
- **Render sites:** the gallery is the only place that shows `large` or more than one photo. The board row and the archive row each show one `thumbnail` (`h-20 w-28`). Each site filters through `safeHttpsUrl` on its own.
- **Lightbox path:** `@radix-ui/react-dialog@1.2.0` is already installed transitively through `@radix-ui/react-alert-dialog` (package-lock.json:3330-3341, 3436-3448). CLAUDE.md wants it as a **direct** dependency plus a `src/components/ui/dialog.tsx` made by the ritual (`bg-overlay` token, Polish close label). No island today takes an array prop or intercepts link clicks — both would be new. No test touches the gallery other than `render.test.ts` (SSR); there is no DOM test environment.

## Detailed Findings

### 1. otodom image variants

- Documentation: `context/foundation/ingestion/otodom_fetching.md:482-483` lists `thumbnail`, `small`, `medium`, `large`, `isExterior` per entry. Line 243 lists only `{small, medium, large}` — incomplete, since `thumbnail` exists in the payload and is what is stored. Neither line gives pixel sizes.
- Data (local Supabase, `public.offers`, 2 rows, 21 photos in `raw.images`):

  | variant          | URL suffix               | rows × photos with it | real JPEG size (1 photo fetched) | bytes   |
  | ---------------- | ------------------------ | --------------------- | -------------------------------- | ------- |
  | thumbnail        | `image;s=184x138;q=80`   | 21/21                 | 184×138                          | 7 272   |
  | small            | `image;s=314x236;q=80`   | 21/21                 | 314×236                          | 16 351  |
  | medium           | `image;s=655x491;q=80`   | 21/21                 | 654×491                          | 54 026  |
  | large            | `image;s=2048x1536;q=80` | 21/21                 | 2048×1536                        | 327 664 |
  | (not in payload) | `;s=1024x768;q=80`       | —                     | 1024×768                         | 115 173 |
  | (not in payload) | `;s=1280x960;q=80`       | —                     | 1280×960                         | 167 403 |

  The URL shape is `https://ireland.apollo.olxcdn.com/v1/files/<signed token>/image;s=WxH;q=80`. The token comes before `/image` and the size after it. Sizes outside the payload were served for the one photo tested, so the signature does not appear to cover the size. That is an observation on 1 photo, not a documented contract.

- `npm run otodom:inspect` was **not** run: the local rows already held the full `raw.images`, and the script prints only `images.length` for images (`scripts/otodom-inspect.mjs:94-97`), so it could not show the variants. No payload or seller data was written anywhere. The fetched test images sit in the session scratchpad, outside the repo.
- Cell width (inferred from classes, not measured in a browser):
  - Card page container: `max-w-6xl` = 1152 px (`src/layouts/AppLayout.astro:21`, `wide` for an offer, `src/pages/offers/[id].astro:132`).
  - Two-column grid `minmax(0,1fr)_minmax(0,24rem)` with `gap-6` (`src/components/offers/OfferView.astro:95`), so the left column is 1152 − 384 − 24 = 744 px.
  - The gallery is its own `Card`, a sibling of the offer card (`src/components/offers/OfferCard.astro:211`). Its `CardContent` has `px-6` (`src/components/ui/card.tsx:46`) plus a 1 px border each side, giving ~694 px of content.
  - Grid is `grid-cols-2 sm:grid-cols-3` with `gap-3` (`src/components/offers/OfferGallery.astro:37`), so a cell is (694 − 24) / 3 ≈ 223 px. One photo uses `grid-cols-1`, so ~694 px.
  - Below `lg` the layout is one column and the cell grows. Mobile is a Non-Goal.

### 2. Stored data and options for existing rows

- `OfferImage = { thumbnail: string; large: string }` (`src/lib/otodom/types.ts:52-55`).
- `mapImages` (`src/lib/otodom/map.ts:190-200`):
  - It reads `thumbnail` and `large` through the local `httpsUrl` (`map.ts:46-58`; it returns the trimmed input, not `URL.href`).
  - It drops an entry whose either URL fails.
  - It never reads `small` or `medium`.
- `raw` is a key whitelist copied as is: `RAW_AD_KEYS` includes `"images"` (`map.ts:19`), and `pickKeys`/`buildRaw` copy the value unchanged (`map.ts:148-161`). So `raw.images[i]` and `images[j]` are not index-aligned once `mapImages` has dropped an entry.
- Both local rows confirm this: `images` keys are `large,thumbnail`, and `raw.images` keys are `large,small,medium,thumbnail,isExterior` (12/12 and 9/9 entries).
- The card reads the whole row (`src/pages/offers/[id].astro:33`, `select("*")`), so `raw` is available to the view. The board and archive read `BOARD_COLUMNS` (`src/lib/offer-board.ts:64`, `src/lib/offer-archive.ts:33`), which include `images` but not `raw`.
- No check constraint on the column: `images jsonb not null default '[]'` (`supabase/migrations/20260922202756_create_offers.sql:59`).

Options:

|                            | (a) `medium` in `OfferImage` + re-fetch                                                                                                                                                                                                                                                                           | (b) read `raw.images` in the view                                                                                                                    | (c) `large` + `srcset`, no schema change                                                                                                                  |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sharp grid on new saves    | yes                                                                                                                                                                                                                                                                                                               | yes                                                                                                                                                  | yes, but each cell downloads `large` (~328 KB × up to ~20 photos) unless the URL is rewritten                                                             |
| Existing rows              | stay `{thumbnail, large}` until a member re-fetches (FR-009; a deliberate action, no backfill job allowed). The view needs a fallback for a missing `medium` (`large` is sharp but heavy; `thumbnail` stays blurry)                                                                                               | work immediately                                                                                                                                     | work immediately                                                                                                                                          |
| Fingerprint / stale audits | none — `images` is outside `AUDIT_OFFER_COLUMNS` (`input.ts:4-7`, `:45-71`); pinned by `tests/lib/audit/freshness.test.ts:313-321`, `tests/lib/audit/input.test.ts:108-109`                                                                                                                                       | none — `raw` also outside                                                                                                                            | none                                                                                                                                                      |
| Lost-facts rule            | none — `lostFacts` iterates `AUDIT_OFFER_COLUMNS` only (`offer-refetch.ts:22-27`); `images` is rejected as a token (`tests/lib/offer-refetch.test.ts:295`)                                                                                                                                                        | none                                                                                                                                                 | none                                                                                                                                                      |
| Re-fetch "changed" signal  | none — computed from `readAuditOffer` fingerprints (`api/offer-refetch.ts:221-228`)                                                                                                                                                                                                                               | none                                                                                                                                                 | none                                                                                                                                                      |
| Mapper tests               | `tests/lib/otodom/map.test.ts` has **no** assertion on `mapImages` output today; the synthetic fixture already carries `small`/`medium` (`tests/fixtures/otodom.ts:109-124`), so a new test needs no fixture change. `tests/pages/api/offer-refetch.test.ts:325-350` checks only the update's key list, unchanged | none; but the view then trusts a second member-writable source with no mapper validation, and must re-pair `raw.images` entries with no shared index | none                                                                                                                                                      |
| Other costs                | the gallery's "both URLs https" gate needs a rule for the third URL                                                                                                                                                                                                                                               | couples the view to otodom's payload shape, which `raw` exists to keep, not to render                                                                | rewriting `;s=` depends on undocumented CDN behaviour (§1) and on a URL any member can write — it would still have to pass `safeHttpsUrl` after rewriting |

### 3. Render sites and `safeHttpsUrl`

- Rule: `context/foundation/lessons.md:5-9`. Every URL from a row placed in `href`/`src` goes through `safeHttpsUrl` (`src/lib/safe-url.ts:7-15`, returns the normalised `href` or `null`).
- **`src/components/offers/OfferGallery.astro`**:
  - Prop `images: unknown[]` (`:10`).
  - `:18-22` filters `thumbnail` and `large` through `safeHttpsUrl` and keeps an entry only when both pass. A non-object entry is skipped.
  - It renders `<a href={large} target="_blank" rel="noopener noreferrer"><img src={thumbnail} loading="lazy" …></a>` (`:38-55`). The alt is `Zdjęcie N z M: <title>` (`:47`). An empty list renders `Unstated` (`:32-35`).
  - Its only caller is `src/components/offers/OfferCard.astro:85` (`Array.isArray(offer.images) ? … : []`) and `:211`.
- **`src/components/offers/OfferBoardItem.astro:39-46, 58-67`**: the first entry whose `thumbnail` passes `safeHttpsUrl` (`large` is not checked), shown at `h-20 w-28` with `alt=""`. Otherwise it shows an `aria-hidden` placeholder.
- **`src/components/offers/OfferArchiveItem.astro:35-41, 53-57`**: the same logic.
- **`src/components/offers/RefetchNotice.astro`**: nothing image-related.
- **Fixtures** (`src/pages/dev/_offer-fixtures.ts`):
  - `image(seed)` builds a picsum 320×240 thumbnail and an 800×600 large (`:37-42`).
  - `fullOffer` has 4 photos (`:89`), `unknownOffer` has `[]` (`:137`), `singleImageOffer` has 1 (`:141-149`).
  - `unsafeImagesOffer` holds an http: pair, a `javascript:` pair and 1 valid photo (`:151-166`).
  - `malformedImagesOffer` holds `null`, `42`, `{}` and a valid thumbnail with a `javascript:` large (`:168-187`), so it shows no photo in the gallery.
  - `archivedEntryUnsafeImages` is at `:293-298`.
  - Kitchen-sink use: `src/pages/dev/offer-card.astro:152, 173` and `src/pages/dev/board.astro:78-80, 202`.
- **What may reach an island:**
  - Island props are serialised into the `<astro-island props="…">` attribute, which is HTML-escaped JSON. The island also uses them for `href`/`src` on the client.
  - So the `.astro` side must pass only the already-filtered list, e.g. `{ grid, full }[]` of `safeHttpsUrl` results, plus the plain-text `title` for alt text. The raw `images` array must never reach the island.
  - Prop serialisation escapes text but does not check URL schemes, so the filter is what keeps a stored `javascript:` URL out of the browser. This is the lessons.md rule applied to a new sink.

### 4. Lightbox

- **Dependencies:**
  - Direct today: `@radix-ui/react-alert-dialog ^1.1.24`, `@radix-ui/react-select ^2.3.8`, `@radix-ui/react-slot ^1.1.2`. There is no umbrella `radix-ui` package.
  - `@radix-ui/react-dialog@1.2.0` is transitive only, pinned exactly by alert-dialog (package-lock.json:3330-3341, 3436-3448).
  - Per CLAUDE.md (### UI, Radix bullet) it must become a direct dependency, and the plan names it. `^1.2.0` would dedupe with the installed copy. No other new dependency is needed.
  - `lucide-react ^1.14.0` is installed and exports `XIcon`, `ChevronLeftIcon` and `ChevronRightIcon` (checked in `node_modules/lucide-react/dist/lucide-react.d.ts`).
- **Primitive:** `npx shadcn add dialog`, then the ritual.
  - Import `cn` from `@/lib/utils`, delete `"use client"`, and import from `@radix-ui/react-dialog` as `alert-dialog.tsx:2` imports from its own package.
  - Drop the umbrella `radix-ui` package if the CLI adds it.
  - Replace the registry's overlay literal with `bg-overlay`. The token is defined in `src/styles/global.css:57-59` and `:114-115` and exposed at `:148`, and `alert-dialog.tsx:19-30` is the reference.
  - Translate the close button's sr-only "Close" to „Zamknij”.
  - The content needs a wider max-width than the registry's `sm:max-w-lg` (a `className` override). Radix requires a `DialogTitle`, which may be sr-only.
  - The registry source was not fetched in this research. Lint (`tokensOnlyConfig`) has to pass on the generated classes, `backdrop-blur` included.
- **Data in:** one island receiving an array of `{ grid, full }` plus `title`. No island takes an array prop today, so this is new. Object props exist, e.g. `running` on `AuditRunner` (`OfferAudit.astro:262-271`).
- **No-JS fallback:**
  - A closed Radix dialog renders nothing on the server. `ConfirmDialog.tsx:53-54` has no no-JS path on purpose, and `render.test.ts:1705-1714` asserts that.
  - To keep today's behaviour without JS, the island renders the grid itself as the same `<a href={full} target="_blank" rel="noopener noreferrer"><img …></a>` markup. SSR then produces the current HTML.
  - On the client, `onClick` calls `preventDefault()` and opens the dialog at that index, but only for an unmodified primary click (`button === 0`, no meta/ctrl/shift/alt), so ctrl- or middle-click still opens a new tab.
  - There is no precedent for intercepting a link click. Precedents for markup that works without JS are native POST forms inside islands (`ArchiveForm.tsx:37-38`, `RefetchForm.tsx:36-37`) and `BoardSort.astro:3`.
- **Keys, counter, focus:**
  - Esc and focus trapping come from Radix.
  - ←/→ would be an `onKeyDown` on `DialogContent`, with a decision whether to wrap or clamp at the ends.
  - The „N z M” counter comes from the index state, and an `aria-live="polite"` region could announce it. That is a design choice; no existing `aria-live` precedent was checked.
  - Focus return: Radix returns focus to a `DialogTrigger`. With a custom open from an anchor's `onClick`, keep a ref per anchor and focus the clicked one in `onCloseAutoFocus`, with `preventDefault` on the default.
  - The navigation and index logic can be pure functions, testable without a browser, as `src/lib/audit/stream.ts` is for `AuditRunner`.
- **Dev-only open state:**
  - `ConfirmDialog.tsx:34-37, 72-80` has `defaultOpen` "for the /dev kitchen sinks alone". `src/pages/dev/forms.astro:120-123` reads `?open=` with `Astro.url.searchParams.get("open")`, and `:762, 772-776, 791-795` pass it.
  - `src/pages/dev/offer-card.astro` has no `searchParams` today.
  - Opening the lightbox there would need a dev-only prop (e.g. a starting index) threaded `OfferView → OfferCard → OfferGallery → island`. Today no such prop exists on that path.

### 5. Tests and kitchen sink

- **Gallery tests:** `tests/components/offers/render.test.ts:247-288`, `describe("OfferGallery: a photo renders only when both its URLs are https (#7)")`, with helper `gallery()` at `:104-106`.
  - `:270-287` asserts `imgSrcsIn == [THUMB]`, `hrefsIn == [LARGE]`, exactly 1 `<img>` and 1 `<a>`.
  - Swapping `src` to another variant changes the first assertion. Adding buttons or anchors in the SSR output changes the counts.
  - `urlsIn` (`:63-68`) requires every `href=`/`src=` to be quoted, and `expectOnlySafeUrls` (`:86-90`) allows `https://` or root-relative only.
  - Island wrappers add `component-url`/`renderer-url`, which these helpers do not read. Other tests normalise `<astro-island …>` (`:424`, `:1015`).
- Card-level image tests are at `render.test.ts:143` and `:151`. Archive item: `tests/components/offers/offer-archive.test.ts:246-265`. Audit privacy canary: `IMAGE_URL_CANARY` in `tests/fixtures/audit.ts:32` (used at `:139`, `:153`).
- **Test environment:**
  - Vitest with no jsdom/happy-dom and no `@testing-library/*` installed (vitest.config.ts; package-lock.json:13508-13543 only as optional peers).
  - Islands are tested by SSR through the Container API with the React renderer (`render.test.ts:1-2, 54-55`), and their logic as pure functions.
  - A click/keyboard test in a DOM would need a new dependency, which needs the user's go-ahead (CLAUDE.md Testing), or a Playwright spec.
- **Smoke / E2E:**
  - `scripts/smoke.mjs` touches no image. It only checks that `/dev/*` answers 404 in the preview (`:1130-1134`).
  - `tests/e2e/` touches no image, and `tests/e2e/fixture-offer.ts` saves an offer without `images`.
  - `tests/e2e/delete-with-confirmation.spec.ts:55-76` is the precedent for dialog role, Escape and focus-return assertions. Playwright is not a CI step.
- **`/dev/offer-card`:**
  - States live in a `states` array rendered through `OfferView` (`src/pages/dev/offer-card.astro:71-93`, `:123-178`, `:582-606`).
  - Gallery-relevant entries: `fullOffer` (4), `unknownOffer` (0), `singleImageOffer` (1), `unsafeImagesOffer`, `malformedImagesOffer`, `longTitleOffer` (2).
  - A new state is a fixture plus an entry. An "open on photo N" state needs a `?open=`-style switch, because the dialog is modal (the `/dev/forms` pattern above).
  - Fixture photos are picsum 320×240/800×600 with no `medium`, so a fixture shape change follows any `OfferImage` change.
  - `scripts/ui-screenshots.mjs:36-37` selects thumbnails as `[data-slot=card] a` containing `img` and external links as `a[target=_blank]` without `img`. Keeping `<a target=_blank><img>` keeps both selectors valid, though the change is ungated and screenshots are not required.

## Code References

- `src/components/offers/OfferGallery.astro:18-22, 37-55` — filter and grid
- `src/lib/otodom/map.ts:11-22, 46-58, 148-161, 190-200, 302` — raw whitelist, httpsUrl, mapImages
- `src/lib/otodom/types.ts:52-55` — `OfferImage`
- `src/lib/audit/input.ts:4-7, 45-71, 220-233, 334-350` — images excluded from the audit and fingerprint
- `src/lib/offer-refetch.ts:15-27` — lost facts over `AUDIT_OFFER_COLUMNS`
- `src/pages/api/offer-refetch.ts:27, 186, 221-228` — full replace, changed signal
- `src/components/offers/OfferBoardItem.astro:39-46`, `OfferArchiveItem.astro:35-41` — single-thumbnail sites
- `src/components/ui/alert-dialog.tsx:2, 19-46` — primitive pattern; `src/styles/global.css:57-59, 114-115, 148` — `bg-overlay`
- `src/components/form/ConfirmDialog.tsx:34-37, 53-54, 72-80` — `defaultOpen`, no no-JS path
- `src/pages/dev/forms.astro:120-123, 762` — `?open=`
- `src/pages/dev/_offer-fixtures.ts:37-42, 89, 137-187` — image fixtures
- `tests/components/offers/render.test.ts:247-288` — gallery tests
- `tests/fixtures/otodom.ts:109-124` — synthetic images incl. `small`/`medium`

## Architecture Insights

- `images` deliberately lives outside everything the audit, freshness and re-fetch rules read, so changing its element shape is free of product-invariant side effects. The cost is only in the views, the dev fixtures and the tests.
- `raw` is an archive of the source payload, built by whitelist for the personal-data rule. Rendering from it would turn it into a second display source with no mapper validation.
- The repo's island style is: the island owns its markup, and islands are tested by SSR plus pure functions. A lightbox that renders its own grid of plain links fits that style and keeps the no-JS behaviour byte-compatible with today.

## Historical Context (from prior changes)

- `context/foundation/roadmap.md:265`: "Photo viewer inside the card (lightbox)" was parked because S-02 opens the full-size photo in a new tab, "which keeps the card free of React state and of hand-rolled focus and keyboard handling". Revisit condition: browsing twenty photos becomes real friction. `change.md` records that the condition has been met.
- `context/foundation/lessons.md:5-9`: the `safeHttpsUrl` rule came from the card rendering stored URLs; the gallery fixtures with hostile URLs are its regression surface.

## Related Research

Not applicable — no other research artifact on the gallery was consulted.

## Open Questions (for /10x-plan)

1. **Variant source:** (a), (b) or (c). Evidence favours (a), with an explicit fallback for rows not yet re-fetched. Which fallback — `large` (sharp, ~328 KB/photo) or `thumbnail` (light, blurry until a re-fetch) — is a user choice.
2. **Single-photo case:** `medium` is under-resolved at ~694 CSS px. Use `large` there, or `srcset` with `medium 655w, large 2048w` and `sizes`.
3. **Gallery gate with three URLs:** must `medium` pass `safeHttpsUrl` for the entry to show, or does an unsafe `medium` just fall back? And does the mapper drop an entry whose `medium` fails, as it does for `thumbnail`/`large`?
4. **Navigation at the ends:** wrap or stop; whether the counter is announced through `aria-live`.
5. **Testing depth:** SSR + pure-function tests only (no new dependency), or also a Playwright spec for keyboard/focus (allowed, not a CI step). A DOM test library would need the user's go-ahead.
6. **Dev entry:** threading a dev-only "open at index" prop through `OfferView → OfferCard → OfferGallery` vs rendering the gallery island directly as its own section on `/dev/offer-card`.
7. **Docs:** `otodom_fetching.md:243` omits `thumbnail`. A one-line fix could note the measured sizes.
