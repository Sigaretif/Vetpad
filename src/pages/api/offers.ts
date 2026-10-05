import type { APIRoute } from "astro";
import { type LogFields, logEvent } from "@/lib/log";
import { createClient } from "@/lib/supabase";
import { ingestOffer, normalizeOfferUrl, type IngestFailureReason } from "@/lib/otodom";

const NOT_CONFIGURED = "Supabase nie jest skonfigurowany — nie można zapisać oferty.";
const SAVE_FAILED = "Nie udało się zapisać oferty. Nic nie zostało zapisane.";
const PRECHECK_FAILED =
  "Nie udało się sprawdzić, czy ta oferta jest już zapisana. Niczego nie pobrano — spróbuj ponownie za chwilę.";
const SAVE_UNCONFIRMED = "Nie udało się potwierdzić zapisu oferty. Sprawdź listę ofert, zanim dodasz ją ponownie.";
const TWIN_NOT_OPENED =
  "To ogłoszenie jest już zapisane, ale nie udało się otworzyć jego karty. Poszukaj go na liście ofert.";
const UNIQUE_VIOLATION = "23505";

/** One reason, one distinguishable message. A new reason fails the exhaustiveness check below. */
function failureMessage(reason: IngestFailureReason, status?: number): string {
  switch (reason) {
    case "empty":
    case "malformed":
      return "To nie wygląda na poprawny adres URL.";
    case "foreign_host":
      return "Vetpad obsługuje wyłącznie ogłoszenia z otodom.pl.";
    case "not_an_offer":
      return "Ten adres nie prowadzi do ogłoszenia otodom.pl.";
    case "not_for_sale":
      return "Vetpad służy do kupowania mieszkań — to ogłoszenie dotyczy wynajmu.";
    case "not_a_flat":
      return "Vetpad obsługuje wyłącznie mieszkania — to ogłoszenie dotyczy innego rodzaju nieruchomości.";
    case "not_found":
    case "expired":
      return "Ogłoszenie nie istnieje lub wygasło. Nic nie zostało zapisane.";
    case "http_denied":
      return `otodom.pl odmówił pobrania ogłoszenia${status === undefined ? "" : ` (HTTP ${status})`}. Nic nie zostało zapisane — spróbuj ponownie za chwilę.`;
    case "upstream_error":
      return `otodom.pl jest chwilowo niedostępny (HTTP ${status ?? "?"}). Nic nie zostało zapisane — spróbuj ponownie za chwilę.`;
    case "shape_changed":
      return "Nie udało się odczytać treści ogłoszenia — strona otodom.pl mogła zmienić format. Nic nie zostało zapisane.";
    case "timeout":
      return "Pobieranie ogłoszenia trwało dłużej niż 45 sekund. Nic nie zostało zapisane — spróbuj ponownie.";
    case "network":
      return "Nie udało się połączyć z otodom.pl. Nic nie zostało zapisane.";
    default: {
      const unhandled: never = reason;
      return unhandled;
    }
  }
}

type Outcome = "started" | "saved" | "duplicate" | "refused" | "failed";

/**
 * A refusal the product expects, or a failure somebody has to look at. Stands beside
 * `failureMessage` and is exhaustive the same way: a new reason without an entry here fails
 * `npx astro check`.
 */
const INGEST_OUTCOME: Record<IngestFailureReason, "refused" | "failed"> = {
  empty: "refused",
  malformed: "refused",
  foreign_host: "refused",
  not_an_offer: "refused",
  not_for_sale: "refused",
  not_a_flat: "refused",
  not_found: "refused",
  expired: "refused",
  http_denied: "failed",
  upstream_error: "failed",
  shape_changed: "failed",
  timeout: "failed",
  network: "failed",
};

/** The client is untyped; the reads below select `id` alone. */
interface OfferId {
  id: string;
}

/** One entry per way out of the route. A failure is an error; everything else is info. */
function report(outcome: Outcome, fields: Omit<LogFields, "event" | "outcome">): void {
  logEvent(outcome === "failed" ? "error" : "info", { event: "offer_add", outcome, ...fields });
}

/**
 * The `ID…` token that ends an offer's slug: it names the listing in a log entry without
 * carrying the words of its title, which the rest of the slug repeats.
 */
function listingToken(url: string): string | undefined {
  return /[-/](ID[A-Za-z0-9]+)$/.exec(url)?.[1];
}

