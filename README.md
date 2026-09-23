# 10x Astro Starter

![](./public/template.png)

A modern, opinionated starter template for building fast, accessible web applications.

## Tech Stack

- [Astro](https://astro.build/) v7 - Modern web framework with server-first rendering
- [React](https://react.dev/) v19 - UI library for interactive components
- [TypeScript](https://www.typescriptlang.org/) v6 - Type-safe JavaScript
- [Tailwind CSS](https://tailwindcss.com/) v4 - Utility-first CSS framework
- [Supabase](https://supabase.com/) - Authentication and backend-as-a-service
- [Cloudflare Workers](https://workers.cloudflare.com/) - Edge deployment runtime

## Prerequisites

- Node.js v22.23.2 (as specified in `.nvmrc` — the version Cloudflare's build image preinstalls)
- npm (comes with Node.js)

## Getting Started

1. Clone the repository:

```bash
git clone https://github.com/Sigaretif/Vetpad.git
cd Vetpad
```

2. Install dependencies:

```bash
npm install
```

3. Set up Supabase and configure environment variables — see [Supabase Configuration](#supabase-configuration) below.

4. Create a `.dev.vars` file for local Cloudflare dev secrets:

```bash
cp .env.example .dev.vars
```

5. Run the development server:

```bash
npm run dev
```

## Available Scripts

- `npm run dev` - Start development server (Cloudflare workerd runtime)
- `npm run build` - Build for production
- `npm run preview` - Preview production build
- `npm run lint` - Run ESLint with type-checked rules
- `npm run lint:fix` - Auto-fix ESLint issues
- `npm run format` - Run Prettier
- `npm run smoke` - Smoke test the auth flow against a running server (`BASE_URL`, defaults to `http://localhost:4321`)
- `npm run otodom:inspect -- <url>` - Print what otodom.pl returns for one live offer next to what the app's mapper makes of it (debugging only, see below)

## Project Structure

```md
.
├── src/
│ ├── layouts/ # Astro layouts
│ ├── pages/ # Astro pages
│ │ └── api/ # API endpoints
│ ├── components/ # UI components (Astro & React)
│ └── assets/ # Static assets
├── public/ # Public assets
├── wrangler.jsonc # Cloudflare Workers config
```

## Supabase Configuration

This project uses [Supabase](https://supabase.com/) for authentication. Environment variables are declared via Astro's `astro:env` schema and are treated as **server-only secrets** — they are never exposed to the client.

### First-time setup (local, no cloud project needed)

Requires [Docker](https://www.docker.com/) and ~7 GB RAM.

1. Create your `.env` file:

```bash
cp .env.example .env
```

2. Initialize the local Supabase project (creates a `supabase/` config folder):

```bash
npx supabase init
```

3. Start the local stack (downloads Docker images on first run):

```bash
npx supabase start
```

4. Copy the credentials printed by the CLI into your `.env` and `.dev.vars`:

```
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_KEY=<anon key from CLI output>
```

5. To stop the stack when done:

```bash
npx supabase stop
```

The local Studio UI is available at `http://localhost:54323`.

The schema lives in `supabase/migrations/` (the first one creates `public.offers` with its row-level security policies). `npx supabase start` applies every migration and then `supabase/seed.sql` on a fresh stack; `npx supabase db reset` rebuilds the local database from the same files. A hosted project gets the migrations with `npx supabase db push` (seeds are not run), and a human runs it before deploying the Worker that needs them — see [`context/foundation/deployment-runbook.md`](./context/foundation/deployment-runbook.md).

### Using a cloud Supabase project instead

If you prefer to use a hosted Supabase project, add these variables to your `.env` and `.dev.vars` files:

| Variable       | Description                                                           |
| -------------- | --------------------------------------------------------------------- |
| `SUPABASE_URL` | Project URL from Supabase dashboard → Settings → API                  |
| `SUPABASE_KEY` | **Publishable** key from Supabase dashboard → Settings → **API Keys** |

```
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_KEY=sb_publishable_...
```

Supabase is retiring the `anon` / `service_role` naming by the end of 2026. A project created today shows **publishable** (`sb_publishable_...`) and **secret** (`sb_secret_...`) under Settings → API Keys; an older project may still show `anon` and `service_role` under Settings → API. The mapping is one to one — publishable replaces `anon`, and that is the one this app uses.

> Never use the **secret** / `service_role` key here. It bypasses row-level security entirely, and it fails silently: the app works, and the database is wide open. The correct key starts with `sb_publishable_`, never `sb_secret_`.

### Team accounts

Registration is closed (FR-001): only the team's pre-created accounts can sign in, and Supabase Auth itself rejects sign-ups (`[auth] enable_signup = false` in `supabase/config.toml`, "Allow new users to sign up" off in the hosted dashboard).

- **Locally**, `supabase/seed.sql` creates three confirmed accounts, `sigaretif1@vetpad.local` to `sigaretif3@vetpad.local`, on a fresh `npx supabase start` or `npx supabase db reset`.
- **In the hosted project**, the administrator creates the accounts by hand, following "Team accounts" in [`context/foundation/deployment-runbook.md`](./context/foundation/deployment-runbook.md). They never go into `seed.sql`.

### Auth routes

| Route              | Description                                                                                                                                                                              |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/auth/signin`     | Email/password sign-in form                                                                                                                                                              |
| `/dashboard`       | Protected page with the form for adding an otodom.pl listing (redirects to `/auth/signin` if unauthenticated)                                                                            |
| `/offers/<id>`     | Protected offer card: description, parameters and photo gallery of a saved listing                                                                                                       |
| `POST /api/offers` | Form endpoint behind "add listing": saves a flat-sale listing and redirects to its card, or back to `/dashboard?error=…` with nothing saved; an anonymous request goes to `/auth/signin` |

Route protection is handled in `src/middleware.ts`: `PROTECTED_ROUTES` covers `/dashboard` and every path under `/offers`. Add paths to that array to require authentication. API routes are not covered by it — `src/pages/api/offers.ts` checks the signed-in user itself.

## Deployment

This project deploys to [Cloudflare Workers](https://workers.cloudflare.com/) — **not** Cloudflare Pages. `@astrojs/cloudflare` v14 dropped Pages support entirely, so `wrangler pages deploy` is wrong for this repository.

**Runs on the Workers Free plan.** Cloudflare meters **CPU time**, not request duration: waiting on `fetch()` does not count toward it, and HTTP-triggered Workers have no hard duration limit while the client stays connected — on Free too. The only open question is whether CPU-bound work fits in Free's 10 ms per invocation, which is measured once real ingestion and audit code exists. The symptom to watch for is error **1102 "Worker exceeded resource limits"** — it reads like a code bug and is not one. See `context/changes/deployment/deployment-plan.md` → "Kiedy wrócić do pytania o plan płatny".

> `wrangler.jsonc` deliberately carries **no `limits` block**: `limits.cpu_ms` is rejected on the Free plan (API error 100328) and blocks the deploy. It is added in the same change that upgrades to Workers Paid.

### Default path: Workers Builds

Cloudflare builds and deploys on every push to `master`. Configured in the Cloudflare dashboard under the Worker's **Settings → Builds** (production branch `master`, build command `npm run build`, deploy command `npx wrangler deploy`). GitHub Actions is the quality gate only and carries no deploy step.

### Fallback path: manual deploy

```bash
npm run build
npx wrangler deploy
```

### Secrets

Set `SUPABASE_URL` and `SUPABASE_KEY` via `npx wrangler secret put <NAME>`. Each one creates a new version and deploys it immediately; secrets are write-only once set. The app deploys and renders without them — `src/lib/config-status.ts` reports the gap in a banner — so this step can follow a first successful deploy.

The full deployment plan, including prerequisites, edge cases and the operational runbook, is at [`context/changes/deployment/deployment-plan.md`](./context/changes/deployment/deployment-plan.md).

## Smoke test

`scripts/smoke.mjs` is a dependency-free Node script that walks the auth flow over HTTP: it signs in with a seeded account (sign-in, protected page, sign-out) and checks that registration is closed — the app's signup routes return 404 and Supabase Auth answers a sign-up attempt with `signup_disabled`. It also checks that `/offers/<id>` and `POST /api/offers` turn anonymous visitors away, and that `POST /api/offers` refuses an empty URL, a foreign host and a non-offer otodom.pl address without ever reaching otodom.pl. It also checks that the dev-only kitchen sink `/dev/offer-card` answers 404, which keeps that test page out of production. Run it against the production preview after dependency upgrades:

```bash
npm run build && npm run preview
BASE_URL=http://localhost:4321 npm run smoke
```

Against `npm run dev` every step works except `/dev/offer-card` → 404, which fails there by design: the page renders under `astro dev` only.

It needs the local Supabase started with the seed (`npx supabase start`) and `SUPABASE_URL`/`SUPABASE_KEY` in `.env`, which `npm run smoke` loads. Credentials default to `sigaretif1@vetpad.local` and can be overridden with `SMOKE_EMAIL`/`SMOKE_PASSWORD`. Never run it against production: the seeded account exists only locally, and the sign-up attempt is only harmless on a throwaway database.

> **Note:** this script exists primarily to guard the development of the starter itself — it is a fast sanity check that dependency upgrades did not break the build, the Cloudflare adapter or the Supabase auth flow. It is **not** a substitute for a real test suite. Once you build your own product on top of this starter, add proper tests (unit, integration, end-to-end) suited to your application.

## Inspecting an otodom.pl listing

```bash
npm run otodom:inspect -- https://www.otodom.pl/pl/oferta/<slug>
```

`scripts/otodom-inspect.mjs` fetches one live offer with the app's own `src/lib/otodom/` code and prints the flat-sale gate's inputs and verdict, every raw `characteristics` entry, and the mapped row with the fields that came out as unknown. Use it when a listing is refused or a parameter maps wrong. It hits the live portal, so it is a debugging tool, not a test, and it never runs in CI. What it has shown so far is recorded in [`context/foundation/ingestion/otodom_fetching.md`](./context/foundation/ingestion/otodom_fetching.md), section 7.4.

## CI

GitHub Actions runs two jobs on every push and PR to `master`:

- **ci** — lint, `astro check` and build. Configure `SUPABASE_URL` and `SUPABASE_KEY` as repository secrets for the build step.
- **smoke** — starts a local Supabase via the Supabase CLI, builds, serves the production preview on the Cloudflare runtime and runs `npm run smoke` against it. No secrets required.

## License

MIT
