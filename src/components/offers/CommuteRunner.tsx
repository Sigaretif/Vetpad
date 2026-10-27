import { Suspense, lazy, useEffect, useId, useRef, useState } from "react";
import { Loader2, MapPinned, RefreshCw, Route } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ServerError } from "@/components/form/ServerError";
import type { CommuteMapMode } from "@/components/offers/CommuteMap";
import { routeSwatchClass } from "@/lib/commute/colors";
import { type CommuteFailureReason, commuteFailureMessage } from "@/lib/commute/failure";
import type { CommuteCell } from "@/lib/commute/outcome";
import { COMMUTE_CUT_OFF, classifyCommuteAnswer, followCommuteStream } from "@/lib/commute/stream";
import { cn } from "@/lib/utils";
import type { CommuteResult } from "@/pages/api/commute";

// The map's code — the library and, through it, Google's script — is fetched only when a result
// is shown with a browser key: a card that is opened and never calculated loads none of it.
const CommuteMap = lazy(() => import("@/components/offers/CommuteMap"));

/**
 * A state the island opens in, for `/dev/offer-card` only: nothing is sent, and the map is never
 * mounted — a placeholder stands where it would be, so the kitchen sink never loads Google's script.
 */
export type CommutePreview =
  | { kind: "running" }
  | { kind: "failed"; reason: CommuteFailureReason }
  | { kind: "result"; result: CommuteResult; mode: CommuteMapMode }
  | { kind: "unreadable"; status: number };

interface Props {
  offerId: string;
  /** Whether the application holds the Routes key (`isCommuteAvailable`). Without it the button is disabled and says why. */
  available: boolean;
  /** The browser key for the map (`commuteMapKey`), or `null`: the table then shows without a map. */
  mapKey: string | null;
  /** The id of the card's commute section, which a refresh reloads the card at. */
  anchorId?: string;
  preview?: CommutePreview;
}

type Phase =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "failed"; message: string }
  /** No retry: the calculation may have reached Google. The member reloads the page. */
  | { kind: "unknown"; message: string };

const NO_ANSWER = "Nie udało się połączyć z aplikacją. Dojazdy nie zostały policzone — spróbuj ponownie za chwilę.";

function unreadableMessage(status: number): string {
  return `Aplikacja nie odpowiedziała przebiegiem liczenia (kod odpowiedzi ${status}). Nie wiadomo, czy dojazdy zostały policzone — odśwież stronę.`;
}

const MODE_LABEL: Record<CommuteMapMode, string> = { transit: "Komunikacja", drive: "Samochód" };

const ORIGIN_LABEL: Record<CommuteResult["origin"], string> = {
  coordinates: "Start: współrzędne z ogłoszenia",
  address: "Start: lokalizacja i ulica z ogłoszenia",
};

