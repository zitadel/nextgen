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

/** What the views call themselves in the Logs list of the sidebar. */
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
 * How far back the list reads, in hours: the last hour, day or week. Unset,
 * it reads everything the server still retains.
 */
export const TIME_RANGES = ["1h", "24h", "7d"] as const;
export type TimeRange = (typeof TIME_RANGES)[number];

export const TIME_RANGE_LABEL: Record<TimeRange, string> = {
  "1h": "Last hour",
  "24h": "Last 24 hours",
  "7d": "Last 7 days",
};

const TIME_RANGE_HOURS: Record<TimeRange, number> = { "1h": 1, "24h": 24, "7d": 168 };

/**
 * The moment a time range starts at, as `created_after` takes it. A list
 * computes it once when it loads and sends the same moment with every further
 * page: a range that moved between pages would drop the rows it slid past.
 */
export function rangeStart(range: TimeRange | undefined, now: Date): string | undefined {
  if (!range) return undefined;
  return new Date(now.getTime() - TIME_RANGE_HOURS[range] * 60 * 60 * 1000).toISOString();
}

/**
 * The filters that narrow by one value the event carries: typed or pasted
 * into the Logs list of the sidebar or the search above the table, or set
 * from an event (a row's menu, the event's page). `name` is what the value is
 * called in a sentence: "Only this actor", "Clear the actor filter".
 *
 * These, the category, the time range and the views are every filter the
 * list offers, because they are the ones an index serves on the server.
 */
export const VALUE_FILTERS = [
  { key: "type", label: "Type", name: "type", placeholder: "user.created" },
  { key: "actor", label: "Actor", name: "actor", placeholder: "user_…" },
  { key: "resource", label: "Resource", name: "resource", placeholder: "user_…, team_…" },
  { key: "request", label: "Request", name: "request", placeholder: "req_…" },
  { key: "session", label: "Session", name: "session", placeholder: "sess_…" },
  { key: "flow", label: "Login flow", name: "login flow", placeholder: "flow_…" },
] as const;
export type ValueFilter = (typeof VALUE_FILTERS)[number];
export type ValueFilterKey = ValueFilter["key"];

const FILTER_BY_KEY = Object.fromEntries(VALUE_FILTERS.map((filter) => [filter.key, filter])) as {
  [K in ValueFilterKey]: Extract<ValueFilter, { key: K }>;
};

