import { Archive, ArchiveRestore } from "lucide-react";
import { ServerError } from "@/components/form/ServerError";
import { SubmitButton } from "@/components/form/SubmitButton";
import { usePendingSubmit } from "@/components/form/use-pending-submit";
import { cn } from "@/lib/utils";

interface Props {
  offerId: string;
  /** What the button does: moves the offer to the archive, or restores it from there. */
  intent: "archive" | "restore";
  /** Where a restore that went through lands: the offer's card, or the archive page it was sent from. */
  returnTo?: "card" | "archive";
  /** A failed archiving or restore, from the card's `?error=…&form=archive`. */
  serverError?: string | null;
  /** For the duplicate notice: the button takes its own width instead of the row's. */
  compact?: boolean;
}

/**
 * Moves a saved offer to the archive or restores it from there, on the member's request (FR-014):
 * one button that posts to `POST /api/offer-archive` (a native POST, so it also works with
 * JavaScript off). Nothing is sent until the member presses it, and nothing asks for a
 * confirmation — either action undoes the other.
 *
 * The island knows the offer by its id alone: whether it is archived, since when and by whom is
 * read from the row and rendered by the server beside it. `intent` and `return` travel in hidden
 * fields, never in the button's `name`/`value`: the button is disabled on submit, and Firefox
 * leaves a disabled submitter out of the form data — the route would then read no intent and
 * refuse the request (`TeamLimitsForm.tsx` is the reference).
 */
export default function ArchiveForm({ offerId, intent, returnTo = "card", serverError, compact = false }: Props) {
  const { pending, markPending } = usePendingSubmit();
  const restore = intent === "restore";

  return (
    <form
      method="POST"
      action="/api/offer-archive"
      className={cn("flex flex-col gap-3", compact && "mx-auto w-fit max-w-full")}
      onSubmit={markPending}
    >
      <input type="hidden" name="offer_id" value={offerId} />
      <input type="hidden" name="intent" value={intent} />
      <input type="hidden" name="return" value={returnTo} />

      <ServerError message={serverError} />

      <SubmitButton
        pending={pending}
        pendingText={restore ? "Przywracam…" : "Archiwizuję…"}
        icon={restore ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />}
      >
        {restore ? "Przywróć" : "Zarchiwizuj"}
      </SubmitButton>
    </form>
  );
}
