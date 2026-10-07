import type { APIContext } from "astro";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/pages/api/audit-settings";
import { type ConsoleEntry, captureConsole, restoreConsole } from "../../fixtures/console";
import { type RecordedRequest, isTableRequest, jsonResponse, restoreFetch, stubFetch } from "../../fixtures/http";

// The route with a configured Supabase client (test values, never a real project's): this mock
// overrides the zero-config one in tests/setup.ts. Only the network is stubbed below —
// @/lib/supabase and @/lib/audit/settings run as they do in production.
vi.mock("astro:env/server", async () => {
  const { SUPABASE_TEST_KEY, SUPABASE_TEST_URL } = await import("../../fixtures/http");
  return { SUPABASE_URL: SUPABASE_TEST_URL, SUPABASE_KEY: SUPABASE_TEST_KEY, getSecret: () => undefined };
});

// Expected outcomes come from prd.md FR-010 and the route's contract in
// context/changes/grounded-listing-audit/plan.md (Phase 2: a value outside the list is refused
// before the save, an update that returns no rows is a failed save, success goes to
// `/criteria#audyt` and failure to `/criteria?error=…&form=audit#audyt`, no session goes to
// sign-in, one `audit_settings` log entry per way out), from the header of
// supabase/migrations/20261007073258_create_audit_settings.sql (who changed the settings is set
// by the trigger, not by the request), and from CLAUDE.md, Conventions (a form route reports
// failure with `?error=` and `&form=`; a log entry carries identifiers and codes, never an
// address or Postgres' `details`). The real policies never answer a signed-in member's update
// with no rows, so smoke cannot reach that exit.

afterEach(restoreFetch);
afterEach(restoreConsole);

const USER_ID = "4c1d7e2a-9b3f-4e8a-8d2c-00000000beef";
/** The member's address is on `locals.user` in production too; no log entry may carry it. */
const USER_EMAIL = "czlonek.kanarek@vetpad.local";

interface Member {
  id: string;
  email: string;
}
const MEMBER: Member = { id: USER_ID, email: USER_EMAIL };

/** A choice that is not the default in either field. */
const CHOSEN = { model: "claude-sonnet-5-5", effort: "high" };

/** Answers the route's one planned Supabase request, the settings `PATCH`, with `answer`. */
function stubSettingsUpdate(answer: () => Response) {
  return stubFetch((request) => (isTableRequest(request, "audit_settings", "PATCH") ? answer() : undefined));
}

async function post(request: Request, user: Member | null = MEMBER): Promise<Response> {
  const context = {
    request,
    locals: { user },
    cookies: { set: vi.fn() },
    redirect: (location: string, status = 302) => new Response(null, { status, headers: { Location: location } }),
  } as unknown as APIContext;
  return POST(context);
}

async function submit(fields: Record<string, string>, user: Member | null = MEMBER): Promise<Response> {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    form.set(name, value);
  }
  return post(new Request("http://localhost/api/audit-settings", { method: "POST", body: form }), user);
}

function location(response: Response): URL {
  expect(response.status).toBe(302);
  const header = response.headers.get("Location");
  if (header === null) throw new Error("expected a redirect with a Location header");
  return new URL(header, "http://localhost");
}

function settingsUpdates(requests: RecordedRequest[]): RecordedRequest[] {
  return requests.filter((request) => isTableRequest(request, "audit_settings", "PATCH"));
}

/** The failed-save redirect: back to the settings form on `/criteria`, naming the form. Returns the message. */
function settingsError(response: Response): string {
  const target = location(response);
  expect(target.pathname).toBe("/criteria");
  expect(target.searchParams.get("form")).toBe("audit");
  expect(target.hash).toBe("#audyt");
  const message = target.searchParams.get("error");
  if (message === null || message === "") throw new Error("expected the redirect to carry an error message");
  return message;
}

/** One log entry, written out by hand: `info` for a save or a refusal, `error` for a failure. */
function entry(level: "info" | "error", fields: Record<string, string | number>): ConsoleEntry {
  return { method: level, args: [{ level, event: "audit_settings", ...fields }] };
}

