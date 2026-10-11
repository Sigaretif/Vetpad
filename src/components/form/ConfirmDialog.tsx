import { useState, type ReactNode } from "react";
import { SubmitButton } from "@/components/form/SubmitButton";
import { usePendingSubmit } from "@/components/form/use-pending-submit";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

interface ConfirmDialogProps {
  /** The button that opens the dialog. Nothing is sent when it is pressed. */
  triggerLabel: string;
  triggerIcon: ReactNode;
  triggerVariant?: "destructive" | "outline";
  triggerSize?: "default" | "sm";
  triggerClassName?: string;
  /** What the member is asked, and what will be gone — both rendered as text. */
  title: string;
  description: string;
  confirmLabel: string;
  confirmIcon: ReactNode;
  /** The confirmation button's text while the form is on its way. */
  pendingText: string;
  /** The route the form posts to. */
  action: string;
  /** Everything the route needs, as hidden fields: name → value. */
  fields: Record<string, string>;
  /** For the /dev kitchen sinks alone: the dialog is open on the first render. */
  defaultOpen?: boolean;
  /** For the /dev kitchen sinks alone: the dialog shows its sending state, and sends nothing. */
  preview?: "pending";
}

/**
 * The confirmation of an action that cannot be undone (FR-015): a button that opens a dialog, and
 * in the dialog a native form `POST` with hidden fields and the button that sends it. Nothing
 * reaches the route until the member confirms; „Anuluj" and Escape close the dialog and send
 * nothing.
 *
 * The confirmation is an ordinary submit button, never `AlertDialogAction`: that one closes the
 * dialog on click, and closing unmounts the form from the portal before the browser has sent it.
 * For the same reason the dialog cannot be closed while the form is on its way — it stays open,
 * saying so, until the page the route redirects to replaces this one.
 *
 * Everything the route reads travels in hidden fields, never in the button's `name`/`value`: the
 * button is disabled on submit, and Firefox leaves a disabled submitter out of the form data
 * (`TeamLimitsForm.tsx` is the reference). The form lives in the dialog, so without JavaScript
 * there is no way to send it — a deletion is never one unconfirmed click.
 */
export function ConfirmDialog({
  triggerLabel,
  triggerIcon,
  triggerVariant = "destructive",
  triggerSize = "default",
  triggerClassName,
  title,
  description,
  confirmLabel,
  confirmIcon,
  pendingText,
  action,
  fields,
  defaultOpen = false,
  preview,
}: ConfirmDialogProps) {
  const [open, setOpen] = useState(defaultOpen);
  const { pending: submitted, markPending } = usePendingSubmit();
  const pending = submitted || preview === "pending";

  function handleOpenChange(next: boolean) {
    // A form on its way keeps its dialog: Escape would unmount it mid-request.
    if (!next && submitted) return;
    setOpen(next);
  }

  function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    if (preview !== undefined) {
      e.preventDefault();
      return;
    }
    markPending();
  }

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogTrigger asChild>
        <Button type="button" variant={triggerVariant} size={triggerSize} className={triggerClassName}>
          {triggerIcon}
          {triggerLabel}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <form method="POST" action={action} onSubmit={handleSubmit}>
          {Object.entries(fields).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Anuluj</AlertDialogCancel>
            <SubmitButton
              variant="destructive"
              className="sm:w-auto"
              pending={pending}
              pendingText={pendingText}
              icon={confirmIcon}
            >
              {confirmLabel}
            </SubmitButton>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
