import { createHash } from "node:crypto";
import type { APIContext } from "astro";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AUDIT_OUTPUT_SCHEMA } from "@/lib/audit/schema";
import { POST } from "@/pages/api/audits";
import {
  PROVIDER_MESSAGE_CANARY,
  type SseEvent,
  answerEvents,
  isProviderRequest,
  providerAnswer,
  providerCalls,
  providerError,
  providerSilence,
  providerStream,
  streamErrorEvent,
} from "../../fixtures/anthropic";
import {
  ANNA_ID_CANARY,
  ANNA_REQUIREMENTS,
  AUDIT_DESCRIPTION,
  AUDIT_TITLE,
  BARTEK_ID_CANARY,
  BARTEK_REQUIREMENTS,
  FORBIDDEN_IN_AUDIT,
  TYPED_NAME,
  TYPED_PHONE,
  auditOfferRow,
} from "../../fixtures/audit";
import { type ConsoleCapture, type ConsoleEntry, captureConsole, restoreConsole } from "../../fixtures/console";
import {
  type FetchContext,
  type FetchStub,
  REFRESHED_ACCESS_TOKEN,
  REFRESHED_REFRESH_TOKEN,
  type RecordedRequest,
  SESSION_ACCESS_TOKEN,
  SESSION_REFRESH_TOKEN,
  isAuthRequest,
  isTableRequest,
  jsonResponse,
  refreshedSessionResponse,
  restoreFetch,
  sessionCookie,
  stubFetch,
} from "../../fixtures/http";

// The route with a configured Supabase client and a provider key (test values, never real ones):
// this mock overrides the zero-config one in tests/setup.ts. Only the network is stubbed below —
// at the HTTP edge, for the database and for the model provider alike. @/lib/supabase, every
// module under @/lib/audit and the provider's SDK run as they do in production.
//
// `providerKey` switches the key off for the one exit that needs a database and no key.
const env = vi.hoisted(() => ({ providerKey: true }));
vi.mock("astro:env/server", async () => {
  const { SUPABASE_TEST_KEY, SUPABASE_TEST_URL } = await import("../../fixtures/http");
  const { ANTHROPIC_TEST_KEY } = await import("../../fixtures/anthropic");
  return {
    SUPABASE_URL: SUPABASE_TEST_URL,
    SUPABASE_KEY: SUPABASE_TEST_KEY,
    get ANTHROPIC_API_KEY() {
      return env.providerKey ? ANTHROPIC_TEST_KEY : undefined;
    },
    getSecret: () => undefined,
  };
});

// The reference for a route test with a provider stub. What is proved here is test-plan.md risks
// #2 and #3, at the only place they can be: the number of requests that reached the provider.
// Every scenario states that number — 0 or 1, never more — beside whatever else it claims.
//
// Expected outcomes come from prd.md (FR-010: an audit runs on a deliberate action; FR-011: a
// positive finding carries a verbatim excerpt, and one that cannot be grounded is not reported;
// Non-Functional Requirements: only the listing's text and the team's criteria reach the model
// provider, members' notes never do), from the route's contract in
// context/changes/grounded-listing-audit/plan.md (Phase 4: the order of the exits, the NDJSON
// lines, one `offer_audit` log entry per way out and `started` before the model call, no retries,
// the save tried twice, a write that reached no row is `claim_lost`), and from the header of
// supabase/migrations/20261007073300_create_offer_audits.sql (what the database answers a claim
// and a write that ends an attempt). Every log entry and every stored row is written out by hand.
//
// Timers are fake for the whole file, the clock included: the model's deadline and the sign of
// life are timers, and a duration in a log entry is exact — 0 unless a test moves the clock.

beforeEach(() => {
  env.providerKey = true;
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  vi.setSystemTime(new Date("2026-10-08T10:00:00.000Z"));
});
afterEach(() => {
  vi.useRealTimers();
});
afterEach(restoreFetch);
afterEach(restoreConsole);
afterEach(() => {
  vi.unstubAllEnvs();
});

const USER_ID = "4c1d7e2a-9b3f-4e8a-8d2c-00000000beef";
/** The member's address is on `locals.user` in production too; no log entry may carry it. */
const USER_EMAIL = "czlonek.kanarek@vetpad.local";

interface Member {
  id: string;
  email: string;
}
const MEMBER: Member = { id: USER_ID, email: USER_EMAIL };

/** The id of the offer in tests/fixtures/audit.ts. An entry names the offer by it; the provider never sees it. */
const OFFER_ID = "0b9f0c2e-7d1a-4c55-9a53-0000000a0d17";
/** `run_started_at` as the database sets it at the claim: the name of the attempt. */
const STARTED_AT = "2026-10-08T10:00:00.123456+00:00";

/** The fixture listing's title and description, in characters. */
const LISTING_CHARS = AUDIT_TITLE.length + AUDIT_DESCRIPTION.length;

type Answer = () => Response | Promise<Response>;
type ProviderAnswer = (context: FetchContext) => Response | Promise<Response>;

const rows =
  (...list: unknown[]): Answer =>
  () =>
    jsonResponse(list, 200);
const dbError =
  (status: number, code: string, message: string): Answer =>
  () =>
    jsonResponse({ code, message, details: "KANAREK-DETAILS", hint: null }, status);

// The database as the route reads it. The offer row carries everything a careless query could
// drag along — `raw`, notes, members — and the requirements rows carry their authors: none of
// it may reach the provider.
const LIMITS_ROW = { city: "Warszawa", price_min: 500000, price_max: 650000, area_min: 45.5 };
const REQUIREMENTS_ROWS = [
  { body: ANNA_REQUIREMENTS, author_id: ANNA_ID_CANARY },
  { body: BARTEK_REQUIREMENTS, author_id: BARTEK_ID_CANARY },
];
/** The settings as the migration inserts them: the defaults, never changed. */
const DEFAULT_SETTINGS_ROW = { model: "claude-opus-5-5", effort: "medium", updated_at: null, updated_by: null };

/** One answer per request, in turn; a request past the last answer is unplanned. */
function inTurn(answers: Answer[]): () => Response | Promise<Response> | undefined {
  let next = 0;
  return () => {
    const answer = answers.at(next);
    next += 1;
    return answer?.();
  };
}

interface Network {
  offer?: Answer;
  /** One answer per read of `criteria_revision`: the route reads it before and after the criteria. */
  revisions?: Answer[];
  limits?: Answer;
  requirements?: Answer;
  settings?: Answer;
  /** The claim's insert. */
  claim?: Answer;
  /** The claim's update, sent only after the insert met an existing row. Unplanned unless given. */
  takeover?: Answer;
  /** One answer per write of the result. */
  complete?: Answer[];
  /** The write that marks the attempt failed. */
  fail?: Answer;
  /** The read of the row after a retried write reached none. Unplanned unless given. */
  stored?: Answer;
  /** The model provider. Unplanned unless given: a request to it then fails the test. */
  provider?: ProviderAnswer;
  /** Supabase Auth's token endpoint. Unplanned unless given. */
  refresh?: Answer;
}

function runState(request: RecordedRequest): unknown {
  return (JSON.parse(request.body ?? "{}") as Record<string, unknown>).run_state;
}

/**
 * Answers every request the route may make, each table on its own. Left alone, the database
 * holds the fixture offer, the fixture criteria under revision 7 and the default settings, takes
 * the claim and accepts either write that ends the attempt. `offer_notes` and `members` have no
 * answer at all: a request to either fails the test.
 */
function stubNetwork({
  offer = rows(auditOfferRow()),
  revisions = [rows({ revision: 7 }), rows({ revision: 7 })],
  limits = rows(LIMITS_ROW),
  requirements = rows(...REQUIREMENTS_ROWS),
  settings = rows(DEFAULT_SETTINGS_ROW),
  claim = () => jsonResponse([{ run_started_at: STARTED_AT }], 201),
  takeover,
  complete = [rows({ offer_id: OFFER_ID })],
  fail = rows({ offer_id: OFFER_ID }),
  stored,
  provider,
  refresh,
}: Network = {}): FetchStub {
  const nextRevision = inTurn(revisions);
  const nextComplete = inTurn(complete);
  return stubFetch((request, context) => {
    if (isProviderRequest(request)) return provider?.(context);
    if (isAuthRequest(request, "token")) return refresh?.();
    if (isTableRequest(request, "offers", "GET")) return offer();
    if (isTableRequest(request, "criteria_revision", "GET")) return nextRevision();
    if (isTableRequest(request, "team_criteria", "GET")) return limits();
    if (isTableRequest(request, "member_requirements", "GET")) return requirements();
    if (isTableRequest(request, "audit_settings", "GET")) return settings();
    if (isTableRequest(request, "offer_audits", "POST")) return claim();
    if (isTableRequest(request, "offer_audits", "GET")) return stored?.();
    if (isTableRequest(request, "offer_audits", "PATCH")) {
      const state = runState(request);
      if (state === "running") return takeover?.();
      if (state === "completed") return nextComplete();
      if (state === "failed") return fail();
    }
    return undefined;
  });
}

function requestsTo(stub: FetchStub, table: string, method?: string): RecordedRequest[] {
  return stub.requests.filter((request) => {
    const url = new URL(request.url);
    return url.pathname === `/rest/v1/${table}` && (method === undefined || request.method === method);
  });
}

/** The writes to `offer_audits` whose body sets `run_state` to `state`. */
function writes(stub: FetchStub, state: "running" | "completed" | "failed"): RecordedRequest[] {
  return requestsTo(stub, "offer_audits", "PATCH").filter((request) => runState(request) === state);
}

