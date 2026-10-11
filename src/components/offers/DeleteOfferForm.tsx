import { Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/form/ConfirmDialog";
import { ServerError } from "@/components/form/ServerError";
import { cn } from "@/lib/utils";

interface Props {
  offerId: string;
  /** Where the member lands afterwards: the board (from the card), or the archive page it was sent from. */
  returnTo?: "card" | "archive";
  /** A failed deletion, from the card's `?error=…&form=delete`. */
  serverError?: string | null;
  /** For a row of the archive page: a smaller button, under „Przywróć". */
  compact?: boolean;
  /** For the /dev kitchen sinks alone: the dialog is open on the first render. */
  defaultOpen?: boolean;
  /** For the /dev kitchen sinks alone: the dialog shows its sending state, and sends nothing. */
  preview?: "pending";
}

/**
 * Deletes a saved offer, live or archived, on the member's request (FR-015): a button that opens
 * a confirmation, whose form posts to `POST /api/offer-delete`. The deletion cannot be undone and
 * takes every member's notes on the offer and its audit with it, so nothing is sent until the
 * member has read exactly that and confirmed — and with JavaScript off nothing can be sent at all.
 *
 * The island knows the offer by its id alone. `offer_id` and `return` travel in hidden fields
 * (`ConfirmDialog.tsx`). A failed deletion is shown beside the button, outside the dialog: the
 * page it arrives on renders with the dialog closed.
 */
export default function DeleteOfferForm({
  offerId,
  returnTo = "card",
  serverError,
  compact = false,
  defaultOpen = false,
  preview,
}: Props) {
  return (
    <div className={cn("flex flex-col gap-3", compact && "mt-2")}>
      <ServerError message={serverError} />

      <ConfirmDialog
        triggerLabel="Usuń ofertę"
        triggerIcon={<Trash2 />}
        triggerVariant="destructive"
        triggerSize={compact ? "sm" : "default"}
        triggerClassName="w-full"
        title="Usunąć tę ofertę?"
        description="Oferta zniknie na zawsze razem z notatkami wszystkich członków zespołu i wynikiem audytu. Tej zmiany nie da się cofnąć."
        confirmLabel="Usuń ofertę"
        confirmIcon={<Trash2 className="size-4" />}
        pendingText="Usuwam…"
        action="/api/offer-delete"
        fields={{ offer_id: offerId, return: returnTo }}
        defaultOpen={defaultOpen}
        preview={preview}
      />
    </div>
  );
}
