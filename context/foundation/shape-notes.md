---
project: "Vetpad"
context_type: greenfield
created: 2026-09-18
updated: 2026-09-18
product_type: web-app
target_scale:
  users: small
  qps: low
  data_volume: small
timeline_budget:
  mvp_weeks: 3
  hard_deadline: 2026-11-04
  after_hours_only: true
checkpoint:
  current_phase: 8
  phases_completed: [1, 2, 3, 4, 5, 6, 7]
  gray_areas_resolved:
    - topic: "context type"
      decision: "greenfield — no project markers in cwd; confirmed by user"
    - topic: "pain moment"
      decision: "pre-viewing preparation + recall days later (not live triage, not joint side-by-side comparison)"
    - topic: "pain category"
      decision: "coordination overhead + missing capability + data trapped behind blind links + no real-estate-specific note structure"
    - topic: "criteria ownership"
      decision: "hard limits (city, price, m²) shared board-wide; additional-requirements free text is per-person, so disagreement surfaces without multiplying audit cost"
    - topic: "product framing"
      decision: "web app; small scale (a handful of users); hard deadline 2026-11-04; after-hours work only"
    - topic: "non-goals"
      decision: "all twelve offered scope avoids accepted, across ingestion/automation, analysis/intelligence and product surface"
    - topic: "business rule"
      decision: "Vetpad determines viewing readiness and hidden risks by evaluating scraped listing text and parameters against shared hard limits and individual soft requirements"
    - topic: "operation timeouts"
      decision: "explicit failure with retry past a bound (~1 min ingest, ~3 min audit); never an indefinite spinner"
    - topic: "privacy boundary"
      decision: "listing text and criteria may go to a third-party model provider; members' notes never leave the system"
    - topic: "retention"
      decision: "indefinite; nothing expires automatically, removal is always a deliberate action"
    - topic: "device support"
      decision: "desktop browsers only; no mobile usability promised in MVP"
    - topic: "note schema"
      decision: "MVP ships Pros / Cons / General Observations only; granular aspect+room structure deferred to post-MVP"
    - topic: "audit output scope"
      decision: "'explicitly stated additional costs' replaces 'likely costs' (extraction, not inference); missing-info limited to decision-critical attributes"
    - topic: "archiving on a shared board"
      decision: "record and display who archived each offer; keep recent archiving visible so flats never vanish silently"
    - topic: "AI hallucination risk"
      decision: "mitigated by the evidence guardrail — every positive finding quotes the original Polish text verbatim; the audit highlights, the human interprets"
    - topic: "authentication"
      decision: "real auth is a binding external (academic grading) requirement; overrules the cheaper shared-link option"
    - topic: "photo persistence"
      decision: "hotlinking stands; images die with a pulled listing, text/params/audit/notes survive. Storage stays out of MVP"
    - topic: "URL normalisation"
      decision: "strip query parameters before the duplicate check; show a notice naming who already saved the listing"
    - topic: "duplicate URLs"
      decision: "dedupe on ingest — redirect to the existing card and offer a re-fetch instead of creating a duplicate"
    - topic: "audit staleness"
      decision: "a re-fetch that changes listing data marks any existing audit stale"
    - topic: "audit evidence"
      decision: "positive findings carry a source excerpt; missing-data findings are flagged without one (an absence cannot be quoted)"
    - topic: "project name"
      decision: "Vetpad — blends 'vet' (to investigate) with 'pad' (slang for an apartment)"
    - topic: "MVP size"
      decision: "scoped down rather than extending the timeline; 3-week after-hours MVP"
    - topic: "criteria entry"
      decision: "lightweight mandatory form — City, Price, Min m² + one free-text 'additional requirements' field for the AI; editable later, past audits not re-run"
    - topic: "snapshots / price history"
      decision: "moved to post-MVP; soft-archive stays in MVP"
    - topic: "portal coverage"
      decision: "otodom.pl only in MVP; olx.pl is the first post-MVP addition"
    - topic: "auth model"
      decision: "login, one account per person (identity needed for note attribution)"
    - topic: "tenancy"
      decision: "single shared space for 3 known users; no signup/group creation in MVP"
    - topic: "roles"
      decision: "flat — all members have full CRUD on searches, criteria, offers, notes"
    - topic: "note visibility / concurrent editing"
      decision: "per-person notes, readable by all; never co-edited, so no real-time collaboration needed"
    - topic: "primary persona scope"
      decision: "couples/families searching together, generally; first instance is a named 3-person team"
  frs_drafted: 15
  quality_check_status: accepted
