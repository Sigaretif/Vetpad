import React, { useEffect, useId, useRef, useState } from "react";
import { CircleAlert, Pencil, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/form/ConfirmDialog";
import { ServerError } from "@/components/form/ServerError";
import { SubmitButton } from "@/components/form/SubmitButton";
import { TextareaField } from "@/components/form/TextareaField";
import { usePendingSubmit } from "@/components/form/use-pending-submit";
import { NoteCard } from "@/components/offers/NoteCard";
import { NOTE_FIELDS, NOTE_FIELD_LABELS, NOTE_MAX_LENGTH, noteError, type NoteField } from "@/lib/notes";

type NoteValues = Record<NoteField, string>;

interface Props {
  offerId: string;
  /** The member's own saved note, or `null` when they have not written one yet. */
  note: (NoteValues & { updatedAt: string }) | null;
  /** A failed save, from the card's `?error=`: the form opens with it. */
  serverError?: string | null;
  /**
   * A failed deletion of the note, from the card's `?error=…&form=note-delete`: shown above the
   * note, and never a reason to open the form — the member asked to delete, not to edit.
   */
  deleteError?: string | null;
  startEditing?: boolean;
  /** For the /dev kitchen sinks alone: the delete confirmation is open on the first render. */
  deleteDialogOpen?: boolean;
}

const EMPTY: NoteValues = { pros: "", cons: "", observations: "" };

/**
 * The member's own note: a preview with „Edytuj" and „Usuń", or the three-field form that saves it
 * through `POST /api/notes` (a native POST, so it also works with JavaScript off). „Usuń" opens a
 * confirmation whose form posts `intent=delete` to the same route (FR-015); the saving form names
 * its own intent, `save`. Ids come from `useId()` because the kitchen sinks render several editors
 * on one page.
 */
export default function NoteEditor({
  offerId,
  note,
  serverError,
  deleteError,
  startEditing = false,
  deleteDialogOpen = false,
}: Props) {
  const saved: NoteValues = note ? { pros: note.pros, cons: note.cons, observations: note.observations } : EMPTY;

  const [editing, setEditing] = useState(note === null || startEditing || Boolean(serverError));
  const [values, setValues] = useState<NoteValues>(saved);
  const [error, setError] = useState<string | null>(null);
  // A failed save belongs to the attempt it reports: „Anuluj" dismisses it with the draft.
  const [serverMessage, setServerMessage] = useState(serverError ?? null);
  const { pending, markPending } = usePendingSubmit();

  const baseId = useId();
  const fieldId = (field: NoteField) => `${baseId}-${field}`;
  const errorId = `${baseId}-error`;
  const headingId = `${baseId}-heading`;
  const editButtonId = `${baseId}-edit`;

  // Switching modes replaces the DOM, so focus would fall to <body>: move it to where the member
  // is going — „Zalety" after „Edytuj", back to „Edytuj" after „Anuluj". Not on the first render.
  const focusAfterSwitch = useRef<string | null>(null);
  useEffect(() => {
    const target = focusAfterSwitch.current;
    if (target === null) return;
    focusAfterSwitch.current = null;
    document.getElementById(target)?.focus();
  }, [editing]);

  function startEdit() {
    focusAfterSwitch.current = fieldId("pros");
    setEditing(true);
  }

  function cancel() {
    focusAfterSwitch.current = editButtonId;
    setValues(saved);
    setError(null);
    setServerMessage(null);
    setEditing(false);
  }

  function change(field: NoteField, value: string) {
    setValues((prev) => ({ ...prev, [field]: value }));
    if (error) setError(null);
  }

  function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    const invalid = noteError(values);
    if (invalid !== null) {
      e.preventDefault();
      setError(invalid);
      return;
    }
    markPending();
  }

  if (!editing && note) {
    return (
      <div className="flex flex-col gap-3">
        <ServerError message={deleteError} />
        <NoteCard
          author={{ kind: "self" }}
          note={note}
          action={
            <div className="flex flex-wrap justify-end gap-2">
              <Button id={editButtonId} type="button" variant="outline" size="sm" onClick={startEdit}>
                <Pencil />
                Edytuj
              </Button>
              <ConfirmDialog
                triggerLabel="Usuń"
                triggerIcon={<Trash2 />}
                triggerVariant="outline"
                triggerSize="sm"
                title="Usunąć Twoją notatkę?"
                description="Twoje zalety, wady i obserwacje dla tej oferty znikną na zawsze. Notatki pozostałych członków zespołu zostaną."
                confirmLabel="Usuń notatkę"
                confirmIcon={<Trash2 className="size-4" />}
                pendingText="Usuwam…"
                action="/api/notes"
                fields={{ offer_id: offerId, intent: "delete" }}
                defaultOpen={deleteDialogOpen}
              />
            </div>
          }
        />
      </div>
    );
  }

  return (
    <Card className="gap-4">
      <CardHeader>
        <h3 id={headingId} className="leading-snug font-semibold">
          Twoja notatka
        </h3>
      </CardHeader>
      <CardContent>
        <form
          method="POST"
          action="/api/notes"
          className="space-y-4"
          aria-labelledby={headingId}
          onSubmit={handleSubmit}
          noValidate
        >
          <input type="hidden" name="offer_id" value={offerId} />
          <input type="hidden" name="intent" value="save" />

          {NOTE_FIELDS.map((field) => (
            <TextareaField
              key={field}
              id={fieldId(field)}
              name={field}
              label={NOTE_FIELD_LABELS[field]}
              value={values[field]}
              onChange={(value) => {
                change(field, value);
              }}
              maxLength={NOTE_MAX_LENGTH}
              invalid={error !== null}
              describedBy={errorId}
            />
          ))}

          {error ? (
            <p id={errorId} className="text-destructive flex items-center gap-1 text-xs">
              <CircleAlert className="size-3 shrink-0" />
              {error}
            </p>
          ) : null}

          <ServerError message={serverMessage} />

          <div className="flex flex-col gap-2">
            <SubmitButton pending={pending} pendingText="Zapisuję…" icon={<Save className="size-4" />}>
              Zapisz notatkę
            </SubmitButton>
            {note ? (
              <Button type="button" variant="ghost" onClick={cancel} disabled={pending}>
                Anuluj
              </Button>
            ) : null}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
