import { Link, useMatch, useNavigate } from "@tanstack/react-router";
import {
  ArrowLeftRight,
  Check,
  ChevronRight,
  ChevronsUpDown,
  Logs,
  LogIn,
  type LucideIcon,
  ScrollText,
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useId, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Combobox,
  ComboboxAnchor,
  ComboboxContent,
  type ComboboxGroup,
  ComboboxPlaceholder,
  ComboboxTrigger,
  ComboboxValue,
} from "@/components/ui/combobox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
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
  STATUS_CLASSES,
  type StatusClass,
  EVENT_VIEWS,
  type EventsSearch,
  type EventView,
  parseEventsSearch,
  SIGNIN_OUTCOME_LABEL,
  SIGNIN_OUTCOMES,
  type SigninOutcome,
  TIME_RANGE_LABEL,
  TIME_RANGES,
  type TimeRange,
  VIEW_DESCRIPTION,
  VIEW_LABEL,
  withCategory,
  withCustomRange,
  withOutcome,
  withStatus,
  withTimeRange,
  withTypes,
  withView,
} from "../model";

/**
 * The Events list of the sidebar (D30): what the shell shows in place of the
 * project's screens on `/events` and under an event's drawer, as Vercel's Logs
 * does. A picker chooses the list's view, and under it sit the filters chosen
 * from a list, each a group that folds away as Vercel's are: the time, and
 * the categories, the type, the statuses or how a sign-in ended. Values that
 * are pasted, the ids and the operation, go in the search above the table
 * (`EventSearchField`).
 *
 * Both read the filters from the URL and write them back to it, so the list's
 * loader is the only thing that asks the server. An event's drawer opens over
 * the list and keeps its filters: a view or a filter chosen while it is open
 * closes it and narrows the list.
 */

/** The filters the list is under, or the default ones away from the list. */
function useEventsSearch(): { current: EventsSearch; onList: boolean } {
  const list = useMatch({ from: "/_authed/events", shouldThrow: false });
  return { current: list ? list.search : NO_FILTERS, onList: !!list };
}

const NO_FILTERS = parseEventsSearch({});

/** A glyph per view, which is all the icon rail shows of it. */
const VIEW_ICON: Record<EventView, LucideIcon> = {
  audit: ScrollText,
  signins: LogIn,
  requests: ArrowLeftRight,
  all: Logs,
};

/**
 * The list's view, chosen from a menu as Vercel's Logs chooses its kind of
 * log: each view by its glyph, its name and what it holds, the one the list
 * is in checked. The trigger names that view; in the icon rail it is its
 * glyph alone.
 */
