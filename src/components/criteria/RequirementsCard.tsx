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
  /** 4 under the „Wymagania pozostałych członków" heading, so the cards sit below it, not beside it. */
  headingLevel?: 3 | 4;
}

/**
 * One member's requirements in preview. React rather than `.astro` only because the editor island
 * renders the member's own requirements with it; everyone else's are rendered from `.astro`
 * without a client directive, so they ship no JavaScript. Pattern: `NoteCard.tsx`. `unknown`
 * names nobody and is never shown as a deleted account.
 */
export function RequirementsCard({ author, body, updatedAt, action, headingLevel = 3 }: RequirementsCardProps) {
  const name = authorName(author);
  const Heading = headingLevel === 4 ? "h4" : "h3";

  return (
    <Card className="gap-4">
      <CardHeader>
        <Heading className="leading-snug font-semibold wrap-anywhere">{name ?? "Wymagania członka zespołu"}</Heading>
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
