import { Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/form/ConfirmDialog";

interface Props {
  pointId: string;
  /** The point's name, for the dialog's question — rendered as text. */
  pointName: string;
  /** For the /dev kitchen sinks alone: the dialog is open on the first render. */
  defaultOpen?: boolean;
  /** For the /dev kitchen sinks alone: the dialog shows its sending state, and sends nothing. */
  preview?: "pending";
}

/**
 * Deletes one of the team's commute points (FR-016): a button that opens a confirmation, whose
 * form posts to `POST /api/commute-points`. The deletion cannot be undone and removes the point for
 * the whole team, so nothing is sent until the member has confirmed — and with JavaScript off
 * nothing can be sent at all. Pattern: `DeleteOfferForm.tsx`.
 *
 * `intent=delete` and the point's `id` travel in hidden fields (`ConfirmDialog.tsx`). A failed
 * deletion lands on /criteria with `&form=points`, and the editor shows it above the points.
 */
export default function DeletePointForm({ pointId, pointName, defaultOpen = false, preview }: Props) {
  return (
    <ConfirmDialog
      triggerLabel="Usuń"
      triggerIcon={<Trash2 />}
      triggerVariant="outline"
      triggerSize="sm"
      title={`Usunąć punkt „${pointName}”?`}
      description="Punkt zniknie dla całego zespołu. Tej zmiany nie da się cofnąć."
      confirmLabel="Usuń punkt"
      confirmIcon={<Trash2 className="size-4" />}
      pendingText="Usuwam…"
      action="/api/commute-points"
      fields={{ intent: "delete", id: pointId }}
      defaultOpen={defaultOpen}
      preview={preview}
    />
  );
}