function body(request: RecordedRequest | undefined): Record<string, unknown> {
  if (typeof request?.body !== "string") throw new Error("expected a request with a JSON body");
  return JSON.parse(request.body) as Record<string, unknown>;
}

/** The tables asked, in the order of the requests. */
function tablesAsked(stub: FetchStub): string[] {
  return stub.requests
    .filter((request) => new URL(request.url).pathname.startsWith("/rest/v1/"))
    .map((request) => `${request.method} ${new URL(request.url).pathname.replace("/rest/v1/", "")}`);
}

/** The requests of a whole audit that got as far as the claim. */
const READS_AND_CLAIM = [
  "GET offers",
  "GET criteria_revision",
  "GET team_criteria",
  "GET member_requirements",
  "GET criteria_revision",
  "GET audit_settings",
  "POST offer_audits",
];

type Line = Record<string, unknown>;

interface Sent {
  response: Response;
  /** `cookies.set` of the request's context. */
  cookiesSet: ReturnType<typeof vi.fn>;
  request: Request;
}

interface Posted {
  user?: Member | null;
  /** The form's fields; `offer_id` is the fixture offer unless a test says otherwise. */
  fields?: Record<string, string>;
  request?: Request;
  cookie?: string;
  locals?: Record<string, unknown>;
  cookiesSet?: ReturnType<typeof vi.fn>;
}

/** Sends the form and returns the route's answer as soon as the route hands it over. */
async function post({
  user = MEMBER,
  fields = { offer_id: OFFER_ID },
  request,
  cookie,
  locals = {},
  cookiesSet = vi.fn(),
}: Posted = {}): Promise<Sent> {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.set(name, value);
  const headers = new Headers();
  if (cookie !== undefined) headers.set("Cookie", cookie);
  const sent = request ?? new Request("http://localhost/api/audits", { method: "POST", body: form, headers });
  const context = {
    request: sent,
    locals: { user, ...locals },
    cookies: { set: cookiesSet },
    redirect: (location: string, status = 302) => new Response(null, { status, headers: { Location: location } }),
  } as unknown as APIContext;
  return { response: await POST(context), cookiesSet, request: sent };
}

/**
 * Waits, in real turns of the event loop, until the route has sent its request to the provider.
 * The reads and the claim before it are real asynchronous work that the fake clock does not
 * drive, so a test that moves the clock first would move it past timers that are not set yet.
 */
async function providerCalled(stub: FetchStub): Promise<void> {
  for (let turn = 0; turn < 500 && providerCalls(stub.requests).length === 0; turn += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  expect(providerCalls(stub.requests)).toHaveLength(1);
}

/** The body as the island reads it: one JSON object per line, every line ended by a line feed. */
function parseLines(text: string): Line[] {
  if (text !== "" && !text.endsWith("\n")) throw new Error("expected the body to end with a line feed");
  return text
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as Line);
}

interface Audited extends Sent {
  lines: Line[];
  /** The body as text — what a search for leaked data reads. */
  text: string;
  stub: FetchStub;
  captured: ConsoleCapture;
}

/** One audit from the form to the last line of the answer, with the console captured. */
async function audit(network: Network = {}, posted: Posted = {}): Promise<Audited> {
  const captured = captureConsole();
  const stub = stubNetwork(network);
  const sent = await post(posted);
  const text = await sent.response.text();
  return { ...sent, lines: parseLines(text), text, stub, captured };
}

/** The last line of a failed audit: the reason, and the sentence a member reads. */
function failure(lines: Line[]): { reason: unknown; message: string } {
  const last = lines.at(-1);
  expect(last?.type).toBe("failed");
  expect(Object.keys(last ?? {}).sort()).toEqual(["message", "reason", "type"]);
  if (typeof last?.message !== "string" || last.message === "") throw new Error("expected a message for the member");
  return { reason: last.reason, message: last.message };
}

function entry(level: "info" | "error", fields: Record<string, string | number>): ConsoleEntry {
  return { method: level, args: [{ level, event: "offer_audit", ...fields }] };
}

/** What every entry of an audit that got as far as the claim carries. */
const KNOWN = {
  user_id: USER_ID,
  offer_id: OFFER_ID,
  model: "claude-opus-5-5",
  effort: "medium",
  criteria_revision: 7,
  listing_chars: LISTING_CHARS,
};

/** The entry the route leaves before it calls the model, so a call the platform cut short still has a trace. */
const STARTED = entry("info", { outcome: "started", stage: "provider", ...KNOWN });

// The model's answer for the fixture listing. The two excerpts are the listing's own words; the
// second runs over a line break of the description, where the model wrote a space. Every
// parameter of the fixture offer is stated, so the finding about the floor is one the grounding
// drops; the one about the second requirement stays.
const ANSWER = {
  missing: [
    { attribute: "floor", requirement_ref: null, question: "Na którym piętrze jest mieszkanie?" },
    {
      attribute: "requirement",
      requirement_ref: "W2",
      question: "Czy do mieszkania należy miejsce postojowe w garażu podziemnym?",
    },
  ],
  conditions: [],
  costs: [
    { label: "Prowizja biura po stronie kupującego", excerpt: "Kupujący pokrywa prowizję biura w wysokości 2% ceny." },
  ],
  red_flags: [
    {
      label: "Mieszkanie z lokatorem",
      excerpt: "Mieszkanie z lokatorem, umowa najmu do końca 2027 roku.",
      requirement_ref: null,
    },
  ],
};

/** What the grounding stores of `ANSWER`: the listing's own text with its line break, and the requirement's text. */
const STORED_FINDINGS = {
  version: 1,
  missing: [
    {
      attribute: "requirement",
      requirement: "Miejsce postojowe w garażu podziemnym.",
      question: "Czy do mieszkania należy miejsce postojowe w garażu podziemnym?",
    },
  ],
  conditions: [],
  costs: [
    {
      label: "Prowizja biura po stronie kupującego",
      excerpt: "Kupujący pokrywa prowizję biura w wysokości 2% ceny.",
      source: "description",
    },
  ],
  red_flags: [
    {
      label: "Mieszkanie z lokatorem",
      excerpt: "Mieszkanie z lokatorem, umowa najmu\ndo końca 2027 roku.",
      source: "description",
      requirement: null,
    },
  ],
};

const answered: ProviderAnswer = () => providerAnswer({ text: JSON.stringify(ANSWER) });

/** What the entry of a finished model call adds: the fixture stream's 12 events and its token counts. */
const CALLED = {
  provider_request_id: "req_test_kanarek_0001",
  stop_reason: "end_turn",
  input_tokens: 1850,
  output_tokens: 420,
  stream_events: 12,
};

const COMPLETED = entry("info", {
  outcome: "completed",
  stage: "save",
  ...KNOWN,
  ...CALLED,
  findings_count: 3,
  rejected_count: 0,
  dropped_count: 1,
  duration_ms: 0,
});

/** The filter of a write that ends the attempt: the offer's row, only while it is still this attempt's. */
function expectOwnAttemptOnly(request: RecordedRequest | undefined): void {
  const params = new URL(request?.url ?? "").searchParams;
  expect(params.get("offer_id")).toBe(`eq.${OFFER_ID}`);
  expect(params.get("run_state")).toBe("eq.running");
  expect(params.get("run_started_at")).toBe(`eq.${STARTED_AT}`);
  // Without `select`, PostgREST answers 204 with no body and a write that reached no row looks like a save.
  expect(params.get("select")).not.toBeNull();
}

describe("POST /api/audits: no session never reaches the database or the provider (#2, FR-001)", () => {
  it("redirects to /auth/signin before anything else: 0 provider calls, no request, the body unread", async () => {
    const captured = captureConsole();
    const stub = stubNetwork();

    const { response, request } = await post({ user: null });

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/auth/signin");
    expect(providerCalls(stub.requests)).toHaveLength(0);
    expect(stub.requests).toHaveLength(0);
    expect(request.bodyUsed).toBe(false);
    expect(captured.entries()).toStrictEqual([
      entry("info", { outcome: "refused", stage: "auth", reason: "signed_out" }),
    ]);
  });

  it("control: the same request with a session does reach the provider, once", async () => {
    const { stub } = await audit({ provider: answered });

    expect(providerCalls(stub.requests)).toHaveLength(1);
  });
});

