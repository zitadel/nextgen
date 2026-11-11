import { Link, useMatch, useNavigate } from "@tanstack/react-router";
import { ArrowLeftRight, CornerDownLeft, Logs, type LucideIcon, ScrollText, X } from "lucide-react";
import { type ReactNode, useId, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Combobox,
  ComboboxAnchor,
  ComboboxContent,
  type ComboboxGroup,
  ComboboxPlaceholder,
  ComboboxTrigger,
  ComboboxValue,
} from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

import {
  AUDIT_CATEGORIES,
  type AuditCategory,
  EVENT_TYPES,
  FAILURE_TYPES,
  hasCustomRange,
  isNarrowed,
  LOG_VIEWS,
  type LogsSearch,
  type LogView,
  narrowedBy,
  parseLogsSearch,
  TIME_RANGE_LABEL,
  TIME_RANGES,
  type TimeRange,
  VALUE_FILTERS,
  type ValueFilter,
  VIEW_LABEL,
  withCategory,
  withCustomRange,
  withTimeRange,
  withTypes,
  withView,
} from "../model";

/**
 * The Logs list of the sidebar (D30): what the shell shows in place of the
 * project's screens on `/events` and on an event's page, as Vercel's Logs
 * does. Its rows are the list's views, and under them sit the list's filters.
 *
 * Both read the filters from the URL and write them back to it, so the list's
 * loader is the only thing that asks the server. An event's drawer opens over
 * the list and keeps its filters: a view or a filter chosen while it is open
 * closes it and narrows the list.
 */

/** The filters the list is under, or the default ones away from the list. */
function useLogsSearch(): { current: LogsSearch; onList: boolean } {
  const list = useMatch({ from: "/_authed/events", shouldThrow: false });
  return { current: list ? list.search : NO_FILTERS, onList: !!list };
}

const NO_FILTERS = parseLogsSearch({});

/** A glyph per view, which is all the icon rail shows of it. */
const VIEW_ICON: Record<LogView, LucideIcon> = {
  audit: ScrollText,
  requests: ArrowLeftRight,
  all: Logs,
};

/**
 * The views as rows of the sidebar's menu: the audit events, the API
 * requests, and both. The view the list is in is the marked row.
 */
