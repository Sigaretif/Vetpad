---
project: vetpad
researched_at: 2026-09-19
recommended_platform: Cloudflare Workers
runner_up: Vercel
context_type: mvp
tech_stack:
  language: TypeScript
  framework: Astro 7 (SSR, React 19 islands)
  runtime: workerd (Cloudflare Workers) via @astrojs/cloudflare ^14.3.1
---

## Recommendation

**Deploy on Cloudflare Workers.**

Of the six platforms researched, Workers is the only one with no wall-clock ceiling on a
single request: billing is CPU time, and waiting on an outbound `fetch` consumes none of
it. That matters because the PRD's audit budget (`context/foundation/prd.md`,
Non-Functional Requirements) is ~3 minutes of mostly-waiting on a model provider, and
every other candidate imposes a hard cap — Netlify 60 s synchronous, Fly.io a 60 s proxy
idle timeout, Vercel 300 s, Railway 5 minutes, Render 100 minutes. Second, the repository
already deploys here: `wrangler.jsonc` points `main` at the `@astrojs/cloudflare` server
entrypoint, `npx astro preview` runs on real workerd via the Cloudflare Vite plugin, and
the deadline in `prd.md` is 2026-11-04 with after-hours-only capacity. A migration would
spend days of that budget buying properties the interview said are not needed: the
project is single-region (Poland), stateless request/response, and already committed to
external Supabase — which neutralises the edge advantage, the persistent-process
advantage and the service-co-location advantage all at once. Cost is $0–5/month.

The cost of this choice is concentrated in one place — listing ingestion (FR-004) — and
the risk register below is mostly about that.

## Platform Comparison

Scored against the five criteria in
`.claude/skills/10x-infra-research/references/agent-friendly-criteria.md`.
All facts checked 2026-09-19.

| Platform | CLI-first | Managed/Serverless | Agent-readable docs | Stable deploy API | MCP / Integration | Total |
|---|---|---|---|---|---|---|
| Cloudflare Workers | Pass | Pass | Pass | Pass | Partial | 4.5 |
| Vercel | Pass | Pass | Pass | Pass | Partial | 4.5 |
| Railway | Partial | Pass | Pass | Pass | Pass | 4.5 |
| Render | Partial | Pass | Pass | Pass | Pass | 4.5 |
| Fly.io | Partial | Partial | Pass | Pass | Partial | 3.5 |
| Netlify | Partial | Pass | Pass | Partial | Pass | 3.5 |

**Cloudflare Workers.** CLI covers the whole loop — `wrangler deploy`, `wrangler rollback
[VERSION_ID]`, `wrangler tail`, `wrangler secret put`. Fully managed, no OS surface. Docs
publish per-product `llms.txt`, every page has an `/index.md` twin, source is on GitHub
(`cloudflare/cloudflare-docs`). Deploy is one deterministic command. MCP scores Partial,
not Pass: managed remote MCP servers exist (docs, bindings, builds, observability) at
`https://docs.mcp.cloudflare.com/mcp` with OAuth, but no GA label is published — treat as
preview.

**Vercel.** Ties Cloudflare on the criteria and beats it on documentation ergonomics:
every docs URL returns Markdown with YAML frontmatter carrying `last_updated`, plus
`.graph.md` cross-link maps and `llms-full.txt`. `vercel deploy --prod`, `vercel rollback`,
`vercel promote`, `vercel logs --follow`. MCP is Public Beta (`https://mcp.vercel.com`).
The weights, not the criteria, pushed it to second — see below.

**Railway.** Railpack builds an Astro `output: "server"` app as a plain Node service with
no Dockerfile. Proxy closes a request only after 5 minutes with no data transferred, so
the audit fits. MCP server is GA (`railway setup agent`). CLI is Partial because
`railway redeploy` only re-runs the *latest* deployment — rolling back to an arbitrary
older one is dashboard-only.

**Render.** The most generous request budget of the six: Render documents allowing HTTP
responses to take up to 100 minutes. Native Node runtime, no Dockerfile, Frankfurt is a
GA region, MCP server GA at `https://mcp.render.com/mcp`. CLI is Partial for the same
reason as Railway — there is no rollback command; rollbacks, scaling and deletions go
through the dashboard or REST API.

