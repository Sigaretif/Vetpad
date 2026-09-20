---
project: vetpad
context_type: runbook
platform: Cloudflare Workers
worker_name: vetpad
production_url: https://vetpad.vetpad.workers.dev
plan: Workers Free
first_deployed: 2026-09-20
---

# Deployment Runbook

Operational knowledge for shipping and debugging Vetpad in production. Written for
an agent starting a fresh session with no memory of how this was set up.

`@context/foundation/infrastructure.md` is *why* this platform was chosen.
This file is *how it actually behaves*, written after deploy zero — every entry
below was observed, not predicted. The step-by-step account of that first deploy
lives in `context/changes/deployment/deployment-plan.md` until that change is
archived; this file is the part that outlives it.

## Current state

| | |
| --- | --- |
| Worker | `vetpad` |
| Production URL | <https://vetpad.vetpad.workers.dev> |
| Cloudflare account | `917c8d5693d671be4227202d2ceb42ed` |
| Plan | **Workers Free** — deliberate, see "When to buy Workers Paid" |
| Auto-deploy | Workers Builds, production branch **`master`** |
| Secrets in production | `SUPABASE_URL`, `SUPABASE_KEY` (hosted Supabase, publishable key) |
| KV binding | `SESSION` → namespace `vetpad-session` (auto-provisioned, adapter-injected) |
| Preview URLs | **disabled** (`preview_urls: false`) |
| Observability | enabled; `wrangler tail` and Workers Logs both work on Free |

## How a change reaches production

**The routine path is a push to `master`.** Workers Builds runs `npm run build`
then `npx wrangler deploy`. Nothing else is needed and nobody has to run a deploy
command. GitHub Actions is a quality gate only and carries no deploy step.

Changes leave the working tree through `/git-ship` or `/git-land` — user-invoked
skills, and `CLAUDE.md` requires asking which one every time. An agent cannot run
either; ask the user.

**The emergency path** is a manual deploy from a local tree:

```bash
npm run build && npx wrangler deploy
```

Use it when Workers Builds is broken or unavailable, not as a habit — two deploy
sources racing is how a tree and a production Worker drift apart. Never
`wrangler pages deploy`: `@astrojs/cloudflare` v14 dropped Pages support, so that
command is wrong for this repository no matter what a tutorial says.

## Verifying a deploy

Routes, banner, Supabase reachability and the CPU ceiling in one pass:

```bash
B=https://vetpad.vetpad.workers.dev
for p in "/" "/auth/signin"; do printf '%-14s %s\n' "$p" "$(curl -s -o /dev/null -w '%{http_code}' "$B$p")"; done
curl -s -o /dev/null -w "/dashboard %{http_code} -> %{redirect_url}\n" "$B/dashboard"
curl -s -o /tmp/p.html "$B/"
grep -q "Supabase nie jest skonfigurowany" /tmp/p.html && echo "banner: VISIBLE — secrets missing" || echo "banner: gone"
grep -qiE "1102|exceeded resource limits" /tmp/p.html && echo "!!! 1102" || echo "1102: none"
curl -s -o /dev/null -w "wrong-password -> %{redirect_url}\n" -X POST "$B/api/auth/signin" \
  -H "Origin: $B" --data-urlencode "email=x@y.z" --data-urlencode "password=wrong"
```

Expected: `200`, `200`, `302 -> /auth/signin`, banner gone, no 1102, and the wrong
password redirect carrying `?error=Invalid%20login%20credentials`.

**That last check is the useful one.** A correct `Invalid login credentials` proves
the Worker reached the hosted Supabase — an unreachable one fails differently. It
verifies the whole path without anybody holding a production password. Signing in
for real stays a human action in a browser.

## Rollback

```bash
npx wrangler versions list          # candidates
npx wrangler rollback [version-id]  # seconds
```

**Rollback reverts code, never data.** Once `supabase/migrations/` exists, a rolled
back Worker may not understand the current schema — that is a manual recovery, not
a rollback. A `wrangler secret put` is itself a new version, so rolling back code
can roll back a secret with it; check `wrangler secret list` afterwards.

## Logs

```bash
npx wrangler tail --format json
```

Workers Logs is included on Free (200k events/day, 3-day retention) and
`observability.enabled` is already true, so the dashboard's log view works with no
extra setup.

## Symptoms that lie

Every row here was hit or verified during deploy zero. All of them look like
something other than what they are, which is the only reason this table exists.

