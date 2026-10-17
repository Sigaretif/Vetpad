import { RefreshCw, TriangleAlert } from "lucide-react";
import { ServerError } from "@/components/form/ServerError";
import { SubmitButton } from "@/components/form/SubmitButton";
import { usePendingSubmit } from "@/components/form/use-pending-submit";
import { cn } from "@/lib/utils";

interface Props {
  offerId: string;
  /** A failed re-fetch, from the card's `?error=…&form=refetch`. */
  serverError?: string | null;
  /**
   * The columns the member was shown as lost, as comma-separated tokens: the form then asks for a
   * deliberate overwrite and sends them back as `accept_lost`. Empty for a plain re-fetch.
   */
  acceptLost?: string;
  /** For the duplicate notice: the button takes its own width instead of the row's. */
  compact?: boolean;
}

/**
 * Re-fetches a saved listing on the member's request (FR-009): one button that posts to
 * `POST /api/offer-refetch` (a native POST, so it also works with JavaScript off) and waits — the
 * fetch may take up to about a minute („do około minuty”). Nothing is sent until the member presses it.
 *
 * The island knows the offer by its id alone; nothing else from the row reaches it. `accept_lost`
 * travels in a hidden field, never in the button's `name`/`value`: the button is disabled on
 * submit, and Firefox leaves a disabled submitter out of the form data — the route would then read
 * no consent and stop on the same lost fields again.
 */
export default function RefetchForm({ offerId, serverError, acceptLost = "", compact = false }: Props) {
  const { pending, markPending } = usePendingSubmit();
  const overwrite = acceptLost !== "";

  return (
    <form
      method="POST"
      action="/api/offer-refetch"
      className={cn("flex flex-col gap-3", compact && "mx-auto w-fit max-w-full")}
      onSubmit={markPending}
    >
      <input type="hidden" name="offer_id" value={offerId} />
      <input type="hidden" name="accept_lost" value={acceptLost} />

      <ServerError message={serverError} />

      <SubmitButton
        pending={pending}
        pendingText="Pobieram ogłoszenie…"
        icon={overwrite ? <TriangleAlert className="size-4" /> : <RefreshCw className="size-4" />}
      >
        {overwrite ? "Nadpisz mimo utraty tych pól" : "Pobierz ponownie z otodom.pl"}
      </SubmitButton>
    </form>
  );
}