**Fly.io.** Scores Partial on "managed" because you own the Dockerfile, the health checks
and the image — a real operational surface at MVP scope. No free tier since the trial-only
change (2 machine-hours or 7 days). Fly Proxy closes a connection after 60 s with no bytes
in either direction, so a 3-minute audit needs streaming or a heartbeat. `fly mcp server`
is self-labelled experimental. No Warsaw region; `fra` is the nearest.

**Netlify.** Synchronous functions time out at **60 s, not configurable**, and the timeout
is wall-clock — "mostly waiting on fetch" does not help. The audit would have to become a
background function (202 immediately, no streaming, two retries on error) plus polling,
with job state in Supabase. That is a real architecture change, not a config flag. Deploy
API is Partial: the CLI has no rollback; it is the dashboard's "Publish deploy" or the
REST API. Pinning functions to an EU region requires the $20/mo Pro plan; Free defaults to
Ohio.

### How the interview weighted the scores

- **Stateless request/response** — no platform dropped on the hard filter.
- **Cost ≈ DX** — a mild penalty on Vercel. Its Hobby plan is off-limits: the Fair Use
  guidelines (updated 2026-09-14) restrict it to non-commercial personal use, and define
  commercial to include a paid employee or consultant writing the code. Pro is $20/mo
  against $0–5 for Workers and ~$5 for Railway, with no compensating advantage at three
  users.
- **No existing platform familiarity** — no tie-break from experience. The tie-break that
  did apply is different in kind: the repo is already wired to Workers and the deadline is
  fixed, so switching costs days that the 3-week after-hours budget does not have.
- **Single region (Poland)** — neutralises the edge-native advantage. Note the inverse
  too: Workers has *no* selectable region, so Supabase's region governs latency either way.
- **External providers fine (Supabase; OpenRouter undecided)** — neutralises the
  co-located-database advantage that Railway, Render and Fly would otherwise carry.

### Shortlisted Platforms

#### 1. Cloudflare Workers (Recommended)

Wins on the constraint that matters most and on the one the interview did not ask about.
The audit's ~3-minute budget is a wall-clock problem on five of six platforms and a
non-problem here, because CPU time is what is metered and `await fetch(...)` does not
consume it. Local fidelity is unusually good: since adapter v13, `astro dev` and
`astro preview` run on real workerd through the Cloudflare Vite plugin, so what CI's smoke
job exercises is the production runtime, not a Node approximation. Zero migration against
a fixed deadline. Astro's core team joined Cloudflare in January 2026, so the adapter is
first-party.

#### 2. Vercel

The strongest alternative and the one to pick if listing ingestion turns out to be the
binding problem. Its SSR functions run the **full Node.js runtime** under Fluid compute,
which dissolves two Workers-specific constraints at once: no `nodejs_compat` surprises
from a provider SDK, and no CPU-time reason to ban an HTML parser — `cheerio` would just
work, restoring the fallback that FR-004 currently lacks. 300 s max duration covers the
audit. Region is one line (`{"regions": ["fra1"]}`). Supabase is a first-class Marketplace
integration. Migration is a swap to `@astrojs/vercel` (v11.0.10, peer `astro ^7.0.0`).
The gaps: $20/mo, a hard 300 s ceiling where Workers has none, and Vercel's own Astro docs
page is stale — it still documents `@astrojs/vercel/serverless` and `output: 'hybrid'`,
both removed in Astro 5+.

#### 3. Railway

Full Node on an always-on VM, ~$5/mo, MCP server in GA, 5-minute proxy timeout, EU West
(Amsterdam) region. Railpack builds the Astro Node output with no Dockerfile. Same
parser-freedom benefit as Vercel at a quarter of the price. The gaps versus the
recommendation: an always-on service instead of scale-to-zero (the serverless toggle is
opt-in and an open Supabase connection pool prevents sleep entirely), arbitrary rollback
is dashboard-only, and the start command needs `server.host: '0.0.0.0'` or the service
502s. Render is a near-tie here — its 100-minute request budget is the best of the six —
losing narrowly on $7 vs $5 and a free tier that spins down after 15 minutes idle.

## Anti-Bias Cross-Check: Cloudflare Workers

### Devil's Advocate — Weaknesses

