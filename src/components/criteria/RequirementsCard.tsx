import type { ReactNode } from "react";
import { Card, CardAction, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { formatTimestamp } from "@/lib/format";
import { authorName, type Saver } from "@/lib/members";

interface RequirementsCardProps {
  author: Saver;
  body: string;
  updatedAt: string;
  /** Rendered in the header, next to the author (the editor's „Edytuj" and „Usuń"). */
  action?: ReactNode;
}

/**
 * One member's requirements in preview. React rather than `.astro` only because the editor island
 * renders the member's own requirements with it; everyone else's are rendered from `.astro`
 * without a client directive, so they ship no JavaScript. Pattern: `NoteCard.tsx`. `unknown`
 * names nobody and is never shown as a deleted account.
 */
export function RequirementsCard({ author, body, updatedAt, action }: RequirementsCardProps) {
  const name = authorName(author);

  return (
    <Card className="gap-4">
      <CardHeader>
        <h3 className="leading-snug font-semibold wrap-anywhere">{name ?? "Wymagania członka zespołu"}</h3>
        <CardDescription>
          edytowano <time dateTime={updatedAt}>{formatTimestamp(updatedAt)}</time>
        </CardDescription>
        {action ? <CardAction>{action}</CardAction> : null}
      </CardHeader>
      <CardContent>
        <p className="text-sm leading-relaxed wrap-anywhere whitespace-pre-wrap">{body}</p>
      </CardContent>
    </Card>
  );
}
