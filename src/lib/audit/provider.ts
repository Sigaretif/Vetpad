// The one module that talks to the model provider (FR-010): Anthropic, through its official SDK
// (`@anthropic-ai/sdk`). One function makes the call and turns every way it can end into a reason
// from `AuditFailureReason`. What it sends is the instruction and the message it was handed
// (`@/lib/audit/prompt`), the answer's schema, and the model and effort the team chose — nothing
// else, and never a member's note (CLAUDE.md, Secrets and data access).
//
// Server-only: the key is read from `astro:env/server`, so this module must never be imported by
// an island. Missing key is a supported state — the factory answers `null` and the audit is off.
//
// A call is paid for, so three things hold here and nowhere else:
// - No retries (`maxRetries: 0`). The SDK's default of two would buy the same audit again after
//   a timeout or a 5xx; running an audit again is a member's deliberate action.
// - One deadline, the caller's `signal`. Aborted, the call ends as `provider_timeout`.
// - The provider's words stay here. An error's message can quote the request — the listing — so
//   a result carries the reason, the status, the request id and the error's type, never its text.
//   One exception, the user's decision of 2026-10-09: a `400 invalid_request_error` that is not a
//   billing state says what is wrong with the request this application built, and nothing else
//   does. Its message is kept — cut short, and dropped whole if it repeats any run of the message
//   that carries the listing and the criteria (`rejectionMessage`).
//
// Read from the SDK's sources (0.132, `client.mjs`, `core/streaming.mjs`, `core/error.mjs`):
// - The client takes `fetch` from the global when it is constructed, and falls back to the
//   environment for whatever it is not given: `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`,
//   `ANTHROPIC_BASE_URL`. So the client is built per request, never at module scope, and is given
//   all three: the key from `astro:env/server`, no token, and the provider's own address.
// - `messages.create({ stream: true })` yields one parsed event per server-sent event — one
//   `JSON.parse` each, and nothing more. The answer is glued together here and parsed once, at
//   the end; `messages.stream()` would keep a snapshot of the message for every event on top of
//   that, which is CPU this route does not have (10 ms per request on Workers Free).
// - An aborted stream does not throw: the iteration simply ends. So the signal is read after the
//   loop, and a stream that ended without a `stop_reason` is never read as an answer.
// - An error the provider sends inside the stream, after `200`, is an `APIError` without a
//   status; its `type` is all that says what it was. Before the stream the same error has both.
// - `APIConnectionTimeoutError` extends `APIConnectionError`, which extends `APIError`: the
//   checks below go from the most specific class to the least.
// - The SDK's own log goes to the console, around `@/lib/log`, and on a stream it cannot parse it
//   prints the data it got. `logLevel: "off"` keeps it silent.

import Anthropic, {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
} from "@anthropic-ai/sdk";
import { jsonSchemaOutputFormat } from "@anthropic-ai/sdk/helpers/json-schema";
import { ANTHROPIC_API_KEY } from "astro:env/server";
import { AUDIT_PROVIDER_DEADLINE_MS, type AuditFailureReason } from "@/lib/audit/failure";
import { AUDIT_OUTPUT_SCHEMA, type AuditOutput, readAuditOutput } from "@/lib/audit/schema";
import { AUDIT_MAX_TOKENS, type AuditEffort, type AuditModel } from "@/lib/audit/settings";

/** Where the listing is sent, and the only place: never taken from the environment. */
const PROVIDER_URL = "https://api.anthropic.com";

/** The ways a model call can end without an answer. */
export type ProviderFailureReason = Extract<AuditFailureReason, `provider_${string}`>;

export interface AuditRunRequest {
  model: AuditModel;
  effort: AuditEffort;
  /** The instruction and the message, exactly as `buildAuditPrompt` made them. */
  system: string;
  user: string;
  /** The call's deadline. Aborting it abandons the call; it is not retried. */
  signal: AbortSignal;
}