1. **The free plan is not viable for this stack, and fails in a confusing way.** Workers
   Free caps CPU at **10 ms per invocation**. Astro 7 SSR with React 19 islands rendering
   an offer card with a photo gallery will exceed that on a cold isolate. The failure mode
   is an error 1102 ("Worker exceeded CPU") mid-render, not a slow page. The real floor is
   the $5/mo Paid plan (30 s CPU default, 5 min configurable). The trap is that people
   size the plan by request count — and static asset requests are free and uncounted, so
   request count is exactly the metric that will *not* warn you.
2. **The HTML-parsing ban in `CLAUDE.md` is a consequence of this platform's billing
   model, and it removes the plan B for a must-have requirement.** Today's path is one
   bounded `RegExp` over `__NEXT_DATA__` (`context/foundation/ingestion/otodom_fetching.md`,
   §7.1). If otodom drops `__NEXT_DATA__` or moves to an RSC payload, the natural fallback
   — build a document, walk it — is architecturally banned here. On a Node platform the
   fix is `npm i cheerio`; on Workers it is a platform migration mid-project.
3. **Cloudflare egress IPs are widely bot-flagged, and otodom sits behind anti-bot.** A
   fetch that succeeds from a laptop can return 403 from a deployed Worker. The PRD
   requires a failed fetch be reported explicitly as a fetch problem — so the degraded
   behaviour is correct, but the product's core ingestion would be broken in production
   only. There is no way to change the outbound IP without paid add-ons.
4. **`nodejs_compat` is not Node.** The model-provider decision is still open (OpenRouter
   vs. a direct Anthropic SDK). Any transitive dependency reaching for
   `node:child_process`, `worker_threads`, `vm` or `http2` gets a non-functional stub — and
   it breaks at runtime in production, not at `npm run build` or `npx astro check`.
5. **Region is not selectable.** A Worker executes at the nearest PoP; Supabase lives in
   one region. An SSR page issuing several sequential queries (offers list, then notes,
   then criteria) compounds round-trips, and the remedy — Smart Placement — is another
   configuration surface with its own heuristics.

### Pre-Mortem — How This Could Fail

December: otodom hardens its anti-bot and fetches begin returning 403 from Cloudflare's
egress ranges. Nobody had ever exercised ingestion from a deployed Worker — it was always
tested from the laptop, where it worked. The documented fallback, parsing the page HTML,
is forbidden by the project's own CPU rule, so the fix requires either a proxy service or
abandoning the platform halfway through the product. In parallel, weeks earlier, the free
plan's 10 ms CPU cap had blown up on the gallery render; the team clicked upgrade to $5
without reading why, so nobody internalised that CPU — not request count — is the binding
resource. When the audit later grew to two model calls with post-processing, per-request
CPU crept past the 30 s default and requests began dying in production only. Runtime
fidelity was never the problem: `astro preview` runs real workerd, and CI exercises it.
The problem was that local workerd does not meter CPU and does not egress from
Cloudflare's address space. The two things CI could not see were precisely the two that
broke.

### Unknown Unknowns

- **`wrangler dev` is redundant and misleading in this project.** Since adapter v13,
  `astro dev` and `astro preview` run on real workerd via the Cloudflare Vite plugin.
  Tutorials still instruct a separate `wrangler dev` step; here it is a dead end. Adapter
  v14 requires Astro ≥ 7.2.0 — this repo is on 7.3.2 with 14.3.1, so it is satisfied.
- **Local workerd fidelity does not extend to CPU metering or egress identity** — the two
  properties most likely to break in production. Per-request CPU is visible only in the
  Workers dashboard; `observability` is already enabled in `wrangler.jsonc` and is the
  only probe that exists today.
- **The `node:fs` line in `CLAUDE.md` was stale.** Research indicates `node:fs`
  is supported under `nodejs_compat` as an ephemeral per-request virtual filesystem from
  compatibility date `2025-09-01` onward. `node:child_process`, `worker_threads`, `vm` and
  `http2` remain stubs. Applied on 2026-09-19 at the user's direction: the rule no longer
  claims `node:fs` is unsupported and names the four stubs instead. Nothing in `src/`
  imports `node:fs` today, so the correction is not yet load-bearing.
