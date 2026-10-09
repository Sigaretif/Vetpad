import type { FetchContext, RecordedRequest } from "./http";

// The model provider, as the audit talks to it — and the only way a test may meet it. Nothing
// here was recorded from the live API, no test holds a real key, and every request goes to the
// `fetch` stub of tests/fixtures/http.ts: a paid call cannot be made from `npm test`.
//
// The request, as the official SDK sends it (`@anthropic-ai/sdk` 0.132, read from
// node_modules/@anthropic-ai/sdk/client.mjs, resources/messages/messages.mjs,
// core/streaming.mjs and core/error.mjs):
//
// - `client.messages.create({ …, stream: true }, { signal })` is one
//   `POST https://api.anthropic.com/v1/messages`. The body is a string, `JSON.stringify` of the
//   parameters as passed — `model`, `max_tokens`, `system`, `messages`, `output_config`,
//   `stream: true`. A function among them (the `parse` of `jsonSchemaOutputFormat`) is dropped
//   by the serialisation, so `output_config.format` on the wire is `{ type, schema }`.
// - Headers: `X-Api-Key` with the key the client was built with, `anthropic-version: 2023-06-01`,
//   `Content-Type` and `Accept: application/json`, and the SDK's `X-Stainless-*` set, among them
//   `X-Stainless-Retry-Count`. The stub does not record headers.
// - The client keeps the `fetch` that was the global when it was constructed. A client built
//   before `stubFetch` would go around the stub, which is one reason the audit builds its client
//   per request. The `signal` it passes to `fetch` is one of its own, aborted when the caller's
//   signal aborts or when its `timeout` passes before the headers arrive.
// - Retries: with the default `maxRetries` of 2 the client sends the same request again after a
//   rejected `fetch`, a timeout, and a `408`, `409`, `429` or `5xx` — waiting between tries on a
//   timer. The audit sets `maxRetries: 0`; each such answer is then final, and a test that counts
//   one request to the provider is the proof.
//
// The answers:
//
// - A stream: `200`, `Content-Type: text/event-stream`, the provider's id of the request in the
//   `request-id` header. Each server-sent event is `event: <name>`, `data: <JSON>` and an empty
//   line. The SDK parses the data of the events it knows and hands each to the caller:
//   `message_start` (with `usage.input_tokens`), then per content block `content_block_start`,
//   `content_block_delta`… and `content_block_stop`, then `message_delta` (with `stop_reason`
//   and `usage.output_tokens`) and `message_stop`. `ping` events are skipped without a parse.
//   On a model that reasons, a `thinking` block comes before the `text` block: its deltas are
//   `thinking_delta` (empty text unless a summary was asked for) and one `signature_delta`.
// - An `error` event inside a stream — the request was accepted, then failed — makes the
//   iteration throw an `APIError` that has no `status`: its `type` is all that says what it was.
// - A refused request: the status with a JSON body `{ "type": "error", "error": { "type",
//   "message" }, "request_id" }`. The SDK throws the class for the status (`BadRequestError`,
//   `RateLimitError`, `InternalServerError` for every `5xx`, a plain `APIError` for a status
//   without a class such as `402` or `413`), carrying `status`, `type` and `requestID`.
// - No answer: a rejected `fetch` becomes `APIConnectionError`; one aborted by the caller's
//   signal becomes `APIUserAbortError`. A stream whose body is cut by an abort does not throw at
//   all — the iteration just ends.

/** A test value only — shaped like a key, and worth nothing. */
export const ANTHROPIC_TEST_KEY = "sk-ant-test-kanarek-0000";

const PROVIDER_HOST = "api.anthropic.com";

/** The provider's id of the stubbed request, as its `request-id` header carries it. */
export const PROVIDER_REQUEST_ID = "req_test_kanarek_0001";

/** Sits in every error message the stubbed provider writes. No log entry and no answer to a member may carry it. */
export const PROVIDER_MESSAGE_CANARY = "kanarek-komunikat-dostawcy-5b1e";

/** True for the one request an audit may send: `POST https://api.anthropic.com/v1/messages`. */
export function isProviderRequest(request: RecordedRequest): boolean {
  const url = new URL(request.url);
  return url.hostname === PROVIDER_HOST && url.pathname === "/v1/messages" && request.method === "POST";
}

/** Every request that reached the provider's host, whatever its path: each one is a call that may be billed. */
export function providerCalls(requests: RecordedRequest[]): RecordedRequest[] {
  return requests.filter((request) => new URL(request.url).hostname === PROVIDER_HOST);
}

/** One server-sent event: its name and the value its `data` line carries as JSON. */
export interface SseEvent {
  event: string;
  data: unknown;
}

export interface AnswerOptions {
  /** What the model wrote: the audit's JSON, or anything a test wants to see refused. */
  text: string;
  /** How the answer ended. `end_turn` is a whole answer. */
  stopReason?: string;
  inputTokens?: number;
  outputTokens?: number;
  /**
   * How many events the SDK hands to its caller — pings are not among them. At least 9: the
   * eight events that frame a reasoning block and a text block, and one text delta. Events
   * beyond that are split between text deltas and (empty) reasoning deltas, the way a real
   * answer is mostly made of them. Left out, the stream has 12.
   */
  events?: number;
}

