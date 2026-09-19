---
project: vetpad
researched_at: 2026-09-19
recommended_platform: Cloudflare Workers
runner_up: Vercel
context_type: mvp
tech_stack:
  language: TypeScript
  framework: Astro 7.3 (SSR, React 19 islands, Tailwind 4)
  runtime: Cloudflare Workers (workerd) via @astrojs/cloudflare ^14.3
---

## Recommendation

**Deploy on Cloudflare Workers.**

Three platforms tied at 5/5 on the agent-friendly criteria (Cloudflare, Vercel, Railway), so the
criteria alone did not decide this. What decided it is the one axis where the platforms genuinely
differ for this product: how long a single HTTP request may wait on an outbound `fetch`. The PRD
budgets roughly three minutes for the AI audit and the Business Logic section makes that a
foreground, member-triggered action — the member watches it run. Cloudflare is the only candidate
with **no wall-clock limit on a request handler at all**, and the only one where the documented
billing unit (CPU time) explicitly excludes waiting on `fetch`. Vercel's 300 s ceiling also fits,
but it is a fixed ceiling rather than the absence of one. Interview answers barely moved the
ranking and that is itself informative: external providers are fine (Supabase is already external),
so co-located databases earn nobody points, and a single-region audience neutralises Cloudflare's
edge advantage. The decision rests on request duration and on Cloudflare's documentation being the
most machine-readable of the six, which matters more than usual because the developer reported no
prior platform experience.

## Platform Comparison

Every status below was checked on 2026-09-19.

| Platform | CLI-first | Managed/Serverless | Agent-readable docs | Stable deploy API | MCP / Integration | Total |
|---|---|---|---|---|---|---|
| **Cloudflare Workers** | Pass | Pass | Pass | Pass | Pass | 5/5 |
| **Vercel** | Pass | Pass | Pass | Pass | Pass | 5/5 |
| **Railway** | Pass | Pass | Pass | Pass | Pass | 5/5 |
| Render | Partial | Pass | Pass | Pass | Pass | 4/5 |
| Fly.io | Pass | Partial | Pass | Pass | Partial | 3/5 |
| Netlify | Partial | Pass | Pass | Pass | Pass | dropped by hard filter |

### Hard filters applied before scoring

