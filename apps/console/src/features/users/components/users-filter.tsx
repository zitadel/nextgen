import { FilterSelect } from "@/components/filter-select";
import {
  REVISION_MENU,
  RevisionItems,
  RevisionValue,
} from "@/features/schemas/components/revision-select";
import { SelectItem, SelectSeparator } from "@/components/ui/select";
import type { SchemaRevision } from "@/features/schemas/model";
import { OLDER_REVISIONS, type SchemaOption, type UsersSearch } from "@/features/users/list";

/**
 * The Users list's filters on the title row (#1669, #2502): a schema by object
 * type, then one revision of it, or `Older revisions` for every user not yet
 * on the newest, which a schema with one revision has none of. The revision
 * filter stays in view, disabled until a schema is chosen. There is no sort: revision ids carry no creation
 * order (a URI `$id`, a UUID on Spanner), and the user query cannot sort by
 * the revision's creation time.
 *
 * Nothing here counts users: the API has no total, by design. A value the URL
 * carries that no option matches (a deleted schema, an unreadable history)
 * still shows on its trigger, so the filter can be cleared. A filter with
 * nothing to offer and nothing set is disabled rather than opening empty.
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
      <FilterSelect
        label="User schema"
        name="schema"
        value={search.schema}
        display={<span className="truncate">{chosen?.title ?? search.schema}</span>}
        disabled={options.length === 0 && !search.schema}
        onChange={(schema) => onChange({ schema })}
      >
        {options.map((option) => (
          <SelectItem key={option.objectType} value={option.objectType}>
            {option.title}
          </SelectItem>
        ))}
      </FilterSelect>
      <FilterSelect
        label="Revision"
        name="revision"
        value={search.revision}
        display={
          search.revision === OLDER_REVISIONS ? (
            <span className="truncate">Older revisions</span>
          ) : (
            search.revision && (
              <RevisionValue
                revisions={revisions}
                latestId={chosen?.latestId}
                id={search.revision}
              />
            )
          )
        }
        disabled={!search.schema || (revisions.length === 0 && !search.revision)}
        onChange={(revision) => onChange({ schema: search.schema, revision })}
        menuClassName={REVISION_MENU}
      >
        {revisions.length > 1 && (
          <>
            <SelectItem value={OLDER_REVISIONS}>Older revisions</SelectItem>
            <SelectSeparator />
          </>
        )}
        <RevisionItems revisions={revisions} latestId={chosen?.latestId} />
      </FilterSelect>
    </>
  );
}