/** The events that are there however long the answer is: see `events` above. */
const FRAME_EVENTS = 8;

function delta(index: number, body: Record<string, unknown>): SseEvent {
  return { event: "content_block_delta", data: { type: "content_block_delta", index, delta: body } };
}

/** `text` cut into `count` pieces, in order; fewer characters than pieces leaves the last ones empty. */
function pieces(text: string, count: number): string[] {
  const size = Math.max(1, Math.ceil(text.length / count));
  return Array.from({ length: count }, (_, index) => text.slice(index * size, (index + 1) * size));
}

/**
 * The stream of one finished model call, event by event: a reasoning block the model's text is
 * not shown for, then a text block carrying `text` in pieces, then how it ended and what it cost.
 */
export function answerEvents({
  text,
  stopReason = "end_turn",
  inputTokens = 1850,
  outputTokens = 420,
  events = 12,
}: AnswerOptions): SseEvent[] {
  if (events <= FRAME_EVENTS) throw new Error(`a stream has at least ${FRAME_EVENTS + 1} events`);
  const deltas = events - FRAME_EVENTS;
  const textDeltas = Math.min(Math.max(1, Math.ceil(deltas / 2)), Math.max(1, text.length));
  const thinkingDeltas = deltas - textDeltas;
  return [
    {
      event: "message_start",
      data: {
        type: "message_start",
        message: {
          id: "msg_test_kanarek_0001",
          type: "message",
          role: "assistant",
          model: "claude-opus-5-5",
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: inputTokens, output_tokens: 1 },
        },
      },
    },
    // The SDK skips a ping: it is not one of the counted events.
    { event: "ping", data: { type: "ping" } },
    {
      event: "content_block_start",
      data: { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "", signature: "" } },
    },
    ...Array.from({ length: thinkingDeltas }, () => delta(0, { type: "thinking_delta", thinking: "" })),
    delta(0, { type: "signature_delta", signature: "c3lnbmF0dXJhLXRlc3Rvd2E=" }),
    { event: "content_block_stop", data: { type: "content_block_stop", index: 0 } },
    {
      event: "content_block_start",
      data: { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } },
    },
    ...pieces(text, textDeltas).map((piece) => delta(1, { type: "text_delta", text: piece })),
    { event: "content_block_stop", data: { type: "content_block_stop", index: 1 } },
    {
      event: "message_delta",
      data: {
        type: "message_delta",
        delta: { stop_reason: stopReason, stop_sequence: null },
        usage: { output_tokens: outputTokens },
      },
    },
    { event: "message_stop", data: { type: "message_stop" } },
  ];
}

/** An error the provider reports inside a stream it had already started. */
export function streamErrorEvent(type: string): SseEvent {
  return {
    event: "error",
    data: { type: "error", error: { type, message: `${PROVIDER_MESSAGE_CANARY}: ${type} in the stream` } },
  };
}

export interface StreamOptions extends FetchContext {
  /**
   * Leave the body open after the last event, as a connection that went quiet. It then ends only
   * when `signal` aborts — with the signal's reason, the way a real `fetch` ends an aborted body.
   */
  stall?: boolean;
}

/** A `200` whose body is `events` as server-sent events, one chunk each. */
export function providerStream(events: SseEvent[], { stall = false, signal }: StreamOptions = {}): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const { event, data } of events) {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      }
      if (!stall) {
        controller.close();
        return;
      }
      signal?.addEventListener(
        "abort",
        () => {
          controller.error(signal.reason);
        },
        { once: true },
      );
    },
  });
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream", "request-id": PROVIDER_REQUEST_ID },
  });
}

/** A whole answer as the provider streams it: `providerStream(answerEvents(…))`. */
export function providerAnswer(options: AnswerOptions): Response {
  return providerStream(answerEvents(options));
}

/**
 * A request the provider refused before any stream: `status` with the error body it sends.
 * `message` replaces the default text, which carries the canary; `details` goes into the error
 * object, where the provider puts a machine-readable code.
 */
export function providerError(
  status: number,
  type: string,
  { message, details }: { message?: string; details?: Record<string, unknown> } = {},
): Response {
  const error = {
    type,
    message: message ?? `${PROVIDER_MESSAGE_CANARY}: ${type}`,
    ...(details === undefined ? {} : { details }),
  };
  return new Response(JSON.stringify({ type: "error", error, request_id: PROVIDER_REQUEST_ID }), {
    status,
    headers: { "Content-Type": "application/json", "request-id": PROVIDER_REQUEST_ID },
  });
}

/**
 * A provider that never answers: the request stays open until the caller's signal aborts, and
 * is then rejected with the signal's reason, as a real `fetch` rejects an aborted request.
 */
export function providerSilence({ signal }: FetchContext): Promise<Response> {
  return new Promise((_resolve, reject) => {
    signal?.addEventListener(
      "abort",
      () => {
        reject(signal.reason as Error);
      },
      { once: true },
    );
  });
}