---

# Shape notes — Vetpad

The sections below appear in the exact order the PRD schema requires, so
`/10x-prd` can map them one to one. Everything after `## Open Questions` is
supporting material that is **not** part of the PRD schema: the locked MVP flow,
forward-looking notes for the tech-stack-selection step, the closing quality
cross-check, and the original seed idea verbatim.

## Vision & Problem Statement

A small group searching for an apartment together — in the first instance a
three-person team (the author, his fiancée, his sister) — currently runs the
search on passive tools: spreadsheets, Notion pages, and plain "white page"
notes. Those tools hold **blind links**, not substance, so time-to-value is poor
and memory decays: a week after saving a listing, nobody remembers why it was
saved or what was wrong with it. They also impose **no opinionated,
real-estate-specific structure** on notes — without a rigid template,
observations devolve into unreadable walls of text, and finding a specific
detail later becomes impossible. Two moments are where this bites hardest:
**pre-viewing preparation**, where the team arrives without knowing what is
missing from the listing or what to ask the seller (the "preparation gap"), and
**recall days later**, when a saved listing has to be re-understood from scratch.
On top of this sits **coordination overhead** — three people, one decision, with
reasoning scattered across chat messages and individual heads — and a **missing
capability**: nothing today checks a listing against *this team's own criteria*
and reports what is missing, risky, or expensive.

Scale probe: at a hundred times this scale the rule itself would change shape.
It would stop evaluating against a single global team state and start evaluating
against fully isolated, per-tenant criteria profiles — turning Vetpad from one
shared board into a multi-tenant platform where the audit acts as a dedicated
agent for dozens of separate family searches. That is a different product, and
the MVP deliberately does not reach for it.

The insight: generic tools (Excel, Notion) are fundamentally **passive** — they
cannot fetch data, and they cannot instantly audit a listing with AI to expose
red flags. Real-estate portals, meanwhile, will never build active auditing,
because their business model serves sellers and agencies: portals optimize for
lead generation and have zero incentive to ship a tool that challenges listings,
highlights missing data, or acts as a cross-portal buyer's advocate. The gap is
structural, not accidental — which is why it is still open.

## User & Persona

**Primary persona**: couples and families searching for an apartment together —
a small group making one joint decision. The first concrete instance is a
three-person team: the author, his fiancée, and his sister, all active
participants rather than one driver plus two spectators.

The moment they reach for this product: when a listing has been saved and must
later be *re-understood* (recall), and when a viewing is imminent and the team
needs to know what the listing does not tell them (preparation).

