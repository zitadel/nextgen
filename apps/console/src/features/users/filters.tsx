import { StatusDot } from "@/components/status-badge";
import { RevisionOption, RevisionValue } from "@/features/schemas/components/revision-select";
import type { SchemaRevision } from "@/features/schemas/model";
import type { FilterDefinition } from "@/lib/resource-filter";

import { OLDER_REVISIONS, type SchemaOption, USER_STATUSES, type UsersSearch } from "./list";

/**
 * What the Users list can be narrowed by, for `ResourceFilter` (#1669, #2502):
 * a schema by object type, one revision of it, a status, and when the user was
 * created. Each key is the search param `userFilter` reads.
 *
 * A revision belongs to a schema, so it waits for one and goes with it.
 * `Older revisions` is every user not yet on the newest, which a schema with
 * one revision has none of. There is no sort: revision ids carry no creation
 * order (a URI `$id`, a UUID on Spanner), and the user query cannot sort by
 * the revision's creation time. Nothing counts users: the API has no total,
 * by design.
 */
export function usersFilters({
  options,
  revisions,
  search,
}: {
  options: SchemaOption[];
  /** The chosen schema's revisions, newest first; empty when none is chosen or they could not be read. */
  revisions: SchemaRevision[];
  search: UsersSearch;
}): FilterDefinition[] {
  const latestId = options.find((option) => option.objectType === search.schema)?.latestId;
  return [
    {
      type: "options",
      key: "schema",
      label: "User schema",
      name: "schema",
      clears: ["revision"],
      unavailable: options.length === 0 ? "None to choose" : undefined,
      options: options.map((option) => ({ value: option.objectType, label: option.title })),
    },
    {
      type: "options",
      key: "revision",
      label: "Revision",
      unavailable: !search.schema
        ? "Choose a schema first"
        : revisions.length === 0
          ? "None to choose"
          : undefined,
      // Wide enough for a date and both badges on one line.
      menuClassName: "w-81",
      display: (value) =>
        value === OLDER_REVISIONS ? (
          <span className="truncate">Older revisions</span>
        ) : (
          <RevisionValue revisions={revisions} latestId={latestId} id={value} />
        ),
      options: [
        ...(revisions.length > 1
          ? [{ value: OLDER_REVISIONS, label: "Older revisions", separated: true }]
          : []),
        ...revisions.map((revision) => ({
          value: revision.id,
          label: revision.id,
          title: revision.id,
          content: <RevisionOption revision={revision} revisions={revisions} latestId={latestId} />,
        })),
      ],
    },
    {
      type: "options",
      key: "status",
      label: "Status",
      options: USER_STATUSES.map((status) => ({
        value: status,
        label: STATUS_LABEL[status],
        // The table's dot beside the name, not its pill: the pill's fill is
        // the popover's own on the dark theme, and shows only under a hover.
        content: (
          <span className="flex min-w-0 flex-1 items-center gap-2 leading-5">
            <StatusDot status={status} />
            <span className="truncate">{STATUS_LABEL[status]}</span>
          </span>
        ),
      })),
    },
    { type: "date", key: "created", label: "Created" },
  ];
}

/** The API's own values in words, as `StatusBadge` shows them. */
const STATUS_LABEL: Record<(typeof USER_STATUSES)[number], string> = {
  active: "Active",
  suspended: "Suspended",
  deactivated: "Deactivated",
  pending_purge: "Pending purge",
};