/** What the provider billed, as far as the stream got to say it. */
export interface AuditUsage {
  inputTokens?: number;
  outputTokens?: number;
}

/** What a call says about itself whichever way it ended. None of it is the provider's or the listing's text. */
interface RunFacts {
  /** The provider's id of the request, for its console and its support. */
  requestId?: string;
  stopReason?: string;
  usage: AuditUsage;
  /** How many events the stream delivered — each one costs a `JSON.parse` of CPU. */
  streamEvents: number;
}

export type AuditRunResult =
  | (RunFacts & { ok: true; output: AuditOutput; stopReason: string })
  | (RunFacts & {
      ok: false;
      reason: ProviderFailureReason;
      /** The HTTP status of a refused request; absent for an error inside the stream and for a call that got no answer. */
      status?: number;
      /** The provider's own name for its error, e.g. `overloaded_error`. */
      errorType?: string;
      /** The class of what was thrown. */
      errorName?: string;
      /**
       * What the provider said was wrong with the request, for a `400 invalid_request_error` only,
       * and only when it repeats nothing of the listing or the criteria. For the log, never the member.
       */
      errorMessage?: string;
    });

export interface AuditProvider {
  runAudit: (request: AuditRunRequest) => Promise<AuditRunResult>;
}

/**
 * The provider for one request, or `null` when the application has no key — the zero-config
 * state, in which the audit is switched off and nothing is sent anywhere. The check stands before
 * the SDK's constructor on purpose: left without `apiKey`, the constructor looks for one in the
 * environment by itself.
 */
export function createAuditProvider(): AuditProvider | null {
  if (!ANTHROPIC_API_KEY) return null;
  const client = new Anthropic({
    apiKey: ANTHROPIC_API_KEY,
    authToken: null,
    baseURL: PROVIDER_URL,
    maxRetries: 0,
    // The wait for the first byte; the caller's signal bounds the whole call.
    timeout: AUDIT_PROVIDER_DEADLINE_MS,
    logLevel: "off",
  });
  return { runAudit: (request) => runAudit(client, request) };
}

/** A reached monthly cap of the provider's tier: a `429` that no waiting clears (provider-selection.md). */
const SPEND_LIMIT_REACHED = "enforced_spend_limit_reached";

/**
 * A `400` that is a billing state, not a bad request: a spend limit the team set itself („You have
 * reached your specified [workspace] API usage limits…") or an exhausted balance („Your credit
 * balance is too low…"). The provider gives these no status or type of their own, so the message
 * is the only thing that tells them from a request it could not read. It is matched and dropped.
 */
const BILLING_MESSAGE = /API usage limits|credit balance is too low/i;

/**
 * A `400` that is the key, not the request: a key that belongs to no workspace („This API key is
 * not scoped to a workspace, so this request must include the anthropic-workspace-id header…").
 * Seen on the first real audit, 2026-10-09. The application sends no such header — the fix is a
 * key created inside a workspace — so it reads as a refused key, like a `401`.
 */
const UNSCOPED_KEY_MESSAGE = /not scoped to a workspace/i;

/**
 * The status each of the provider's error types arrives with before the stream. An error inside
 * the stream has the type alone, and is sorted as the same error would have been before it.
 */
const STATUS_OF_ERROR_TYPE = new Map<string, number>([
  ["invalid_request_error", 400],
  ["authentication_error", 401],
  ["billing_error", 402],
  ["permission_error", 403],
  ["not_found_error", 404],
  ["request_too_large", 413],
  ["rate_limit_error", 429],
  ["api_error", 500],
  ["timeout_error", 504],
  ["overloaded_error", 529],
]);

function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>)[key] : undefined;
}

/** The provider's error object, `{ type, message, details? }`, from an error body `{ type: "error", error }`. */
function errorObject(body: unknown): unknown {
  return field(body, "error");
}

