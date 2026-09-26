import type { ReactNode } from "react";
import { Card, CardAction, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { formatTimestamp } from "@/lib/format";
import { authorName, type Saver } from "@/lib/members";
import { NOTE_FIELDS, NOTE_FIELD_LABELS, type NoteField } from "@/lib/notes";

type NoteContent = Record<NoteField, string> & { updatedAt: string };

interface NoteCardProps {
  author: Saver;
  note: NoteContent;
  /** Rendered in the header, next to the author (the editor's „Edytuj"). */
  action?: ReactNode;
}

/**
 * One note in preview. React rather than `.astro` only because the editor island renders the
 * member's own note with it; everyone else's notes are rendered from `.astro` without a client
 * directive, so they ship no JavaScript. `unknown` names nobody and is never shown as a deleted
 * account.
 */
export function NoteCard({ author, note, action }: NoteCardProps) {
  const name = authorName(author);

  return (
    <Card className="gap-4">
      <CardHeader>
        <h3 className="leading-snug font-semibold wrap-anywhere">{name ?? "Notatka członka zespołu"}</h3>
        <CardDescription>
          edytowano <time dateTime={note.updatedAt}>{formatTimestamp(note.updatedAt)}</time>
        </CardDescription>
        {action ? <CardAction>{action}</CardAction> : null}
      </CardHeader>
      <CardContent>
        <dl className="flex flex-col gap-3 text-sm">
          {NOTE_FIELDS.map((field) => (
            <div key={field}>
              <dt className="text-muted-foreground mb-1 text-xs font-medium tracking-wide uppercase">
                {NOTE_FIELD_LABELS[field]}
              </dt>
              <dd className="leading-relaxed wrap-anywhere whitespace-pre-wrap">
                {note[field].trim() === "" ? <span className="text-muted-foreground">nie wpisano</span> : note[field]}
              </dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}