const WEEKDAY = new Intl.DateTimeFormat("pl-PL", { weekday: "long", timeZone: "UTC" });
const DATE = new Intl.DateTimeFormat("pl-PL", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const KILOMETRES = new Intl.NumberFormat("pl-PL", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** „odjazd: wtorek 28 października 2026, 8:00” from the route's `YYYY-MM-DD` (a Warsaw calendar date). */
function departureLabel(date: string): string {
  const day = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(day.getTime())) return "odjazd: 8:00";
  return `odjazd: ${WEEKDAY.format(day)} ${DATE.format(day)}, 8:00`;
}

/** „25 min”, „1 h 05 min” — whole minutes, rounded up from Google's seconds, never 0 for a route. */
function durationLabel(seconds: number): string {
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")} min`;
}

/** „850 m”, „3,4 km”. */
function distanceLabel(meters: number): string {
  return meters < 1000 ? `${Math.round(meters)} m` : `${KILOMETRES.format(meters / 1000)} km`;
}

function reloadAt(anchorId: string): void {
  if (window.location.hash !== `#${anchorId}`) window.location.hash = anchorId;
  window.location.reload();
}

function openingPhase(preview: CommutePreview | undefined): Phase {
  switch (preview?.kind) {
    case "running":
      return { kind: "running" };
    case "failed":
      return { kind: "failed", message: commuteFailureMessage(preview.reason) };
    case "unreadable":
      return { kind: "unknown", message: unreadableMessage(preview.status) };
    default:
      return { kind: "idle" };
  }
}

/** One cell of the table: time and distance, or why there are none. Text only. */
function Cell({ cell }: { cell: CommuteCell }) {
  if (cell.kind === "route") {
    return (
      <>
        <td className="px-2 py-2 text-right tabular-nums">{durationLabel(cell.durationSeconds)}</td>
        <td className="text-muted-foreground px-2 py-2 text-right tabular-nums">
          {distanceLabel(cell.distanceMeters)}
        </td>
      </>
    );
  }
  if (cell.kind === "no_route") {
    return (
      <td colSpan={2} className="text-muted-foreground px-2 py-2 text-right">
        brak trasy
      </td>
    );
  }
  return (
    <td colSpan={2} className="text-destructive px-2 py-2 text-right">
      Google odrzucił adres tego punktu — sprawdź go w{" "}
      <a href="/criteria#punkty" className="text-link underline-offset-4 hover:underline">
        kryteriach
      </a>
    </td>
  );
}

/**
 * Calculates the commute from the offer to each of the team's points (FR-016), on a member's
 * press: `POST /api/commute` with `fetch`, the NDJSON body read through `followCommuteStream`.
 *
 * - `done` — the table for the chosen mode (Komunikacja / Samochód), the departure day, the start
 *   the routes left from, Google's attribution and, with a browser key, one map. Nothing of it is
 *   stored: a reload shows the idle section again.
 * - `failed` — the route's own sentence, and the button again.
 * - A body without its last line, or an answer that is not the stream — a sentence and a refresh,
 *   no retry: whether the calculation reached Google is not known.
 * - A redirected answer — the member has no session: the browser goes to sign-in.
 *
 * The map is mounted once the first result is there and stays mounted for the island's life: a mode
 * switch or a later result reaches it as props, never as a new map. A result is kept while the
 * member calculates again, so the map is never unmounted and created anew; a new result replaces
 * it. Names render as text; no route description or steps are ever shown (EEA SST §20.1).
 */
export default function CommuteRunner({ offerId, available, mapKey, anchorId = "dojazdy", preview }: Props) {
  const [phase, setPhase] = useState<Phase>(() => openingPhase(preview));
  const [result, setResult] = useState<CommuteResult | null>(preview?.kind === "result" ? preview.result : null);
  const [mode, setMode] = useState<CommuteMapMode>(preview?.kind === "result" ? preview.mode : "transit");
  const run = useRef<AbortController | null>(null);
  const noteId = useId();
  const tableId = useId();

  useEffect(
    () => () => {
      run.current?.abort();
      run.current = null;
    },
    [],
  );

  async function start(): Promise<void> {
    if (run.current !== null || preview !== undefined) return;
    const controller = new AbortController();
    run.current = controller;
    setPhase({ kind: "running" });
    const abandoned = () => run.current !== controller;

    const form = new FormData();
    form.set("offer_id", offerId);
    let response: Response;
    try {
      response = await fetch("/api/commute", { method: "POST", body: form, signal: controller.signal });
    } catch {
      if (abandoned()) return;
      run.current = null;
      setPhase({ kind: "failed", message: NO_ANSWER });
      return;
    }
    if (abandoned()) return;

    const answer = classifyCommuteAnswer({
      redirected: response.redirected,
      status: response.status,
      contentType: response.headers.get("content-type"),
    });
    if (answer !== "stream") {
      run.current = null;
      controller.abort();
      if (answer === "signed_out") {
        window.location.assign("/auth/signin");
        return;
      }
      setPhase({ kind: "unknown", message: unreadableMessage(response.status) });
      return;
    }

    const final = await followCommuteStream(response.body);
    if (abandoned()) return;
    run.current = null;
    if (final === null) {
      setPhase({ kind: "unknown", message: COMMUTE_CUT_OFF });
      return;
    }
    if (final.type === "failed") {
      setPhase({ kind: "failed", message: final.message });
      return;
    }
    setResult(final.result);
    setPhase({ kind: "idle" });
  }

  const running = phase.kind === "running";
  const showButton = phase.kind !== "unknown";

  return (
    <div data-commute-runner className="flex flex-col gap-3">
      {phase.kind === "failed" || phase.kind === "unknown" ? <ServerError message={phase.message} /> : null}

      {showButton ? (
        <Button
          type="button"
          variant={result === null ? "default" : "outline"}
          className="w-full"
          disabled={running || !available}
          aria-describedby={available ? undefined : noteId}
          onClick={() => {
            void start();
          }}
        >
          {running ? (
            <span className="flex items-center gap-2">
              <Loader2 className="size-4 animate-spin" />
              Liczenie dojazdów…
            </span>
          ) : (
            <span className="flex items-center gap-2">
              {result === null ? <Route className="size-4" /> : <RefreshCw className="size-4" />}
              {result === null ? "Policz dojazdy" : "Policz ponownie"}
            </span>
          )}
        </Button>
      ) : (
        <Button
          type="button"
          variant="link"
          className="h-auto self-start p-0"
          onClick={() => {
            reloadAt(anchorId);
          }}
        >
          Odśwież stronę
        </Button>
      )}

      {available ? null : (
        <p id={noteId} className="text-muted-foreground text-sm">
          {commuteFailureMessage("not_configured")}
        </p>
      )}

      {running ? (
        <p role="status" className="text-muted-foreground text-sm">
          Google liczy trasy do punktów zespołu — to trwa kilka sekund.
        </p>
      ) : null}

      {result === null ? null : (
        <div data-commute-result={result.origin} className="flex flex-col gap-3">
          <div role="group" aria-label="Sposób dojazdu" className="flex gap-2">
            {(["transit", "drive"] as const).map((option) => (
              <Button
                key={option}
                type="button"
                size="sm"
                variant={mode === option ? "default" : "outline"}
                aria-pressed={mode === option}
                aria-controls={tableId}
                onClick={() => {
                  setMode(option);
                }}
              >
                {MODE_LABEL[option]}
              </Button>
            ))}
          </div>

          <table id={tableId} className="w-full text-sm">
            <caption className="text-muted-foreground pb-2 text-left text-xs">
              {MODE_LABEL[mode]}
              {mode === "transit" ? ` · ${departureLabel(result.departure.date)}` : null}
            </caption>
            <thead className="sr-only">
              <tr>
                <th scope="col">Nr</th>
                <th scope="col">Punkt</th>
                <th scope="col">Czas</th>
                <th scope="col">Odległość</th>
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row, index) => (
                <tr key={row.pointId} className="border-border border-t align-top">
                  <td className="py-2 pr-2">
                    <span className="flex items-center gap-1.5 tabular-nums">
                      <span
                        aria-hidden="true"
                        className={cn("size-3 shrink-0 rounded-full", routeSwatchClass(index))}
                      />
                      {index + 1}
                    </span>
                  </td>
                  <th scope="row" className="px-2 py-2 text-left font-medium wrap-anywhere">
                    {row.name}
                  </th>
                  <Cell cell={mode === "transit" ? row.transit : row.drive} />
                </tr>
              ))}
            </tbody>
          </table>

          <div className="text-muted-foreground flex flex-col gap-1 text-xs">
            <p>{ORIGIN_LABEL[result.origin]} — to szacunek okolicy, nie budynku.</p>
            <p>
              Czasy i trasy: <span translate="no">Google Maps</span>. Wynik nie jest zapisywany — po odświeżeniu strony
              trzeba policzyć ponownie.
            </p>
          </div>

          {mapKey === null ? (
            <p data-commute-map-missing className="text-muted-foreground text-sm">
              Mapa jest niedostępna — aplikacja nie ma klucza Google Maps do mapy. Tabela pokazuje wszystkie dojazdy.
            </p>
          ) : preview !== undefined ? (
            <div
              data-commute-map-placeholder
              className="border-border bg-muted text-muted-foreground flex h-72 w-full items-center justify-center gap-2 rounded-md border border-dashed text-sm"
            >
              <MapPinned className="size-4" />
              Tu po policzeniu stanie mapa tras (podgląd bez mapy)
            </div>
          ) : (
            <Suspense fallback={<div className="bg-muted h-72 w-full rounded-md" aria-label="Wczytywanie mapy" />}>
              <CommuteMap apiKey={mapKey} rows={result.rows} mode={mode} />
            </Suspense>
          )}
        </div>
      )}
    </div>
  );
}