> Note carried forward to Phase 2: the persona is generic ("couples/families
> searching together") while the MVP's environment is a single shared space for
> three named people. Whether the MVP is single-tenant (one shared board, three
> accounts) or multi-tenant (any group can create a space) is an access-control
> decision, resolved in Phase 2.

## Success Criteria

### Primary
- Vetpad replaces the spreadsheet outright: for the duration of the apartment
  search, all three members keep zero parallel notes in Excel, Notion or plain
  text files. A surviving spreadsheet means the product failed.
- The preparation gap closes: the team walks into every viewing with Vetpad's
  question list, and it surfaces at least one thing they would otherwise have
  failed to ask the seller.

### Secondary
- The Google Maps link removes the "where is this really?" step — one click from
  listing to map, with no copy-pasting an address into a browser.

### Guardrails
- Human-authored notes survive re-scraping, always. Notes are editable at any
  time and are never overwritten when listing data is re-fetched; scraped
  content and written content never collide.
- Missing data reads "unknown", never "no" and never zero. A listing that does
  not mention a feature must not render as that feature being absent — a
  fabricated fact could cost the team a flat.
- The AI never asserts without evidence. Any finding about a legal condition,
  cost or red flag quotes the original listing text verbatim. The audit is a
  highlighter, not a lawyer: interpretation of the quoted text stays with the
  human. Confident-but-ungrounded findings are the failure mode this guards
  against, because Polish real-estate terminology is exactly where a language
  model hallucinates.

## User Stories

### US-01: Member vets a new listing before calling the seller

- **Given** a member with the team's saved search criteria and an otodom.pl listing URL
- **When** they paste the URL, press "Add", open the resulting card and press "Run AI Audit"
- **Then** they see the audit's findings — missing information, questions for the seller, mandatory conditions, likely additional costs and red flags — beside their own empty structured note fields, and can write their conclusions before contacting the seller

#### Acceptance Criteria
- A pasted URL produces a saved card without waiting for any AI call
- A duplicate URL opens the existing card and offers a re-fetch rather than creating a second entry
- The card's status distinguishes "Not Audited" from a completed audit
- Positive findings (red flags, detected costs, mandatory conditions) each carry a supporting excerpt from the listing text
- Missing data points are flagged explicitly and carry no excerpt — an absence cannot be quoted
- Attributes absent from the listing are reported as "unknown", never as "no" or 0

## Functional Requirements

### Access

- FR-001: Member can log in using pre-seeded accounts. No registration and no password-reset flows in the MVP. Priority: must-have
  > Socrates: Counter-argument considered: "authentication is overkill for three people on a private board — a shared secret link would do and saves days of MVP work." Resolution: overruled by a binding external constraint — real authentication is mandatory (see `## Constraints`). The operational risk of having no password reset is accepted: the author is both user and database administrator, so reissuing a password is a ten-second database statement.

### Criteria

- FR-002: Member can define the team's search criteria: shared hard limits — city, price range, minimum square meters — that govern the whole board, plus their own free-text additional-requirements field that only they own. Priority: must-have
  > Socrates: Counter-argument considered: "three people don't share one set of criteria — a shared set hides real disagreement instead of surfacing it, and surfacing disagreement is what a joint decision tool is for." Resolution: split the criteria. Hard limits stay shared, because the core buying couple agrees on them before they go into the system; soft requirements become per-person free text, so disagreement surfaces where it actually lives. One audit still covers both, so AI cost and latency do not multiply.
- FR-003: Member can edit or delete criteria at any time. Completed audits are never re-run automatically and never deleted; any audit generated against older parameters is flagged stale so the interface can warn that a re-audit is needed. Priority: must-have
  > Socrates: Counter-argument considered: "frozen audits become quietly wrong — after the price ceiling moves, an old audit still reports a budget you no longer hold." Resolution: the exact reason the stale flag exists. Old audits are preserved but explicitly marked as generated against older parameters, and the member is prompted to re-audit.

### Ingestion

- FR-004: Member can save an offer by pasting an otodom.pl listing URL, which fetches its description and parameters and extracts photo URLs for hotlinking. Priority: must-have
  > Socrates: Counter-argument considered: "hotlinked photos die exactly when they matter — a pulled listing is the one you most need to remember weeks later, so the cut undermines the recall moment." Resolution: accepted as a real loss; hotlinking stands. When a listing is pulled the images break, but scraped text, parameters, audit and notes all survive, so recall degrades visually rather than substantively. File storage stays out of the MVP.
- FR-005: System validates the pasted URL. An invalid URL shows an error. Before the duplicate check the URL is normalised by stripping query parameters, so tracking identifiers do not disguise a known listing as a new one. A URL already present in the workspace redirects the member to the existing card, shows a notice naming the member who already saved it, and offers a manual re-fetch instead of creating a duplicate. Priority: must-have
  > Socrates: Counter-arguments considered: "URL identity is the wrong identity — tracking parameters make one listing look like many, and relisting defeats it anyway" and "a silent redirect hides the most useful fact on a three-person board: that someone else already saved this." Resolution: both valid, both mitigated cheaply — strip query parameters before the duplicate check, and surface a notice naming who saved it. Cross-portal and relisting duplicate matching remain explicitly post-MVP.
- FR-006: Member can browse all saved offers on a shared dashboard, each showing whether it is "Not Audited" or already audited. Priority: must-have
  > Socrates: Counter-arguments considered: "audited-versus-not is a process axis, not a decision axis" and "a flat list is no better than the spreadsheet." Resolution: conceptually correct, and precisely why soft-archive was kept in the MVP. The primary decision axis is Live versus Archived, and the board shows only Live flats; against that reduced set, a flat list of process states is manageable at three-week MVP scale. The backlog risk is handled by archiving unpromising flats aggressively, before the AI ever audits them.
- FR-007: Member can review a saved offer's full scraped content — description text, parameters, hotlinked photo gallery — without reopening the source portal. Priority: must-have
  > Socrates: Counter-arguments considered: "it is a worse copy of a page that already exists", "it reproduces the wall-of-text problem", "stored text goes stale silently between re-fetches." Resolution: none of them outweigh it; the FR stands as written. Holding the source text locally is what makes the audit, its excerpts and later recall possible at all.
- FR-008: Member can open a 1-click Google Maps search for an offer's location, generated from the scraped location text. Priority: must-have
  > Socrates: Counter-argument considered: "coarse location text gives false confidence — in the Polish market exact addresses are usually hidden, so the pin predictably lands at the centre of a district or street." Resolution: accepted and accepted knowingly. The link is a coarse vicinity check, not viewing navigation. It still removes the copy-paste step, which is all its role as the Secondary success criterion requires.
- FR-009: Member can re-fetch an offer's listing data on demand. Notes are preserved across the re-fetch, and if the listing data changed, any existing AI audit is marked stale because the text it analysed is no longer current. Priority: must-have
  > Socrates: Counter-argument considered: "a stale flag without history is a warning you cannot act on — with snapshots deferred, the re-fetch overwrites the old data, so you learn that something changed but never what." Resolution: a brutal but accurate critique of dropping snapshots; the UX cost is accepted to save development time. The member's response to a stale flag is simply to re-run the audit, which evaluates the new text and overwrites the old findings. The team needs the new verdict, not the diff. A history feature is considered after the MVP ships.

### AI audit

- FR-010: Member can run an AI audit of a saved offer against the team's shared hard limits and each member's own additional requirements, on demand. Priority: must-have
  > Socrates: Counter-argument considered: "the AI can be confidently wrong about Polish real-estate specifics — czynsz, media, taxes, ownership form — and a confident 'no red flags' is strictly worse than no audit." Resolution: a genuine domain risk, and the reason the evidence guardrail is binding. When the audit flags a legal or cost issue it is strictly required to quote the original Polish source text, so it acts as a highlighter rather than a lawyer and the final interpretation of the quoted text stays with the human.
- FR-011: Member can read the audit's findings — critical missing information and the questions for the seller it implies, mandatory conditions, explicitly stated additional costs, and red flags. Every positive finding carries a verbatim excerpt of the original listing text it rests on; missing data points are flagged explicitly and carry no excerpt, because an absence cannot be quoted. Missing-information findings cover only decision-critical attributes (for example floor, heating, ownership form), not an exhaustive inventory of everything the listing omits. Priority: must-have
  > Socrates: Counter-arguments considered: "'likely additional costs' is inference, not extraction, and cannot be grounded in an excerpt — it conflicts with the evidence guardrail" and "an exhaustive missing-information list buries the two or three questions actually worth asking." Resolution: both accepted and both fixed in the FR. The cost category is redefined as *explicitly stated* additional costs — czynsz, kaucja and the like, only where the text names them — so it stays extraction. The missing-information category is restricted to decision-critical attributes rather than exhaustive trivia.

### Notes

- FR-012: Member can write and edit their own structured note on an offer, in three fields — Pros, Cons and General Observations — displayed alongside the audit. Priority: must-have
  > Socrates: Counter-arguments considered: "high structure raises the cost of writing anything, and an empty structured note is worse than a scrappy one" and "pros/cons and room aspects overlap, so the same judgement is written twice or lost between fields." Resolution: both exposed a fatal flaw in the planned note schema, and the schema was cut down. The MVP ships three fields only — Pros, Cons, General Observations — so that people actually write notes on day one. The granular aspect- and room-based form, possibly with dynamic custom sections, remains a valuable post-MVP direction: the complex structure is deferred, not discarded.
- FR-013: Member can read every other member's notes on an offer, attributed to their author. Priority: must-have
  > Socrates: Counter-argument considered: "visible notes anchor the group's judgement — whoever writes first frames the flat, producing consensus by anchoring rather than three independent views." Resolution: anchoring is real, but in a three-person family search the goal is explicitly alignment and consensus, not independent jury verdicts. If one person spots a fatal flaw early and the others adopt it, that saves the group time. Transparent shared reasoning outweighs the bias risk.

### Board hygiene

- FR-014: Member can soft-archive an offer to hide it from the board without losing it, and can view or restore archived offers. An archived offer records which member archived it, and the dashboard surfaces recent archiving visibly — a "recently archived" section or counter — so a flat never disappears silently. Priority: must-have
  > Socrates: Counter-arguments considered: "archiving is a group decision dressed as a solo action — any one member can hide a flat the other two are still considering, and with flat roles nobody notices" and "one binary axis is too coarse for real triage." Resolution: the first is a genuine risk on a shared board and is mitigated without building a voting system — record and display who archived each offer, and keep recent archiving visible on the dashboard. The coarse binary Live/Archived state is accepted for the MVP.
- FR-015: Member can delete a saved offer and their own notes. Priority: must-have
  > Socrates: Counter-arguments considered: "deleting an offer destroys the other members' notes with it, irreversibly, under flat roles" and "hard delete makes the duplicate check lie — a deleted listing returns as new, with no trace the team already rejected it." Resolution: the risks are understood and accepted. In a closed, highly trusted three-person family group, malicious or negligent deletion is not a practical threat, and hard delete earns its place cleaning up genuine mistakes such as a wrong or invalid pasted URL. The dedupe-failure risk on deleted items is accepted; the author, as database administrator, can inspect logs if an accidental deletion happens.

## Non-Functional Requirements

- When the source portal is unreachable, rate-limits the request, or has changed
  shape so that a listing cannot be read, the member is shown an explicit
  failure identifying it as a fetch problem. No blank, partial or silently empty
  offer is ever created or saved.
- No system action modifies or destroys human-authored text. After any re-fetch,
  every note reads exactly as its author last left it.
- An attribute the listing does not state is reported as unknown. The product
  never reports an unstated attribute as absent or as zero.
- Every finding the audit makes about a condition, a cost or a risk is traceable
  to a verbatim quotation of the listing's own text. A finding that cannot be
  grounded in the text is not reported at all.
- Audit correctness takes precedence over both audit speed and audit cost. The
  team accepts a slower and more expensive verdict in exchange for one that is
  right about Polish-language listing terminology.
- There is no strict response-time budget, but any operation in progress is
  continuously visible as in progress. An ingest that has not completed within
  roughly one minute, and an audit that has not completed within roughly three
  minutes, are reported as failed with a retry offered — rather than showing
  progress indefinitely.
- The listing's text and the team's criteria may be sent to a third-party model
  provider. Members' notes never leave the system.
- Data is retained indefinitely; nothing expires automatically. Removal is
  always a deliberate member action.
- The product is usable on current desktop browsers. No mobile usability is
  promised in the MVP.

## Business Logic

Vetpad determines an apartment's viewing readiness and hidden risks by
evaluating its scraped source text and parameters against the team's shared hard
limits and individual soft requirements.

The rule consumes three user-facing inputs: the listing's own words and stated
parameters as published by the seller; the team's shared hard limits (city,
price range, minimum square meters); and each member's own free-text additional
requirements. Nothing the team writes about a flat feeds the rule — members'
notes are their conclusions about the result, not inputs to it.