/** One reason for every status: a status without a branch of its own is a request the provider turned down. */
function reasonForStatus(status: number | undefined, body: unknown): ProviderFailureReason {
  if (status === 401 || status === 403) return "provider_auth";
  if (status === 402) return "provider_credit";
  if (status === 400) {
    const message = field(errorObject(body), "message");
    if (typeof message !== "string") return "provider_rejected";
    if (BILLING_MESSAGE.test(message)) return "provider_credit";
    return UNSCOPED_KEY_MESSAGE.test(message) ? "provider_auth" : "provider_rejected";
  }
  if (status === 429) {
    const code = field(field(errorObject(body), "details"), "error_code");
    return code === SPEND_LIMIT_REACHED ? "provider_credit" : "provider_rate_limited";
  }
  if (status !== undefined && status >= 500) return "provider_unavailable";
  return "provider_rejected";
}

/** How much of the provider's message is kept. */
const REJECTION_MESSAGE_LENGTH = 300;

/** A run of this many characters shared with the listing's message is the listing, quoted. */
const QUOTED_RUN = 12;

/**
 * What the provider said was wrong with a request it could not read, or `undefined` when that
 * cannot be kept. The provider describes a rejected request by its fields — but it is free to
 * quote one, and the message field holds the listing and the team's criteria. So the text is cut
 * to its first 300 characters and compared with `sent`, the message that carried them: if any 12
 * characters in a row stand in both, case aside, the whole text is dropped rather than trimmed.
 */
function rejectionMessage(body: unknown, sent: string): string | undefined {
  const message = field(errorObject(body), "message");
  if (typeof message !== "string") return undefined;
  const text = message.slice(0, REJECTION_MESSAGE_LENGTH).trim();
  if (text === "") return undefined;
  const said = text.toLowerCase();
  const listing = sent.toLowerCase();
  if (said.length < QUOTED_RUN) return listing.includes(said) ? undefined : text;
  for (let at = 0; at + QUOTED_RUN <= said.length; at += 1) {
    if (listing.includes(said.slice(at, at + QUOTED_RUN))) return undefined;
  }
  return text;
}

type Failure = Omit<Extract<AuditRunResult, { ok: false }>, keyof RunFacts | "ok">;

/**
 * Why a call that threw ended, from the most specific cause to the least. The error's message is
 * read for two things: telling a billing `400` from any other, and — for that other `400` alone —
 * saying what the provider found wrong with the request (`rejectionMessage`). `sent` is the
 * message that carried the listing, which the kept text must not repeat.
 */
function classify(error: unknown, signal: AbortSignal, sent: string): Failure {
  const thrown = error instanceof Error ? error.name : "NonError";
  // The deadline passed: whatever the SDK made of the aborted request, the cause is ours.
  if (signal.aborted) return { reason: "provider_timeout", errorName: "DeadlineExceeded" };
  if (error instanceof APIUserAbortError) return { reason: "provider_network", errorName: "APIUserAbortError" };
  if (error instanceof APIConnectionTimeoutError) {
    return { reason: "provider_timeout", errorName: "APIConnectionTimeoutError" };
  }
  if (error instanceof APIConnectionError) return { reason: "provider_network", errorName: "APIConnectionError" };
  if (error instanceof APIError) {
    const errorType = typeof error.type === "string" ? error.type : undefined;
    const status = typeof error.status === "number" ? error.status : undefined;
    const equivalent = status ?? (errorType === undefined ? undefined : STATUS_OF_ERROR_TYPE.get(errorType));
    const reason = reasonForStatus(equivalent, error.error);
    // Before the stream, with the status and the type both there: the request itself was turned down.
    const errorMessage =
      status === 400 && errorType === "invalid_request_error" && reason === "provider_rejected"
        ? rejectionMessage(error.error, sent)
        : undefined;
    return {
      reason,
      status,
      errorType,
      errorName: "APIError",
      ...(errorMessage === undefined ? {} : { errorMessage }),
    };
  }
  // Not the provider's answer at all: a connection cut while the stream was being read.
  return { reason: "provider_network", errorName: thrown };
}

