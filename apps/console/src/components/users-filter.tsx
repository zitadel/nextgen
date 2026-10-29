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
import type { SchemaRevision } from "@/lib/schema";
import type { SchemaOption, UsersSearch } from "@/lib/user-list";

/** The value standing for no narrowing, in either select. */
const ALL = "all";

/** The revision choices that name a comparison rather than one revision. */
const REVISION_CHOICES = { latest: "Latest only", older: "Older revisions" } as const;

/**
 * The Users list's filter on the title row (#1669): a schema by object type,
 * and once one is chosen, a revision of it. Both are sent to the server; the
 * second names the newest revision (`Latest only`, `Older revisions`) or one
 * revision by id, each marked when some user is still on it. Nothing here
 * counts users: the API has no total, by design.
 *
 * A value the URL carries that no option matches (a deleted schema, an
 * unreadable list) still shows on its trigger, so the filter can be cleared.
 */
export function UsersFilter({
  options,
  revisions,
  search,
  onChange,
}: {
  options: SchemaOption[];
  /** The chosen schema's revisions, newest first; empty when none is chosen or they could not be read. */
  revisions: SchemaRevision[];
  search: UsersSearch;
  onChange: (next: UsersSearch) => void;
}) {
  const chosen = options.find((option) => option.objectType === search.schema);
  return (
    <>
      <Select
        value={search.schema ?? ALL}
        onValueChange={(value) => onChange({ schema: value === ALL ? undefined : value })}
      >
        <SelectTrigger aria-label="Filter by schema" className="font-medium">
          <Braces aria-hidden strokeWidth={1.5} className="text-foreground" />
          <SelectValue>{chosen?.title ?? search.schema ?? "All schemas"}</SelectValue>
        </SelectTrigger>
        <SelectContent position="popper" align="end">
          <SelectItem value={ALL}>All schemas</SelectItem>
          {options.map((option) => (
            <SelectItem key={option.objectType} value={option.objectType}>
              {option.title}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {search.schema && (
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
            {Object.entries(REVISION_CHOICES).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
            {revisions.length > 0 && <SelectSeparator />}
            {revisions.map((revision, index) => (
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
  return revision in REVISION_CHOICES
    ? REVISION_CHOICES[revision as keyof typeof REVISION_CHOICES]
    : revision;
}