Its output is a verdict in two parts. First, viewing readiness: what the listing
does not say that the team would need to know before spending an evening on a
viewing, expressed as the decision-critical attributes that are missing and the
questions for the seller they imply. Second, hidden risks: mandatory conditions,
explicitly stated additional costs, and red flags, each one quoting the source
text it rests on. An attribute the listing never mentions is reported as unknown
— never as absent, and never as zero.

The member encounters the rule as a deliberate act, not a background event. They
save a listing, look at it, and decide it is worth vetting; the verdict then
appears beside their own empty note fields, so the first thing they read before
writing their own judgement is what the listing failed to tell them. When the
underlying listing or the criteria later change, the verdict is marked as
generated under older parameters rather than silently updated, and the member
chooses whether to ask for it again.

### Anti-pattern check

Empty-CRUD: **not triggered**. The application applies a real domain rule —
validation and risk classification of a listing against explicit criteria — and
produces a judgement the team could not get from a spreadsheet.

## Access Control

Multi-user, single shared space.

- **Entry**: login — one account per person. Identity is per-person, not shared,
  because note attribution ("who wrote this?") depends on it.
- **Tenancy**: one shared space for the three known users. No signup flow, no
  group-creation flow, no invitations in the MVP. The generic persona
  (couples/families) is the product's intent, not the MVP's surface;
  generalizing to many groups is explicitly post-MVP.