export function EventViewPicker() {
  const { current } = useEventsSearch();
  const Icon = VIEW_ICON[current.view];

  return (
    <SidebarMenuItem className="mt-1">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuButton
            // The sidebar's outlined row, as search above it: one width, one
            // radius, one height.
            variant="outline"
            tooltip={`View: ${VIEW_LABEL[current.view]}`}
            aria-label={`View: ${VIEW_LABEL[current.view]}`}
          >
            <Icon aria-hidden />
            <span className="flex-1">{VIEW_LABEL[current.view]}</span>
            <ChevronsUpDown aria-hidden className="text-muted-foreground ml-auto size-3.5!" />
          </SidebarMenuButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="bottom" className="w-72">
          {EVENT_VIEWS.map((view) => {
            const ViewIcon = VIEW_ICON[view];
            const chosen = current.view === view;
            return (
              // The router marks the view the list is in `aria-current="page"`.
              <DropdownMenuItem key={view} asChild className="items-start gap-3 py-2">
                <Link to="/events" search={withView(current, view)}>
                  <ViewIcon aria-hidden className="mt-0.5" />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-sm">{VIEW_LABEL[view]}</span>
                    <span className="text-muted-foreground text-xs">{VIEW_DESCRIPTION[view]}</span>
                  </span>
                  {chosen && <Check aria-hidden className="mt-0.5" />}
                </Link>
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  );
}

/** `Select` cannot hold an empty value, so "no choice" has a name of its own. */
const ANY = "any";

/** One value of a short list, as a row of its group. */
interface CheckOption<T extends string> {
  value: T;
  label: string;
  /** What the value means, in the row's last place, where Vercel draws a count. */
  note?: string;
  /** A dot in the tone the list's rows give the value: the colour of a failure. */
  dot?: string;
}

/** The API's own values, capitalised. */
const CATEGORY_OPTIONS: CheckOption<AuditCategory>[] = AUDIT_CATEGORIES.map((category) => ({
  value: category,
  label: category.charAt(0).toUpperCase() + category.slice(1),
}));

const NEUTRAL_DOT = "bg-muted-foreground/60";

const OUTCOME_OPTIONS: CheckOption<SigninOutcome>[] = SIGNIN_OUTCOMES.map((outcome) => ({
  value: outcome,
  label: SIGNIN_OUTCOME_LABEL[outcome],
  dot: outcome === "failed" ? "bg-destructive" : NEUTRAL_DOT,
}));

/** What a status class means, beside it in the list. */
const STATUS_MEANING: Record<StatusClass, string> = {
  "2xx": "Succeeded",
  "3xx": "Redirected",
  "4xx": "Refused",
  "5xx": "Failed",
};

/** The dots of a request's status in the rows: the caller's mistake, the server's error. */
const STATUS_DOT: Record<StatusClass, string> = {
  "2xx": NEUTRAL_DOT,
  "3xx": NEUTRAL_DOT,
  "4xx": "bg-warning",
  "5xx": "bg-destructive",
};

const STATUS_OPTIONS: CheckOption<StatusClass>[] = STATUS_CLASSES.map((status) => ({
  value: status,
  label: status,
  note: STATUS_MEANING[status],
  dot: STATUS_DOT[status],
}));

/**
 * The list's filters, under the view, as Vercel's Logs draws its own: one
 * group a filter, which folds away under its name. The time is a range chosen
 * from a list. A filter of a few values (the categories, how a sign-in ended,
 * a request's status classes) shows them all as checkboxes, several at once,
 * each one range of an index; the types, some fifty, are found in a list.
 * A value that is pasted is the search's. The API has no count of the events
 * behind a value, so none is drawn where Vercel draws one.
 *
 * The icon rail has no room for a field: the group leaves with the labels,
 * and the screen's own button opens the sidebar to reach it.
 */
export function EventFilters() {
  const { current } = useEventsSearch();
  const navigate = useNavigate();
  const go = (search: EventsSearch) => void navigate({ to: "/events", search });

  return (
    <SidebarGroup
      role="group"
      aria-label="Filters"
      className="pt-4 group-data-[collapsible=icon]:hidden"
    >
      {/* The group's name, a step above its filters' names. Clearing is the
          group's action, so it sits on the heading. */}
      <div className="flex h-9 items-center justify-between pr-1 pl-2">
        <SidebarGroupLabel className="text-sidebar-foreground h-auto px-0 text-sm">
          Filters
        </SidebarGroupLabel>
        {isNarrowed(current) && (
          <Button
            variant="ghost"
            size="sm"
            aria-label="Clear filters"
            className="text-muted-foreground h-7 px-2 text-xs"
            onClick={() => go({ view: current.view })}
          >
            Clear
          </Button>
        )}
      </div>
      <SidebarGroupContent className="flex flex-col px-2 pb-2">
        <FilterGroup label="Timeline" set={current.since || hasCustomRange(current) ? 1 : 0}>
          {(labelId) => <TimeFilter current={current} go={go} labelId={labelId} />}
        </FilterGroup>

        {/* The requests are one category themselves, and the sign-ins their
            own types. */}
        {current.view === "signins" && (
          <FilterGroup label="Outcome" set={current.outcome?.length ?? 0}>
            {(labelId) => (
              <CheckList
                labelId={labelId}
                options={OUTCOME_OPTIONS}
                chosen={current.outcome ?? []}
                onChange={(outcomes) => go(withOutcome(current, outcomes))}
              />
            )}
          </FilterGroup>
        )}
        {current.view !== "requests" && current.view !== "signins" && (
          <FilterGroup label="Category" set={current.category?.length ?? 0}>
            {(labelId) => (
              <CheckList
                labelId={labelId}
                options={CATEGORY_OPTIONS}
                chosen={current.category ?? []}
                onChange={(categories) => go(withCategory(current, categories))}
              />
            )}
          </FilterGroup>
        )}

        {/* A request is one type: the requests narrow by status instead.
            Requests recorded before the server indexed the status are not
            matched. */}
        {current.view === "requests" ? (
          <FilterGroup label="Status" set={current.status?.length ?? 0}>
            {(labelId) => (
              <CheckList
                labelId={labelId}
                options={STATUS_OPTIONS}
                chosen={current.status ?? []}
                onChange={(classes) => go(withStatus(current, classes))}
              />
            )}
          </FilterGroup>
        ) : (
          current.view !== "signins" && (
            <FilterGroup label="Type" set={current.type?.length ?? 0}>
              {() => <TypeFilter current={current} go={go} />}
            </FilterGroup>
          )
        )}
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

/**
 * One filter: its name, which folds its control away, over the control. Open
 * until it is folded; folded over a value that is set, the name says how many
 * are, so a filter never narrows the list unseen. The sidebar renders twice on
 * a phone, so ids are per instance.
 */
function FilterGroup({
  label,
  set,
  children,
}: {
  label: string;
  /** How many values the filter holds. */
  set: number;
  children: (labelId: string) => ReactNode;
}) {
  const labelId = useId();
  const [open, setOpen] = useState(true);
  return (
    <Collapsible open={open} onOpenChange={setOpen} role="group" aria-labelledby={labelId}>
      <CollapsibleTrigger
        // Folded over a value, the name says so: the parts would run together.
        aria-label={!open && set > 0 ? `${label}, ${set} set` : undefined}
        className={cn(
          "text-sidebar-foreground hover:bg-sidebar-accent group/filter -mx-1 flex h-9 w-[calc(100%+--spacing(2))] items-center gap-2 rounded-md px-1 text-left text-sm font-medium outline-none",
          "focus-visible:ring-ring/50 focus-visible:ring-[3px]",
        )}
      >
        <ChevronRight
          aria-hidden
          strokeWidth={1.5}
          className="text-muted-foreground size-4 shrink-0 transition-transform group-data-[state=open]/filter:rotate-90 motion-reduce:transition-none"
        />
        <span id={labelId} className="flex-1">
          {label}
        </span>
        {!open && set > 0 && (
          <Badge variant="secondary" aria-hidden>
            {set}
          </Badge>
        )}
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-1 pb-3">{children(labelId)}</CollapsibleContent>
    </Collapsible>
  );
}

/**
 * A filter of a few values, all of them in sight: a box a value, any number
 * ticked, none meaning every one. As Vercel's Level and Status lists, less
 * the count.
 */
function CheckList<T extends string>({
  labelId,
  options,
  chosen,
  onChange,
}: {
  labelId: string;
  options: readonly CheckOption<T>[];
  chosen: readonly T[];
  onChange: (chosen: T[]) => void;
}) {
  const id = useId();
  return (
    <ul
      aria-labelledby={labelId}
      className="border-input bg-background dark:bg-input/30 divide-border divide-y rounded-md border"
    >
      {options.map((option) => {
        const checked = chosen.includes(option.value);
        return (
          <li key={option.value}>
            <label
              htmlFor={`${id}-${option.value}`}
              className="flex h-9 cursor-pointer items-center gap-2.5 px-2.5 text-sm"
            >
              <Checkbox
                id={`${id}-${option.value}`}
                checked={checked}
                onCheckedChange={() =>
                  onChange(
                    checked
                      ? chosen.filter((value) => value !== option.value)
                      : [...chosen, option.value],
                  )
                }
              />
              {option.dot && (
                <span aria-hidden className={cn("size-2 shrink-0 rounded-full", option.dot)} />
              )}
              <span className="text-foreground min-w-0 flex-1 truncate">{option.label}</span>
              {option.note && (
                <span className="text-muted-foreground shrink-0 text-xs">{option.note}</span>
              )}
            </label>
          </li>
        );
      })}
    </ul>
  );
}

/** The Timeline's value for a range with fixed ends. */
const CUSTOM = "custom";

/**
 * The time the list reads: a range counted back from when it loads, as
 * Vercel's Logs offers them, everything retained, or a range with fixed ends.
 * Choosing **Custom range** opens two fields, read as they are changed.
 */
function TimeFilter({
  current,
  go,
  labelId,
}: {
  current: EventsSearch;
  go: (search: EventsSearch) => void;
  /** The group's name, which names the list. */
  labelId: string;
}) {
  const custom = hasCustomRange(current);
  const [editing, setEditing] = useState(false);
  const value = custom || editing ? CUSTOM : (current.since ?? ANY);

  return (
    <div className="flex flex-col gap-3">
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
        <SelectTrigger aria-labelledby={labelId} className={CONTROL}>
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
      {(custom || editing) && (
        <CustomRange
          from={current.from}
          to={current.to}
          onApply={(from, to) => {
            setEditing(false);
            go(withCustomRange(current, from, to));
          }}
        />
      )}
    </div>
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

/** How long the fields rest before the range they hold is read. */
const RANGE_PAUSE_MS = 600;

/**
 * A range with fixed ends, in the viewer's local time: from, to, or both. A
 * new range starts at the last hour. It is read as it is changed, after a
 * pause, as every other filter is on being chosen; Enter reads it at once. A
 * start that is not before the end is not read, and says so.
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
  // Only what the person set is read: a range from elsewhere carries seconds
  // the fields do not show, and reading the fields back would round it.
  const [edited, setEdited] = useState(fresh);
  const startAt = fromLocalInput(start);
  const endAt = fromLocalInput(end);
  const backwards = !!startAt && !!endAt && startAt >= endAt;
  const valid = (startAt || endAt) && !backwards;
  const fromId = useId();
  const toId = useId();

  // A range set elsewhere (a row's "Events around this one") refills the
  // fields; the one these fields sent is theirs already, and typing goes on.
  const sent = useRef<{ from?: string; to?: string }>(undefined);
  const [seen, setSeen] = useState({ from, to });
  if (seen.from !== from || seen.to !== to) {
    setSeen({ from, to });
    if (sent.current?.from !== from || sent.current?.to !== to) {
      setStart(localInput(from));
      setEnd(localInput(to));
      setEdited(false);
    }
  }

  const apply = useRef(onApply);
  apply.current = onApply;
  const read = useCallback(() => {
    sent.current = { from: startAt, to: endAt };
    apply.current(startAt, endAt);
  }, [startAt, endAt]);
  const pending = edited && valid && (startAt !== from || endAt !== to);
  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(read, RANGE_PAUSE_MS);
    return () => clearTimeout(timer);
  }, [pending, read]);

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (pending) read();
      }}
    >
      <label htmlFor={fromId} className={FIELD_LABEL}>
        From
      </label>
      <Input
        id={fromId}
        type="datetime-local"
        value={start}
        aria-invalid={backwards || undefined}
        onChange={(event) => {
          setStart(event.target.value);
          setEdited(true);
        }}
        className={CONTROL}
      />
      <label htmlFor={toId} className={FIELD_LABEL}>
        To
      </label>
      <Input
        id={toId}
        type="datetime-local"
        value={end}
        aria-invalid={backwards || undefined}
        onChange={(event) => {
          setEnd(event.target.value);
          setEdited(true);
        }}
        className={CONTROL}
      />
      {backwards && (
        <p role="alert" className="text-destructive text-xs leading-4">
          The start must be before the end.
        </p>
      )}
      {/* Enter in a field submits only through a submit control. */}
      <button type="submit" hidden />
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

/** The list's first row, which is no type: it stands for all the failure types. */
const FAILURES = "preset:failures";

/**
 * The shortcut heads the list it ticks, so what it chose shows beneath it. A
 * chip in the failures' own tint over a rule, with no caption: under one it
 * read as one more prefix of the types (`auth`, `user`).
 */
const TYPE_LIST: ComboboxGroup[] = [
  {
    ruled: true,
    options: [
      {
        value: FAILURES,
        label: "Only failures",
        description: `${FAILURE_TYPES.length} types`,
        chip: "destructive",
      },
    ],
  },
  ...TYPE_GROUPS,
];

/**
 * The event types the list is narrowed to, chosen from the types the server
 * writes rather than typed: several at once, each one range of the type
 * index, so any choice fills its pages. **Only failures**, the list's first
 * row, ticks the failure types in the list under it, and unticks them again:
 * a button outside the list set the same types without showing that it had.
 * Types read the All view with no category beside them.
 */
function TypeFilter({
  current,
  go,
}: {
  current: EventsSearch;
  go: (search: EventsSearch) => void;
}) {
  const [open, setOpen] = useState(false);
  const chosen = current.type ?? [];
  const failuresOnly =
    chosen.length === FAILURE_TYPES.length && FAILURE_TYPES.every((type) => chosen.includes(type));
  const toggle = (type: string) => {
    if (type === FAILURES) return go(withTypes(current, failuresOnly ? [] : FAILURE_TYPES));
    go(
      withTypes(
        current,
        chosen.includes(type) ? chosen.filter((known) => known !== type) : [...chosen, type],
      ),
    );
  };

  return (
    <Combobox open={open} onOpenChange={setOpen}>
      <ComboboxAnchor asChild>
        <ComboboxTrigger
          label="Event types"
          open={open}
          onOpen={() => setOpen(true)}
          className={CONTROL}
        >
          {chosen.length === 0 ? (
            <ComboboxPlaceholder>Any type</ComboboxPlaceholder>
          ) : (
            <ComboboxValue>
              {failuresOnly
                ? "Only failures"
                : chosen.length === 1
                  ? chosen[0]
                  : `${chosen.length} types`}
            </ComboboxValue>
          )}
        </ComboboxTrigger>
      </ComboboxAnchor>
      <ComboboxContent
        groups={TYPE_LIST}
        selected={failuresOnly ? [FAILURES, ...chosen] : chosen}
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
  );
}

/** A filter's control: the sidebar's width, and its rows' 36px and 14px. */
const CONTROL = "h-9 w-full text-sm md:text-sm";

/** A custom range's field names, under the group's. */
const FIELD_LABEL = "text-xs leading-4 text-muted-foreground";