- **Persistent connections**: not required (interview Q1 — request/response only, consistent with
  the PRD's Non-Goals: no scheduled jobs, no background re-scraping, no notifications). Dropped
  nobody.
- **Runtime compatibility**: all six run TypeScript / Astro 7 SSR through an official adapter.
  Dropped nobody.
- **~3-minute audit inside one HTTP request** (PRD, Business Logic + Non-Functional Requirements):
  **dropped Netlify**. Netlify's synchronous function limit is 60 s, uniform across every plan and
  not configurable. Background Functions reach 15 minutes but return `202` immediately with no
  response body and no streaming, which is a different architecture (async polling), not a
  deployment of this one.

### Per-platform notes

**Cloudflare Workers** — `wrangler deploy` / `wrangler rollback` / `wrangler tail` /
`wrangler secret put` cover the whole operational loop with no dashboard step. Docs are the
strongest agent surface of the six: a fundamentals `llms.txt`, per-product `llms.txt` and
`llms-full.txt`, every page available as `<url>/index.md` or via an `Accept: text/markdown` header,
and the source on GitHub at `cloudflare/cloudflare-docs`. The limits page states plainly that
waiting on network requests does not count toward CPU time, and that HTTP-triggered Workers have no
hard duration limit while the client stays connected. Cloudflare's own MCP servers exist as a
family at `*.mcp.cloudflare.com` (docs, Workers bindings, builds, observability), but none carries
an explicit GA or beta label — see the risk register.

**Vercel** — equally complete CLI (`vercel deploy --prod`, `vercel rollback`, `vercel promote`,
`vercel logs --follow`, `vercel env`), `llms.txt` and `llms-full.txt`, and a hosted OAuth MCP
server at `mcp.vercel.com`. Fluid compute (GA since 2025-04-23) gives Hobby a 300 s maximum
duration, which covers a 180 s audit with margin; the adapter exposes `maxDuration` in
`astro.config.mjs`. Its real advantage over Cloudflare is a full Node runtime with no CPU-ms
metering, which would lift this project's ban on parsing a listing page. Its constraint is that the
Hobby plan is restricted to non-commercial personal use.

**Railway** — Railpack (now the default builder; Nixpacks is in maintenance mode) detects an Astro
Node app from `package.json` with no Dockerfile. `railway up --detach` is CI-safe and
non-interactive with `RAILWAY_TOKEN`; `railway redeploy` covers rollback; docs mirror every page at
`<url>.md` plus a `llms.txt` index. EU West Metal (Amsterdam) is GA. The proxy allows 15 minutes of
active transfer but closes connections idle for 5 minutes — a silent 3-minute wait passes, but
without much margin and with no doc explicitly exempting a non-streaming wait.

**Render** — scored Partial on CLI because the operational loop has holes an agent cannot close:
there is no rollback command (Dashboard or REST API only) and no confirmed command for setting
environment variables. Docs are strong (`llms.txt`, `llms-full.txt`, markdown via `.md` suffix,
plus a `render-oss/skills` repo). The blocking issue is that **no Render document states a maximum
request duration**, and Render's own guidance actively discourages holding a request open for long
synchronous work, pointing instead at Render Workflows (public beta). An undocumented limit is
worse than a documented low one, because it cannot be designed around.

**Fly.io** — `flyctl` is complete for deploy, logs and secrets, though rollback is a manual pattern
(`fly releases --image`, then redeploy that image hash) rather than a command, and old images can
be pruned. Scored Partial on managed/serverless: Dockerfiles, Machines, health checks that do not
auto-restart on failure, and explicit `auto_stop_machines` configuration are meaningfully more
operational surface than the rest of the field. Partial on MCP: `fly mcp server` exists but carries
no maturity label. Frankfurt (`fra`) is the nearest region; there is no Warsaw. The proxy's default
idle timeout is **60 seconds**, so the audit route would require an explicit `idle_timeout` raise in
`fly.toml` — a default that fails, not a default that works.

**Netlify** — dropped on the 60 s filter above. Worth recording that it scored well otherwise:
`llms.txt`, a hosted MCP server, and Netlify DB (Neon) GA since 2026-04-28. Its CLI lacks a
rollback command; rollback is a dashboard "Publish deploy" on a prior atomic deploy, or the API.

### Shortlisted Platforms

#### 1. Cloudflare Workers (Recommended)

Wins on the only axis that separated the leaders: a request handler has no wall-clock limit while
the client stays connected, and the metered resource (CPU time) excludes `fetch` waits. That maps
exactly onto an audit that spends ~3 minutes waiting on a model provider and almost no time
computing. Secondary wins: the best machine-readable documentation of the six, which matters
because the developer has no prior platform experience to fall back on; `$5`/month for the plan this
project actually needs; and, from adapter v13 onward, `astro dev` and `astro preview` already run
on workerd, so local development and production share a runtime with no separate platform-native
dev command.

#### 2. Vercel

Matches Cloudflare on all five criteria and beats it on runtime headroom: a full Node runtime with
no CPU metering, which would remove this project's constraint against parsing a full listing page
and open up `cheerio` or similar. Its 300 s Hobby ceiling covers the audit. The gap is that the
ceiling is fixed where Cloudflare's is absent, that the Hobby plan forbids commercial use (fine for
a private family tool, a decision point if that ever changes), and that adopting it means replacing
the adapter, `wrangler.jsonc`, the deploy step and several rules in `CLAUDE.md`.

#### 3. Railway

The strongest of the long-lived-process options: no CPU metering, no cold starts when always-on,
Railpack detects Astro without a Dockerfile, an Amsterdam region, and a complete scriptable CLI.
The gap is the 5-minute idle-connection close, which puts a silent 3-minute audit uncomfortably
near a boundary that no document explicitly exempts it from, plus the absence of a free tier
($5/month minimum, which doubles as usage credit).

## Anti-Bias Cross-Check: Cloudflare Workers

This cross-check carried more weight than usual: the repository already targets Workers
(`wrangler.jsonc`, `@astrojs/cloudflare`, and a `CLAUDE.md` written around Workers constraints), so
the research started tilted toward confirming a decision that had already been made.

### Devil's Advocate — Weaknesses

1. **The free plan is not a tier this application can use.** The Free plan caps CPU at 10 ms per
   invocation. Astro SSR rendering a dashboard with React islands, plus `JSON.parse` over a full
   `__NEXT_DATA__` payload, will exceed that. The $5/month Workers Paid plan is mandatory from day
   one — and its *default* CPU limit is 30 seconds, not the headline 5-minute maximum. Reaching the
   maximum requires an explicit `limits` block in `wrangler.jsonc`. Nothing surfaces this until a
   request dies in production.
2. **The HTML-parsing ban targets the wrong artifact.** `CLAUDE.md` forbids `cheerio`,
   `node-html-parser` and DOM walks over a fetched page, on CPU grounds. But `JSON.parse` over a
   several-hundred-kilobyte `__NEXT_DATA__` blob is the same CPU-bound full-page pass in a different
   format, and the rule permits it. The protection does not cover the path the project actually
   uses.
