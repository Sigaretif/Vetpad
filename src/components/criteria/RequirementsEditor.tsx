import React, { useEffect, useId, useRef, useState } from "react";
import { CircleAlert, Pencil, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { ServerError } from "@/components/form/ServerError";
import { SubmitButton } from "@/components/form/SubmitButton";
import { TextareaField } from "@/components/form/TextareaField";
import { usePendingSubmit } from "@/components/form/use-pending-submit";
import { RequirementsCard } from "@/components/criteria/RequirementsCard";
import { REQUIREMENTS_MAX_LENGTH, requirementsError, type RequirementsView } from "@/lib/criteria";

interface Props {
  /** The member's own saved requirements, or `null` when they have not written any. */
  own: RequirementsView | null;
  /** A failed save or delete, from the page's `?error=`: the form opens with it. */
  serverError?: string | null;
  startEditing?: boolean;
}

const DELETE_CONFIRMATION = "Usunąć Twoje wymagania dodatkowe? Tej zmiany nie można cofnąć.";

/**
 * The member's own requirements (FR-002, FR-003): a preview with „Edytuj" and „Usuń", or the form
 * that saves them through `POST /api/requirements` (a native POST, so it also works with
 * JavaScript off). Without saved requirements the form is open straight away. „Usuń" sends
 * `intent=delete` after a confirmation. Ids come from `useId()` because the kitchen sinks render
 * several editors on one page. Pattern: `NoteEditor.tsx`.
 */
export default function RequirementsEditor({ own, serverError, startEditing = false }: Props) {
  const saved = own?.body ?? "";

  const [editing, setEditing] = useState(own === null || startEditing || Boolean(serverError));
  const [body, setBody] = useState(saved);
  const [error, setError] = useState<string | null>(null);
  // A failed save belongs to the attempt it reports: „Anuluj" dismisses it with the draft.
  const [serverMessage, setServerMessage] = useState(serverError ?? null);
  const { pending, markPending } = usePendingSubmit();

  const baseId = useId();
  const fieldId = `${baseId}-body`;
  const errorId = `${baseId}-error`;
  const headingId = `${baseId}-heading`;
  const descriptionId = `${baseId}-description`;
  const editButtonId = `${baseId}-edit`;

  // Switching modes replaces the DOM, so focus would fall to <body>: move it to where the member
  // is going — the field after „Edytuj", back to „Edytuj" after „Anuluj". Not on the first render.
  const focusAfterSwitch = useRef<string | null>(null);
  useEffect(() => {
    const target = focusAfterSwitch.current;
    if (target === null) return;
    focusAfterSwitch.current = null;
    document.getElementById(target)?.focus();
  }, [editing]);

  function startEdit() {
    focusAfterSwitch.current = fieldId;
    setEditing(true);
  }

  function cancel() {
    focusAfterSwitch.current = editButtonId;
    setBody(saved);
    setError(null);
    setServerMessage(null);
    setEditing(false);
  }

  function change(value: string) {
    setBody(value);
    if (error) setError(null);
  }

  function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    // Checked as the route will store it: a textarea submits line breaks as CRLF.
    const invalid = requirementsError(body.replace(/\r\n/g, "\n"));
    if (invalid !== null) {
      e.preventDefault();
      setError(invalid);
      return;
    }
    markPending();
  }

  function handleDelete(e: React.SubmitEvent<HTMLFormElement>) {
    if (!window.confirm(DELETE_CONFIRMATION)) {
      e.preventDefault();
      return;
    }
    markPending();
  }

  if (!editing && own) {
    return (
      <RequirementsCard
        author={own.author}
        body={own.body}
        updatedAt={own.updatedAt}
        action={
          <div className="flex flex-wrap justify-end gap-2">
            <Button id={editButtonId} type="button" variant="outline" size="sm" onClick={startEdit} disabled={pending}>
              <Pencil />
              Edytuj
            </Button>
            <form method="POST" action="/api/requirements" onSubmit={handleDelete}>
              <input type="hidden" name="intent" value="delete" />
              <Button type="submit" variant="outline" size="sm" disabled={pending}>
                <Trash2 />
                {pending ? "Usuwam…" : "Usuń"}
              </Button>
            </form>
          </div>
        }
      />
    );
  }

  return (
    <Card className="gap-4">
      <CardHeader>
        <h3 id={headingId} className="leading-snug font-semibold">
          Twoje wymagania
        </h3>
        <CardDescription id={descriptionId}>
          Czego jeszcze szukasz w mieszkaniu, poza limitami zespołu. Widzą je wszyscy członkowie, zmienić możesz tylko
          Ty.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          method="POST"
          action="/api/requirements"
          className="space-y-4"
          aria-labelledby={headingId}
          aria-describedby={descriptionId}
          onSubmit={handleSubmit}
          noValidate
        >
          <input type="hidden" name="intent" value="save" />

          <TextareaField
            id={fieldId}
            name="body"
            label="Wymagania dodatkowe"
            value={body}
            onChange={change}
            maxLength={REQUIREMENTS_MAX_LENGTH}
            rows={6}
            invalid={error !== null}
            describedBy={errorId}
          />

          {error ? (
            <p id={errorId} className="text-destructive flex items-center gap-1 text-xs">
              <CircleAlert className="size-3 shrink-0" />
              {error}
            </p>
          ) : null}

          <ServerError message={serverMessage} />

          <div className="flex flex-col gap-2">
            <SubmitButton pending={pending} pendingText="Zapisuję…" icon={<Save className="size-4" />}>
              Zapisz wymagania
            </SubmitButton>
            {own ? (
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