describe("POST /api/audits: the answer is a stream of lines that always ends with done or failed", () => {
  it("answers 200 with NDJSON that is never cached", async () => {
    const { response } = await audit({ provider: answered });

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/x-ndjson; charset=utf-8");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("writes the three stages in order and ends with done", async () => {
    const { lines } = await audit({ provider: answered });

    expect(lines).toStrictEqual([
      { type: "stage", stage: "reading" },
      { type: "stage", stage: "model" },
      { type: "stage", stage: "saving" },
      { type: "done" },
    ]);
  });

  it("answers a refusal with 200 and the same headers, its last line failed", async () => {
    const { response, lines } = await audit({}, { fields: { offer_id: "not-a-uuid" } });

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/x-ndjson; charset=utf-8");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(lines).toHaveLength(1);
    expect(lines.at(-1)?.type).toBe("failed");
  });

  it("writes a sign of life every 5 seconds while the model works, and stops when it answers", async () => {
    captureConsole();
    let answer: (response: Response) => void = () => undefined;
    const stub = stubNetwork({
      provider: () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        }),
    });
    const { response } = await post();
    const reading = response.text();

    // Twelve seconds of silence from the model: two signs of life, at 5 and at 10 seconds.
    await providerCalled(stub);
    await vi.advanceTimersByTimeAsync(12_000);
    answer(providerAnswer({ text: JSON.stringify(ANSWER) }));
    const lines = parseLines(await reading);

    expect(lines).toStrictEqual([
      { type: "stage", stage: "reading" },
      { type: "stage", stage: "model" },
      { type: "alive" },
      { type: "alive" },
      { type: "stage", stage: "saving" },
      { type: "done" },
    ]);
    // Neither the deadline nor the sign of life outlives the call.
    expect(vi.getTimerCount()).toBe(0);
  });

  it("leaves no timer behind when the model call fails", async () => {
    await audit({ provider: () => providerError(500, "api_error") });

    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("POST /api/audits: what can be checked for free is checked before the claim (#2)", () => {
  const INVALID: [string, Posted][] = [
    ["an id that is not a uuid", { fields: { offer_id: "not-a-uuid" } }],
    ["an empty id", { fields: { offer_id: "" } }],
    ["a form without the field", { fields: {} }],
    ["a uuid with a query glued to it", { fields: { offer_id: `${OFFER_ID}?kanarek-zapytanie=1` } }],
    [
      "a body that is not a form",
      {
        request: new Request("http://localhost/api/audits", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ offer_id: OFFER_ID }),
        }),
      },
    ],
  ];

  it.each(INVALID)("refuses %s as invalid_offer: 0 provider calls and no request", async (_case, posted) => {
    const { lines, stub, captured } = await audit({}, posted);

    const { reason, message } = failure(lines);
    expect(reason).toBe("invalid_offer");
    expect(message).toContain("Nie rozpoznano oferty");
    expect(providerCalls(stub.requests)).toHaveLength(0);
    expect(stub.requests).toHaveLength(0);
    // The value itself stays out of the entry: it is whatever the request carried.
    expect(captured.entries()).toStrictEqual([
      entry("info", { outcome: "refused", stage: "offer_id", reason: "invalid_offer", user_id: USER_ID }),
    ]);
    expect(captured.text()).not.toContain("kanarek-zapytanie");
  });

  it("refuses an offer that is not there as offer_not_found: 0 provider calls, no claim", async () => {
    const { lines, stub, captured } = await audit({ offer: rows() });

    const { reason, message } = failure(lines);
    expect(reason).toBe("offer_not_found");
    expect(message).toContain("już nie istnieje");
    expect(providerCalls(stub.requests)).toHaveLength(0);
    expect(tablesAsked(stub)).toEqual(["GET offers"]);
    expect(lines).toStrictEqual([{ type: "stage", stage: "reading" }, lines.at(-1)]);
    expect(captured.entries()).toStrictEqual([
      entry("info", {
        outcome: "refused",
        stage: "offer",
        reason: "offer_not_found",
        user_id: USER_ID,
        offer_id: OFFER_ID,
      }),
    ]);
  });

  it("asks for the audit's columns of that one offer and nothing else", async () => {
    const { stub } = await audit({ provider: answered });

    const params = new URL(requestsTo(stub, "offers")[0]?.url ?? "").searchParams;
    expect(params.get("id")).toBe(`eq.${OFFER_ID}`);
    // Written out by hand: the listing's words, the facts it states and its amenities. Never
    // `raw`, `images`, `source_url`, `id` or `created_by` — and no embedded notes.
    expect(params.get("select")).toBe(
      "title,description,price,price_currency,price_per_m,area_m2,rooms,floors_total,build_year,rent,rent_currency," +
        "floor,market,building_type,construction_status,building_ownership,heating,windows_type,building_material," +
        "energy_certificate,advert_type,free_from,location_label,street_name,features",
    );
  });

  // Two causes, one reason: the member reads the same sentence, the entry tells them apart.
  it.each<[string, Answer, Record<string, string | number>]>([
    [
      "a read the database failed",
      dbError(500, "XX000", "internal error"),
      { detail: "query_failed", db_code: "XX000", db_message: "internal error", db_status: 500 },
    ],
    ["a row whose price is zero", rows(auditOfferRow({ price: 0 })), { detail: "row_unreadable" }],
    ["a row whose description is blank", rows(auditOfferRow({ description: "  " })), { detail: "row_unreadable" }],
    ["a row without the title column", rows({ ...auditOfferRow(), title: undefined }), { detail: "row_unreadable" }],
  ])("reports %s as offer_read_failed: 0 provider calls, no claim", async (_case, offer, fields) => {
    const { lines, stub, captured } = await audit({ offer });

    const { reason, message } = failure(lines);
    expect(reason).toBe("offer_read_failed");
    // True for both causes: it promises nothing about "in a moment".
    expect(message).toContain("nieczytelne");
    expect(message).not.toContain("za chwilę");
    expect(providerCalls(stub.requests)).toHaveLength(0);
    expect(tablesAsked(stub)).toEqual(["GET offers"]);
    expect(captured.entries()).toStrictEqual([
      entry("error", {
        outcome: "failed",
        stage: "offer",
        reason: "offer_read_failed",
        user_id: USER_ID,
        offer_id: OFFER_ID,
        ...fields,
      }),
    ]);
    // Postgres quotes the rejected row in `details`: it is never read.
    expect(captured.text()).not.toContain("KANAREK-DETAILS");
  });

  it("refuses without a provider key as unconfigured_provider, after the offer was found: 0 provider calls, no claim", async () => {
    env.providerKey = false;

    const { lines, stub, captured } = await audit();

    const { reason, message } = failure(lines);
    expect(reason).toBe("unconfigured_provider");
    expect(message).toContain("klucza dostawcy modelu");
    expect(providerCalls(stub.requests)).toHaveLength(0);
    // The offer was read, and nothing after it: no criteria, no settings, no claim.
    expect(tablesAsked(stub)).toEqual(["GET offers"]);
    expect(captured.entries()).toStrictEqual([
      entry("info", {
        outcome: "refused",
        stage: "config",
        reason: "unconfigured_provider",
        user_id: USER_ID,
        offer_id: OFFER_ID,
      }),
    ]);
  });

  // The key stands after the offer, so an unknown offer gets one answer with a key and without.
  it("answers an unknown offer the same way without a provider key", async () => {
    env.providerKey = false;

    const { lines, stub } = await audit({ offer: rows() });

    expect(failure(lines).reason).toBe("offer_not_found");
    expect(providerCalls(stub.requests)).toHaveLength(0);
  });

  // The entry names the step that failed, and the database's code and status when it answered:
  // this read stands before a paid call, and "criteria" alone would not say what to look at.
  it.each<[string, Network, string[], Record<string, unknown>]>([
    [
      "the revision cannot be read",
      { revisions: [dbError(500, "XX000", "internal error")] },
      ["GET criteria_revision"],
      { detail: "revision_query", db_code: "XX000", db_status: 500 },
    ],
    [
      "the limits cannot be read",
      { limits: dbError(500, "XX000", "internal error") },
      ["GET criteria_revision", "GET team_criteria", "GET member_requirements"],
      { detail: "limits_query", db_code: "XX000", db_status: 500 },
    ],
    [
      "the requirements cannot be read",
      { requirements: dbError(500, "XX000", "internal error") },
      ["GET criteria_revision", "GET team_criteria", "GET member_requirements"],
      { detail: "requirements_query", db_code: "XX000", db_status: 500 },
    ],
    [
      "a limit does not read as a limit",
      { limits: rows({ ...LIMITS_ROW, price_max: 0 }) },
      ["GET criteria_revision", "GET team_criteria", "GET member_requirements"],
      { detail: "limits_unreadable" },
    ],
  ])("reports criteria_read_failed when %s: 0 provider calls, no claim", async (_case, network, asked, cause) => {
    const { lines, stub, captured } = await audit(network);

    const { reason, message } = failure(lines);
    expect(reason).toBe("criteria_read_failed");
    expect(message).toContain("kryteriów zespołu");
    expect(providerCalls(stub.requests)).toHaveLength(0);
    expect(requestsTo(stub, "offer_audits")).toHaveLength(0);
    expect([...tablesAsked(stub)].sort()).toEqual(["GET offers", ...asked].sort());
    expect(captured.entries()).toStrictEqual([
      entry("error", {
        outcome: "failed",
        stage: "criteria",
        reason: "criteria_read_failed",
        user_id: USER_ID,
        offer_id: OFFER_ID,
        ...cause,
      }),
    ]);
  });

  it.each<[string, Answer, Record<string, unknown>]>([
    [
      "the settings cannot be read",
      dbError(500, "XX000", "internal error"),
      { detail: "query", db_code: "XX000", db_status: 500 },
    ],
    ["the settings row is missing", rows(), { detail: "missing", db_status: 200 }],
    [
      "the stored model is off the list",
      rows({ ...DEFAULT_SETTINGS_ROW, model: "claude-haiku-4-5" }),
      { detail: "off_list" },
    ],
    ["the stored effort is off the list", rows({ ...DEFAULT_SETTINGS_ROW, effort: "max" }), { detail: "off_list" }],
  ])("reports settings_read_failed when %s: 0 provider calls, no claim", async (_case, settings, cause) => {
    const { lines, stub, captured } = await audit({ settings });

    const { reason, message } = failure(lines);
    expect(reason).toBe("settings_read_failed");
    expect(message).toContain("ustawień audytu");
    expect(providerCalls(stub.requests)).toHaveLength(0);
    expect(requestsTo(stub, "offer_audits")).toHaveLength(0);
    expect(captured.entries()).toStrictEqual([
      entry("error", {
        outcome: "failed",
        stage: "settings",
        reason: "settings_read_failed",
        user_id: USER_ID,
        offer_id: OFFER_ID,
        ...cause,
      }),
    ]);
  });
});