- **Astro's core team joined Cloudflare in January 2026.** This is the strongest argument
  for staying — the adapter is first-party — and a quiet dependency: Astro's neutrality
  across adapters is now commercially entangled, and the Vercel/Netlify adapters may
  diverge in quality over time.
- **`tech-stack.md` front matter said `deployment_target: cloudflare-pages`.** Pages
  is not deprecated but is frozen — Cloudflare's own guidance is to start new projects
  with Workers. An agent reading only `tech-stack.md` would run `wrangler pages deploy`
  and create a second, parallel deployment. `CLAUDE.md` already bans this; the ban exists
  for exactly this reason. Corrected to `cloudflare-workers` on 2026-09-19, together with
  `ci_default_flow`, which claimed `auto-deploy-on-merge` although
  `.github/workflows/ci.yml` has no deploy job and production release is a human action.

## Operational Story

- **Preview deploys**: none today, and that is the current state, not a gap — CI
  (`.github/workflows/ci.yml`) runs `ci` and `smoke` only; there is no deploy job and no
  per-PR URL. `smoke` builds and runs `npm run preview`, which since adapter v13 executes
  on real workerd against a local Supabase, so a PR is verified on the production runtime
  without a hosted preview. To add hosted previews later, the primitive is
  `wrangler versions upload`, which returns a preview URL without shifting production
  traffic; protect it with Cloudflare Access, and note that fork PRs cannot read repository
  secrets.
- **Secrets**: `SUPABASE_URL` and `SUPABASE_KEY` live in three places, each for a different
  consumer — Cloudflare Workers Secrets for production (`npx wrangler secret put`), GitHub
  repository secrets for the CI build job, and local `.env` + `.dev.vars` for development.
  They are read only through `astro:env/server`, declared `access: "secret"` and
  `optional: true` in `astro.config.mjs`. Absence is a supported state: `createClient()`
  returns `null` and `src/lib/config-status.ts` surfaces the gap in the layout banner.
  Rotation is `wrangler secret put` followed by a redeploy; Workers Secrets are write-only
  once set — they cannot be read back, so GitHub and Cloudflare must be updated as a pair.
  Adding the model-provider key repeats all six places (see `CLAUDE.md`).
- **Rollback**: `npx wrangler rollback [VERSION_ID]`, or `wrangler versions deploy` to
  shift traffic between uploaded versions. Time-to-revert is seconds — a version is already
  built and uploaded. **Two caveats.** A rollback does not revert secrets: a version
  deployed before a key rotation will run against the rotated value. And it does not
  revert the database — once `supabase/migrations/` exists, a schema migration is a
  separate, forward-only system, so a code rollback across a migration boundary can leave
  the Worker talking to a schema it does not expect.
- **Approval**: `npx wrangler deploy` to production, rotating `SUPABASE_KEY`, and anything
  touching the Supabase schema or RLS policies are human decisions — deploy is deliberately
  not automated in CI. An agent may run unattended: `npm run build`, `npm run lint`,
  `npx astro sync`, `npx astro check`, `npm run smoke`, `wrangler tail`,
  `wrangler versions upload` (no traffic shift), and `wrangler secret list` (names only,
  never values).
- **Logs**: `npx wrangler tail` streams live requests and exceptions read-only; add
  `--format json` to pipe into a filter. Historical queries and per-request CPU time come
  from the Workers dashboard — `observability` is enabled in `wrangler.jsonc`, which is
  what makes them available at all. CI logs read via `gh run view --log`. Cloudflare's
  managed remote MCP servers (docs, observability) offer structured access over OAuth, but
  publish no GA label — treat as preview.

## Risk Register

