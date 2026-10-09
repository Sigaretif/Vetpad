import { useEffect, useId, useRef, useState } from "react";
import { Loader2, RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ServerError } from "@/components/form/ServerError";
import { AUDIT_BROWSER_LIMIT_MS, auditFailureMessage } from "@/lib/audit/failure";
import { classifyAuditAnswer, followAuditStream } from "@/lib/audit/stream";
import { formatClock, formatElapsed } from "@/lib/format";
import type { AuditStage } from "@/pages/api/audits";

/** A state the island opens in, for `/dev/offer-card` only: nothing is sent and no clock runs. */
export type AuditRunnerPreview =
  { kind: "progress"; stage: AuditStage; elapsedSeconds: number } | { kind: "unreadable"; status: number };

interface Props {
  offerId: string;
  /** Whether the offer has a stored result: the button then offers a re-run. */
  hasResult: boolean;
  /** Whether the application holds a model-provider key. Without one the button is disabled and says why. */
  available: boolean;
  /**
   * An attempt that was running when the card was read: who started it, as a name to put after
   * „przez" (`null` when nobody can be named), and when. The button stays disabled — the database
   * would turn a second attempt away — and the member is offered a refresh.
   */
  running?: { by: string | null; at: string } | null;
  /** Why the offer's latest attempt failed, as the card read it from the database. */
  failure?: string | null;
  /** The id of the card's audit section, which the card is reloaded at. */
  anchorId?: string;
  preview?: AuditRunnerPreview;
}

type Phase =
  | { kind: "idle" }
  | { kind: "progress"; stage: AuditStage | null }
  /** `live`: the reason came from this run's stream, not from the database on load. */
  | { kind: "failed"; message: string; live: boolean }
  | { kind: "unreadable"; message: string }
  | { kind: "reloading"; message: string };

const STAGE_TEXT: Record<AuditStage, string> = {
  reading: "Etap 1 z 3: odczyt oferty i kryteriów zespołu",
  model: "Etap 2 z 3: model analizuje ogłoszenie",
  saving: "Etap 3 z 3: sprawdzanie cytatów i zapis wyniku",
};

const SENDING = "Wysyłanie żądania…";
const DONE = "Audyt zakończony — wczytuję wynik…";
const CUT_OFF = "Połączenie z audytem zostało przerwane — wczytuję jego aktualny stan z serwera…";
const NO_ANSWER =
  "Nie udało się połączyć z aplikacją. Nie wiadomo, czy audyt się rozpoczął — odśwież kartę, aby zobaczyć jego stan.";

function unreadableMessage(status: number): string {
  return `Aplikacja nie odpowiedziała przebiegiem audytu (kod odpowiedzi ${status}). Nie wiadomo, czy audyt się rozpoczął — odśwież kartę, aby zobaczyć jego stan.`;
}

/**
 * Loads the card again, landing on its audit section. `reload()` keeps the address as it is, so
 * the fragment is set first; the card was read with a GET, and so is the reload — nothing is sent twice.
 */
function reloadAt(anchorId: string): void {
  if (window.location.hash !== `#${anchorId}`) window.location.hash = anchorId;
  window.location.reload();
}

function openingPhase(failure: string | null | undefined, preview: AuditRunnerPreview | undefined): Phase {
  if (preview?.kind === "progress") return { kind: "progress", stage: preview.stage };
  if (preview?.kind === "unreadable") return { kind: "unreadable", message: unreadableMessage(preview.status) };
  return failure ? { kind: "failed", message: failure, live: false } : { kind: "idle" };
}

interface Run {
  controller: AbortController;
  limit: ReturnType<typeof setTimeout>;
  tick: ReturnType<typeof setInterval>;
  /** Set when the browser's own limit ended the run, to tell that abort from the island being removed. */
  timedOut: boolean;
}

function stopTimers(run: Run): void {
  clearTimeout(run.limit);
  clearInterval(run.tick);
}

/**
 * Starts an AI audit of the offer (FR-010) and shows that it is running: `POST /api/audits` with
 * `fetch`, the answer's NDJSON body read line by line for the stage, a clock that counts the
 * seconds, and a request not to close the tab.
 *
 * How a run ends decides what the member is offered:
 *
 * - `done` — the card is reloaded at its audit section, where the server shows the result.
 * - `failed` — the route's own sentence, and the button again: the route said the attempt is over.
 * - The body ended without either, reading it failed, or `AUDIT_BROWSER_LIMIT_MS` passed — no
 *   retry. The request may be alive on the server and may still store a result that was paid
 *   for, so the card is reloaded and the database says what happened: a result, an attempt in
 *   progress, or an interrupted one with the button.
 * - A redirected answer — the member has no session: the browser goes to sign-in. Nothing else
 *   leads there.
 * - Any other answer (the 503 page of an Auth outage, a 500 page) or none at all — a message and
 *   a link that refreshes the card. An outage is never treated as a sign-out, and never as a
 *   failed audit to retry.
 *
 * Ids come from `useId()` because the kitchen sink renders several runners on one page.
 */