describe("POST /api/audits: the row is claimed before anything is paid for (#2)", () => {
  const EXISTING_ROW = dbError(409, "23505", 'duplicate key value violates unique constraint "offer_audits_pkey"');

  it("claims the offer's first attempt with an insert that names the offer and the state, and nothing else", async () => {
    const { stub } = await audit({ provider: answered });

    const claims = requestsTo(stub, "offer_audits", "POST");
    expect(claims).toHaveLength(1);
    expect(body(claims[0])).toEqual({ offer_id: OFFER_ID, run_state: "running" });
    // The member's id travels in no column: the trigger signs the attempt.
    expect(claims[0]?.body).not.toContain(USER_ID);
    // The claim stands before the provider call, and every read before the claim.
    const order = stub.requests.map((request) => (isProviderRequest(request) ? "provider" : request.method));
    expect(order.indexOf("POST")).toBeLessThan(order.indexOf("provider"));
    expect(tablesAsked(stub).slice(0, 7)).toEqual(READS_AND_CLAIM);
  });

  it("refuses as busy while another attempt holds the row (VP001): 0 provider calls", async () => {
    const { lines, stub, captured } = await audit({
      claim: EXISTING_ROW,
      takeover: dbError(400, "VP001", "an audit of this offer is already running"),
    });

    const { reason, message } = failure(lines);
    expect(reason).toBe("busy");
    expect(message).toContain("już trwa");
    expect(providerCalls(stub.requests)).toHaveLength(0);
    // The insert, then the takeover — and no write that would end somebody else's attempt.
    expect(requestsTo(stub, "offer_audits", "POST")).toHaveLength(1);
    expect(writes(stub, "running")).toHaveLength(1);
    expect(writes(stub, "completed")).toHaveLength(0);
    expect(writes(stub, "failed")).toHaveLength(0);
    expect(lines.some((line) => line.stage === "model")).toBe(false);
    // An audit already running is what the product expects of a second click: info, not an error.
    expect(captured.entries()).toStrictEqual([
      entry("info", { outcome: "refused", stage: "claim", reason: "busy", ...KNOWN }),
    ]);
  });

  it("takes over the row of an attempt that has ended, and audits under the new start: 1 provider call", async () => {
    const TAKEN_AT = "2026-10-08T10:00:00.654321+00:00";
    const { lines, stub } = await audit({
      claim: EXISTING_ROW,
      takeover: () => jsonResponse([{ run_started_at: TAKEN_AT }], 200),
      provider: answered,
    });

    expect(lines.at(-1)).toStrictEqual({ type: "done" });
    expect(providerCalls(stub.requests)).toHaveLength(1);
    const takeovers = writes(stub, "running");
    expect(takeovers).toHaveLength(1);
    expect(body(takeovers[0])).toEqual({ run_state: "running" });
    expect(new URL(takeovers[0]?.url ?? "").searchParams.get("offer_id")).toBe(`eq.${OFFER_ID}`);
    // The result is written under the start the takeover returned, not the insert's.
    expect(new URL(writes(stub, "completed")[0]?.url ?? "").searchParams.get("run_started_at")).toBe(`eq.${TAKEN_AT}`);
  });

  it.each<[string, Network, Record<string, string | number>]>([
    [
      "the insert is refused by the database",
      { claim: dbError(403, "42501", "an audit can only be started by a signed-in member") },
      {
        detail: "insert",
        db_code: "42501",
        db_message: "an audit can only be started by a signed-in member",
        db_status: 403,
      },
    ],
    [
      "the insert gets no answer",
      { claim: () => Promise.reject(new TypeError("fetch failed")) },
      { detail: "insert", db_message: "TypeError: fetch failed", db_status: 0 },
    ],
    [
      "the insert answers without the row",
      { claim: () => jsonResponse([], 201) },
      { detail: "insert", db_status: 201 },
    ],
    [
      "the takeover is refused by the database",
      { claim: EXISTING_ROW, takeover: dbError(500, "XX000", "internal error") },
      { detail: "takeover", db_code: "XX000", db_message: "internal error", db_status: 500 },
    ],
    ["the takeover reaches no row", { claim: EXISTING_ROW, takeover: rows() }, { detail: "takeover", db_status: 200 }],
  ])("reports claim_failed when %s: 0 provider calls", async (_case, network, fields) => {
    const { lines, stub, captured } = await audit(network);

    const { reason, message } = failure(lines);
    expect(reason).toBe("claim_failed");
    expect(message).toContain("Model nie został wywołany");
    expect(providerCalls(stub.requests)).toHaveLength(0);
    expect(writes(stub, "completed")).toHaveLength(0);
    expect(writes(stub, "failed")).toHaveLength(0);
    expect(captured.entries()).toStrictEqual([
      entry("error", { outcome: "failed", stage: "claim", reason: "claim_failed", ...KNOWN, ...fields }),
    ]);
    expect(captured.text()).not.toContain("KANAREK-DETAILS");
  });
});

describe("POST /api/audits: a finished audit is one provider call and one stored result (#2, #3)", () => {
  it("calls the provider exactly once and never asks for a member's note", async () => {
    const { stub } = await audit({ provider: answered });

    expect(providerCalls(stub.requests)).toHaveLength(1);
    expect(providerCalls(stub.requests).every(isProviderRequest)).toBe(true);
    expect(requestsTo(stub, "offer_notes")).toHaveLength(0);
    expect(requestsTo(stub, "members")).toHaveLength(0);
    expect(tablesAsked(stub)).toEqual([...READS_AND_CLAIM, "PATCH offer_audits"]);
  });

  it("stores the grounded findings with the model, the effort, the revision and the fingerprint", async () => {
    const { stub } = await audit({ provider: answered });

    const saves = writes(stub, "completed");
    expect(saves).toHaveLength(1);
    expectOwnAttemptOnly(saves[0]);
    const row = body(saves[0]);
    // Written out by hand. The fixture team has limits and two members' requirements.
    expect(Object.keys(row).sort()).toEqual([
      "criteria_revision",
      "effort",
      "findings",
      "had_limits",
      "listing_fingerprint",
      "model",
      "rejected_count",
      "requirements_count",
      "run_state",
    ]);
    expect(row).toMatchObject({
      run_state: "completed",
      findings: STORED_FINDINGS,
      rejected_count: 0,
      model: "claude-opus-5-5",
      effort: "medium",
      criteria_revision: 7,
      had_limits: true,
      requirements_count: 2,
    });
    // The date and the people are the trigger's: none of them travels in the write.
    for (const forbidden of ["audited_at", "audited_by", "run_started_at", "run_started_by", "offer_id"]) {
      expect(row).not.toHaveProperty(forbidden);
    }
    expect(saves[0]?.body).not.toContain(USER_ID);
  });

  it("stores the fingerprint of the whitelisted columns: v1 and the SHA-256 of their values in order", async () => {
    const { stub } = await audit({ provider: answered });

    // The fixture row's audit columns, by hand, in the order of the whitelist.
    const offer = auditOfferRow();
    const values = {
      title: offer.title,
      description: offer.description,
      price: 599000,
      price_currency: "PLN",
      price_per_m: 10990.83,
      area_m2: 54.5,
      rooms: 3,
      floors_total: 10,
      build_year: 1975,
      rent: 650,
      rent_currency: "PLN",
      floor: "floor_7",
      market: "secondary",
      building_type: "block",
      construction_status: "ready_to_use",
      building_ownership: "full_ownership",
      heating: "urban",
      windows_type: "plastic",
      building_material: "concrete_plate",
      energy_certificate: "C",
      advert_type: "PRIVATE",
      free_from: "2026-11-01",
      location_label: "Praga-Południe, Warszawa, mazowieckie",
      street_name: "ul. Kanarkowa",
      features: ["balcony", "lift", "piwnica"],
    };
    const expected = `v1:${createHash("sha256").update(JSON.stringify(values), "utf8").digest("hex")}`;
    expect(body(writes(stub, "completed")[0]).listing_fingerprint).toBe(expected);
  });

  it("logs the start and the result with the tokens, the request id and the number of stream events", async () => {
    const { captured } = await audit({ provider: answered });

    expect(captured.entries()).toStrictEqual([STARTED, COMPLETED]);
  });

  it("logs as many stream events as the stream had", async () => {
    const { captured, lines } = await audit({
      provider: () => providerAnswer({ text: JSON.stringify(ANSWER), events: 240 }),
    });

    expect(lines.at(-1)).toStrictEqual({ type: "done" });
    expect(captured.entries().at(-1)).toStrictEqual(
      entry("info", {
        outcome: "completed",
        stage: "save",
        ...KNOWN,
        ...CALLED,
        stream_events: 240,
        findings_count: 3,
        rejected_count: 0,
        dropped_count: 1,
        duration_ms: 0,
      }),
    );
  });

  it("audits with the model and the effort the team chose, and stores them with the result", async () => {
    const { stub, captured } = await audit({
      settings: rows({ ...DEFAULT_SETTINGS_ROW, model: "claude-sonnet-5-5", effort: "high" }),
      provider: answered,
    });

    const sent = body(providerCalls(stub.requests)[0]);
    expect(sent.model).toBe("claude-sonnet-5-5");
    expect((sent.output_config as Record<string, unknown>).effort).toBe("high");
    expect(body(writes(stub, "completed")[0])).toMatchObject({ model: "claude-sonnet-5-5", effort: "high" });
    expect(captured.entries()[0]).toStrictEqual(
      entry("info", { outcome: "started", stage: "provider", ...KNOWN, model: "claude-sonnet-5-5", effort: "high" }),
    );
  });

  it("stores no limits and no requirements for a team that has set none", async () => {
    const { stub, lines } = await audit({
      limits: rows({ city: null, price_min: null, price_max: null, area_min: null }),
      requirements: rows(),
      provider: () =>
        providerAnswer({ text: JSON.stringify({ missing: [], conditions: [], costs: [], red_flags: [] }) }),
    });

    expect(lines.at(-1)).toStrictEqual({ type: "done" });
    expect(body(writes(stub, "completed")[0])).toMatchObject({
      findings: { version: 1, missing: [], conditions: [], costs: [], red_flags: [] },
      rejected_count: 0,
      had_limits: false,
      requirements_count: 0,
    });
  });
});