describe("POST /api/audit-settings: a value outside the list never reaches the database (FR-010)", () => {
  // Each fragment is the word that tells the two refusals apart; the other one's must be absent.
  const OUTSIDE: [string, Record<string, string>, string, string, string][] = [
    ["a model off the list", { model: "claude-haiku-4-5", effort: "medium" }, "unknown_model", "model", "rozumowania"],
    [
      "a listed model in capitals",
      { model: "CLAUDE-OPUS-5-5", effort: "medium" },
      "unknown_model",
      "model",
      "rozumowania",
    ],
    ["no model at all", { effort: "medium" }, "unknown_model", "model", "rozumowania"],
    ["the effort xhigh", { model: "claude-opus-5-5", effort: "xhigh" }, "unknown_effort", "rozumowania", "model"],
    ["the effort max", { model: "claude-opus-5-5", effort: "max" }, "unknown_effort", "rozumowania", "model"],
    ["no effort at all", { model: "claude-opus-5-5" }, "unknown_effort", "rozumowania", "model"],
  ];

  it.each(OUTSIDE)("refuses %s on the settings form, with no request", async (_case, fields, reason, own, other) => {
    const captured = captureConsole();
    const stub = stubFetch(() => undefined);

    const message = settingsError(await submit(fields));

    expect(message).toContain(own);
    expect(message).not.toContain(other);
    expect(stub.requests).toHaveLength(0);
    expect(captured.entries()).toStrictEqual([
      entry("info", { outcome: "refused", stage: "form", reason, user_id: USER_ID }),
    ]);
    // What the request carried stays out of the entry.
    for (const value of Object.values(fields)) {
      if (value !== "medium") expect(captured.text()).not.toContain(value);
    }
  });

  it("control: the same request with both values on the list does reach the database", async () => {
    const stub = stubSettingsUpdate(() => jsonResponse([{ id: true }], 200));

    await submit({ model: "claude-opus-5-5", effort: "medium" });

    expect(settingsUpdates(stub.requests)).toHaveLength(1);
  });

  it("refuses a body that is not a form, with no request", async () => {
    const captured = captureConsole();
    const stub = stubFetch(() => undefined);
    const request = new Request("http://localhost/api/audit-settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(CHOSEN),
    });

    const message = settingsError(await post(request));

    expect(message).toContain("formularza");
    expect(stub.requests).toHaveLength(0);
    expect(captured.entries()).toStrictEqual([
      entry("info", { outcome: "refused", stage: "body", reason: "unreadable_body", user_id: USER_ID }),
    ]);
  });
});

describe("POST /api/audit-settings: no session goes to sign-in (FR-001)", () => {
  it("redirects to /auth/signin before anything else, with no request", async () => {
    const captured = captureConsole();
    const stub = stubFetch(() => undefined);

    const target = location(await submit(CHOSEN, null));

    expect(target.pathname).toBe("/auth/signin");
    expect(target.search).toBe("");
    expect(stub.requests).toHaveLength(0);
    expect(captured.entries()).toStrictEqual([
      entry("info", { outcome: "refused", stage: "auth", reason: "signed_out" }),
    ]);
  });
});

describe("POST /api/audit-settings: a write that changed no row is a failed save", () => {
  it("reports an update answered 200 [] as failed, on the settings form", async () => {
    const captured = captureConsole();
    const stub = stubSettingsUpdate(() => jsonResponse([], 200));

    const message = settingsError(await submit(CHOSEN));

    expect(message).toContain("Nie udało się zapisać ustawień audytu");
    // The failure came from the database's answer — the write did go out, once.
    expect(settingsUpdates(stub.requests)).toHaveLength(1);
    expect(captured.entries()).toStrictEqual([
      entry("error", { outcome: "failed", stage: "update", reason: "no_rows", db_status: 200, user_id: USER_ID }),
    ]);
  });

  // A 200 the route cannot read as "one row changed" is not a save either.
  it.each<[string, () => Response]>([
    ["an empty object", () => jsonResponse({}, 200)],
    ["null", () => jsonResponse(null, 200)],
  ])("reports an update answered 200 with %s as failed, and does not throw", async (_case, answer) => {
    captureConsole();
    const stub = stubSettingsUpdate(answer);

    const message = settingsError(await submit(CHOSEN));

    expect(message).toContain("Nie udało się zapisać ustawień audytu");
    expect(settingsUpdates(stub.requests)).toHaveLength(1);
  });

  it("reports a write the database refused (42501) as a session problem, not a success", async () => {
    const captured = captureConsole();
    const stub = stubSettingsUpdate(() =>
      jsonResponse(
        {
          code: "42501",
          message: "audit settings can only be changed by a signed-in member",
          details: "KANAREK-DETAILS",
          hint: null,
        },
        403,
      ),
    );

    const message = settingsError(await submit(CHOSEN));

    expect(message).toContain("sesji");
    expect(message).toContain("zaloguj się ponownie");
    expect(settingsUpdates(stub.requests)).toHaveLength(1);
    expect(captured.entries()).toStrictEqual([
      entry("error", {
        outcome: "failed",
        stage: "update",
        reason: "no_session_in_database",
        db_code: "42501",
        db_message: "audit settings can only be changed by a signed-in member",
        db_status: 403,
        user_id: USER_ID,
      }),
    ]);
    // Postgres quotes the rejected row in `details`: it is never read.
    expect(captured.text()).not.toContain("KANAREK-DETAILS");
  });

  it("reports a value the table's check refused (23514) as rejected settings", async () => {
    const captured = captureConsole();
    const stub = stubSettingsUpdate(() =>
      jsonResponse(
        {
          code: "23514",
          message: 'new row for relation "audit_settings" violates check constraint "audit_settings_model_known"',
          details: "KANAREK-DETAILS",
          hint: null,
        },
        400,
      ),
    );

    const message = settingsError(await submit(CHOSEN));

    expect(message).toContain("odrzuciła");
    expect(settingsUpdates(stub.requests)).toHaveLength(1);
    expect(captured.entries()).toStrictEqual([
      entry("error", {
        outcome: "failed",
        stage: "update",
        reason: "check_violation",
        db_code: "23514",
        db_message: 'new row for relation "audit_settings" violates check constraint "audit_settings_model_known"',
        db_status: 400,
        user_id: USER_ID,
      }),
    ]);
    expect(captured.text()).not.toContain("KANAREK-DETAILS");
  });

  it("reports a write the database failed (500) as a failed save", async () => {
    const captured = captureConsole();
    const stub = stubSettingsUpdate(() =>
      jsonResponse({ code: "XX000", message: "internal error", details: null, hint: "try later" }, 500),
    );

    const message = settingsError(await submit(CHOSEN));

    expect(message).toContain("Nie udało się zapisać ustawień audytu");
    expect(settingsUpdates(stub.requests)).toHaveLength(1);
    expect(captured.entries()).toStrictEqual([
      entry("error", {
        outcome: "failed",
        stage: "update",
        reason: "update_failed",
        db_code: "XX000",
        db_message: "internal error",
        db_hint: "try later",
        db_status: 500,
        user_id: USER_ID,
      }),
    ]);
  });

  it("tells the failures apart by their messages", async () => {
    captureConsole();
    const answers = [
      () => jsonResponse([], 200),
      () => jsonResponse({ code: "42501", message: "refused", details: null, hint: null }, 403),
      () => jsonResponse({ code: "23514", message: "check", details: null, hint: null }, 400),
    ];
    const messages: string[] = [];
    for (const answer of answers) {
      stubSettingsUpdate(answer);
      messages.push(settingsError(await submit(CHOSEN)));
      restoreFetch();
    }

    expect(new Set(messages).size).toBe(3);
  });
});

