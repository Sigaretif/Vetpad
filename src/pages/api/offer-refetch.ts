import type { APIRoute } from "astro";
import { AUDIT_OFFER_COLUMNS, listingFingerprint, readAuditOffer } from "@/lib/audit/input";
import { isApifyAvailable } from "@/lib/config-status";
import { loadIngestionSettings, resolveIngestionMode } from "@/lib/ingestion-settings";
import { type LogFields, logEvent } from "@/lib/log";
import { isLossAccepted, lostFacts, readLostTokens } from "@/lib/offer-refetch";
import { ingestOffer, normalizeOfferUrl } from "@/lib/otodom";
import { createApifyLeg } from "@/lib/otodom/apify";
import {
  INGEST_OUTCOME,
  apifyNeedsAttention,
  fetchFields,
  ingestFailureMessage,
  modeFields,
  modeReadFields,
  traceFields,
} from "@/lib/otodom/failure";
import { createClient } from "@/lib/supabase";
import { isUuid } from "@/lib/uuid";

const NOT_CONFIGURED = "Supabase nie jest skonfigurowany — nie można pobrać ogłoszenia ponownie.";
const UNREADABLE_FORM = "Nie udało się odczytać formularza ponownego pobrania. Niczego nie pobrano.";
const INVALID_OFFER = "Nie udało się rozpoznać oferty do ponownego pobrania. Niczego nie pobrano.";
const OFFER_MISSING = "Nie ma takiej oferty — mogła zostać usunięta. Niczego nie pobrano.";
const READ_FAILED =
  "Nie udało się odczytać zapisanej oferty. Niczego nie pobrano — zapisane dane oferty pozostały bez zmian. Spróbuj ponownie za chwilę.";
const OTHER_LISTING =
  "Pod zapisanym adresem jest teraz inne ogłoszenie niż to, które zapisano. Zapisane dane oferty pozostały bez zmian.";
const SAVE_FAILED = "Nie udało się zapisać pobranych danych. Zapisane dane oferty pozostały bez zmian.";
const SAVE_UNCONFIRMED =
  "Nie udało się potwierdzić zapisu pobranych danych. Odśwież kartę oferty i sprawdź datę pobrania, zanim spróbujesz ponownie.";
const OFFER_GONE =
  "Nie udało się zapisać pobranych danych — tej oferty nie ma już na liście. Mogła zostać usunięta w trakcie pobierania.";

/** What the route reads of the stored row: where the listing lives, which listing it is, and what the audit reads. */
const STORED_COLUMNS = ["source_url", "otodom_id", ...AUDIT_OFFER_COLUMNS].join(", ");
/** What the update hands back: the audit's columns, as the database holds them after the write. */
const SAVED_COLUMNS = AUDIT_OFFER_COLUMNS.join(", ");

type Outcome = "started" | "saved" | "held" | "refused" | "failed";
type Fields = Omit<LogFields, "event" | "outcome">;

/** The client is untyped; a row is read key by key and trusted for none of them. */
type Row = Record<string, unknown>;

/**
 * One entry per way out of the route, and one before the fetch. A failure is an error; so is an
 * entry whose Apify run ended in a way somebody has to look at (`apifyNeedsAttention`), whatever
 * the member reads. Everything else is info.
 */
function report(outcome: Outcome, fields: Fields, attention = false): void {
  logEvent(outcome === "failed" || attention ? "error" : "info", { event: "offer_refetch", outcome, ...fields });
}

/**
 * The `ID…` token that ends an offer's slug: it names the listing in a log entry without
 * carrying the words of its title, which the rest of the slug repeats. Mirrors `listingToken` in
 * src/pages/api/offers.ts.
 */
function listingToken(url: string): string | undefined {
  return /[-/](ID[A-Za-z0-9]+)$/.exec(url)?.[1];
}

/** What a failed Supabase call says about itself. `details` is never read: Postgres quotes the rejected row there. */
function dbFields(error: { code: string; message: string; hint: string }, status: number): Fields {
  return { db_code: error.code, db_message: error.message, db_hint: error.hint, db_status: status };
}

