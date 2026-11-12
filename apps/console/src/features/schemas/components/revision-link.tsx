import { Link } from "@tanstack/react-router";
import { GitCommitHorizontal } from "lucide-react";

import { IdText } from "@/components/id-text";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

/**
 * A schema revision's id in its box, opening that revision: the commit glyph
 * and the id cut in the middle, on one line. `name` is the schema's, for an
 * accessible name that says which schema the revision belongs to.
 */
export function RevisionLink({ schemaId, name }: { schemaId: string; name?: string }) {
  return (
    // `min-h-6` is the 24px touch target, the box's own height.
    <Button
      asChild
      variant="secondary"
      size="xs"
      className="h-auto min-h-6 max-w-full justify-start py-0.5 has-[>svg]:px-2"
    >
      <Link
        to="/schemas/$schemaId"
        params={{ schemaId }}
        aria-label={name && name !== schemaId ? `${name} ${schemaId}` : undefined}
      >
        <GitCommitHorizontal className="size-4" strokeWidth={1.5} aria-hidden />
        <Badge
          variant="ghost"
          className="h-auto min-h-5 min-w-0 shrink px-0 py-0 font-mono font-normal"
        >
          <IdText id={schemaId} title={schemaId} />
        </Badge>
      </Link>
    </Button>
  );
}
