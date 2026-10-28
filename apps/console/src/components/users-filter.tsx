import { Braces } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatDateTime } from "@/lib/date";
import type { SchemaLineage } from "@/lib/schema";
import type { UsersSearch } from "@/lib/user-list";

/** The value standing for no narrowing, in either select. */
const ALL = "all";

/**
 * The Users list's filter on the title row (#1669): a schema by object type,
 * and once one is chosen, a revision of it. Both are sent to the server; the
 * second names the newest revision (`Latest only`, `Older revisions`) or one
 * revision by id, each marked when some user is still on it. Nothing here
 * counts users: the API has no total, by design.
 */
export function UsersFilter({
  lineages,
  search,
  onChange,
}: {
  lineages: SchemaLineage[];
  search: UsersSearch;
  onChange: (next: UsersSearch) => void;
}) {
  const lineage = lineages.find((entry) => entry.objectType === search.schema);
  return (
    <>
      <Select
        value={search.schema ?? ALL}
        onValueChange={(value) => onChange({ schema: value === ALL ? undefined : value })}
      >
        <SelectTrigger aria-label="Filter by schema" className="font-medium">
          <Braces aria-hidden strokeWidth={1.5} className="text-foreground" />
          {/* Named here rather than by the matching item: a URL can carry an
              object type no lineage has (a deleted schema), and the trigger
              must still say what the list is narrowed to. */}
          <SelectValue>{lineage?.title ?? search.schema ?? "All schemas"}</SelectValue>
        </SelectTrigger>
        <SelectContent position="popper" align="end">
          <SelectItem value={ALL}>All schemas</SelectItem>
          {lineages.map((entry) => (
            <SelectItem key={entry.objectType} value={entry.objectType}>
              {entry.title}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {lineage && (
        <Select
          value={search.revision ?? ALL}
          onValueChange={(value) =>
            onChange({ schema: search.schema, revision: value === ALL ? undefined : value })
          }
        >
          <SelectTrigger aria-label="Filter by revision" className="max-w-full font-medium">
            {/* The trigger names the choice without the option's date and
                badges, which would widen it past the title row. */}
            <SelectValue>
              <span className="truncate">{revisionLabel(search.revision)}</span>
            </SelectValue>
          </SelectTrigger>
          <SelectContent position="popper" align="end">
            <SelectItem value={ALL}>All revisions</SelectItem>
            <SelectItem value="latest">Latest only</SelectItem>
            <SelectItem value="older">Older revisions</SelectItem>
            <SelectSeparator />
            {lineage.revisions.map((revision, index) => (
              <SelectItem key={revision.id} value={revision.id} className="gap-2">
                <span className="text-xs font-medium">{revision.id}</span>
                <span className="text-muted-foreground text-xs">
                  {formatDateTime(revision.createdAt)}
                </span>
                {index === 0 && (
                  <Badge variant="secondary" className="h-5">
                    latest
                  </Badge>
                )}
                {revision.inUse && (
                  <Badge variant="outline" className="h-5">
                    in use
                  </Badge>
                )}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </>
  );
}

function revisionLabel(revision: string | undefined): string {
  if (!revision) return "All revisions";
  if (revision === "latest") return "Latest only";
  if (revision === "older") return "Older revisions";
  return revision;
}
