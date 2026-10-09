# Model provider for the audit — selection and billing

Companion to `research.md` in this folder. Records why the audit's model provider is
Anthropic, called directly, and what its billing does and does not guarantee.
Researched 2026-10-06; every external fact carries its source and was read that day.

## Decision

**Anthropic, called directly, on prepaid usage credits.** Decided by the user on
2026-10-06, after buying credits in the Claude Console the same day.

The requirement behind it, in the user's terms: the provider must work as a wallet that is
topped up in advance (for example 10 USD) and drawn down by audits — no ad-hoc charging and
no end-of-month invoice — so that the bill is predictable, cannot grow past what was paid
in, and a Denial-of-Wallet attack cannot run up a debt.

Decided later the same day, after `research.md` was written (recorded in `change.md`):

- **The official Anthropic SDK**, not plain `fetch`. Its README lists Cloudflare Workers as a
  supported runtime; a build and a deployed request have not been run yet.
- **Default model `claude-opus-5-5`**, default reasoning effort `medium`, neither hard-coded at the
  call site. `CLAUDE.md` named `claude-opus-5` until this decision and was updated with it.

## What the billing guarantees

Source: [How do I pay for my Claude API usage?](https://support.claude.com/en/articles/8977456-how-do-i-pay-for-my-claude-api-usage)
(dated 2026-08-19) and [Rate limits](https://platform.claude.com/docs/en/api/rate-limits).

- API usage is billed through prepaid usage credits, bought before use. Monthly invoicing in
  arrears exists only for organizations with an arrangement made through the Sales team.
- "If you run out of credits, you can no longer call the API or use the playground until you
  add more."
- Auto-reload is a toggle on the Billing page, with a trigger balance and a reload amount.
  It is the one path by which the card is charged without a person acting.
- A self-set monthly spend limit, below the tier's cap, can be set on the Billing page. When
  usage reaches it, requests return HTTP 400 with error type `invalid_request_error` and a
  message beginning `You have reached your specified API usage limits` (or `… workspace API
usage limits` for a workspace limit).
- The tier's own monthly cap answers differently: HTTP 429, `rate_limit_error`, with
  `error.details.error_code` = `enforced_spend_limit_reached` and no `retry-after` header.
- Spend and rate limits can be set per workspace, but not on the default workspace.
- Purchased credits expire one year after purchase and are non-refundable.
- Only successful calls are charged — with one exception that matters for a long request:
  "If your client disconnects or times out in the middle of a request that was on track to
  succeed, that request is still charged."

## What it does not guarantee

- **Not confirmed: the default state of auto-reload on a new organization.** The help
  article describes the toggle, not its default. To be read off the Billing page.
- **Not confirmed: whether the balance can go slightly negative** on a request that starts
  just before the credits run out. The API billing article does not say either way.
- **Tier tables disagree between two versions of the docs.** `docs.anthropic.com` lists
  Tier 1 as a 5 USD credit purchase with a 100 USD monthly maximum; `platform.claude.com`
  lists a Start tier with a 500 USD monthly cap. The newer page is the `platform.claude.com`
  one; which applies to this organization is visible on its Billing page.
- **A wallet turns Denial of Wallet into denial of service.** The loss is bounded by the
  balance, but an emptied balance stops the audit for every member until someone tops it
  up. The in-application protections `context/foundation/test-plan.md` asks of S-04 (risk
  #2: no provider call without a session, no second call while one is in flight, in-flight
  state in Postgres) are still required; the wallet only bounds what their failure costs.
- **A request cut off by the client is still paid for.** This is test-plan risk #3 seen from
  the provider's side: an audit whose HTTP request dies after the model has started
  answering costs money and leaves nothing behind unless the application stores it.

## Alternatives considered

| Provider                               | Prepaid wallet        | Auto top-up                    | Extra cost                                     | Can the bill exceed what was paid in                                                          |
| -------------------------------------- | --------------------- | ------------------------------ | ---------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Anthropic, direct                      | yes, the default      | optional toggle                | none                                           | no statement found                                                                            |
| OpenRouter                             | yes                   | optional, off until enabled    | 5.5% of each credit purchase, 0.80 USD minimum | balance can go negative; further requests then fail with HTTP 402                             |
| Cloudflare AI Gateway, Unified Billing | yes                   | optional                       | 5% of each credit purchase                     | **yes** — a negative balance is charged to the payment method at the start of the next month  |
| OpenAI                                 | yes, for new accounts | **on by default** during setup | none                                           | cut-off is delayed; the overshoot shows as a negative balance deducted from the next purchase |

- **OpenRouter** — [limits](https://openrouter.ai/docs/api_reference/limits),
  [FAQ](https://openrouter.ai/docs/faq),
  [auto top-up](https://openrouter.zendesk.com/hc/en-us/articles/51680638594331-How-does-Auto-Top-Up-work-and-how-do-I-turn-it-on-or-off).
  It offers what Anthropic direct does not: a credit limit per API key, daily/weekly/monthly/
  lifetime workspace budgets, and an in-flight spending budget that holds each request's
  estimated cost up front so concurrent requests cannot outrun a low balance. The cost is the
  purchase fee and one more party that receives the listing's text. It stays the fallback if
  buying or holding Anthropic credits stops working.
- **Cloudflare AI Gateway** — [Unified Billing](https://developers.cloudflare.com/ai-gateway/features/unified-billing/).
  Ruled out despite the app already running on Cloudflare: it is the only option that states
  outright that a negative balance is collected from the card.
- **OpenAI** — [prepaid billing](https://help.openai.com/en/articles/8264644-what-is-prepaid-billing).
  Would mean a different model family, which is a separate decision under `CLAUDE.md`, and
  its prepaid mode documents both a default-on auto-reload and a delayed cut-off.
- Not checked against primary sources: Google Gemini API, Vercel AI Gateway.

## Token prices

Per million tokens, standard (non-batch) pricing, read 2026-10-06 from
[Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing) and
[OpenAI pricing](https://developers.openai.com/api/docs/pricing). The OpenAI figures are
from the first table on its page, read as the Standard tier; the page has several tabs and
the fetch flattened them.

| Model                                                 | Input    | Output   | One audit (assumed) | 200 audits (assumed) |
| ----------------------------------------------------- | -------- | -------- | ------------------- | -------------------- |
| OpenAI `gpt-6-astra`                                  | 10 USD   | 50 USD   | ~0.25 USD           | ~50 USD              |
| Claude Opus 5 (`claude-opus-5`, named in `CLAUDE.md`) | 5 USD    | 25 USD   | ~0.13 USD           | ~25 USD              |
| Claude Opus 5.5                                       | 4 USD    | 20 USD   | ~0.10 USD           | ~20 USD              |
| Claude Sonnet 5 / Sonnet 5.5                          | 2 USD    | 10 USD   | ~0.05 USD           | ~10 USD              |
| OpenAI `gpt-6.1-sol`                                  | 2 USD    | 10 USD   | ~0.05 USD           | ~10 USD              |
| Claude Haiku 4.5                                      | 1 USD    | 5 USD    | ~0.025 USD          | ~5 USD               |
| OpenAI `gpt-6-luna`                                   | 0.10 USD | 0.50 USD | ~0.003 USD          | ~0.50 USD            |

**The two right-hand columns are an assumption, not a measurement:** 5,000 input tokens and
4,000 output tokens per audit, thinking included. Nobody has measured a listing's length in
tokens or an audit's output; `deployment-plan.md` in the deployment archive carries an
estimate of about 29 USD for about 200 audits on `claude-opus-5` with no stated basis, and
this table lands in the same range. The count of 200 audits comes from that estimate.

What the table supports:

- At a comparable tier OpenAI is not cheaper: its mid model costs what Sonnet costs, its
  flagship twice what Opus 5 costs. The one clearly cheaper option is its smallest model.
- At this scale the spread between Opus 5 and a mid-tier model is about 15 USD over the
  whole search. Cost does not decide the model; the PRD's "correctness over speed and cost"
  does.
- Opus 5.5 is listed cheaper than Opus 5.

What it does not support: any claim about which model is better at Polish real-estate
terminology. No document read here measures that. `context/foundation/test-plan.md`
provides for a manual, optional golden set, which is where that comparison would be made.

## Buying credits — a known failure

The first purchase attempt on 2026-10-06 failed with "Your purchase couldn't be completed.
Check your card details and try again."; a later attempt succeeded. Which step resolved it
was not recorded. The message is generic and widely reported from Europe; the workarounds
users report are in
[anthropics/claude-code#45361](https://github.com/anthropics/claude-code/issues/45361):
pay from a private window, log out of Stripe's Link and type the card in by hand, try
another browser. These are user reports, not Anthropic documentation.

## Console setup this decision implies

The human-only steps, in addition to the six places the key has to land
(`context/foundation/deployment-runbook.md`):

1. **Settings > Billing > Auto-reload:** confirm it is off.
2. **Settings > Billing > Spend limits:** set a monthly limit.
3. Optionally create a dedicated workspace for Vetpad and issue the API key inside it, since
   limits cannot be set on the default workspace.
