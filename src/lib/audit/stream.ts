// The browser's side of `POST /api/audits`: telling what kind of answer came back, and reading
// the NDJSON body line by line while the audit runs. Pure functions, so the audit island
// (`src/components/offers/AuditRunner.tsx`) holds no parsing of its own and these rules are
// tested without a browser (tests/lib/audit/stream.test.ts).
//
// The island ships this module to the browser: the route enters through `import type` only, and
// the one runtime import is `@/lib/audit/failure`, which has none.

import { isAuditFailureReason } from "@/lib/audit/failure";
import type { AuditStage, AuditStreamLine } from "@/pages/api/audits";

/** The stages the route reports, in the order an audit goes through them. */
export const AUDIT_STAGES: readonly AuditStage[] = ["reading", "model", "saving"];

function isAuditStage(value: unknown): value is AuditStage {
  return (AUDIT_STAGES as readonly unknown[]).includes(value);
}

/** What `fetch` reports about an answer, as far as this module needs it. */
export interface AuditAnswer {
  redirected: boolean;
  status: number;
  /** The `Content-Type` header, or `null` when the answer has none. */
  contentType: string | null;
}

/**
 * What an answer of the audit route is:
 *
 * - `signed_out` — the request was redirected. The route redirects in one case only, a request
 *   without a session, so this is the one answer that sends the member to sign in.
 * - `stream` — `200` with an NDJSON body: the audit's progress, to be followed line by line.
 * - `unreadable` — anything else: the 503 page the middleware serves while Auth is down, a 500
 *   page, a proxy's error. It says nothing about the session and nothing about whether an audit
 *   started, so it is never read as either. An Auth outage is not a sign-out (CLAUDE.md, Structure).
 */
export function classifyAuditAnswer({
  redirected,
  status,
  contentType,
}: AuditAnswer): "signed_out" | "stream" | "unreadable" {
  if (redirected) return "signed_out";
  const type = (contentType ?? "").split(";")[0].trim().toLowerCase();
  return status === 200 && type === "application/x-ndjson" ? "stream" : "unreadable";
}

/**
 * One line of the body as the route types it, or `null` for a line that is not one: empty, not
 * JSON, of a type this version does not know, a stage off the list, or a failure without a known
 * reason and a sentence. A line that does not read is skipped, never guessed at — and a body
 * whose last line was skipped ends, for the reader, without a final line.
 */
export function readAuditStreamLine(text: string): AuditStreamLine | null {
  if (text.trim() === "") return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const line = value as Record<string, unknown>;
  switch (line.type) {
    case "alive":
      return { type: "alive" };
    case "done":
      return { type: "done" };
    case "stage":
      return isAuditStage(line.stage) ? { type: "stage", stage: line.stage } : null;
    case "failed": {
      const { reason, message } = line;
      if (!isAuditFailureReason(reason) || typeof message !== "string" || message.trim() === "") return null;
      return { type: "failed", reason, message };
    }
    default:
      return null;
  }
}

/** The line that ends an audit's stream: how the audit ended. */
export type AuditFinalLine = Extract<AuditStreamLine, { type: "done" | "failed" }>;

/**
 * Reads the body to its final line and answers it, calling `onStage` for every stage on the way.
 * Lines arrive cut anywhere — in the middle of a line, in the middle of a character — so the
 * text is put together across chunks before it is split.
 *
 * `null` is a body that gave no final line: there was none, it ended early, or reading it failed
 * (the connection dropped, or the caller aborted the request). That answer says nothing about
 * how the audit ended — the route may still be running and may still store a paid result — so
 * the caller must not treat it as a failure to retry. Never throws.
 */
export async function followAuditStream(
  body: ReadableStream<Uint8Array> | null,
  onStage: (stage: AuditStage) => void,
): Promise<AuditFinalLine | null> {
  if (body === null) return null;
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      pending += done ? decoder.decode() : decoder.decode(value, { stream: true });
      const parts = pending.split("\n");
      // Whatever follows the last line break is a line still arriving — unless the body is over.
      pending = done ? "" : (parts.pop() ?? "");
      for (const part of parts) {
        const line = readAuditStreamLine(part);
        if (line === null) continue;
        if (line.type === "stage") onStage(line.stage);
        if (line.type === "done" || line.type === "failed") return line;
      }
      if (done) return null;
    }
  } catch {
    return null;
  } finally {
    // The rest of the body is of no interest; on a body that already failed this rejects, and that is fine.
    void reader.cancel().catch(() => undefined);
  }
}