/** A stop reason that is a whole answer; any other means the text is not one. */
const COMPLETE = "end_turn";

function reasonForStop(stopReason: string): ProviderFailureReason {
  if (stopReason === "refusal") return "provider_refused";
  // Cut short by the answer's own limit or by the model's context window: not a whole answer either way.
  if (stopReason === "max_tokens" || stopReason === "model_context_window_exceeded") return "provider_truncated";
  return "provider_malformed";
}

/**
 * One model call for one audit: streamed, never retried, abandoned when `signal` aborts.
 *
 * `stop_reason` is read before the answer: a refusal or a cut-off answer is not valid JSON of the
 * schema's shape, and is reported as what it is rather than as a malformed answer. Only an answer
 * the model finished is parsed — once — and read through `readAuditOutput`, so `output` always
 * has the shape `groundFindings` walks.
 *
 * Never throws. Every result carries the facts for a log entry: the provider's request id, the
 * tokens billed as far as the stream reported them, and the number of stream events.
 */
async function runAudit(client: Anthropic, request: AuditRunRequest): Promise<AuditRunResult> {
  const { model, effort, system, user, signal } = request;
  const facts: RunFacts = { usage: {}, streamEvents: 0 };
  const parts: string[] = [];
  try {
    const {
      data: stream,
      response,
      request_id: requestId,
    } = await client.messages
      .create(
        {
          model,
          max_tokens: AUDIT_MAX_TOKENS,
          system,
          messages: [{ role: "user", content: user }],
          // `transform: false`: by default the helper rewrites the schema and moves what it does
          // not know — `enum` among it — into a description. The schema is sent as written.
          output_config: { effort, format: jsonSchemaOutputFormat(AUDIT_OUTPUT_SCHEMA, { transform: false }) },
          stream: true,
        },
        { signal },
      )
      .withResponse();
    facts.requestId = requestId ?? response.headers.get("request-id") ?? undefined;

    for await (const event of stream) {
      facts.streamEvents += 1;
      if (event.type === "content_block_delta") {
        // Reasoning arrives as its own kind of delta and is not part of the answer.
        if (event.delta.type === "text_delta") parts.push(event.delta.text);
      } else if (event.type === "message_start") {
        facts.usage.inputTokens = event.message.usage.input_tokens;
      } else if (event.type === "message_delta") {
        facts.stopReason = event.delta.stop_reason ?? undefined;
        facts.usage.outputTokens = event.usage.output_tokens;
        // Sent only when the count changed since `message_start`; the wire may leave the key out.
        if (typeof event.usage.input_tokens === "number") facts.usage.inputTokens = event.usage.input_tokens;
      }
    }
  } catch (error) {
    const failure = classify(error, signal, user);
    const requestId = error instanceof APIError ? (error.requestID ?? undefined) : undefined;
    return { ...facts, requestId: requestId ?? facts.requestId, ok: false, ...failure };
  }

  // An aborted stream ends without throwing: the deadline is read here.
  if (signal.aborted) return { ...facts, ok: false, reason: "provider_timeout", errorName: "DeadlineExceeded" };
  const { stopReason } = facts;
  // The stream closed before the provider said how the answer ended: the connection, not the model.
  if (stopReason === undefined)
    return { ...facts, ok: false, reason: "provider_network", errorName: "StreamEndedEarly" };
  if (stopReason !== COMPLETE) return { ...facts, ok: false, reason: reasonForStop(stopReason) };

  let parsed: unknown;
  try {
    parsed = JSON.parse(parts.join(""));
  } catch {
    // Not JSON at all. The text is the model's answer and may quote the listing: it is not kept.
    return { ...facts, ok: false, reason: "provider_malformed", errorName: "UnparseableAnswer" };
  }
  const output = readAuditOutput(parsed);
  if (output === null) return { ...facts, ok: false, reason: "provider_malformed", errorName: "UnexpectedShape" };
  return { ...facts, ok: true, output, stopReason };
}