- **Roles**: flat. All three members can create, read, update and delete
  searches, criteria, saved offers and notes. No admin role, no restricted
  destructive actions — all three are active participants.
- **Binding external constraint**: real authentication is mandatory — an
  academic grading requirement. A shared secret link, a single shared account or
  any other "good enough for three people" substitute is not acceptable, even
  though it would be the cheaper product choice. Downstream steps must not
  simplify auth away.
- **Note visibility**: every note belongs to exactly one person and is readable
  by all three. Notes are never co-edited, so the MVP needs no real-time
  collaboration, no locking and no merge strategy — the concurrency problem from
  the seed's open questions is dissolved by the access model rather than solved
  by machinery.

## Non-Goals

### Ingestion and automation

- **No automated background fetching or notifications.** No scheduled jobs, no
  periodic re-scraping, no alerts or digests. Every fetch and re-fetch is a
  deliberate manual action. This is load-bearing: it is why price history was
  deferred and why the audit is manually triggered.
- **No browser userscript for 1-click saving.** Ingestion means copying a URL
  from the portal and pasting it into Vetpad.
- **No olx.pl — otodom.pl only.** olx scraping is verified to work, but the
  second parser and its ongoing maintenance stay out of v1.
- **No price or description history.** A re-fetch overwrites the stored listing
  data; the team sees that an audit went stale, never a diff of what changed.

