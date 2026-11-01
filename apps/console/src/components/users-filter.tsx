import { Plus, X } from "lucide-react";
import type { ReactNode } from "react";

import {
  REVISION_MENU,
  RevisionBadges,
  RevisionItems,
  shortRevisionId,
} from "@/components/revision-select";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { SchemaRevision } from "@/lib/schema";
import type { SchemaOption, UsersSearch, UsersSort } from "@/lib/user-list";

/**
 * The Users list's controls on the title row: a schema by object type, one
 * revision of it, and the order by revision (#1669, #2502). Filtering and
 * sorting are separate controls. The revision filter stays in view, disabled
 * until a schema is chosen. The sort is opt-in, so a new user stays on top
 * until someone asks for revision order, and it is disabled once one
 * revision is chosen, since every row is then on it.
 *
 * Nothing here counts users: the API has no total, by design. A value the URL
 * carries that no option matches (a deleted schema, an unreadable history)
 * still shows on its trigger, so the filter can be cleared.
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
        onChange={(schema) => onChange({ schema, sort: search.sort })}
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
          search.revision && (
            <>
              <span className="truncate" title={search.revision}>
                {shortRevisionId(search.revision)}
              </span>
              <RevisionBadges revisions={revisions} id={search.revision} />
            </>
          )
        }
        disabled={!search.schema}
        // One revision has no order, so choosing one drops the sort.
        onChange={(next) =>
          onChange({
            schema: search.schema,
            revision: next,
            ...(next ? {} : { sort: search.sort }),
          })
        }
        menuClassName={REVISION_MENU}
      >
        <RevisionItems revisions={revisions} />
      </FilterSelect>
      {/* Unset, the list keeps the server's order, newest users first, and the
          trigger names what it would sort by rather than an order it does
          not apply. */}
      <Select
        value={search.sort ?? ""}
        onValueChange={(value) => onChange({ ...search, sort: value as UsersSort })}
        disabled={Boolean(search.revision)}
      >
        <SelectTrigger
          aria-label="Sort by revision"
          className={`${CONTROL} data-[placeholder]:text-foreground`}
        >
          <SelectValue placeholder="Sort by revision" />
        </SelectTrigger>
        <SelectContent position="popper" align="end">
          <SelectItem value="latest">Sort by latest</SelectItem>
          <SelectItem value="oldest">Sort by oldest</SelectItem>
        </SelectContent>
      </Select>
    </>
  );
}

/** The design's 36px outline control: 10px inset, 6px gaps inside and out, medium label. */
const CONTROL = "max-w-full min-w-0 gap-1.5 px-2.5 font-medium *:data-[slot=select-value]:gap-1.5";

/**
 * One filter: `+ Label` while unset, `× Label value` once set, where the
 * cross clears it. The cross is a button of its own laid over the trigger's
 * leading icon, since a button cannot sit inside the trigger.
 */
function FilterSelect({
  label,
  name,
  value,
  display,
  disabled,
  onChange,
  menuClassName,
  children,
}: {
  label: string;
  /** What the filter narrows by, in the controls' accessible names. */
  name: string;
  value: string | undefined;
  display: ReactNode;
  disabled?: boolean;
  onChange: (value: string | undefined) => void;
  menuClassName?: string;
  children: ReactNode;
}) {
  const Glyph = value ? X : Plus;
  return (
    <div className="relative min-w-0">
      <Select value={value ?? ""} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger
          aria-label={`Filter by ${name}`}
          // A filter has no chevron: the leading plus or cross is its glyph.
          // Unset, the label is the placeholder, in the foreground colour.
          className={`${CONTROL} data-[placeholder]:text-foreground [&>svg:last-child]:hidden`}
        >
          <Glyph aria-hidden className="text-foreground" />
          <SelectValue placeholder={label}>
            <span className="text-muted-foreground">{label}</span>
            {display}
          </SelectValue>
        </SelectTrigger>
        <SelectContent position="popper" align="end" className={menuClassName}>
          {children}
        </SelectContent>
      </Select>
      {value && (
        <button
          type="button"
          aria-label={`Clear the ${name} filter`}
          className="absolute top-1/2 left-1.5 size-6 -translate-y-1/2 rounded-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          onClick={() => onChange(undefined)}
        />
      )}
    </div>
  );
}