describe("POST /api/audit-settings: a saved change sends the model and the effort and nothing else", () => {
  async function saved(): Promise<{
    response: Response;
    requests: RecordedRequest[];
    log: ConsoleEntry[];
    text: string;
  }> {
    const captured = captureConsole();
    const stub = stubSettingsUpdate(() => jsonResponse([{ id: true }], 200));
    const response = await submit(CHOSEN);
    return { response, requests: stub.requests, log: captured.entries(), text: captured.text() };
  }

  it("returns to the settings section without an error when one row changed", async () => {
    const { response } = await saved();
    const target = location(response);
    expect(target.pathname).toBe("/criteria");
    expect(target.search).toBe("");
    expect(target.hash).toBe("#audyt");
  });

  it("sends exactly one PATCH, to the singleton, asking for the changed rows back", async () => {
    const { requests } = await saved();
    expect(requests).toHaveLength(1);
    const updates = settingsUpdates(requests);
    expect(updates).toHaveLength(1);
    const params = new URL(updates[0]?.url ?? "").searchParams;
    expect(params.get("id")).toBe("eq.true");
    // Without `select`, PostgREST answers 204 with no body and a filtered write looks like a save.
    expect(params.get("select")).not.toBeNull();
  });

  it("sends the two settings as chosen — no id, no signature and no date", async () => {
    const body = settingsUpdates((await saved()).requests)[0]?.body;
    if (typeof body !== "string") throw new Error("expected the update to carry a JSON body");
    const row = JSON.parse(body) as Record<string, unknown>;

    // Written out by hand, not imported from the code under test.
    expect(Object.keys(row).sort()).toEqual(["effort", "model"]);
    expect(row).toEqual({ model: "claude-sonnet-5-5", effort: "high" });
    for (const forbidden of ["id", "updated_by", "updated_at"]) {
      expect(row).not.toHaveProperty(forbidden);
    }
    // The member's id travels in no column at all: the trigger signs the change.
    expect(body).not.toContain(USER_ID);
  });

  it("ignores a signature, a date and an id sent with the form", async () => {
    captureConsole();
    const stub = stubSettingsUpdate(() => jsonResponse([{ id: true }], 200));

    await submit({
      ...CHOSEN,
      id: "false",
      updated_by: "7a2b9c1d-3e4f-4a5b-8c6d-0000000000a1",
      updated_at: "2099-01-01T00:00:00Z",
    });

    const body = settingsUpdates(stub.requests)[0]?.body;
    if (typeof body !== "string") throw new Error("expected the update to carry a JSON body");
    expect(JSON.parse(body)).toEqual({ model: "claude-sonnet-5-5", effort: "high" });
  });

  it("logs the save as info, naming the member by id and never by address", async () => {
    const { log, text } = await saved();

    expect(log).toStrictEqual([entry("info", { outcome: "saved", stage: "update", user_id: USER_ID })]);
    expect(text).not.toContain(USER_EMAIL);
  });
});