| Risk | Source | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| otodom returns 403 to Cloudflare egress IPs; FR-004 ingestion broken in production only | Devil's advocate #3 / Pre-mortem | M | H | Decided 2026-09-19: accepted, not pre-verified. The scraper ships as written; if it returns 403 from a deployed Worker, it is replaced by an external extraction service (Apify or similar) — the same escape hatch as the row above, and a swap behind one `fetch` rather than a platform migration. The explicit fetch-failure path (PRD NFR) stays the user-visible contract either way. |
| `__NEXT_DATA__` disappears from otodom; the DOM-parsing fallback is banned on this platform | Devil's advocate #2 | L | H | Decided 2026-09-19: the fallback moves extraction off the Worker — an external service (Apify or similar) called with one `fetch` — rather than migrating the platform. Recorded in `CLAUDE.md`; adding the service is a decision the user makes. |
| Free plan's 10 ms CPU cap kills SSR renders with error 1102 | Devil's advocate #1 | H | M | Budget the $5/mo Workers Paid plan from day one. Do not size the plan by request count — static assets are free and uncounted, so requests will not warn you. |
| Per-request CPU creeps past the 30 s default as the audit grows | Pre-mortem | M | M | Check per-request CPU in the Workers dashboard after each change to the audit path — `observability` is already on. The CLAUDE.md rule requiring this for any CPU-bound pass over a page body already covers it. |
| A model-provider SDK pulls in a `node:*` module that is a stub under `nodejs_compat` | Devil's advocate #4 | M | M | Verify the dependency against the `nodejs_compat` support list for `compatibility_date` 2026-05-08 *before* adding it to `package.json`. Build and typecheck will not catch this; only a deployed request will. |
| Compounding Supabase round-trips from a non-selectable PoP region | Devil's advocate #5 | L | L | Low stakes at three users. If SSR latency becomes visible, batch the queries first; reach for Smart Placement only after measuring. |
| Rollback does not revert secrets or schema migrations | Research finding (operational story) | L | M | Rotate secrets and redeploy as one action. Once `supabase/migrations/` exists, keep migrations forward-only and additive so a code rollback stays safe across the boundary. |
| An agent reads `deployment_target: cloudflare-pages` in tech-stack.md and runs `wrangler pages deploy` | Unknown unknowns | L | M | **Closed 2026-09-19** — the front matter now reads `cloudflare-workers`. The ban in `CLAUDE.md` stands as the second line of defence. |
| The `node:fs` rule in CLAUDE.md is stale and misleads future work | Unknown unknowns | M | L | **Closed 2026-09-19** — the rule now names `child_process`, `worker_threads`, `vm` and `http2` as the stubs. Confirm against Cloudflare's docs the first time code actually imports `node:fs`. |
| OpenRouter routing conflicts with the recorded model choice | Interview answer / research finding | M | L | `CLAUDE.md` states the audit calls `claude-opus-5` and that audit correctness outranks speed and cost. Routing through OpenRouter is a deliberate decision to raise with the user — and the change that adds any provider SDK updates that line to name it. |

## Getting Started

The project already deploys to this platform; these are the steps that keep it correct at
the versions in `package.json` (`astro ^7.3.2`, `@astrojs/cloudflare ^14.3.1`,
`wrangler ^4.131.1`, Node 22).

1. **Develop against the real runtime — do not add `wrangler dev`.** `npm run dev` already
   runs on workerd through the Cloudflare Vite plugin (adapter v13+). `npm run build &&
   npm run preview` is the production-parity check, and is what CI's `smoke` job uses.
2. **Before pushing, run what CI runs**, including the two commands that are not npm
   scripts: `npx astro sync && npm run lint && npx astro check && npm run build`.
3. **Deploy manually**: `npm run build && npx wrangler deploy`. There is no deploy job in
   `.github/workflows/ci.yml` — production release is a deliberate human action.
4. **Set production secrets once**: `npx wrangler secret put SUPABASE_URL` and
   `npx wrangler secret put SUPABASE_KEY`. Mirror them into GitHub repository secrets for
   the `ci` build job. Verify with `npx wrangler secret list` (names only).
5. **Move to the Workers Paid plan ($5/mo) before real use**, and confirm per-request CPU
   in the Workers dashboard after the first SSR page with a photo gallery ships. The free
   plan's 10 ms CPU cap is the first thing this stack will hit.
6. **Ingestion is not pre-validated from a deployed Worker** — decided 2026-09-19. The
   otodom scraper ships as written; a 403 from Cloudflare's egress is handled by replacing
   it with an external extraction service, not by a preflight or a proxy.
7. **Observe and revert**: `npx wrangler tail` for live logs;
   `npx wrangler rollback [VERSION_ID]` to revert, remembering it reverts neither secrets
   nor database schema.

## Out of Scope

The following were not evaluated in this research:
- Docker image configuration
- CI/CD pipeline setup (including adding a deploy job to `.github/workflows/ci.yml`)
- Production-scale architecture (multi-region, HA, DR)