describe("POST /api/audits: what the provider is sent (#6, FR-010)", () => {
  async function sent(): Promise<{ request: RecordedRequest; params: Record<string, unknown> }> {
    const { stub } = await audit({ provider: answered });
    const request = providerCalls(stub.requests).at(0);
    if (request === undefined) throw new Error("expected a request to the provider");
    return { request, params: body(request) };
  }

  it("sends one streamed request with the instruction, one user message, the model, the effort and the token ceiling", async () => {
    const { request, params } = await sent();

    expect(request.url).toBe("https://api.anthropic.com/v1/messages");
    // Nothing else travels: no thinking budget, no tools, no metadata about the member.
    expect(Object.keys(params).sort()).toEqual([
      "max_tokens",
      "messages",
      "model",
      "output_config",
      "stream",
      "system",
    ]);
    expect(params.model).toBe("claude-opus-5-5");
    expect(params.max_tokens).toBe(16000);
    expect(params.stream).toBe(true);
    expect(Object.keys(params.output_config as object).sort()).toEqual(["effort", "format"]);
    expect((params.output_config as Record<string, unknown>).effort).toBe("medium");
    expect(typeof params.system).toBe("string");
    const messages = params.messages as { role: string; content: string }[];
    expect(messages).toHaveLength(1);
    expect(messages[0]?.role).toBe("user");
    expect(typeof messages[0]?.content).toBe("string");
  });

  // The SDK reads a base address, a token and custom headers from the process environment for
  // whatever its constructor is not given. The listing goes to the provider, and only there.
  it("sends it to the provider's own address whatever the process environment says", async () => {
    vi.stubEnv("ANTHROPIC_BASE_URL", "https://kanarek-posrednik.example");
    vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "kanarek-token-srodowiska");

    const { request } = await sent();

    expect(request.url).toBe("https://api.anthropic.com/v1/messages");
  });

  it("sends the schema as it is written, the attributes' enum included", async () => {
    const { params } = await sent();
    const format = (params.output_config as Record<string, unknown>).format as Record<string, unknown>;

    // The SDK's helper would by default rewrite the schema and move `enum` into a description.
    expect(format).toEqual({ type: "json_schema", schema: AUDIT_OUTPUT_SCHEMA });
    const schema = format.schema as typeof AUDIT_OUTPUT_SCHEMA;
    const attribute = schema.properties.missing.items.properties.attribute as Record<string, unknown>;
    expect(attribute).toEqual({
      type: "string",
      enum: [
        "price",
        "area",
        "location",
        "floor",
        "heating",
        "ownership",
        "admin_rent",
        "build_year",
        "finish_state",
        "requirement",
      ],
    });
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.red_flags.items.properties.requirement_ref).toEqual({ type: ["string", "null"] });
  });

  it("sends the listing's own words and the team's criteria", async () => {
    const { params } = await sent();
    const message = (params.messages as { content: string }[])[0]?.content ?? "";

    expect(message).toContain(AUDIT_TITLE);
    expect(message).toContain(AUDIT_DESCRIPTION);
    expect(message).toContain(ANNA_REQUIREMENTS);
    expect(message).toContain(BARTEK_REQUIREMENTS);
    // What the advertiser typed into the listing stays as written (prd.md, Non-Functional Requirements).
    expect(message).toContain(TYPED_NAME);
    expect(message).toContain(TYPED_PHONE);
    // The instruction carries no listing and no criteria.
    expect(params.system).not.toContain(AUDIT_TITLE);
    expect(params.system).not.toContain(ANNA_REQUIREMENTS);
  });

  it("sends no note, no seller data from raw, no address of a member and no identifier", async () => {
    const { request } = await sent();

    // The JSON on the wire escapes a line break; the canaries hold none, so they are searched as they are.
    for (const forbidden of [...FORBIDDEN_IN_AUDIT, USER_ID, USER_EMAIL]) {
      expect(request.body).not.toContain(forbidden);
    }
    // The control: the same search does find what is meant to be there.
    expect(request.body).toContain(TYPED_PHONE);
  });
});

describe("POST /api/audits: a finding that cannot be grounded is not stored (#4, FR-011)", () => {
  it("completes with the paraphrased finding left out and counted: 1 provider call, rejected_count 1", async () => {
    const paraphrased = {
      ...ANSWER,
      costs: [{ label: "Prowizja biura po stronie kupującego", excerpt: "Kupujący płaci biuru prowizję 2% od ceny." }],
    };
    const { lines, stub, captured } = await audit({
      provider: () => providerAnswer({ text: JSON.stringify(paraphrased) }),
    });

    expect(lines.at(-1)).toStrictEqual({ type: "done" });
    expect(providerCalls(stub.requests)).toHaveLength(1);
    const row = body(writes(stub, "completed")[0]);
    expect(row).toMatchObject({
      run_state: "completed",
      rejected_count: 1,
      findings: { ...STORED_FINDINGS, costs: [] },
    });
    // Neither the label nor the model's wording of the excerpt is stored anywhere in the row.
    expect(writes(stub, "completed")[0]?.body).not.toContain("płaci biuru");
    expect(writes(stub, "completed")[0]?.body).not.toContain("Prowizja biura po stronie kupującego");
    expect(captured.entries().at(-1)).toStrictEqual(
      entry("info", {
        outcome: "completed",
        stage: "save",
        ...KNOWN,
        ...CALLED,
        findings_count: 2,
        rejected_count: 1,
        dropped_count: 1,
        duration_ms: 0,
      }),
    );
  });

  it("control: the same finding with the listing's own words is stored, and nothing is counted", async () => {
    const { stub } = await audit({ provider: answered });

    expect(body(writes(stub, "completed")[0])).toMatchObject({ rejected_count: 0, findings: STORED_FINDINGS });
  });
});

/** What the entry of a refused request adds: the provider said what it was, before any stream. */
function refusedWith(status: number, type: string): Record<string, string | number> {
  return {
    status,
    provider_error_type: type,
    provider_request_id: "req_test_kanarek_0001",
    error_name: "APIError",
    stream_events: 0,
    duration_ms: 0,
  };
}

/** A stream the provider started and then broke off: the first two events, and no more. */
function begun(...rest: SseEvent[]): SseEvent[] {
  // `message_start`, the ping the SDK skips, and the start of the first block.
  return [...answerEvents({ text: "" }).slice(0, 3), ...rest];
}

/** What the entry of a stream that began adds: its request id, the input tokens it reported and its two events. */
const BEGUN = { provider_request_id: "req_test_kanarek_0001", input_tokens: 1850, stream_events: 2 };

