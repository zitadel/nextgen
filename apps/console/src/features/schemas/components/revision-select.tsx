import { IdText, mintedPrefixLength } from "@/components/id-text";
import { Badge } from "@/components/ui/badge";
import { SelectItem } from "@/components/ui/select";
import { formatDateTime } from "@/lib/date";
import type { SchemaRevision } from "@/features/schemas/model";
import { cn } from "@/lib/utils";

/**
 * The pieces every revision picker shares (#2502): the Users list's revision
 * filter and the schema detail's picker draw a revision the same way, by its
 * shortened id, its creation time and its badges.
 */

/**
 * The menu's width: wide enough for a date and both badges on one line, and
 * never narrower than its trigger, whose width Radix gives the menu's list.
 */
export const REVISION_MENU = "w-81 min-w-(--radix-select-trigger-width)";

/** A trigger whose value is a row of pieces: it shrinks to its container, 6px apart. */
export const REVISION_TRIGGER =
  "max-w-full min-w-0 gap-1.5 *:data-[slot=select-value]:min-w-0 *:data-[slot=select-value]:gap-1.5";

/**
 * A minted revision id cut to its prefix and its last six characters,
 * `sch_…ZNP02S`, which is where two revisions of one schema differ. An id
 * without a minted prefix (a URI a schema names itself by) stays whole. The
 * full id goes in a `title` wherever this is shown.
 */
export function shortRevisionId(id: string): string {
  const prefix = mintedPrefixLength(id);
  return prefix === 0 ? id : `${id.slice(0, prefix)}…${id.slice(-6)}`;
}

/**
 * A revision's id on one line, at most the menu's width: a minted one in the
 * design's short form (`shortRevisionId`), any other cut in the middle.
 * `readWhole` gives a screen reader the whole id behind the short form, where
 * nothing else names it; an option keeps its visible text as its name, which
 * its title and typeahead text carry the whole id beside.
 */
function RevisionId({
  id,
  title,
  readWhole = false,
  className,
}: {
  id: string;
  title?: string;
  readWhole?: boolean;
  className?: string;
}) {
  const short = shortRevisionId(id);
  // The short form is as short as the design draws it, so it never gives way.
  const fixed = short !== id && "shrink-0";
  return (
    <IdText
      id={short}
      label={readWhole ? id : short}
      title={title}
      className={cn("max-w-81", fixed, className)}
    />
  );
}

/**
 * A chosen revision on a trigger: its shortened id, with the full one in its
 * title, and its badges.
 */
export function RevisionValue({
  revisions,
  latestId,
  id,
  className,
}: {
  revisions: SchemaRevision[];
  latestId?: string;
  id: string;
  className?: string;
}) {
  return (
    <>
      <RevisionId id={id} title={id} readWhole className={className} />
      <RevisionBadges revisions={revisions} latestId={latestId} id={id} />
    </>
  );
}

/**
 * `Latest` marks the newest revision and `In use` one some user is still on;
 * a revision can carry both. Filled and outlined, so they stay apart when
 * they sit side by side. `latestId` is the newest revision as the latest-of-type
 * read names it, not the history's first entry: the history leaves out a
 * revision the viewer may not read. Unknown, nothing is marked `Latest`.
 * `revisions` is the history, which says what is in use.
 */
export function RevisionBadges({
  revisions,
  latestId,
  id,
}: {
  revisions: SchemaRevision[];
  latestId?: string;
  id: string;
}) {
  const latest = latestId !== undefined && latestId === id;
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
 * One revision as a menu row: the id on the first line, the creation time and
 * badges under it. Shared by the schema detail's `Select` and the Users list's
 * filter, whose rows are not `Select` items.
 */
export function RevisionOption({
  revision,
  revisions,
  latestId,
}: {
  revision: SchemaRevision;
  revisions: SchemaRevision[];
  latestId?: string;
}) {
  return (
    <span className="flex min-w-0 flex-col items-start gap-1.5">
      <RevisionId id={revision.id} className="max-w-full" />
      <span className="flex flex-wrap items-center gap-1.25">
        {/* Muted text on the highlighted row's accent fill falls under
            4.5:1, so the date takes the accent's own foreground there:
            `data-highlighted` in a `Select`, `data-selected` in a `Command`. */}
        <span className="text-muted-foreground in-data-highlighted:text-accent-foreground in-data-[selected=true]:text-accent-foreground text-xs">
          {formatDateTime(revision.createdAt)}
        </span>
        <RevisionBadges revisions={revisions} latestId={latestId} id={revision.id} />
      </span>
    </span>
  );
}

/**
 * The menu's options, newest first: each a `RevisionOption` with the check
 * mark beside its id. Each option's value, and what typing finds it by, is
 * the revision's whole id.
 */
export function RevisionItems({
  revisions,
  latestId,
}: {
  revisions: SchemaRevision[];
  latestId?: string;
}) {
  return revisions.map((revision) => (
    <SelectItem
      key={revision.id}
      value={revision.id}
      textValue={revision.id}
      title={revision.id}
      // The design's rhythm: the id on a 32px row, the meta line 6px under
      // it, 5px below, and 4px between options. The check mark sits on the
      // id's line, not centred on both. The item text may shrink, so a long
      // id is cut rather than running under the check mark.
      className="items-start pb-1.25 not-first:mt-1 *:[span]:last:min-w-0 [&>[data-slot=select-item-indicator]]:top-2.5"
    >
      <RevisionOption revision={revision} revisions={revisions} latestId={latestId} />
    </SelectItem>
  ));
}