export default function AuditRunner({
  offerId,
  hasResult,
  available,
  running = null,
  failure = null,
  anchorId = "audyt",
  preview,
}: Props) {
  const [phase, setPhase] = useState<Phase>(() => openingPhase(failure, preview));
  const [elapsed, setElapsed] = useState(preview?.kind === "progress" ? preview.elapsedSeconds : 0);
  const run = useRef<Run | null>(null);
  const noteId = useId();

  // The island is going away (the member left the card): stop waiting. The audit goes on without
  // a reader — the route hands it to the platform — so nothing here tries to stop it.
  useEffect(
    () => () => {
      const current = run.current;
      if (current === null) return;
      run.current = null;
      stopTimers(current);
      current.controller.abort();
    },
    [],
  );

  async function start(): Promise<void> {
    if (run.current !== null) return;
    const startedAt = Date.now();
    const controller = new AbortController();
    const current: Run = {
      controller,
      timedOut: false,
      limit: setTimeout(() => {
        current.timedOut = true;
        controller.abort();
      }, AUDIT_BROWSER_LIMIT_MS),
      tick: setInterval(() => {
        setElapsed(Math.floor((Date.now() - startedAt) / 1000));
      }, 1000),
    };
    run.current = current;
    setElapsed(0);
    setPhase({ kind: "progress", stage: null });

    /** Whether this run was given up from outside — the island was removed — and must touch nothing more. */
    const abandoned = () => run.current !== current;
    /** Ends the run: its timers stop and the button may start another. The request is the caller's to abort. */
    const release = () => {
      stopTimers(current);
      run.current = null;
    };
    const reload = (message: string) => {
      release();
      setPhase({ kind: "reloading", message });
      reloadAt(anchorId);
    };

    const form = new FormData();
    form.set("offer_id", offerId);
    let response: Response;
    try {
      response = await fetch("/api/audits", { method: "POST", body: form, signal: controller.signal });
    } catch {
      if (abandoned()) return;
      // The limit passed with no answer at all: the server shows what became of the request.
      if (current.timedOut) {
        reload(CUT_OFF);
        return;
      }
      release();
      setPhase({ kind: "unreadable", message: NO_ANSWER });
      return;
    }
    if (abandoned()) return;

    const answer = classifyAuditAnswer({
      redirected: response.redirected,
      status: response.status,
      contentType: response.headers.get("content-type"),
    });
    if (answer !== "stream") {
      release();
      // Not a body to follow: let the connection go.
      controller.abort();
      if (answer === "signed_out") {
        window.location.assign("/auth/signin");
        return;
      }
      setPhase({ kind: "unreadable", message: unreadableMessage(response.status) });
      return;
    }

    const final = await followAuditStream(response.body, (stage) => {
      if (!abandoned()) setPhase({ kind: "progress", stage });
    });
    if (abandoned()) return;

    if (final?.type === "failed") {
      release();
      setPhase({ kind: "failed", message: final.message, live: true });
      return;
    }
    reload(final === null ? CUT_OFF : DONE);
  }

  const inProgress = phase.kind === "progress";
  const busy = running !== null;
  // No button where a retry must not be offered: after an answer that was not the audit's stream,
  // and while the card is on its way to being reloaded.
  const showButton = phase.kind !== "unreadable" && phase.kind !== "reloading";
  const showRefresh = phase.kind === "unreadable" || (phase.kind === "failed" && phase.live) || (busy && !inProgress);
  const explained = !inProgress && (busy || !available);

  return (
    <div data-audit-runner className="flex flex-col gap-3">
      {phase.kind === "failed" || phase.kind === "unreadable" ? <ServerError message={phase.message} /> : null}

      {inProgress ? (
        <div className="bg-muted flex flex-col gap-1 rounded-md px-3 py-2 text-sm">
          <p role="status" className="font-medium">
            {phase.stage === null ? SENDING : STAGE_TEXT[phase.stage]}
          </p>
          <p className="text-muted-foreground tabular-nums">
            Upłynęło: {formatElapsed(elapsed)}. Audyt trwa najwyżej {AUDIT_BROWSER_LIMIT_MS / 60_000} min.
          </p>
          <p>Nie zamykaj tej karty przeglądarki do końca audytu — po jej zamknięciu wynik może przepaść.</p>
        </div>
      ) : null}

      {phase.kind === "reloading" ? (
        <p role="status" className="flex items-center gap-2 text-sm">
          <Loader2 className="size-4 shrink-0 animate-spin" />
          {phase.message}
        </p>
      ) : null}

      {showButton ? (
        <Button
          type="button"
          variant={hasResult ? "outline" : "default"}
          className="w-full"
          disabled={inProgress || busy || !available}
          aria-describedby={explained ? noteId : undefined}
          onClick={() => {
            void start();
          }}
        >
          {inProgress ? (
            <span className="flex items-center gap-2">
              <Loader2 className="size-4 animate-spin" />
              Audyt trwa…
            </span>
          ) : (
            <span className="flex items-center gap-2">
              {hasResult ? <RefreshCw className="size-4" /> : <Sparkles className="size-4" />}
              {hasResult ? "Uruchom ponownie" : "Uruchom audyt AI"}
            </span>
          )}
        </Button>
      ) : null}

      {explained ? (
        <div id={noteId} className="text-muted-foreground flex flex-col gap-1 text-sm">
          {running !== null ? (
            <p className="wrap-anywhere">
              Audyt tej oferty jest w toku — uruchomiony {running.by === null ? null : <>przez {running.by} </>}o{" "}
              <time dateTime={running.at}>{formatClock(running.at)}</time>. Drugiego nie da się uruchomić, dopóki ten
              trwa.
            </p>
          ) : null}
          {available ? null : <p>{auditFailureMessage("unconfigured_provider")}</p>}
        </div>
      ) : null}

      {showRefresh ? (
        <Button
          type="button"
          variant="link"
          className="h-auto self-start p-0"
          onClick={() => {
            reloadAt(anchorId);
          }}
        >
          Odśwież kartę
        </Button>
      ) : null}
    </div>
  );
}