### Analysis and intelligence

- **No photo or Vision analysis.** The audit reads text and parameters only —
  scoped out to control cost and latency, and the reason hotlinked photos are
  acceptable.
- **No cross-portal or relisting duplicate matching.** The same flat under a new
  URL, or on another portal, counts as a new offer. Deduplication is URL
  identity only, after query parameters are stripped.
- **No map plotting or commute-time routing.** A generated Google Maps search
  link is the whole of the location feature — no shared map of pins, no travel
  time to the team's workplaces.
- **No cost scenarios or viewing/contact planner.** Vetpad prepares the team for
  a viewing; it does not schedule one, track seller contact, or model total cost
  of ownership.

### Product surface

- **No mobile usability.** Desktop browsers only; notes are written at a desk.
- **No multi-tenancy.** One shared space and three pre-seeded accounts; other
  families cannot sign up. The generic persona is the product's intent, not the
  MVP's surface.
- **No granular aspect or room note structure.** Pros, Cons and General
  Observations only. The aspect/room form and any dynamic custom sections are
  deferred post-MVP vision.
- **No real-time collaborative editing.** Notes are per-person and never
  co-edited, so there is no locking, no merging and no presence indication.

## Open Questions

Carried forward verbatim for `/10x-prd` to route into the PRD's `## Open
Questions`. Three of the seed's five open questions were resolved during
shaping; these two were not.

1. **How is a parser failure told apart from a real listing change?** A broken
   scrape returns different data and would mark an audit stale for the wrong
   reason; repeated false staleness trains the team to ignore the flag. Surfaced
   during the Socratic round on FR-009 and left unresolved. Owner: user. Block:
   no — the MVP ships either way, but the stale flag's credibility depends on it.
2. **What does "unknown" look like in the interface?** The guardrail binds the
   semantics — an unstated attribute is never rendered as absent or as zero —
   but not the presentation. Owner: user; a design decision for the
   implementation step. Block: no.

Resolved during shaping, recorded so they are not reopened:

- *Concurrent note editing* — dissolved by the access model: notes are
  per-person and never co-edited.
- *Aspect and room note structure, fixed list versus free tags* — cut entirely
  for the MVP in favour of Pros / Cons / General Observations; the granular form
  is deferred post-MVP vision.
- *Which criteria are hard requirements versus preferences* — hard limits (city,
  price, square meters) are shared board-wide; soft requirements are per-person
  free text.

## MVP flow (locked in Phase 3)

The smallest end-to-end flow that proves Vetpad works:

0. Member fills a lightweight criteria form: City, Price, Min m², plus one
   free-text "additional requirements" field the AI interprets. Criteria are
   editable afterwards; past audits are not re-run and keep their original
   result.
1. Member logs in. Accounts are seeded by hand — no signup, verification or
   password-reset flows.
2. Member pastes an otodom.pl URL into the main input and presses "Add".
3. App scrapes text, parameters and photo URLs, and creates a flat card on the
   dashboard with status "AI Audit Pending". Photos are hotlinked from the
   source, not stored. This lets offers be ingested rapidly and analysed later.
4. Member opens the card's detail view.
5. The detail view already shows a ready-to-use Google Maps link derived from
   the scraped location text.
6. Member presses "Run AI Audit" — deliberately manual, to control cost and
   latency.
7. The AI analyses the scraped description and parameters only — no photo or
   Vision analysis — against the saved criteria.
8. The audit appears side-by-side with the member's own empty note fields —
   Pros, Cons and General Observations. It highlights critical missing
   information and red flags.
9. Member writes their own conclusions into their own isolated, attributed note
   section.
10. Rejected flats are soft-archived — hidden from the board, history kept.

### Scope-down decisions (Phase 3)

The first sketch was judged bigger than three weeks of after-hours work. The
user chose to scope down rather than extend the timeline. Cuts accepted:

- **otodom only for v1.** olx.pl scraping is verified to work but is a second
  parser with its own breakage-maintenance cost; it becomes the first post-MVP
  addition.
- **Photos hotlinked, not stored.** No file storage in the MVP.
- **Accounts seeded by hand.** Login and per-person identity are kept; signup,
  email verification and password reset are not built.
- **Note schema cut to three fields.** The seed's aspect- and room-tagged notes
  were first reduced to a fixed aspect list (no free tagging), then cut further
  during the Socratic round to Pros / Cons / General Observations — because high
  structure raises the cost of writing and an empty structured note is worse
  than a scrappy one. The granular form is deferred, not discarded.
- **Snapshots / price-and-description history moved to post-MVP.** With
  manual-only re-scraping, history accumulates too slowly to pay off inside the
  MVP; most of its value arrives with the post-MVP scheduled fetching.
- **Soft-archive stays in the MVP.** Cheap, and it directly serves keeping the
  shared board clean.
- **Criteria entry added as step zero.** The original sketch assumed criteria
  were already present; they are a build prerequisite for the audit, not an
  assumption.

## Forward: tech-stack

Not part of the PRD. Captured here for the tech-stack-selection step that runs
after `/10x-prd`.

- **Model capability preference**: the team wants a highly capable model,
  prioritising reasoning quality and audit accuracy over generation speed, over
  cost, and over data-sharing concerns. This is a vendor and model-selection
  preference, not a product-level requirement; the product-level property it
  implies ("audit correctness takes precedence over speed and cost") is recorded
  as an NFR above.
- **Scraping feasibility already verified**: the author has confirmed that
  scraping works for both otodom.pl and olx.pl. Working notes for both live in
  the repository root (`otodom_fetching.md`, `olx_fetching.md`). Only otodom is
  in the MVP; olx is the first post-MVP source.
- **Binding constraint, repeated for the downstream step**: real authentication
  is mandatory (academic grading requirement). Do not substitute a shared link
  or a single shared account.

## Quality cross-check

Run at the close of Phase 7. All six elements present; no gaps.

| Element | Result |
| --- | --- |
| Access Control | present — login, three pre-seeded accounts, flat roles, per-person notes, binding real-authentication constraint |
| Business Logic | present — one declarative rule sentence with inputs, output and encounter. Empty-CRUD anti-pattern not triggered |
| Project artifacts | present |
| Timeline-cost acknowledged | present — `mvp_weeks: 3`, at the default target, so no sustained-effort acknowledgment was required. Hard deadline 2026-11-04 leaves roughly seven weeks |
| Non-Goals | present — twelve entries across ingestion/automation, analysis/intelligence and product surface |
| Preserved behavior | n/a — greenfield session |

Status: `accepted`. Two open questions are recorded in `## Open Questions`;
they are captured gaps, not gate gaps.

