import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { ingestOffer, normalizeOfferUrl, type IngestFailureReason } from "@/lib/otodom";

const NOT_CONFIGURED = "Supabase nie jest skonfigurowany — nie można zapisać oferty.";
const SAVE_FAILED = "Nie udało się zapisać oferty. Nic nie zostało zapisane.";
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

export const POST: APIRoute = async (context) => {
  const fail = (message: string) => context.redirect(`/dashboard?error=${encodeURIComponent(message)}`);

  const user = context.locals.user;
  if (!user) {
    return context.redirect("/auth/signin");
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return fail(NOT_CONFIGURED);
  }

  let form: FormData;
  try {
    form = await context.request.formData();
  } catch {
    // A body that is not a form (a hand-crafted request) reads as an empty field, never a 500.
    return fail(failureMessage("empty"));
  }
  const rawUrl = form.get("url");
  const normalized = normalizeOfferUrl(typeof rawUrl === "string" ? rawUrl : "");
  if (!normalized.ok) {
    return fail(failureMessage(normalized.reason));
  }

  // A known offer opens its card without touching otodom.pl, even if the listing has expired since (FR-005).
  const existing = await supabase.from("offers").select("id").eq("source_url", normalized.url).maybeSingle();
  if (existing.error) {
    return fail(SAVE_FAILED);
  }
  if (existing.data) {
    return context.redirect(`/offers/${existing.data.id}?duplicate=1`);
  }

  const result = await ingestOffer(normalized.url, AbortSignal.timeout(45_000));
  if (!result.ok) {
    return fail(failureMessage(result.reason, result.status));
  }

  const inserted = await supabase
    .from("offers")
    .insert({ ...result.offer, source_url: result.url, created_by: user.id })
    .select("id")
    .single();

  if (inserted.error) {
    // The same offer under a different slug trips the unique index on otodom_id: open the existing card.
    if (inserted.error.code === UNIQUE_VIOLATION) {
      const twin = await supabase.from("offers").select("id").eq("otodom_id", result.offer.otodom_id).maybeSingle();
      if (!twin.error && twin.data) {
        return context.redirect(`/offers/${twin.data.id}?duplicate=1`);
      }
    }
    return fail(SAVE_FAILED);
  }

  return context.redirect(`/offers/${inserted.data.id}`);
};