function textField(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

/**
 * Re-fetches one saved listing on a member's request (FR-009) and overwrites its row in
 * `public.offers`. Everything that can be checked for free comes first, then one fetch, then one
 * write judged by its error and by the number of rows it reached:
 *
 *   session → Supabase configured → form → offer id → stored row → stored address → ingestion
 *   mode → fetch → same listing → lost facts → update.
 *
 * Only scraped listing data is replaced. The route writes `public.offers` alone and reads it and
 * the one row of `public.ingestion_settings` — never a member's note and never an audit: an audit made on the older data is flagged stale by whoever
 * reads it (`src/lib/audit/freshness.ts`), not by anything stored here. The update carries the
 * mapper's columns and `fetched_at`; the row's `id`, `source_url`, `created_by` and `created_at`
 * are never sent.
 *
 * A fact the stored listing states and the fetched one no longer does stops the save until the
 * member agrees to lose exactly that (`src/lib/offer-refetch.ts`); the form sends back the columns
 * the member was shown as `accept_lost`.
 */
export const POST: APIRoute = async (context) => {
  // Before an offer is known there is no card to return to.
  const failOnBoard = (message: string) => context.redirect(`/dashboard?error=${encodeURIComponent(message)}`);

  const user = context.locals.user;
  if (!user) {
    report("refused", { stage: "auth", reason: "signed_out" });
    return context.redirect("/auth/signin");
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    report("refused", { stage: "config", reason: "unconfigured", user_id: user.id });
    return failOnBoard(NOT_CONFIGURED);
  }

  let form: FormData;
  try {
    form = await context.request.formData();
  } catch {
    // A body that is not a form (a hand-crafted request) is a refusal, never a 500.
    report("refused", { stage: "body", reason: "unreadable_body", user_id: user.id });
    return failOnBoard(UNREADABLE_FORM);
  }

  const offerId = textField(form, "offer_id");
  // The value itself stays out of the entry: it is whatever the request carried.
  if (!isUuid(offerId)) {
    report("refused", { stage: "offer_id", reason: "invalid_offer", user_id: user.id });
    return failOnBoard(INVALID_OFFER);
  }
  // Tokens that are not the audit's columns are dropped here, so they can agree to nothing.
  const accepted = readLostTokens(textField(form, "accept_lost"));

  // `form=` names the form the message belongs to: the card's `?error=` is the note editor's
  // otherwise, and the page cannot see the `#` fragment.
  const failOnCard = (message: string) =>
    context.redirect(`/offers/${offerId}?error=${encodeURIComponent(message)}&form=refetch#pobranie`);

  const read = await supabase.from("offers").select(STORED_COLUMNS).eq("id", offerId).maybeSingle<Row>();
  if (read.error) {
    report("failed", {
      stage: "offer",
      reason: "offer_read_failed",
      user_id: user.id,
      offer_id: offerId,
      ...dbFields(read.error, read.status),
    });
    return failOnCard(READ_FAILED);
  }
  // RLS lets every member read every offer, so no row is no offer.
  if (!read.data) {
    report("refused", { stage: "offer", reason: "offer_missing", user_id: user.id, offer_id: offerId });
    return failOnBoard(OFFER_MISSING);
  }
  const storedRow = read.data;

  // The stored address is not trusted: any member can change it through the Data API, and the
  // Worker would fetch whatever stands there. It goes through the same check as a pasted one, and
  // an address that is not an otodom offer is refused before any request.
  const storedUrl = typeof storedRow.source_url === "string" ? storedRow.source_url : "";
  const normalized = normalizeOfferUrl(storedUrl);
  if (!normalized.ok) {
    report("refused", { stage: "url", reason: normalized.reason, user_id: user.id, offer_id: offerId });
    return failOnCard(ingestFailureMessage(normalized.reason, undefined, "refetch"));
  }

  const ids = { user_id: user.id, offer_id: offerId, listing: listingToken(normalized.url) };

  // The mode is read only now, after every free refusal: a request refused anyway never reads it
  // and never pays for an Apify run. A failed read runs as `direct_only`.
  const settings = await loadIngestionSettings(supabase);
  const mode = resolveIngestionMode(settings, isApifyAvailable());
  const apify = mode.effective === "direct_only" ? null : createApifyLeg();
  const modeIds = { ...ids, ...modeFields(mode) };

  // Written before the fetch, which may take up to INGEST_ACTION_BUDGET_MS (src/lib/otodom/deadlines.ts):
  // a call the platform cuts short still leaves a trace.
  report("started", { ...modeIds, ...modeReadFields(settings), stage: "fetch" });
  const result = await ingestOffer(normalized.url, { mode, apify });
  const attention = apifyNeedsAttention(result);
  const traced = { ...modeIds, ...traceFields(result) };
  if (!result.ok) {
    report(
      INGEST_OUTCOME[result.reason],
      {
        ...fetchFields(result.evidence),
        ...traced,
        stage: result.stage,
        reason: result.reason,
        status: result.status,
        detail: result.detail,
      },
      attention,
    );
    return failOnCard(ingestFailureMessage(result.reason, result.status, "refetch"));
  }

  const fetching = { ...traced, otodom_id: result.offer.otodom_id };

  // The same listing, or nothing is written. Compared as text: PostgREST may send a `bigint` as
  // either a number or a string.
  if (String(storedRow.otodom_id) !== String(result.offer.otodom_id)) {
    report("refused", { ...fetching, stage: "identity", reason: "other_listing" });
    return failOnCard(OTHER_LISTING);
  }

  // A stored row that does not read does not block the re-fetch — the re-fetch is what repairs
  // it. There is then nothing to compare the fetched listing with: no lost facts, and no
  // "changed / unchanged" afterwards.
  const before = readAuditOffer(storedRow);
  const lost = before === null ? [] : lostFacts(before, result.offer);
  const lostColumns = lost.join(",");
  if (!isLossAccepted(lost, accepted)) {
    // Column names only — never what the columns held.
    report("held", { ...fetching, stage: "lost_facts", reason: "lost_facts", lost_columns: lostColumns });
    return context.redirect(`/offers/${offerId}?lost=${encodeURIComponent(lostColumns)}#pobranie`);
  }

  // The mapper's columns and the date of this fetch — never `id`, `source_url`, `created_by` or
  // `created_at`. `source_url` stays as stored even when otodom redirected to a new slug.
  const updated = await supabase
    .from("offers")
    .update({ ...result.offer, fetched_at: new Date().toISOString() })
    .eq("id", offerId)
    .select(SAVED_COLUMNS)
    .overrideTypes<Row[], { merge: false }>();

  if (updated.error) {
    // No answer at all: the row may have been overwritten, so the member is not told it was kept.
    if (updated.status === 0) {
      report("failed", {
        ...fetching,
        stage: "update",
        reason: "update_unconfirmed",
        db_message: updated.error.message,
        db_status: updated.status,
      });
      return failOnCard(SAVE_UNCONFIRMED);
    }
    report("failed", {
      ...fetching,
      stage: "update",
      reason: "update_failed",
      ...dbFields(updated.error, updated.status),
    });
    return failOnCard(SAVE_FAILED);
  }
  // An update that reached no row answers 200 with an empty list: the offer was deleted while the
  // listing was being fetched, or RLS filtered the write out. Either way it is a failed save.
  if (updated.data.length === 0) {
    report("failed", { ...fetching, stage: "update", reason: "offer_gone", db_status: updated.status });
    return failOnBoard(OFFER_GONE);
  }

  // Whether the audit would read something else now: both fingerprints are taken from rows as the
  // database answered them — the one read at the start and the one the update returned — never
  // from the freshly mapped object, because the database normalises numbers and dates.
  const after = readAuditOffer(updated.data[0]);
  const changed =
    before === null || after === null
      ? undefined
      : (await listingFingerprint(before)) !== (await listingFingerprint(after));

  report("saved", { ...fetching, stage: "update", changed, lost_columns: lostColumns });
  const verdict = changed === undefined ? "saved" : changed ? "changed" : "unchanged";
  return context.redirect(`/offers/${offerId}?refetched=${verdict}`);
};