export function LogViewRows() {
  const { current, onList } = useLogsSearch();
  return LOG_VIEWS.map((view) => {
    const Icon = VIEW_ICON[view];
    const label = VIEW_LABEL[view];
    return (
      <SidebarMenuItem key={view}>
        <SidebarMenuButton asChild isActive={onList && current.view === view} tooltip={label}>
          <Link to="/events" search={withView(current, view)} title={label}>
            <Icon aria-hidden />
            <span>{label}</span>
          </Link>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  });
}

/** `Select` cannot hold an empty value, so "no choice" has a name of its own. */
const ANY = "any";

/**
 * The list's filters, under the views. The time range and the category are
 * chosen from the few values there are. The rest match one value an event
 * carries, typed or pasted: the API has no list of the values a project
 * holds, and no count of the events behind one, so none is drawn.
 *
 * The icon rail has no room for a field: the group leaves with the labels,
 * and the screen's own button opens the sidebar to reach it.
 */
export function LogFilters() {
  const { current } = useLogsSearch();
  const navigate = useNavigate();
  const go = (search: LogsSearch) => void navigate({ to: "/events", search });

  return (
    <SidebarGroup
      role="group"
      aria-label="Filters"
      className="pt-4 group-data-[collapsible=icon]:hidden"
    >
      <SidebarGroupLabel>Filters</SidebarGroupLabel>
      <SidebarGroupContent className="flex flex-col gap-3 px-2 pb-2">
        <TimeFilter current={current} go={go} />

        {/* The requests are one category themselves. */}
        {current.view !== "requests" && (
          <Field label="Category">
            {(labelId) => (
              <Select
                value={current.category ?? ANY}
                onValueChange={(category) =>
                  go(
                    withCategory(
                      current,
                      category === ANY ? undefined : (category as AuditCategory),
                    ),
                  )
                }
              >
                <SelectTrigger size="sm" aria-labelledby={labelId} className={CONTROL}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>Any category</SelectItem>
                  {AUDIT_CATEGORIES.map((category) => (
                    // The API's own value, capitalised.
                    <SelectItem key={category} value={category} className="capitalize">
                      {category}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Field>
        )}

        <TypeFilter current={current} go={go} />

        {VALUE_FILTERS.map((filter) =>
          filter.key === "type" ? null : (
            <ValueField
              key={filter.key}
              filter={filter}
              value={current[filter.key]}
              onCommit={(value) => go(narrowedBy(current, filter.key, value))}
            />
          ),
        )}

        {isNarrowed(current) && (
          <Button
            variant="ghost"
            size="sm"
            className="self-start px-2 text-xs"
            onClick={() => go({ view: current.view })}
          >
            Clear filters
          </Button>
        )}
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

/** The Timeline's value for a range with fixed ends. */
const CUSTOM = "custom";

/**
 * The time the list reads: a range counted back from when it loads, as
 * Vercel's Logs offers them, everything retained, or a range with fixed ends.
 * Choosing **Custom range** opens two fields, applied together.
 */
function TimeFilter({ current, go }: { current: LogsSearch; go: (search: LogsSearch) => void }) {
  const custom = hasCustomRange(current);
  const [editing, setEditing] = useState(false);
  const value = custom || editing ? CUSTOM : (current.since ?? ANY);

  return (
    <>
      <Field label="Timeline">
        {(labelId) => (
          <Select
            value={value}
            onValueChange={(choice) => {
              if (choice === CUSTOM) {
                setEditing(true);
                return;
              }
              setEditing(false);
              go(withTimeRange(current, choice === ANY ? undefined : (choice as TimeRange)));
            }}
          >
            <SelectTrigger size="sm" aria-labelledby={labelId} className={CONTROL}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Everything retained</SelectItem>
              {TIME_RANGES.map((range) => (
                <SelectItem key={range} value={range}>
                  {TIME_RANGE_LABEL[range]}
                </SelectItem>
              ))}
              <SelectItem value={CUSTOM}>Custom range</SelectItem>
            </SelectContent>
          </Select>
        )}
      </Field>
      {(custom || editing) && (
        <CustomRange
          // A range set elsewhere (a row's "Events around this one") refills the fields.
          key={`${current.from ?? ""}/${current.to ?? ""}`}
          from={current.from}
          to={current.to}
          onApply={(from, to) => {
            setEditing(false);
            go(withCustomRange(current, from, to));
          }}
        />
      )}
    </>
  );
}

/** `2026-11-10T08:15:00.000Z` as a `datetime-local` field holds it: the viewer's local time, to the minute. */
function localInput(value: string | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** A `datetime-local` value, in the viewer's time zone, as an RFC 3339 moment; empty is open. */
function fromLocalInput(value: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/**
 * A range with fixed ends, in the viewer's local time: from, to, or both. A
 * new range starts at the last hour, so Apply alone reads something. A start
 * that is not before the end cannot be applied.
 */
function CustomRange({
  from,
  to,
  onApply,
}: {
  from: string | undefined;
  to: string | undefined;
  onApply: (from: string | undefined, to: string | undefined) => void;
}) {
  const fresh = !from && !to;
  const [start, setStart] = useState(() =>
    localInput(fresh ? new Date(Date.now() - 60 * 60 * 1000).toISOString() : from),
  );
  const [end, setEnd] = useState(() => localInput(fresh ? new Date().toISOString() : to));
  const startAt = fromLocalInput(start);
  const endAt = fromLocalInput(end);
  const valid = (startAt || endAt) && !(startAt && endAt && startAt >= endAt);
  const fromId = useId();
  const toId = useId();

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (valid) onApply(startAt, endAt);
      }}
    >
      <label htmlFor={fromId} className={FIELD_LABEL}>
        From
      </label>
      <Input
        id={fromId}
        type="datetime-local"
        value={start}
        onChange={(event) => setStart(event.target.value)}
        className="h-8 text-xs md:text-xs"
      />
      <label htmlFor={toId} className={FIELD_LABEL}>
        To
      </label>
      <Input
        id={toId}
        type="datetime-local"
        value={end}
        onChange={(event) => setEnd(event.target.value)}
        className="h-8 text-xs md:text-xs"
      />
      <Button type="submit" size="sm" variant="secondary" disabled={!valid} className="self-start">
        Apply range
      </Button>
    </form>
  );
}

/** The type list's captions: the first word of a type, as `auth` in `auth.check.failed`. */
const TYPE_GROUPS: ComboboxGroup[] = EVENT_TYPES.reduce<ComboboxGroup[]>((groups, type) => {
  const heading = type.split(".")[0] ?? type;
  const option = { value: type, label: type };
  const last = groups.at(-1);
  if (last?.heading === heading) last.options.push(option);
  else groups.push({ heading, options: [option] });
  return groups;
}, []);

/**
 * The event types the list is narrowed to, chosen from the types the server
 * writes rather than typed: several at once, each one range of the type
 * index, so any choice fills its pages. **Only failures** chooses the failure
 * types. Types read the All view with no category beside them.
 */
function TypeFilter({ current, go }: { current: LogsSearch; go: (search: LogsSearch) => void }) {
  const [open, setOpen] = useState(false);
  const chosen = current.type ?? [];
  const failuresOnly =
    chosen.length === FAILURE_TYPES.length && FAILURE_TYPES.every((type) => chosen.includes(type));
  const toggle = (type: string) =>
    go(
      withTypes(
        current,
        chosen.includes(type) ? chosen.filter((known) => known !== type) : [...chosen, type],
      ),
    );

  return (
    <Field label="Type">
      {() => (
        <div className="flex flex-col gap-1.5">
          <Combobox open={open} onOpenChange={setOpen}>
            <ComboboxAnchor asChild>
              <ComboboxTrigger
                label="Event types"
                open={open}
                onOpen={() => setOpen(true)}
                className="h-8 w-full text-xs"
              >
                {chosen.length === 0 ? (
                  <ComboboxPlaceholder>Any type</ComboboxPlaceholder>
                ) : (
                  <ComboboxValue>
                    {failuresOnly
                      ? "Failures"
                      : chosen.length === 1
                        ? chosen[0]
                        : `${chosen.length} types`}
                  </ComboboxValue>
                )}
              </ComboboxTrigger>
            </ComboboxAnchor>
            <ComboboxContent
              groups={TYPE_GROUPS}
              selected={chosen}
              searchPlaceholder="Find a type"
              emptyLabel="No type matches."
              label="Event types"
              closeOnSelect={false}
              onSelect={toggle}
              onClose={() => setOpen(false)}
              footer={
                chosen.length > 0
                  ? { label: "Any type", onSelect: () => go(withTypes(current, [])) }
                  : undefined
              }
              className="w-64"
            />
          </Combobox>
          {!failuresOnly && (
            <Button
              variant="ghost"
              size="sm"
              className="self-start px-2 text-xs"
              onClick={() => go(withTypes(current, FAILURE_TYPES))}
            >
              Only failures
            </Button>
          )}
        </div>
      )}
    </Field>
  );
}

/** A filter's control at the sidebar's width: 32px tall, 12px text. */
const CONTROL = "w-full text-xs";

/** One filter: its name over its control. The sidebar renders twice on a phone, so ids are per instance. */
function Field({ label, children }: { label: string; children: (labelId: string) => ReactNode }) {
  const labelId = useId();
  return (
    <div className="flex flex-col gap-1">
      <span id={labelId} className={FIELD_LABEL}>
        {label}
      </span>
      {children(labelId)}
    </div>
  );
}

const FIELD_LABEL = "text-xs leading-4 text-muted-foreground";

/**
 * A filter by one value: a field that is typed or pasted into. The value is
 * matched whole, so it is applied when the person says it is complete, with
 * Enter or the field's button, never as they type. While it is applied the
 * button clears it.
 */
function ValueField({
  filter,
  value,
  onCommit,
}: {
  filter: ValueFilter;
  /** The value the list is narrowed to. */
  value: string | undefined;
  onCommit: (value: string | undefined) => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState(value ?? "");
  // The URL holds the filter: a value set or cleared anywhere else (a row's
  // menu, the search, another filter it gives way to) replaces what was typed.
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    setDraft(value ?? "");
  }
  const typed = draft.trim();
  const pending = typed !== (value ?? "");

  return (
    <form
      className="flex flex-col gap-1"
      onSubmit={(event) => {
        event.preventDefault();
        if (pending) onCommit(typed || undefined);
      }}
    >
      <label htmlFor={id} className={FIELD_LABEL}>
        {filter.label}
      </label>
      <div className="relative">
        <Input
          id={id}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={filter.placeholder}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          className="h-8 pr-8 text-xs md:text-xs"
        />
        {pending && typed ? (
          <button
            type="submit"
            aria-label={`Apply the ${filter.name} filter`}
            className={FIELD_BUTTON}
          >
            <CornerDownLeft aria-hidden className="size-3.5" />
          </button>
        ) : (
          value && (
            <button
              type="button"
              aria-label={`Clear the ${filter.name} filter`}
              className={FIELD_BUTTON}
              onClick={() => onCommit(undefined)}
            >
              <X aria-hidden className="size-3.5" />
            </button>
          )
        )}
      </div>
    </form>
  );
}

/** The button inside a field's trailing edge: 24px around a 14px glyph. */
const FIELD_BUTTON =
  "text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 absolute top-1/2 right-1 flex size-6 -translate-y-1/2 items-center justify-center rounded-sm outline-none focus-visible:ring-[3px]";
