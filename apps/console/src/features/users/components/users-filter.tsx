import { Plus, X } from "lucide-react";
import { type ReactNode, useRef } from "react";

import {
  REVISION_MENU,
  REVISION_TRIGGER,
  RevisionItems,
  RevisionValue,
} from "@/features/schemas/components/revision-select";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

/** The design's 36px outline control: 10px inset, 6px gaps inside and out, medium label. */
const CONTROL = `${REVISION_TRIGGER} px-2.5 font-medium`;

/**
 * One filter: `+ Label` while unset, `× Label value` once set, where the
 * cross clears it. The cross is a button of its own laid over the trigger's
 * leading icon, since a button cannot sit inside the trigger. It comes first
 * in the DOM, as it is drawn, and hands focus to the trigger once it clears.
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
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <div className="relative min-w-0">
      {value && (
        <button
          type="button"
          aria-label={`Clear the ${name} filter`}
          className="absolute top-1/2 left-1.5 z-10 size-6 -translate-y-1/2 rounded-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          onClick={() => {
            onChange(undefined);
            trigger.current?.focus();
          }}
        />
      )}
      <Select value={value ?? ""} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger
          ref={trigger}
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
    </div>
  );
}