3. **Cloudflare egress is the most heavily flagged datacenter IP space on the web**, and Vetpad's
   entire ingestion path depends on otodom.pl serving a Worker. otodom.pl is itself most likely
   Cloudflare-fronted. Cloudflare's own community forum carries recurring reports of Workers egress
   being blocked. That `CLAUDE.md` already documents a third-party extraction fallback means the
   risk is priced in, not that it is mitigated — adopting the fallback is a second vendor, a second
   secret in six places, and a second failure mode.
4. **Runtime parity cuts both ways.** `astro dev` on workerd catches missing Node APIs immediately,
   which is honest. It also means any dependency added later that needs CommonJS `require` or an
   unsupported `node:*` module fails at install time rather than at deploy time. Under a seven-week
   after-hours deadline that is a real velocity cost, not only a virtue.
5. **There is no escape hatch.** If the audit route ever needs libraries that assume Node streams,
   switching adapters means re-verifying every place the zero-config contract puts an integration —
   the `astro.config.mjs` schema, the factory, every call site, and the config-status entry — which
   is a wider change than "swap the adapter".

### Pre-Mortem — How This Could Fail

Six months on, the decision has turned out badly. The first week after deploy looks perfect: the
audit completes, `wrangler tail` shows clean logs, the bill is five dollars. The crack appears
quietly — otodom starts returning 403 to a fraction of Worker requests, irregularly, perhaps one in
ten. The team reads it as a portal glitch, because the same page loads fine in a browser. Ingestion
becomes a lottery exactly as a wave of new listings hits the market. Switching to the extraction
fallback means threading a new secret through six places and rewriting the fetch path — a weekend's
work that does not exist, because the deadline is two weeks out. In parallel the audit starts
failing on longer listings: nobody set `limits.cpu_ms`, so the default 30-second CPU ceiling kills
requests on the largest descriptions — precisely the ones that most needed auditing. The failure
looks like a model provider problem, so it is debugged on the wrong side for three weeks. The team
goes back to the spreadsheet. The PRD's primary success criterion fails, not because the platform
was wrong, but because of two defaults nobody checked.

### Unknown Unknowns

- **The repository's `compatibility_date` is `2026-05-08`**, which predates the 2026-08-04 change
  that made `nodejs_compat` the default. The explicit flag is present, so it works today — but any
  future bump of that date crosses a behavioural boundary and is a change to test, not a version
  bump.
- **"Wait inside one request" is architectural lock-in disguised as a hosting choice.** Only
  Cloudflare and Vercel support the pattern without streaming. Fly (60 s idle) and Railway (5 min
  idle) would both force a rewrite to polling. Leaving Cloudflare later is not an adapter swap; it
  is a rebuild of the audit's interaction model.
- **No platform limit does not mean no limit.** Browsers and intermediate proxies also drop silent
  long-lived requests. The PRD's requirement that any operation in progress stays continuously
  visible as in progress effectively demands streaming or polling regardless of what Cloudflare
  permits.
- **`@astrojs/cloudflare` v14 dropped Cloudflare Pages support entirely.** Workers is the only path.
  Every tutorial — and a large share of model-generated answers — saying `wrangler pages deploy` is
  wrong for this repository, which is why `CLAUDE.md` bans it by name.
- **Cloudflare's own MCP servers carry no per-server GA or beta label** on the documentation page
  listing them. Treating any one of them as stable is an assumption, not a documented fact.

## Operational Story

- **Preview deploys**: `wrangler versions upload` publishes a non-production version and returns a
  preview URL; `wrangler versions deploy` promotes it. Preview URLs are public by default — put
  Cloudflare Access in front of them before any real Supabase data is reachable through one. The
  existing GitHub Actions `ci` job builds every PR but does not deploy, so preview deploys are an
  opt-in manual step today, not an automatic per-PR URL.
- **Secrets**: `SUPABASE_URL` and `SUPABASE_KEY` live in three places, and the model-provider key
  will make it four. Locally in `.env` (Astro) and `.dev.vars` (workerd); in GitHub repository
  secrets, which `.github/workflows/ci.yml` injects into the `ci` job's build step; and in Workers
  Secrets via `npx wrangler secret put <NAME>`, which creates a new version and deploys it
  immediately. Workers secrets are write-only once set — they can be replaced, not read back.
  Rotation is `wrangler secret put` again, then update the GitHub secret to match.
- **Rollback**: `npx wrangler rollback` reverts to the previous version; `npx wrangler rollback
  <version-id>` targets a specific one, and `wrangler versions list` shows the candidates. Time to
  revert is seconds. The caveat that matters here: a rollback reverts code, never data. Once
  Supabase migrations exist, a schema change that a rolled-back Worker cannot read is a manual
  recovery, and a `wrangler secret put` is itself a new version, so rolling back code can roll back
  a secret with it.