## Seed idea (verbatim)

Captured from `shape_prompt.md` at the start of the session. Preserved unedited
so later steps can check what was said against what was decided.

```text
Collaborative apartment-search tool for an active 3-person team (myself, my fiancée, and my sister). I've verified that scraping works on both otodom.pl and olx.pl. We are escaping passive tools (Excel, Notion) that suffer from poor Time-to-Value, rely on "blind links," and cause memory decay.

**MVP core is a shared, active journal.** For each saved offer we record pros, cons, free-form notes, and notes tied to specific aspects or rooms (e.g., kitchen, bathroom, noise, condition). Notes are editable at any time and never overwritten when listing data is re-scraped. To keep the shared board clean, a soft-archive toggle hides rejected flats without deleting their history. Unlike passive spreadsheets, the app is active from second one: pasting a URL fetches full visual context, automatically generates a 1-click Google Maps search link from the scraped location text, and triggers the AI to immediately generate a checklist of missing information and questions for the seller to eliminate our "preparation gap" for viewings.

**My search criteria are first-class data**, not just a filter: price range, square meters, number of rooms, floor, location, and other attributes. The app stores them and the AI analysis feature uses them in the MVP — comparing a listing's description and attributes against our criteria to surface mandatory conditions, likely additional costs, and red flags, with supporting excerpts from the source text. Missing information is "unknown", never "no" or zero.

**Scraping-based ingestion:** manual trigger (pasting a URL) pulls data from otodom.pl (olx.pl as a second source). The system stores snapshots so we can see price history and description changes. A listing, its successive snapshots, and our shared private notes are three separate things.

**Access control and CRUD:** a shared environment for 3 users; we create, read, update, and delete searches, criteria, saved offers, and notes.

**Later features, explicitly not MVP:** periodic background fetching (cron jobs), automated notifications and digests, a Tampermonkey userscript injecting a 'save to my app' button directly into portal listings for 1-click ingestion, duplicate matching across portals (e.g., recognizing the same flat under a new URL), a viewing/contact planner, cost scenarios, and photo analysis, map integration for plotting locations and automated commute-time routing to our workplaces.

**Open questions:** how to handle concurrent note editing or structure team notes to avoid overwriting each other (e.g., defaulting to isolated per-user notes with a manual sharing/viewing feature instead of complex real-time collaboration); how "aspect" and "room" notes are structured (fixed list vs. free tags); which criteria are hard requirements vs. preferences for the AI analysis; how to tell a parser failure from a real change; what "unknown" looks like in the UI.
```
