import { Badge } from "@/components/ui/badge";
import { SelectItem } from "@/components/ui/select";
import { formatDateTime } from "@/lib/date";
import type { SchemaRevision } from "@/lib/schema";

/**
 * The pieces every revision picker shares (#2502): the Users list's revision
 * filter and the schema detail's picker draw a revision the same way, by its
 * shortened id, its creation time and its badges.
 */

/** The menu's width: wide enough for a date and both badges on one line. */
export const REVISION_MENU = "w-81";

/**
 * A minted revision id cut to its prefix and its last six characters,
 * `sch_…ZP02S`, which is where two revisions of one schema differ. An id
 * without a `prefix_` (a URI a schema names itself by) is not a ULID and
 * stays whole. The full id goes in a `title` wherever this is shown.
 */
export function shortRevisionId(id: string): string {
  const prefix = id.indexOf("_") + 1;
  if (prefix === 0 || id.length - prefix <= 10) return id;
  return `${id.slice(0, prefix)}…${id.slice(-6)}`;
}

/**
 * `Latest` marks the newest revision and `In use` one some user is still on;
 * a revision can carry both. Filled and outlined, so they stay apart when
 * they sit side by side. `revisions` is the history, newest first; an id it
 * does not list carries neither.
 */
export function RevisionBadges({ revisions, id }: { revisions: SchemaRevision[]; id: string }) {
  const latest = revisions[0]?.id === id;
  const revision = revisions.find((entry) => entry.id === id);
  return (
    <>
      {/* `secondary` is the popover's own fill in dark mode, which would
          leave the badge as bare text in the menu; the design lifts it a step
          off whatever it sits on. */}
      {latest && (
        <Badge variant="secondary" className="bg-foreground/25">
          Latest
        </Badge>
      )}
      {/* The outline's usual `border-border` vanishes on a popover; the
          design rings it in the muted text colour. */}
      {revision?.inUse && (
        <Badge variant="outline" className="border-muted-foreground">
          In use
        </Badge>
      )}
    </>
  );
}

/**
 * The menu's options, newest first: the id on the first line with the check
 * mark beside it, the creation time and badges under it. Each option's value
 * is the revision's id.
 */
export function RevisionItems({ revisions }: { revisions: SchemaRevision[] }) {
  return revisions.map((revision) => (
    <SelectItem
      key={revision.id}
      value={revision.id}
      title={revision.id}
      // The design's rhythm: the id on a 32px row, the meta line 6px under
      // it, 5px below, and 4px between options. The check mark sits on the
      // id's line, not centred on both.
      className="items-start pb-1.25 not-first:mt-1 [&>[data-slot=select-item-indicator]]:top-2.5"
    >
      <span className="flex min-w-0 flex-col items-start gap-1.5">
        <span className="truncate">{shortRevisionId(revision.id)}</span>
        <span className="flex flex-wrap items-center gap-1.25">
          {/* Muted text on the highlighted row's accent fill falls under
              4.5:1, so the date takes the accent's own foreground there. */}
          <span className="text-muted-foreground in-data-highlighted:text-accent-foreground text-xs">
            {formatDateTime(revision.createdAt)}
          </span>
          <RevisionBadges revisions={revisions} id={revision.id} />
        </span>
      </span>
    </SelectItem>
  ));
}