describe("POST /api/audits: a failed model call is paid for at most once, and leaves the attempt failed (#2, #3)", () => {
  const usageLimit =
    "You have reached your specified API usage limits. You will regain access on 2026-11-01 at 00:00 UTC.";
  const lowBalance = "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing.";
  // The provider's answer to a key that belongs to no workspace, as it came on 2026-10-09.
  const unscopedKey =
    "This API key is not scoped to a workspace, so this request must include the anthropic-workspace-id header with the ID of the workspace to use. Add the header, or use an API key that is scoped to a workspace.";
  // What the provider says about a request it could not read: the field, and what is wrong with it.
  const rejected =
    "output_config.format.schema: For 'object' type, 'additionalProperties' must be explicitly set to false";

  // One row per way a call can fail: what the provider did, the reason, a fragment of the
  // sentence the member reads, and what the entry adds.
  const FAILURES: [string, ProviderAnswer, string, string, Record<string, string | number>][] = [
    [
      "429 rate_limit_error",
      () => providerError(429, "rate_limit_error"),
      "provider_rate_limited",
      "ogranicza teraz liczbę zapytań",
      refusedWith(429, "rate_limit_error"),
    ],
    [
      "429 with the tier's spend limit reached",
      () => providerError(429, "rate_limit_error", { details: { error_code: "enforced_spend_limit_reached" } }),
      "provider_credit",
      "stan rozliczeń",
      refusedWith(429, "rate_limit_error"),
    ],
    [
      "500 api_error",
      () => providerError(500, "api_error"),
      "provider_unavailable",
      "chwilowo niedostępny",
      refusedWith(500, "api_error"),
    ],
    [
      "529 overloaded_error",
      () => providerError(529, "overloaded_error"),
      "provider_unavailable",
      "chwilowo niedostępny",
      refusedWith(529, "overloaded_error"),
    ],
    [
      "504 timeout_error",
      () => providerError(504, "timeout_error"),
      "provider_unavailable",
      "chwilowo niedostępny",
      refusedWith(504, "timeout_error"),
    ],
    [
      "402 billing_error",
      () => providerError(402, "billing_error"),
      "provider_credit",
      "stan rozliczeń",
      refusedWith(402, "billing_error"),
    ],
    [
      "400 saying the team's own usage limit is reached",
      () => providerError(400, "invalid_request_error", { message: usageLimit }),
      "provider_credit",
      "stan rozliczeń",
      refusedWith(400, "invalid_request_error"),
    ],
    [
      "400 saying the credit balance is too low",
      () => providerError(400, "invalid_request_error", { message: lowBalance }),
      "provider_credit",
      "stan rozliczeń",
      refusedWith(400, "invalid_request_error"),
    ],
    [
      "400 about anything else",
      () => providerError(400, "invalid_request_error", { message: rejected }),
      "provider_rejected",
      "odrzucił zapytanie audytu",
      // The one failure whose entry says what the provider said: nothing else names the fault.
      { ...refusedWith(400, "invalid_request_error"), provider_error_message: rejected },
    ],
    [
      "400 saying the key is not scoped to a workspace",
      () => providerError(400, "invalid_request_error", { message: unscopedKey }),
      "provider_auth",
      "odrzucił klucz API",
      refusedWith(400, "invalid_request_error"),
    ],
    [
      "401 authentication_error",
      () => providerError(401, "authentication_error"),
      "provider_auth",
      "odrzucił klucz API",
      refusedWith(401, "authentication_error"),
    ],
    [
      "403 permission_error",
      () => providerError(403, "permission_error"),
      "provider_auth",
      "odrzucił klucz API",
      refusedWith(403, "permission_error"),
    ],
    [
      "a status without a branch of its own (404)",
      () => providerError(404, "not_found_error"),
      "provider_rejected",
      "odrzucił zapytanie audytu",
      refusedWith(404, "not_found_error"),
    ],
    [
      "another status without a branch of its own (413)",
      () => providerError(413, "request_too_large"),
      "provider_rejected",
      "odrzucił zapytanie audytu",
      refusedWith(413, "request_too_large"),
    ],
    [
      // The same error as the 529 above, arriving after the stream began: the same reason.
      "overloaded_error inside the stream, after 200",
      () => providerStream(begun(streamErrorEvent("overloaded_error"))),
      "provider_unavailable",
      "chwilowo niedostępny",
      { ...BEGUN, provider_error_type: "overloaded_error", error_name: "APIError", duration_ms: 0 },
    ],
    [
      // The same error as the 429 above, arriving after the stream began: the same reason.
      "rate_limit_error inside the stream, after 200",
      () => providerStream(begun(streamErrorEvent("rate_limit_error"))),
      "provider_rate_limited",
      "ogranicza teraz liczbę zapytań",
      { ...BEGUN, provider_error_type: "rate_limit_error", error_name: "APIError", duration_ms: 0 },
    ],
    [
      "an error of a type nobody has seen inside the stream",
      () => providerStream(begun(streamErrorEvent("kanarek_error"))),
      "provider_rejected",
      "odrzucił zapytanie audytu",
      { ...BEGUN, provider_error_type: "kanarek_error", error_name: "APIError", duration_ms: 0 },
    ],
    [
      "a connection that could not be made",
      () => Promise.reject(new TypeError(`fetch failed ${PROVIDER_MESSAGE_CANARY}`)),
      "provider_network",
      "Nie udało się połączyć z dostawcą modelu",
      { error_name: "APIConnectionError", stream_events: 0, duration_ms: 0 },
    ],
    [
      "a stream that closes before it says how the answer ended",
      () => providerStream(begun()),
      "provider_network",
      "Nie udało się połączyć z dostawcą modelu",
      { ...BEGUN, error_name: "StreamEndedEarly", duration_ms: 0 },
    ],
    [
      "a stream whose connection breaks while it is read",
      () => {
        const broken = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.error(new TypeError(`terminated ${PROVIDER_MESSAGE_CANARY}`));
          },
        });
        return new Response(broken, {
          status: 200,
          headers: { "Content-Type": "text/event-stream", "request-id": "req_test_kanarek_0001" },
        });
      },
      "provider_network",
      "Nie udało się połączyć z dostawcą modelu",
      { provider_request_id: "req_test_kanarek_0001", error_name: "TypeError", stream_events: 0, duration_ms: 0 },
    ],
    [
      "a refusal",
      () => providerAnswer({ text: "", stopReason: "refusal" }),
      "provider_refused",
      "Model odmówił",
      { ...CALLED, stop_reason: "refusal", duration_ms: 0 },
    ],
    [
      "an answer cut off at the token ceiling",
      () => providerAnswer({ text: '{"missing":[{"attribute":"flo', stopReason: "max_tokens", outputTokens: 16000 }),
      "provider_truncated",
      "została ucięta",
      { ...CALLED, stop_reason: "max_tokens", output_tokens: 16000, duration_ms: 0 },
    ],
    [
      "an answer cut off by the context window",
      () => providerAnswer({ text: '{"missing":[', stopReason: "model_context_window_exceeded" }),
      "provider_truncated",
      "została ucięta",
      { ...CALLED, stop_reason: "model_context_window_exceeded", duration_ms: 0 },
    ],
    [
      "an answer that stops to call a tool nobody offered",
      () => providerAnswer({ text: "", stopReason: "tool_use" }),
      "provider_malformed",
      "w nieoczekiwanym kształcie",
      { ...CALLED, stop_reason: "tool_use", duration_ms: 0 },
    ],
    [
      "a finished answer that is not JSON",
      () => providerAnswer({ text: `Oto audyt: ${AUDIT_TITLE}` }),
      "provider_malformed",
      "w nieoczekiwanym kształcie",
      { ...CALLED, error_name: "UnparseableAnswer", duration_ms: 0 },
    ],
    [
      "a finished answer with a list missing",
      () => providerAnswer({ text: JSON.stringify({ missing: [], conditions: [], costs: [] }) }),
      "provider_malformed",
      "w nieoczekiwanym kształcie",
      { ...CALLED, error_name: "UnexpectedShape", duration_ms: 0 },
    ],
    [
      "a finished answer whose excerpt is a number",
      () => providerAnswer({ text: JSON.stringify({ ...ANSWER, costs: [{ label: "Koszt", excerpt: 650 }] }) }),
      "provider_malformed",
      "w nieoczekiwanym kształcie",
      { ...CALLED, error_name: "UnexpectedShape", duration_ms: 0 },
    ],
  ];

  it.each(FAILURES)(
    "%s: 1 provider call, no retry, the attempt failed with its reason",
    async (_case, provider, reason, fragment, fields) => {
      const { lines, text, stub, captured } = await audit({ provider });

      const told = failure(lines);
      expect(told.reason).toBe(reason);
      expect(told.message).toContain(fragment);
      // Paid for at most once: the request went out, and was not sent again.
      expect(providerCalls(stub.requests)).toHaveLength(1);
      // Nothing is stored as a result — the previous one, if the offer has one, is not written over.
      expect(writes(stub, "completed")).toHaveLength(0);
      const marks = writes(stub, "failed");
      expect(marks).toHaveLength(1);
      expectOwnAttemptOnly(marks[0]);
      expect(body(marks[0])).toEqual({ run_state: "failed", run_failure: reason });
      expect(lines.some((line) => line.stage === "saving")).toBe(false);
      expect(captured.entries()).toStrictEqual([
        STARTED,
        entry("error", { outcome: "failed", stage: "provider", reason, ...KNOWN, ...fields }),
      ]);
      // What the provider wrote stays in the provider's module: not in the log, not in the answer.
      expect(captured.text()).not.toContain(PROVIDER_MESSAGE_CANARY);
      expect(captured.text()).not.toContain("usage limits");
      expect(text).not.toContain(PROVIDER_MESSAGE_CANARY);
    },
  );

  // The user's decision of 2026-10-09: a rejected request's entry carries what the provider said
  // was wrong with it — cut short, for the log alone, and never when it repeats the listing.
  it("keeps the first 300 characters of what the provider said about a rejected request, in the log alone", async () => {
    const long = `messages.0.content: ${"y".repeat(400)}`;
    const { lines, text, captured } = await audit({
      provider: () => providerError(400, "invalid_request_error", { message: long }),
    });

    expect(failure(lines).reason).toBe("provider_rejected");
    expect(captured.entries().at(-1)?.args[0]).toMatchObject({
      reason: "provider_rejected",
      provider_error_message: `messages.0.content: ${"y".repeat(280)}`,
    });
    // The member reads the application's sentence, never the provider's.
    expect(text).not.toContain("messages.0.content");
  });

  it.each([
    ["a line of the description", `messages.0.content: could not read "${AUDIT_DESCRIPTION.split("\n")[0]}"`],
    ["the title in capitals", `messages.0.content: ${AUDIT_TITLE.toUpperCase()}`],
    ["a member's requirement", `messages.0.content: ${ANNA_REQUIREMENTS}`],
    ["twelve characters of the description", `x:${AUDIT_DESCRIPTION.slice(9, 21)}y`],
    // Shorter than twelve characters, and nowhere in this listing: a run of digits is dropped for what it is.
    ["a phone number", "messages.0.content: 600 700 800 is not valid"],
    ["a phone number written with hyphens", "messages.0.content: 600-700-800"],
  ])("drops the provider's message whole when it quotes %s", async (_what, message) => {
    const { lines, captured } = await audit({
      provider: () => providerError(400, "invalid_request_error", { message }),
    });

    expect(failure(lines).reason).toBe("provider_rejected");
    expect(captured.entries()).toStrictEqual([
      STARTED,
      entry("error", {
        outcome: "failed",
        stage: "provider",
        reason: "provider_rejected",
        ...KNOWN,
        ...refusedWith(400, "invalid_request_error"),
      }),
    ]);
    expect(captured.text()).not.toContain("messages.0.content");
  });

  // Beside them: the numbers a provider does write about a request are short, and the message stays.
  it("keeps a message that names a limit in figures", async () => {
    const message = "max_tokens: 16000 > 8192, which is the maximum allowed";
    const { captured } = await audit({
      provider: () => providerError(400, "invalid_request_error", { message }),
    });

    expect(captured.entries().at(-1)?.args[0]).toMatchObject({ provider_error_message: message });
  });

  // Beside them: eleven characters shared with the listing are not a quotation, and the message stays.
  it("keeps a message that shares fewer than twelve characters in a row with the listing", async () => {
    const message = `x:${AUDIT_DESCRIPTION.slice(9, 20)}y`;
    const { captured } = await audit({
      provider: () => providerError(400, "invalid_request_error", { message }),
    });

    expect(captured.entries().at(-1)?.args[0]).toMatchObject({ provider_error_message: message });
  });

  it("gives up a provider that never answers after 165 seconds: 1 provider call, no retry, provider_timeout", async () => {
    const captured = captureConsole();
    const stub = stubNetwork({ provider: providerSilence });
    const { response } = await post();
    const reading = response.text();

    // One second short of the deadline the call is still open, and nothing has been decided.
    await providerCalled(stub);
    await vi.advanceTimersByTimeAsync(164_000);
    expect(providerCalls(stub.requests)).toHaveLength(1);
    expect(writes(stub, "failed")).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1_000);
    const lines = parseLines(await reading);

    const told = failure(lines);
    expect(told.reason).toBe("provider_timeout");
    expect(told.message).toContain("165 sekund");
    expect(providerCalls(stub.requests)).toHaveLength(1);
    expect(writes(stub, "completed")).toHaveLength(0);
    expect(body(writes(stub, "failed")[0])).toEqual({ run_state: "failed", run_failure: "provider_timeout" });
    expect(lines.filter((line) => line.type === "alive")).toHaveLength(32);
    expect(captured.entries()).toStrictEqual([
      STARTED,
      entry("error", {
        outcome: "failed",
        stage: "provider",
        reason: "provider_timeout",
        ...KNOWN,
        error_name: "DeadlineExceeded",
        stream_events: 0,
        duration_ms: 165_000,
      }),
    ]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("gives up a stream that goes quiet after 165 seconds: 1 provider call, no retry, provider_timeout", async () => {
    const captured = captureConsole();
    const stub = stubNetwork({ provider: ({ signal }) => providerStream(begun(), { stall: true, signal }) });
    const { response } = await post();
    const reading = response.text();

    await providerCalled(stub);
    await vi.advanceTimersByTimeAsync(165_000);
    const lines = parseLines(await reading);

    expect(failure(lines).reason).toBe("provider_timeout");
    expect(providerCalls(stub.requests)).toHaveLength(1);
    expect(writes(stub, "completed")).toHaveLength(0);
    expect(body(writes(stub, "failed")[0])).toEqual({ run_state: "failed", run_failure: "provider_timeout" });
    expect(captured.entries().at(-1)).toStrictEqual(
      entry("error", {
        outcome: "failed",
        stage: "provider",
        reason: "provider_timeout",
        ...KNOWN,
        ...BEGUN,
        error_name: "DeadlineExceeded",
        duration_ms: 165_000,
      }),
    );
  });

  it("says so in the entry when the failed attempt could not be marked", async () => {
    const { lines, stub, captured } = await audit({
      provider: () => providerError(500, "api_error"),
      fail: dbError(500, "XX000", "internal error"),
    });

    // The member is told why the model call failed; the row stays `running` until it reads as interrupted.
    expect(failure(lines).reason).toBe("provider_unavailable");
    expect(providerCalls(stub.requests)).toHaveLength(1);
    expect(writes(stub, "failed")).toHaveLength(1);
    expect(captured.entries().at(-1)).toStrictEqual(
      entry("error", {
        outcome: "failed",
        stage: "provider",
        reason: "provider_unavailable",
        ...KNOWN,
        ...refusedWith(500, "api_error"),
        detail: "attempt_not_marked",
        db_code: "XX000",
        db_message: "internal error",
        db_status: 500,
      }),
    );
  });
});

