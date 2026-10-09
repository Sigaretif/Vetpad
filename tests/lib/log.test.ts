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

  it("writes the fields of a fetch-stage entry and keeps a false marker and a zero body length", () => {
    const captured = captureConsole();
    logEvent("error", {
      event: "offer_add",
      outcome: "failed",
      stage: "fetch",
      reason: "challenged",
      status: 403,
      error_name: "TypeError",
      landed_host: "www.otodom.pl",
      landed_path: "/pl/oferta/<slug>/galeria",
      landed_listing: "ID4canary",
      content_type: "text/html",
      body_length: 0,
      marker_present: false,
      cf_mitigated: "challenge",
      retry_after: "120",
      error_message: "fetch failed for <url>",
      error_cause: "ECONNRESET",
      phase: "body",
    });

    // An empty body and a page without the marker are what the fetch found: values, not absences.
    expect(captured.entries()).toStrictEqual([
      {
        method: "error",
        args: [
          {
            level: "error",
            event: "offer_add",
            outcome: "failed",
            stage: "fetch",
            reason: "challenged",
            status: 403,
            error_name: "TypeError",
            landed_host: "www.otodom.pl",
            landed_path: "/pl/oferta/<slug>/galeria",
            landed_listing: "ID4canary",
            content_type: "text/html",
            body_length: 0,
            marker_present: false,
            cf_mitigated: "challenge",
            retry_after: "120",
            error_message: "fetch failed for <url>",
            error_cause: "ECONNRESET",
            phase: "body",
          },
        ],
      },
    ]);
  });

  it("writes the fields of an audit's entry and keeps its zero counts", () => {
    const captured = captureConsole();
    logEvent("info", {
      event: "offer_audit",
      outcome: "completed",
      stage: "save",
      user_id: USER_ID,
      offer_id: "0b9f0c2e-7d1a-4c55-9a53-0000000a0d17",
      model: "claude-opus-5-5",
      effort: "medium",
      provider_request_id: "req_test_kanarek_0001",
      stop_reason: "end_turn",
      input_tokens: 1850,
      output_tokens: 420,
      duration_ms: 0,
      findings_count: 0,
      rejected_count: 0,
      dropped_count: 0,
      criteria_revision: 0,
      listing_chars: 388,
      stream_events: 12,
    });

    // An audit that found nothing, rejected nothing and ran under revision 0 says so: a zero is
    // a count, not an absence.
    expect(captured.entries()).toStrictEqual([
      {
        method: "info",
        args: [
          {
            level: "info",
            event: "offer_audit",
            outcome: "completed",
            stage: "save",
            user_id: USER_ID,
            offer_id: "0b9f0c2e-7d1a-4c55-9a53-0000000a0d17",
            model: "claude-opus-5-5",
            effort: "medium",
            provider_request_id: "req_test_kanarek_0001",
            stop_reason: "end_turn",
            input_tokens: 1850,
            output_tokens: 420,
            duration_ms: 0,
            findings_count: 0,
            rejected_count: 0,
            dropped_count: 0,
            criteria_revision: 0,
            listing_chars: 388,
            stream_events: 12,
          },
        ],
      },
    ]);
  });

  it("writes the provider's name for its error on a failed audit's entry", () => {
    const captured = captureConsole();
    logEvent("error", {
      event: "offer_audit",
      outcome: "failed",
      stage: "provider",
      reason: "provider_unavailable",
      status: 529,
      provider_error_type: "overloaded_error",
      provider_request_id: "req_test_kanarek_0001",
    });
    // What the provider said about a request it rejected has a key of its own (the user's
    // decision of 2026-10-09); like every text, it is cut to 300 characters.
    logEvent("error", {
      event: "offer_audit",
      outcome: "failed",
      stage: "provider",
      reason: "provider_rejected",
      status: 400,
      provider_error_type: "invalid_request_error",
      provider_error_message: `output_config.format.schema: ${"x".repeat(300)}`,
    });

    expect(captured.entries()).toStrictEqual([
      {
        method: "error",
        args: [
          {
            level: "error",
            event: "offer_audit",
            outcome: "failed",
            stage: "provider",
            reason: "provider_unavailable",
            status: 529,
            provider_error_type: "overloaded_error",
            provider_request_id: "req_test_kanarek_0001",
          },
        ],
      },
      {
        method: "error",
        args: [
          {
            level: "error",
            event: "offer_audit",
            outcome: "failed",
            stage: "provider",
            reason: "provider_rejected",
            status: 400,
            provider_error_type: "invalid_request_error",
            // 29 characters of the field's path and 271 of the rest: 300 in all.
            provider_error_message: `output_config.format.schema: ${"x".repeat(271)}`,
          },
        ],
      },
    ]);
  });

  // What an audit works on never has a key of its own on the list: an entry cannot carry it,
  // whatever a call site passes.
  // The provider's message has one key, `provider_error_message`, which the provider's module
  // fills for a rejected request alone; under any other name it does not get in.
  it("leaves out an audit's prompt, listing, excerpts, requirements and a provider's message under another key", () => {
    const captured = captureConsole();
    logEvent(
      "error",
      untyped({
        event: "offer_audit",
        prompt: "Jesteś zakreślaczem…",
        system: "Jesteś zakreślaczem…",
        listing_text: "Sprzedam mieszkanie 3-pokojowe",
        description: "Sprzedam mieszkanie 3-pokojowe",
        excerpt: "Mieszkanie z lokatorem",
        findings: "[]",
        requirements: "Balkon albo loggia.",
        provider_message: "prompt is too long",
        error_text: "prompt is too long",
        api_key: "sk-ant-kanarek",
      }),
    );

    expect(captured.entries()).toStrictEqual([{ method: "error", args: [{ level: "error", event: "offer_audit" }] }]);
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
