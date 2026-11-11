import { Link, useMatch, useNavigate } from "@tanstack/react-router";
import {
  ArrowLeftRight,
  Check,
  ChevronsUpDown,
  Logs,
  type LucideIcon,
  ScrollText,
} from "lucide-react";
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
  FAILED_STATUS,
  FAILURE_TYPES,
  hasCustomRange,
  isNarrowed,
  STATUS_CLASSES,
  type StatusClass,
  LOG_VIEWS,
  type LogsSearch,
  type LogView,
  parseLogsSearch,
  TIME_RANGE_LABEL,
  TIME_RANGES,
  type TimeRange,
  VIEW_DESCRIPTION,
  VIEW_LABEL,
  withCategory,
  withCustomRange,
  withStatus,
  withTimeRange,
  withTypes,
  withView,
} from "../model";

/**
 * The Logs list of the sidebar (D30): what the shell shows in place of the
 * project's screens on `/events` and under an event's drawer, as Vercel's Logs
 * does. A picker chooses the list's view, and under it sit the filters chosen
 * from a list: the time, the category, the type or the status. Values that
 * are pasted, the ids and the operation, go in the search above the table
 * (`LogSearchField`).
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
 * The list's view, chosen from a menu as Vercel's Logs chooses its kind of
 * log: each view by its glyph, its name and what it holds, the one the list
 * is in checked. The trigger names that view; in the icon rail it is its
 * glyph alone.
 */
export function LogViewPicker() {
  const { current } = useLogsSearch();
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
          {LOG_VIEWS.map((view) => {
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

/**
 * The list's filters, under the view: the time range, and the category and
 * the type, or the requests' status, each chosen from the values there are.
 * A value that is pasted is the search's. The API has no count of the events
 * behind a value, so none is drawn.
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
      {/* The group's name, a step above its fields' labels: at one size the
          heading read as the first of them. Clearing is the group's action,
          so it sits on the heading. */}
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
      <SidebarGroupContent className="flex flex-col gap-4 px-2 pb-2">
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
                <SelectTrigger aria-labelledby={labelId} className={CONTROL}>
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

        {/* A request is one type: the requests narrow by status instead. */}
        {current.view === "requests" ? (
          <StatusFilter current={current} go={go} />
        ) : (
          <TypeFilter current={current} go={go} />
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
        className={CONTROL}
      />
      <label htmlFor={toId} className={FIELD_LABEL}>
        To
      </label>
      <Input
        id={toId}
        type="datetime-local"
        value={end}
        onChange={(event) => setEnd(event.target.value)}
        className={CONTROL}
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
function TypeFilter({ current, go }: { current: LogsSearch; go: (search: LogsSearch) => void }) {
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
    <Field label="Type">
      {() => (
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
      )}
    </Field>
  );
}

/** What a status class means, beside it in the list. */
const STATUS_MEANING: Record<StatusClass, string> = {
  "2xx": "Succeeded",
  "3xx": "Redirected",
  "4xx": "Refused: the caller's mistake",
  "5xx": "Failed: the server's error",
};

/** The list's first row, which is no class: it stands for the failed ones. */
const FAILED = "preset:failed";

/** As the type list: the shortcut heads the classes it ticks. */
const STATUS_LIST: ComboboxGroup[] = [
  {
    ruled: true,
    options: [
      {
        value: FAILED,
        label: "Only failed requests",
        description: FAILED_STATUS.join(", "),
        chip: "destructive",
      },
    ],
  },
  {
    options: STATUS_CLASSES.map((status) => ({
      value: status,
      label: status,
      description: STATUS_MEANING[status],
    })),
  },
];

/**
 * The API requests narrowed by the class of their response status, several
 * at once: one range of the status index each, so any choice fills its pages.
 * **Only failed requests**, the list's first row, ticks 4xx and 5xx. Requests recorded before the
 * server indexed the status are not matched.
 */
function StatusFilter({ current, go }: { current: LogsSearch; go: (search: LogsSearch) => void }) {
  const [open, setOpen] = useState(false);
  const chosen = current.status ?? [];
  const failedOnly =
    chosen.length === FAILED_STATUS.length &&
    FAILED_STATUS.every((status) => chosen.includes(status));
  const toggle = (status: string) => {
    if (status === FAILED) return go(withStatus(current, failedOnly ? [] : FAILED_STATUS));
    const known = STATUS_CLASSES.find((candidate) => candidate === status);
    if (!known) return;
    go(
      withStatus(
        current,
        chosen.includes(known) ? chosen.filter((other) => other !== known) : [...chosen, known],
      ),
    );
  };

  return (
    <Field label="Status">
      {() => (
        <Combobox open={open} onOpenChange={setOpen}>
          <ComboboxAnchor asChild>
            <ComboboxTrigger
              label="Status classes"
              open={open}
              onOpen={() => setOpen(true)}
              className={CONTROL}
            >
              {chosen.length === 0 ? (
                <ComboboxPlaceholder>Any status</ComboboxPlaceholder>
              ) : (
                <ComboboxValue>
                  {failedOnly ? "Only failed requests" : chosen.join(", ")}
                </ComboboxValue>
              )}
            </ComboboxTrigger>
          </ComboboxAnchor>
          <ComboboxContent
            groups={STATUS_LIST}
            selected={failedOnly ? [FAILED, ...chosen] : chosen}
            searchPlaceholder="Find a status"
            emptyLabel="No status matches."
            label="Status classes"
            closeOnSelect={false}
            onSelect={toggle}
            onClose={() => setOpen(false)}
            footer={
              chosen.length > 0
                ? { label: "Any status", onSelect: () => go(withStatus(current, [])) }
                : undefined
            }
            className="w-64"
          />
        </Combobox>
      )}
    </Field>
  );
}

/** A filter's control: the sidebar's width, and its rows' 36px and 14px. */
const CONTROL = "h-9 w-full text-sm md:text-sm";

/** One filter: its name over its control. The sidebar renders twice on a phone, so ids are per instance. */
function Field({ label, children }: { label: string; children: (labelId: string) => ReactNode }) {
  const labelId = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <span id={labelId} className={FIELD_LABEL}>
        {label}
      </span>
      {children(labelId)}
    </div>
  );
}

const FIELD_LABEL = "text-xs leading-4 text-muted-foreground";