describe("POST /api/audits: a paid result that cannot be stored is an explicit failure (#3)", () => {
  const failedWrite = dbError(500, "XX000", "internal error");
  const noAnswer: Answer = () => Promise.reject(new TypeError("fetch failed"));
  const saved = rows({ offer_id: OFFER_ID });

  it.each<[string, Answer]>([
    ["the database fails the first write", failedWrite],
    ["the first write gets no answer", noAnswer],
  ])("writes the result a second time when %s, and is done: 1 provider call", async (_case, first) => {
    const { lines, stub, captured } = await audit({ provider: answered, complete: [first, saved] });

    expect(lines.at(-1)).toStrictEqual({ type: "done" });
    expect(providerCalls(stub.requests)).toHaveLength(1);
    const saves = writes(stub, "completed");
    expect(saves).toHaveLength(2);
    // The same write, twice: the same row under the same claim.
    expect(saves[1]?.url).toBe(saves[0]?.url);
    expect(saves[1]?.body).toBe(saves[0]?.body);
    expect(writes(stub, "failed")).toHaveLength(0);
    expect(captured.entries()).toStrictEqual([STARTED, COMPLETED]);
  });

  it("reports save_failed when the write fails twice: 1 provider call, the second write was tried", async () => {
    const { lines, stub, captured } = await audit({ provider: answered, complete: [failedWrite, failedWrite] });

    const { reason, message } = failure(lines);
    expect(reason).toBe("save_failed");
    // The member has to know before retrying: the model has been paid for once already.
    expect(message).toContain("nowe, płatne zapytanie");
    expect(providerCalls(stub.requests)).toHaveLength(1);
    expect(writes(stub, "completed")).toHaveLength(2);
    // The attempt does not stay `running`: it is marked failed with the reason the card will show.
    const marks = writes(stub, "failed");
    expect(marks).toHaveLength(1);
    expectOwnAttemptOnly(marks[0]);
    expect(body(marks[0])).toEqual({ run_state: "failed", run_failure: "save_failed" });
    expect(captured.entries()).toStrictEqual([
      STARTED,
      entry("error", {
        outcome: "failed",
        stage: "save",
        reason: "save_failed",
        ...KNOWN,
        ...CALLED,
        findings_count: 3,
        rejected_count: 0,
        dropped_count: 1,
        db_code: "XX000",
        db_message: "internal error",
        db_status: 500,
        duration_ms: 0,
      }),
    ]);
    expect(captured.text()).not.toContain("KANAREK-DETAILS");
  });

  it("reports save_failed when the write gets no answer twice: 1 provider call", async () => {
    const { lines, stub, captured } = await audit({ provider: answered, complete: [noAnswer, noAnswer] });

    expect(failure(lines).reason).toBe("save_failed");
    expect(providerCalls(stub.requests)).toHaveLength(1);
    expect(writes(stub, "completed")).toHaveLength(2);
    expect(captured.entries().at(-1)?.args[0]).toMatchObject({
      outcome: "failed",
      reason: "save_failed",
      db_message: "TypeError: fetch failed",
      db_status: 0,
    });
  });

  it("reports claim_lost when the write reached no row: 1 provider call, not written again, nothing marked", async () => {
    const { lines, stub, captured } = await audit({ provider: answered, complete: [rows()] });

    const { reason, message } = failure(lines);
    expect(reason).toBe("claim_lost");
    expect(message).toContain("przejęła inna próba");
    expect(providerCalls(stub.requests)).toHaveLength(1);
    // A write that reached no row is not a failed write: it is not retried.
    expect(writes(stub, "completed")).toHaveLength(1);
    // The row is another attempt's now: this request writes nothing more to it.
    expect(writes(stub, "failed")).toHaveLength(0);
    expect(captured.entries()).toStrictEqual([
      STARTED,
      entry("error", {
        outcome: "failed",
        stage: "save",
        reason: "claim_lost",
        ...KNOWN,
        ...CALLED,
        findings_count: 3,
        rejected_count: 0,
        dropped_count: 1,
        duration_ms: 0,
      }),
    ]);
  });

  // The first write was stored and only its answer was lost: the second then reaches no row, because
  // the row is no longer `running`. That is this attempt's own result, not another attempt's row.
  it("is done when the retried write reached no row because the first was stored: 1 provider call", async () => {
    const { lines, stub, captured } = await audit({
      provider: answered,
      complete: [noAnswer, rows()],
      stored: rows({ run_state: "completed", run_started_at: STARTED_AT }),
    });

    expect(lines.at(-1)).toStrictEqual({ type: "done" });
    expect(providerCalls(stub.requests)).toHaveLength(1);
    expect(writes(stub, "completed")).toHaveLength(2);
    expect(requestsTo(stub, "offer_audits", "GET")).toHaveLength(1);
    expect(writes(stub, "failed")).toHaveLength(0);
    expect(captured.entries()).toStrictEqual([STARTED, COMPLETED]);
  });

  it.each<[string, Answer]>([
    ["another attempt runs on the row", rows({ run_state: "running", run_started_at: "2026-10-09T12:05:00+00:00" })],
    [
      "another attempt completed on the row",
      rows({ run_state: "completed", run_started_at: "2026-10-09T12:05:00+00:00" }),
    ],
    ["this attempt was failed on the row", rows({ run_state: "failed", run_started_at: STARTED_AT })],
    ["the row is gone", rows()],
    ["the row cannot be read", failedWrite],
  ])("reports claim_lost after a retried write reached no row and %s", async (_case, stored) => {
    const { lines, stub } = await audit({ provider: answered, complete: [noAnswer, rows()], stored });

    expect(failure(lines).reason).toBe("claim_lost");
    expect(providerCalls(stub.requests)).toHaveLength(1);
    expect(writes(stub, "failed")).toHaveLength(0);
  });

  it("control: a write that reached the row is done, with one write", async () => {
    const { lines, stub } = await audit({ provider: answered, complete: [saved] });

    expect(lines.at(-1)).toStrictEqual({ type: "done" });
    expect(writes(stub, "completed")).toHaveLength(1);
  });
});