| Symptom | Actual cause | Action |
| --- | --- | --- |
| `1102 Worker exceeded resource limits` | Free plan's 10 ms CPU ceiling | **Check the plan before debugging code.** The message names no limit and reads like an application bug |
| Deploy rejected, API error **100328** | a `limits` block in `wrangler.jsonc` while on Free | Remove it. `limits.cpu_ms` is Paid-only and blocks the deploy outright |
| `curl` exit 35 / `sslv3 alert handshake failure` on a fresh `*.workers.dev` name | certificate not issued yet — the wildcard covers one label, this host has two | Wait ~2 minutes and retry. The Worker is already live |
| Push to `master` triggers no build, silently | Workers Builds production branch left at the default `main` | Set it to `master`. Failure mode is silence, not an error |
| Build fails during install | `.nvmrc` pins a version the build image lacks | Image preinstalls **22.23.2** and **24.18.0** only; an exact version outside those forces a source build |
| New version shows source `version_upload`, looks unpromoted | `wrangler deploy` is upload **then** promotion, and the API labels them separately | Check `wrangler deployments list` — 100% traffic on the new version means it deployed |
| Login fails in production, **and no banner appears** | hosted Supabase project paused after ~7 days idle (Free tier) | Resume it in the Supabase dashboard. `src/lib/config-status.ts` detects *unset* variables, never an *unreachable* service |
| A table returns `[]` with HTTP 200 | RLS is on with no `select` policy — looks like missing data | Add the policy. **Never** reach for the `secret` / `service_role` key |
| Secrets appear to vanish after an auto-deploy | they do not — secrets are per-Worker, not per-version | Verified: they survived the first Workers Builds deploy |

## Contingencies

### Ingestion starts failing (otodom)

**Verified 2026-09-20: otodom serves Cloudflare's egress** — HTTP 200 with
`__NEXT_DATA__` present, no captcha, no `cf-mitigated` header
(`@context/foundation/ingestion/otodom_fetching.md` § 9.1). So the direct path in
§ 7.1 is the one in use: one `fetch`, one bounded `RegExp`, `JSON.parse`.

One observation is not permanent access. Blocking of datacenter ranges arrives
gradually, so **log every non-200 fetch status distinctly from a parse failure** —
otherwise intermittent blocking is indistinguishable from a broken parser, which is
exactly the failure the pre-mortem describes.

Re-run the probe before concluding anything: deploy a throwaway Worker **outside
this repository** that fetches one otodom URL and returns the status code plus
whether `__NEXT_DATA__` is present, call it once, then
`npx wrangler delete --force`. It takes ten minutes and turns a guess into a fact.

If it returns 403/429 or a captcha, the fallback is the extraction service in
`@context/foundation/ingestion/otodom_apify.md` — **verified end to end**, request
shape and failure modes included. Adopting it is a decision to raise with the user,
never a default: it is a second vendor, a second secret in six places, and a second
failure mode. Three things to know before starting:

- **Server-side field projection is mandatory, not an optimisation.** `sellerPhone`
  and `agencyName` carry a private seller's phone number and real name. Request
  `?fields=...` so they never enter the Worker (§ 6.1). `CLAUDE.md` and the PRD both
  forbid storing them.
- The actor reports a **missing offer as HTTP 201 with a fake result**, not a 404.
  Filter it, or the product will save a blank offer — which the PRD forbids outright.
- One maintainer, one version, no reviews. Re-run the verification table in § 10
  before trusting the document.

### The CPU ceiling is reached

The Free plan carried deploy zero with room to spare: Astro SSR showed no 1102, and
a probe decoded 1.2 MB of HTML and scanned it without tripping the limit. That
measurement was taken against an **almost empty application** and does not predict
the one that ingests listings.

Re-measure before these land on `master`:

- **FR-004 ingestion** — `JSON.parse` over a full `__NEXT_DATA__` payload builds
  objects and is categorically more expensive than a substring scan. This is the
  single heaviest CPU consumer in the product.
- **FR-010 audit** — parsing the model's structured output is small, but it adds to
  an existing budget. The model call itself costs almost no CPU: waiting on `fetch`
  is not metered, and HTTP-triggered Workers have no duration limit on Free either.

When the ceiling is reached, enable Workers Paid and **in the same change** add:

```jsonc
"limits": { "cpu_ms": 300000 },
```

Without it the Paid default is 30 s, not the headline 5 minutes — the pre-mortem's
exact failure: the audit dies on the longest listings, the ones that most needed
auditing, and it looks like a model-provider problem for weeks.

### Adding the model provider key (FR-010)

Server-only, and it lands in **six** places: the `astro.config.mjs` schema, `.env`,
`.dev.vars`, `.env.example`, Workers Secrets, and GitHub repository secrets. Plus a
factory returning `null` when unset and a `ConfigStatus` entry, so absence shows up
in the banner instead of crashing a route.

Never call a model provider from a React island — islands ship to the browser and
the key would ship with them.

## What only a human does

An agent may run `astro build`, `wrangler deploy`, `wrangler versions upload`,
`wrangler tail` and `wrangler rollback` unattended.

A human does, by hand: creating accounts and API tokens, `wrangler login`, setting
or rotating any production secret, applying a migration to the hosted project,
deleting the Worker, changing the billing plan, dashboard configuration, and
invoking `/git-ship` or `/git-land`.

## Two databases, never one

| Where | Which Supabase |
| --- | --- |
| `.env`, `.dev.vars` — `npm run dev`, `preview`, `smoke` | **local** (`npx supabase start`) |
| CI `smoke` job | its own local container |
| Workers Secrets | **hosted** |

Local development uses the local database. `npm run smoke` registers a fresh account
on every run and would litter production `auth.users`; migration work runs through
`supabase db reset`, which wipes whatever it points at.

**`supabase db reset --linked` wipes the hosted database and runs `supabase/seed.sql`
against it.** Seeds are not inherently local. Migrations reach the hosted project
with `supabase db push`, which does not run seeds.