/** The value of an event each filter matches. */
const EVENT_VALUE: Record<ValueFilterKey, (event: LogEvent) => string | null | undefined> = {
  type: (event) => event.event_type,
  actor: (event) => event.actor_id,
  resource: (event) => event.entity_id,
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
export type LogsSearch = { view: LogView; category?: AuditCategory; since?: TimeRange } & Partial<
  Record<ValueFilterKey, string>
>;

/**
 * Filters brought to a combination an index serves on the server, in order
 * and a page at a time. Every way into a list goes through here (the URL, a
 * click, the request itself), so no combination that would read every event
 * of the project can be asked for:
 *
 * - A type is a category of its own and has its own index, which holds no
 *   category and no actor. So a type reads the All view, and takes neither a
 *   category nor an actor beside it.
 * - The requests are one category themselves, so they take no other.
 *
 * Everything else combines: an actor with any view and category, and a
 * request, session, login flow or resource with anything, since each of those
 * holds few events. The time range bounds every one of them.
 */
export function servedSearch(search: LogsSearch): LogsSearch {
  if (search.type) {
    return { ...search, view: "all", category: undefined, actor: undefined };
  }
  if (search.view === "requests") return { ...search, category: undefined };
  return search;
}

/**
 * The filters a URL may carry. Anything else is dropped rather than sent: an
 * unknown view is the default one, and what does not combine gives way
 * ({@link servedSearch}).
 */
export function parseLogsSearch(search: Record<string, unknown>): LogsSearch {
  // Every key, even unset: the router lays this over the raw search, so a key
  // left out would keep the URL's value.
  const parsed: LogsSearch = {
    view: LOG_VIEWS.find((known) => known === search.view) ?? "audit",
    category: AUDIT_CATEGORIES.find((known) => known === search.category),
    since: TIME_RANGES.find((known) => known === search.since),
  };
  for (const { key } of VALUE_FILTERS) {
    const value = search[key];
    parsed[key] = typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
  }
  return servedSearch(parsed);
}

/** How many filters narrow the view beyond the view itself. */
export function filterCount(search: LogsSearch): number {
  return (
    Number(Boolean(search.category)) +
    Number(Boolean(search.since)) +
    VALUE_FILTERS.filter(({ key }) => search[key]).length
  );
}

/** Whether anything narrows the view beyond the view itself. */
export function isNarrowed(search: LogsSearch): boolean {
  return filterCount(search) > 0;
}

/**
 * What `GET /events` is asked for under these filters. `createdAfter` is the
 * start of the time range, which the list computed when it loaded
 * ({@link rangeStart}).
 */
export function eventsQuery(
  search: LogsSearch,
  createdAfter?: string,
): Pick<
  ListEventsParams,
  | "category"
  | "event_type"
  | "actor_id"
  | "entity_id"
  | "request_id"
  | "session_id"
  | "flow_id"
  | "created_after"
> {
  const served = servedSearch(search);
  const category: ListEventsParams["category"] =
    served.view === "requests"
      ? ["request"]
      : served.category
        ? [served.category]
        : served.view === "audit"
          ? [...AUDIT_VIEW_CATEGORIES]
          : undefined;
  return {
    category,
    event_type: served.type ? [served.type] : undefined,
    actor_id: served.actor,
    entity_id: served.resource,
    request_id: served.request,
    session_id: served.session,
    flow_id: served.flow,
    created_after: createdAfter,
  };
}

/** The list in another view. Only the All view holds a type. */
export function withView(current: LogsSearch, view: LogView): LogsSearch {
  return servedSearch({ ...current, view, type: view === "all" ? current.type : undefined });
}

/** The list narrowed to one category, or to none. A category takes no type beside it. */
export function withCategory(current: LogsSearch, category: AuditCategory | undefined): LogsSearch {
  return servedSearch({ ...current, category, type: category ? undefined : current.type });
}

/** The list over another time range, or over everything retained. */
export function withTimeRange(current: LogsSearch, since: TimeRange | undefined): LogsSearch {
  return { ...current, since };
}

/**
 * The list with one value filter set, on top of what already narrows it, or
 * cleared when `value` is empty.
 *
 * - An actor and a resource keep the view and the category: "what did this
 *   person change" is the audit view by one actor, "what happened to this
 *   user" the audit view by one resource. An actor replaces a type, which it
 *   does not combine with.
 * - A request, a session and a login flow read every view: they tie audit
 *   events to the API requests behind them, and a request's own event is not
 *   an audit event.
 * - A type reads every view too, with no category and no actor beside it
 *   ({@link servedSearch}).
 */
export function narrowedBy(
  current: LogsSearch,
  key: ValueFilterKey,
  value: string | undefined,
): LogsSearch {
  if (!value) return { ...current, [key]: undefined };
  if (key === "actor") return servedSearch({ ...current, type: undefined, actor: value });
  if (key === "resource") return servedSearch({ ...current, resource: value });
  return servedSearch({ ...current, view: "all", [key]: value });
}

/**
 * The list of everything that shares one value with an event, in every view
 * and under no other filter: where the event's page leads on to.
 */
export function sharing(key: ValueFilterKey, value: string): LogsSearch {
  return { view: "all", [key]: value };
}

/** What a pasted or typed term can mean to the list. */
export type SearchMeaning =
  | { kind: "event"; id: string }
  | { kind: "filter"; filter: ValueFilter; value: string };

/** An event type: lowercase words joined by dots, as `auth.check.failed`. */
const EVENT_TYPE = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/;
/** A request id as a W3C trace id: 32 hex digits. */
const TRACE_ID = /^[0-9a-f]{32}$/i;

/**
 * What a term in the search above the table means: the filters it could set,
 * or the event it names. The list is searched by exact value on a field the
 * server indexes, never by text, so a term is read by its shape:
 *
 * - `evt_…` is an event, and opens it.
 * - `req_…` (or a 32-digit trace id), `sess_…` and `flow_…` are a request, a
 *   session and a login flow.
 * - Words joined by dots are an event type.
 * - Any other id may be who did something or what it was done to, so it
 *   means both an actor and a resource, and the person says which.
 *
 * A term with a space in it, or none, means nothing.
 */
export function searchMeanings(term: string): SearchMeaning[] {
  const value = term.trim();
  if (!value || /\s/.test(value)) return [];
  const filter = (key: ValueFilterKey): SearchMeaning => ({
    kind: "filter",
    filter: FILTER_BY_KEY[key],
    value,
  });
  if (value.startsWith("evt_")) return [{ kind: "event", id: value }];
  if (value.startsWith("req_") || TRACE_ID.test(value)) return [filter("request")];
  if (value.startsWith("sess_")) return [filter("session")];
  if (value.startsWith("flow_")) return [filter("flow")];
  if (EVENT_TYPE.test(value)) return [filter("type")];
  return [filter("actor"), filter("resource")];
}
