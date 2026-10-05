import { afterEach, describe, expect, it } from "vitest";
import { type LogFields, logEvent } from "@/lib/log";
import { captureConsole, restoreConsole } from "../fixtures/console";

// The reporter is the only way out to the console (eslint.config.js), so what it lets through
// is what a log can ever hold. Every expected entry is written out by hand and compared
// strictly: a key that is present with `undefined` is not the same as a key that is absent.

afterEach(restoreConsole);

const USER_ID = "4c1d7e2a-9b3f-4e8a-8d2c-00000000beef";

/** Fields the type refuses, the way a careless call site would pass them. */
function untyped(fields: Record<string, unknown>): LogFields {
  return fields as unknown as LogFields;
}

describe("logEvent", () => {
  it("writes an info event as one console.info call with one object", () => {
    const captured = captureConsole();
    logEvent("info", { event: "offer_add", outcome: "saved", user_id: USER_ID });

    expect(captured.entries()).toStrictEqual([
      { method: "info", args: [{ level: "info", event: "offer_add", outcome: "saved", user_id: USER_ID }] },
    ]);
  });

  it("writes an error event through console.error and keeps a zero status", () => {
    const captured = captureConsole();
    logEvent("error", { event: "offer_add", db_code: "42501", db_status: 0 });

    // Zero is what postgrest-js reports for a request that got no answer: a value, not an absence.
    expect(captured.entries()).toStrictEqual([
      { method: "error", args: [{ level: "error", event: "offer_add", db_code: "42501", db_status: 0 }] },
    ]);
  });

  it("writes the fields of an entry from outside a route and keeps a zero auth status", () => {
    const captured = captureConsole();
    logEvent("error", {
      event: "auth_check",
      outcome: "unavailable",
      route: "/offers/[id]",
      method: "GET",
      error_name: "AuthRetryableFetchError",
      auth_status: 0,
      auth_code: "over_request_rate_limit",
    });

    // Zero is what auth-js reports for a request that got no answer: a value, not an absence.
    expect(captured.entries()).toStrictEqual([
      {
        method: "error",
        args: [
          {
            level: "error",
            event: "auth_check",
            outcome: "unavailable",
            route: "/offers/[id]",
            method: "GET",
            error_name: "AuthRetryableFetchError",
            auth_status: 0,
            auth_code: "over_request_rate_limit",
          },
        ],
      },
    ]);
  });

  it("leaves out a field that is undefined, null or an empty text", () => {
    const captured = captureConsole();
    logEvent("info", untyped({ event: "offer_add", reason: undefined, detail: null, db_hint: "" }));

    expect(captured.entries()).toStrictEqual([{ method: "info", args: [{ level: "info", event: "offer_add" }] }]);
  });

  it("leaves out a key that is not on the list, whatever the caller passes", () => {
    const captured = captureConsole();
    logEvent(
      "error",
      untyped({ event: "offer_add", details: "Failing row contains (…)", email: "member@vetpad.local" }),
    );

    expect(captured.entries()).toStrictEqual([{ method: "error", args: [{ level: "error", event: "offer_add" }] }]);
  });

  it("leaves out an object or an array under a listed key", () => {
    const captured = captureConsole();
    logEvent("error", untyped({ event: "offer_add", detail: { title: "Mieszkanie" }, reason: ["shape_changed"] }));

    expect(captured.entries()).toStrictEqual([{ method: "error", args: [{ level: "error", event: "offer_add" }] }]);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])("leaves out a status of %s", (status) => {
    const captured = captureConsole();
    logEvent("error", { event: "offer_add", status });

    expect(captured.entries()).toStrictEqual([{ method: "error", args: [{ level: "error", event: "offer_add" }] }]);
  });

  it("keeps a boolean, false included", () => {
    const captured = captureConsole();
    logEvent("info", untyped({ event: "offer_add", detail: false }));

    expect(captured.entries()).toStrictEqual([
      { method: "info", args: [{ level: "info", event: "offer_add", detail: false }] },
    ]);
  });

  it("cuts a text longer than 300 characters down to its first 300", () => {
    const captured = captureConsole();
    logEvent("error", { event: "offer_add", db_message: `${"a".repeat(300)}TAIL`, db_hint: "b".repeat(300) });

    expect(captured.entries()).toStrictEqual([
      {
        method: "error",
        args: [{ level: "error", event: "offer_add", db_message: "a".repeat(300), db_hint: "b".repeat(300) }],
      },
    ]);
  });
});
