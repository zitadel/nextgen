import type { ListEvents200DataItem, ListEventsParams } from "@zitadel/api/generated/model";

/**
 * One event, as `GET /events` and `GET /events/{id}` return it: an
 * append-only record of something that happened in a project, a sign-in
 * step, a change to a record or an API request. The API calls them events;
 * the sidebar calls their screen Logs.
 */
export type LogEvent = ListEvents200DataItem;

/**
 * What an event is about, for the one line a list row has: the request an
 * API call made, or the record a change touched. `undefined` when the event
 * names no record.
 *
 * A request's `route` is the operation it ran (`createUser`): the server
 * records that rather than the path, which would carry resource ids.
 */
export type EventSubject =
  | { kind: "request"; method: string; route: string; status: number }
  | { kind: "record"; type: string; id?: string };

export function eventSubject(event: LogEvent): EventSubject | undefined {
  if (event.event_type === "request.api") {
    const { method, route_template: route, status } = event.payload;
    return { kind: "request", method, route, status };
  }
  if (!event.entity_type) return undefined;
  return { kind: "record", type: event.entity_type, id: event.entity_id || undefined };
}

/** One labelled value of an event's envelope. */
export interface EventField {
  label: string;
  value: string;
  /** An identifier: drawn in the code face, with a copy button. */
  id?: boolean;
}

/**
 * The envelope values an event carries, in reading order: who, through what,
 * on what, and the ids that tie it to other events. A value the event does
 * not carry has no row, since the server stores an unset one as empty or
 * `null` and neither says anything.
 */
export function eventFields(event: LogEvent): EventField[] {
  const fields: (Omit<EventField, "value"> & { value: string | null | undefined })[] = [
    { label: "Category", value: event.category },
    { label: "Actor", value: event.actor_id, id: true },
    { label: "Actor type", value: event.actor_type },
    { label: "Application", value: event.client_id, id: true },
    { label: "Token", value: event.token_id, id: true },
    { label: "Delegation", value: event.delegation_type },
    { label: "Delegation ID", value: event.delegation_id, id: true },
    { label: "Granted by", value: event.grantor, id: true },
    { label: "Resource type", value: event.entity_type },
    { label: "Resource ID", value: event.entity_id, id: true },
    { label: "Team", value: event.team_id, id: true },
    { label: "Request ID", value: event.request_id, id: true },
    { label: "Session ID", value: event.session_id, id: true },
    { label: "Flow ID", value: event.flow_id, id: true },
    { label: "Device", value: event.fingerprint, id: true },
  ];
  return fields.filter((field): field is EventField => Boolean(field.value));
}

/**
 * The list's three views. The server keeps two kinds of event: the changes
 * and sign-ins it writes with what they record, which are the project's audit
 * events, and one per API request, written in batches and dropped under load.
 * `audit` leaves the requests out, since every screen that is opened adds
 * some; `requests` is them alone; `all` reads both together, as following one
 * request through its changes needs.
 */
export const LOG_VIEWS = ["audit", "requests", "all"] as const;
export type LogView = (typeof LOG_VIEWS)[number];

/** What the views call themselves on their tabs. */
export const VIEW_LABEL: Record<LogView, string> = {
  audit: "Audit events",
  requests: "API requests",
  all: "All",
};

/**
 * The audit categories a list can be narrowed to, as the API names them
 * (`category`). `signal` is an audit category too, and the audit view reads
 * it, but nothing writes one yet, so it is not offered to narrow to.
 */
export const AUDIT_CATEGORIES = ["auth", "session", "admin", "entity"] as const;
export type AuditCategory = (typeof AUDIT_CATEGORIES)[number];

/** Every category the audit view reads: all but `request`. */
const AUDIT_VIEW_CATEGORIES = [...AUDIT_CATEGORIES, "signal"] as const;

/**
 * The filters that narrow by one value the event carries. They are set from
 * an event (a row's menu, the event's page), not typed: the value is an id
 * nobody knows by heart. `name` is what the value is called in a sentence:
 * "Only this request", "Clear the request filter".
 *
 * These three, the category and the views are every filter the list offers,
 * because they are the ones an index serves on the server. `GET /events`
 * also filters by type, actor and resource, but reads every event of the
 * project to do it, so the console does not send those until they have an
 * index of their own.
 */
export const VALUE_FILTERS = [
  { key: "request", label: "Request", name: "request" },
  { key: "session", label: "Session", name: "session" },
  { key: "flow", label: "Flow", name: "login flow" },
] as const;
export type ValueFilter = (typeof VALUE_FILTERS)[number];
export type ValueFilterKey = ValueFilter["key"];

/** The value of an event each filter matches. */
const EVENT_VALUE: Record<ValueFilterKey, (event: LogEvent) => string | null | undefined> = {
  request: (event) => event.request_id,
  session: (event) => event.session_id,
  flow: (event) => event.flow_id,
};

/** The filters an event can set, each with the value it carries; none for a value it lacks. */
export function eventFilterValues(event: LogEvent): { filter: ValueFilter; value: string }[] {
  return VALUE_FILTERS.flatMap((filter) => {
    const value = EVENT_VALUE[filter.key](event);
    return value ? [{ filter, value }] : [];
  });
}

/**
 * The list's filters, as the URL holds them: they are server-side, so they
 * belong to the request the loader makes, are linkable and survive a reload.
 */
export type LogsSearch = { view: LogView; category?: AuditCategory } & Partial<
  Record<ValueFilterKey, string>
>;

/**
 * The filters a URL may carry. Anything else is dropped rather than sent:
 * an unknown view is the default one, and a category has no say among the
 * requests, which are one category themselves.
 */
export function parseLogsSearch(search: Record<string, unknown>): LogsSearch {
  const view = LOG_VIEWS.find((known) => known === search.view) ?? "audit";
  const category =
    view === "requests" ? undefined : AUDIT_CATEGORIES.find((known) => known === search.category);
  // Every key, even unset: the router lays this over the raw search, so a key
  // left out would keep the URL's value.
  const parsed: LogsSearch = { view, category };
  for (const { key } of VALUE_FILTERS) {
    const value = search[key];
    parsed[key] = typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
  }
  return parsed;
}

/** Whether anything narrows the view beyond its tab. */
export function isNarrowed(search: LogsSearch): boolean {
  return Boolean(search.category) || VALUE_FILTERS.some(({ key }) => search[key]);
}

/** What `GET /events` is asked for under these filters. */
export function eventsQuery(
  search: LogsSearch,
): Pick<ListEventsParams, "category" | "request_id" | "session_id" | "flow_id"> {
  const category: ListEventsParams["category"] =
    search.view === "requests"
      ? ["request"]
      : search.category
        ? [search.category]
        : search.view === "audit"
          ? [...AUDIT_VIEW_CATEGORIES]
          : undefined;
  return {
    category,
    request_id: search.request,
    session_id: search.session,
    flow_id: search.flow,
  };
}

/**
 * The list narrowed by one more value, on top of what already narrows it.
 * Following a request, a session or a login flow reads every view: each ties
 * audit events to the API requests behind them, and a request's own event is
 * not an audit event.
 */
export function narrowedBy(current: LogsSearch, key: ValueFilterKey, value: string): LogsSearch {
  return { ...current, view: "all", [key]: value };
}

/**
 * The list of everything that shares one value with an event, in every view
 * and under no other filter: where the event's page leads on to.
 */
export function sharing(key: ValueFilterKey, value: string): LogsSearch {
  return { view: "all", [key]: value };
}