/** What a failed Supabase call says about itself. `details` is never read: Postgres quotes the rejected row there. */
function dbFields(error: { code: string; message: string; hint: string }, status: number) {
  return { db_code: error.code, db_message: error.message, db_hint: error.hint, db_status: status };
}

export const POST: APIRoute = async (context) => {
  const fail = (message: string) => context.redirect(`/dashboard?error=${encodeURIComponent(message)}`);

  const user = context.locals.user;
  if (!user) {
    report("refused", { stage: "auth", reason: "signed_out" });
    return context.redirect("/auth/signin");
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    report("refused", { stage: "config", reason: "unconfigured", user_id: user.id });
    return fail(NOT_CONFIGURED);
  }

  let form: FormData;
  try {
    form = await context.request.formData();
  } catch {
    // A body that is not a form (a hand-crafted request) reads as an empty field, never a 500.
    report("refused", { stage: "body", reason: "unreadable_body", user_id: user.id });
    return fail(failureMessage("empty"));
  }
  const rawUrl = form.get("url");
  const normalized = normalizeOfferUrl(typeof rawUrl === "string" ? rawUrl : "");
  if (!normalized.ok) {
    report("refused", { stage: "url", reason: normalized.reason, user_id: user.id });
    return fail(failureMessage(normalized.reason));
  }

  const ids = { user_id: user.id, listing: listingToken(normalized.url) };

  // A known offer opens its card without touching otodom.pl, even if the listing has expired since (FR-005).
  const existing = await supabase.from("offers").select("id").eq("source_url", normalized.url).maybeSingle<OfferId>();
  if (existing.error) {
    report("failed", {
      ...ids,
      stage: "precheck",
      reason: "precheck_failed",
      ...dbFields(existing.error, existing.status),
    });
    return fail(PRECHECK_FAILED);
  }
  if (existing.data) {
    report("duplicate", { ...ids, stage: "precheck", offer_id: existing.data.id });
    return context.redirect(`/offers/${existing.data.id}?duplicate=1`);
  }

  // Written before the fetch, which may take 45 s: a call the platform cuts short still leaves a trace.
  report("started", { ...ids, stage: "fetch" });
  const result = await ingestOffer(normalized.url, AbortSignal.timeout(45_000));
  if (!result.ok) {
    report(INGEST_OUTCOME[result.reason], {
      ...ids,
      stage: result.stage,
      reason: result.reason,
      status: result.status,
      detail: result.detail,
    });
    return fail(failureMessage(result.reason, result.status));
  }

  const saving = { ...ids, otodom_id: result.offer.otodom_id };
  const inserted = await supabase
    .from("offers")
    .insert({ ...result.offer, source_url: result.url, created_by: user.id })
    .select("id")
    .single<OfferId>();

  if (inserted.error) {
    // No answer at all: the row may have landed, so the member is not told that nothing was saved.
    if (inserted.status === 0) {
      report("failed", {
        ...saving,
        stage: "insert",
        reason: "insert_unconfirmed",
        db_message: inserted.error.message,
        db_status: inserted.status,
      });
      return fail(SAVE_UNCONFIRMED);
    }
    if (inserted.error.code !== UNIQUE_VIOLATION) {
      report("failed", {
        ...saving,
        stage: "insert",
        reason: "insert_failed",
        ...dbFields(inserted.error, inserted.status),
      });
      return fail(SAVE_FAILED);
    }

    // The same offer under a different slug trips the unique index on otodom_id: open the existing card.
    const twin = await supabase
      .from("offers")
      .select("id")
      .eq("otodom_id", result.offer.otodom_id)
      .maybeSingle<OfferId>();
    if (twin.error) {
      report("failed", {
        ...saving,
        stage: "twin",
        reason: "twin_lookup_failed",
        ...dbFields(twin.error, twin.status),
      });
      return fail(TWIN_NOT_OPENED);
    }
    if (!twin.data) {
      report("failed", { ...saving, stage: "twin", reason: "twin_missing" });
      return fail(TWIN_NOT_OPENED);
    }
    report("duplicate", { ...saving, stage: "twin", offer_id: twin.data.id });
    return context.redirect(`/offers/${twin.data.id}?duplicate=1`);
  }

  report("saved", { ...saving, stage: "insert", offer_id: inserted.data.id });
  return context.redirect(`/offers/${inserted.data.id}`);
};