- **Approval**: an agent may run `wrangler deploy`, `wrangler versions upload`, `wrangler tail`,
  `wrangler rollback` and `astro build` unattended. A human does, by hand: creating the Cloudflare
  account and API token, the first `wrangler login`, setting or rotating any production secret,
  applying a Supabase migration to the hosted project, deleting the Worker, and any billing-plan
  change. The API token this project uses should be scoped to Workers for this one project — no
  DNS, no unrelated Workers Secrets, no billing.
- **Logs**: `npx wrangler tail` streams live requests and exceptions; `wrangler tail --format json`
  gives structured output an agent can parse. `observability.enabled` is already `true` in
  `wrangler.jsonc`, so invocation logs are queryable in the dashboard's Workers Logs without extra
  setup. Cloudflare's observability MCP server exposes the same data as structured tools, at the
  cost of the caveat in the risk register about unlabelled server maturity.

## Risk Register

| Risk | Source | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Default 30 s CPU limit on the Paid plan kills the audit on long listings; nobody notices the default is not the 5-min maximum | Devil's advocate | M | H | Add an explicit `limits` block to `wrangler.jsonc` before first deploy and check the per-request CPU number in the Workers dashboard after the first real audit |
| Free plan's 10 ms CPU cap makes the free tier unusable; deploy silently fails under load | Devil's advocate | H | M | Treat Workers Paid ($5/mo) as a prerequisite of the first deploy, not an upgrade path |
| otodom.pl returns 403 to Cloudflare egress IPs, intermittently at first | Research finding + Pre-mortem | M | H | Log every non-200 fetch status distinctly from a parse failure so intermittent blocking is visible as blocking; keep the extraction-service fallback in `context/foundation/ingestion/otodom_apify.md` ready to adopt as a decision, not a scramble |
| `JSON.parse` over a large `__NEXT_DATA__` payload is the CPU-bound full-page pass the HTML-parsing ban was meant to prevent | Devil's advocate | M | M | Measure CPU time on the largest real listing before merging ingestion; if it is close to the limit, extract the needed subtree with a bounded RegExp rather than parsing the whole blob |
| A silent 3-minute request is dropped by the browser or an intermediate proxy even though Cloudflare imposes no limit | Unknown unknowns | M | H | Satisfy the PRD's in-progress-visibility requirement with streaming or polling; that same mechanism keeps bytes flowing and removes the exposure |
| The wait-in-one-request pattern locks the audit to Cloudflare or Vercel; migrating later means rebuilding the audit UX | Unknown unknowns | L | H | Accepted for the MVP. Record it here so a future platform change is scoped as an architecture change from the start |
| Bumping `compatibility_date` past 2026-08-04 changes `nodejs_compat` behaviour | Unknown unknowns | L | M | Treat any `compatibility_date` change as a change to test against a preview version, never as a routine bump |
| A preview URL exposes real Supabase data publicly | Research finding | M | M | Put Cloudflare Access in front of preview versions before the first one carries production credentials |
| Cloudflare MCP servers carry no GA/beta label; one changes or disappears mid-project | Unknown unknowns | L | L | Keep `wrangler` the primary operational path; treat MCP as a convenience, per the CLI-first default |
| An adapter change forces re-verification of every zero-config integration point | Devil's advocate | L | M | No action for the MVP; the four-place pattern in `CLAUDE.md` is the checklist if it ever happens |

## Getting Started

The repository is already configured for this platform, so these are the gaps between the current
tree and a first deploy — not a from-scratch setup. Commands are written against the versions this
project pins (`wrangler` ^4.131, `@astrojs/cloudflare` ^14.3, Astro ^7.3). The Worker name in
`wrangler.jsonc` is already `vetpad`, which is what the `workers.dev` subdomain will be — renaming
it after the first deploy would create a second Worker rather than move the first.

1. **Add an explicit CPU limit.** Set `"limits": { "cpu_ms": 300000 }` in `wrangler.jsonc`. Without
   it the Paid plan's 30-second default applies, which is the failure mode in the pre-mortem above.
2. **Authenticate and deploy.** `npx wrangler login` (interactive, human-only — run it as
   `! npx wrangler login` in this session if you want the output here), then `npm run build` and
   `npx wrangler deploy`. Do **not** use `wrangler pages deploy`; adapter v14 does not support
   Pages.
3. **Set the production secrets.** `npx wrangler secret put SUPABASE_URL` and
   `npx wrangler secret put SUPABASE_KEY`, pointing at the hosted Supabase project rather than the
   local one. The app deploys and renders without them — the banner from `src/lib/config-status.ts`
   reports the gap — so this step can follow a first successful deploy.
4. **Verify the audit's CPU cost on real data**, once FR-010 exists: run one audit against the
   longest listing you can find and read the per-request CPU number in the Workers dashboard. That
   single measurement closes the two highest-impact rows of the risk register.

## Out of Scope

The following were not evaluated in this research:
- Docker image configuration
- CI/CD pipeline setup
- Production-scale architecture (multi-region, HA, DR)