describe("POST /api/audits: the audit outlives the member's connection (#3)", () => {
  it("hands the audit to the platform's waitUntil as a promise that settles when the audit has ended", async () => {
    captureConsole();
    const stub = stubNetwork({ provider: answered });
    const waitUntil = vi.fn<(work: Promise<unknown>) => void>();

    const { response } = await post({ locals: { cfContext: { waitUntil } } });

    expect(waitUntil).toHaveBeenCalledTimes(1);
    const work = waitUntil.mock.calls[0]?.[0];
    expect(work).toBeInstanceOf(Promise);
    // Nobody reads the answer: the promise alone carries the audit to its stored result.
    await work;
    expect(writes(stub, "completed")).toHaveLength(1);
    await response.body?.cancel();
  });

  it("finishes and stores the audit when the member closes the card while the model works: 1 provider call", async () => {
    const captured = captureConsole();
    let answer: (response: Response) => void = () => undefined;
    const stub = stubNetwork({
      provider: () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        }),
    });
    const waitUntil = vi.fn<(work: Promise<unknown>) => void>();
    const { response } = await post({ locals: { cfContext: { waitUntil } } });

    // The browser goes away after the first line; a sign of life then finds nobody listening.
    const reader = response.body?.getReader();
    await reader?.read();
    await reader?.cancel();
    await providerCalled(stub);
    await vi.advanceTimersByTimeAsync(6_000);
    answer(providerAnswer({ text: JSON.stringify(ANSWER) }));
    await waitUntil.mock.calls[0]?.[0];

    expect(providerCalls(stub.requests)).toHaveLength(1);
    expect(writes(stub, "completed")).toHaveLength(1);
    expect(writes(stub, "failed")).toHaveLength(0);
    expect(captured.entries()).toStrictEqual([
      STARTED,
      entry("info", {
        outcome: "completed",
        stage: "save",
        ...KNOWN,
        ...CALLED,
        findings_count: 3,
        rejected_count: 0,
        dropped_count: 1,
        duration_ms: 6_000,
      }),
    ]);
    expect(vi.getTimerCount()).toBe(0);
  });
});

// A cookie set once the response is on its way never reaches the browser, and the Supabase client
// writes one whenever it refreshes the session. Astro warns about such a write and has a path on
// which it throws; a write that throws fails the database call that triggered the refresh — at
// the end of an audit, the write of a paid result. The route therefore stops passing cookie
// writes on once it has handed its response over, and these tests play the strict Astro.
describe("POST /api/audits: a session refreshed during the audit does not cost the result (#3)", () => {
  /** `cookies.set` at its strictest: it takes a write until the response has left, and throws after. */
  function cookiesUntilResponse() {
    const state = { left: false, early: 0, late: 0 };
    const set = vi.fn(() => {
      if (state.left) {
        state.late += 1;
        throw new Error("KANAREK-RESPONSE-SENT cookies cannot be set after the response was sent");
      }
      state.early += 1;
    });
    return { state, set };
  }

  it("refreshes an expired session before the response leaves, while its cookie can still be set", async () => {
    const captured = captureConsole();
    const stub = stubNetwork({ provider: answered, refresh: refreshedSessionResponse });
    const cookies = cookiesUntilResponse();

    const { response } = await post({ cookie: sessionCookie({ expired: true }), cookiesSet: cookies.set });
    cookies.state.left = true;
    const lines = parseLines(await response.text());

    expect(lines.at(-1)).toStrictEqual({ type: "done" });
    expect(stub.requests.filter((request) => isAuthRequest(request, "token"))).toHaveLength(1);
    expect(cookies.state.early).toBeGreaterThan(0);
    expect(cookies.state.late).toBe(0);
    expect(providerCalls(stub.requests)).toHaveLength(1);
    expect(writes(stub, "completed")).toHaveLength(1);
    // Neither the session's tokens nor the refreshed ones are in an entry.
    for (const token of [
      SESSION_ACCESS_TOKEN,
      SESSION_REFRESH_TOKEN,
      REFRESHED_ACCESS_TOKEN,
      REFRESHED_REFRESH_TOKEN,
    ]) {
      expect(captured.text()).not.toContain(token);
    }
  });

  it("stores the result when the session is refreshed after the response left: 1 provider call, no cookie write", async () => {
    const captured = captureConsole();
    let answer: (response: Response) => void = () => undefined;
    const stub = stubNetwork({
      provider: () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        }),
      refresh: refreshedSessionResponse,
    });
    const cookies = cookiesUntilResponse();

    // 100 seconds from expiry: fresh enough for the reads and the claim. The client refreshes a
    // token within 90 seconds of its expiry, so 20 seconds later the save triggers a refresh.
    const { response } = await post({ cookie: sessionCookie({ expiresIn: 100 }), cookiesSet: cookies.set });
    cookies.state.left = true;
    const reading = response.text();
    await providerCalled(stub);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(stub.requests.filter((request) => isAuthRequest(request, "token"))).toHaveLength(0);
    answer(providerAnswer({ text: JSON.stringify(ANSWER) }));
    const lines = parseLines(await reading);

    expect(lines.at(-1)).toStrictEqual({ type: "done" });
    expect(stub.requests.filter((request) => isAuthRequest(request, "token"))).toHaveLength(1);
    expect(cookies.state.late).toBe(0);
    expect(providerCalls(stub.requests)).toHaveLength(1);
    expect(writes(stub, "completed")).toHaveLength(1);
    expect(captured.text()).not.toContain("KANAREK-RESPONSE-SENT");
  });
});

// One assertion over every way out of the route: whatever a later change adds to an entry, the
// console must not carry the listing's words, the criteria, what the model wrote, what the
// provider wrote or the member's address (prd.md, Non-Functional Requirements; CLAUDE.md,
// Conventions). Each scenario names the stage its last entry reports, so one that stopped
// reaching its exit — and therefore logs nothing worth searching — fails instead of passing empty.
describe("POST /api/audits: no log entry carries the listing, the criteria, the model's words or a member's address (#6)", () => {
  const FORBIDDEN = [
    ...FORBIDDEN_IN_AUDIT.filter((canary) => canary !== OFFER_ID),
    USER_EMAIL,
    AUDIT_TITLE,
    // The listing's words, a line at a time: an entry is one line of text.
    ...AUDIT_DESCRIPTION.split("\n").filter((line) => line !== ""),
    "Praga-Południe",
    "lokatorem",
    TYPED_NAME,
    TYPED_PHONE,
    // The team's criteria.
    ANNA_REQUIREMENTS,
    BARTEK_REQUIREMENTS,
    "Warszawa",
    "650000",
    // What the model wrote: labels, excerpts, questions.
    "Prowizja biura",
    "miejsce postojowe",
    "Na którym piętrze",
    // The instruction.
    "zakreślaczem",
    "<ogloszenie>",
    // What the provider wrote, and what Postgres quotes.
    PROVIDER_MESSAGE_CANARY,
    "KANAREK-DETAILS",
    "sk-ant-test",
  ];

  const SCENARIOS: [string, string, Network, Posted?][] = [
    ["auth", "a signed-out visitor", {}, { user: null }],
    ["offer_id", "an id that is not a uuid", {}, { fields: { offer_id: "Praga-Południe" } }],
    ["offer", "an offer that is not there", { offer: rows() }],
    ["offer", "a failed offer read", { offer: dbError(500, "XX000", "internal error") }],
    ["criteria", "a failed criteria read", { limits: dbError(500, "XX000", "internal error") }],
    ["settings", "a failed settings read", { settings: dbError(500, "XX000", "internal error") }],
    [
      "claim",
      "a refused claim",
      { claim: dbError(403, "42501", "an audit can only be started by a signed-in member") },
    ],
    ["provider", "a provider error whose message is the canary", { provider: () => providerError(500, "api_error") }],
    [
      "provider",
      "a rejected request whose message quotes the listing",
      {
        provider: () =>
          providerError(400, "invalid_request_error", { message: `messages.0.content: ${AUDIT_DESCRIPTION}` }),
      },
    ],
    [
      "provider",
      "an answer that is the listing's title instead of JSON",
      { provider: () => providerAnswer({ text: AUDIT_TITLE }) },
    ],
    ["save", "a stored audit", { provider: answered }],
    [
      "save",
      "a result the database refused twice",
      { provider: answered, complete: [dbError(400, "23514", "check"), dbError(400, "23514", "check")] },
    ],
  ];

  it.each(SCENARIOS)("at the %s stage: %s", async (stage, _label, network, posted = {}) => {
    const captured = captureConsole();
    stubNetwork(network);
    const { response } = await post(posted);
    await response.text();

    const last = captured.entries().at(-1);
    expect(last?.args).toHaveLength(1);
    expect(last?.args[0]).toMatchObject({ event: "offer_audit", stage });

    const text = captured.text();
    for (const forbidden of FORBIDDEN) {
      expect(text).not.toContain(forbidden);
    }
  });
});
