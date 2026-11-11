import type { ListEvents200DataItem, ListEventsParams } from "@zitadel/api/generated/model";

/**
 * One event, as `GET /events` and `GET /events/{id}` return it: an
 * append-only record of something that happened in a project, a sign-in
 * step, a change to a record or an API request. The API calls them events;
 * the sidebar calls their screen Logs.
 */
export type LogEvent = ListEvents200DataItem;

/** What Logs' audit view, and Overview's card of it, say of a project with none. */
export const NO_AUDIT_EVENTS = "This project has no audit events.";

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
interface EventField {
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

/** What each view holds, under its name in the view picker. */
export const VIEW_DESCRIPTION: Record<LogView, string> = {
  audit: "Sign-ins and changes to the project",
  requests: "One per call to the API",
  all: "Both, in the order they happened",
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
 * How far back the list reads, counted back from when it loads: Vercel's
 * Logs offers the same steps. Unset, it reads everything the server still
 * retains. A range with both ends set is `from` and `to` instead
 * ({@link LogsSearch}).
 */
export const TIME_RANGES = ["30m", "1h", "12h", "24h", "3d", "7d", "14d"] as const;
export type TimeRange = (typeof TIME_RANGES)[number];

export const TIME_RANGE_LABEL: Record<TimeRange, string> = {
  "30m": "Last 30 minutes",
  "1h": "Last hour",
  "12h": "Last 12 hours",
  "24h": "Last 24 hours",
  "3d": "Last 3 days",
  "7d": "Last 7 days",
  "14d": "Last 14 days",
};

const MINUTE_MS = 60 * 1000;
const TIME_RANGE_MINUTES: Record<TimeRange, number> = {
  "30m": 30,
  "1h": 60,
  "12h": 12 * 60,
  "24h": 24 * 60,
  "3d": 3 * 24 * 60,
  "7d": 7 * 24 * 60,
  "14d": 14 * 24 * 60,
};

/**
 * The moment a time range starts at, as `created_after` takes it. A list
 * computes it once when it loads and sends the same moment with every further
 * page: a range that moved between pages would drop the rows it slid past.
 */
export function rangeStart(range: TimeRange | undefined, now: Date): string | undefined {
  if (!range) return undefined;
  return new Date(now.getTime() - TIME_RANGE_MINUTES[range] * MINUTE_MS).toISOString();
}

/** How far either side of an event "Events around this one" reads. */
export const AROUND_MINUTES = 5;

/**
 * Everything the project recorded in the minutes either side of an event,
 * under no other filter: what else happened then. The bounds are on
 * `created_at`, the time the server filters by.
 */
export function around(event: Pick<LogEvent, "created_at">): LogsSearch {
  const at = new Date(event.created_at).getTime();
  return {
    view: "all",
    from: new Date(at - AROUND_MINUTES * MINUTE_MS).toISOString(),
    to: new Date(at + AROUND_MINUTES * MINUTE_MS).toISOString(),
  };
}

/**
 * The event types the server writes, as `GET /events` names them, to choose
 * from rather than type. The compiler holds the list to the API's: a type the
 * spec adds and this list lacks fails `console:typecheck`.
 */
export const EVENT_TYPES = [
  "auth.attempt.created",
  "auth.attempt.handed_off",
  "auth.check.failed",
  "auth.check.succeeded",
  "auth.factor.passkey.enrolled",
  "auth.factor.password.set",
  "auth.sso.authorization.failed",
  "auth.sso.exchange.failed",
  "auth.sso.exchange.succeeded",
  "auth.token.issued",
  "auth.token.revoked",
  "authz.granted",
  "authz.revoked",
  "branding.created",
  "deployment.created",
  "flowdef.created",
  "flowdef.deleted",
  "flowdef.updated",
  "idp.created",
  "idp.identity_link.created",
  "idp.updated",
  "origin.added",
  "origin.removed",
  "policy.created",
  "policy.updated",
  "preview.removed",
  "project.created",
  "project.deleted",
  "project.updated",
  "release.created",
  "release.revoked",
  "request.api",
  "schema.created",
  "session.deleted",
  "session.established",
  "team.created",
  "team.deactivated",
  "team.updated",
  "user.create.failed",
  "user.created",
  "user.deleted",
  "user.updated",
  "variable.removed",
  "variable.set",
] as const satisfies readonly LogEvent["event_type"][];

// Fails to compile while the API knows a type the list above lacks.
const EVERY_EVENT_TYPE: [Exclude<LogEvent["event_type"], (typeof EVENT_TYPES)[number]>] extends [
  never,
]
  ? true
  : never = true;
void EVERY_EVENT_TYPE;

/**
 * The types that record something failing: a sign-in check or a single
 * sign-on step that did not pass, a user that could not be created. Each is
 * one range of the type index, so the preset fills its pages.
 */
export const FAILURE_TYPES: readonly string[] = EVENT_TYPES.filter((type) =>
  /\.failed$/.test(type),
);

/** Whether an event records a failure: a failure type, or a request the server answered with 5xx. */
export function isFailure(event: LogEvent): boolean {
  if (FAILURE_TYPES.includes(event.event_type)) return true;
  return event.event_type === "request.api" && event.payload.status >= 500;
}

/**
 * The filters that narrow by one value the event carries: typed or pasted
 * into the Logs list of the sidebar or the search above the table, or set
 * from an event (a row's menu, the event's panel). `name` is what the value
 * is called in a sentence: "Only this actor", "Clear the actor filter".
 *
 * The type is chosen from {@link EVENT_TYPES} rather than typed, and the list
 * takes several at once (`LogsSearch.type`); the others hold one value each.
 * Any of them combine: what no index holds is matched under the server's scan
 * budget (root ADR 048), and the list says when a page stopped short.
 */
export const VALUE_FILTERS = [
  { key: "type", label: "Type", name: "type", prefix: "type" },
  { key: "actor", label: "Actor", name: "actor", prefix: "actor" },
  { key: "resource", label: "Resource", name: "resource", prefix: "resource" },
  { key: "resource_type", label: "Resource type", name: "resource type", prefix: "resource_type" },
  { key: "client", label: "Application", name: "application", prefix: "app" },
  { key: "operation", label: "Operation", name: "operation", prefix: "operation" },
  { key: "request", label: "Request", name: "request", prefix: "request" },
  { key: "session", label: "Session", name: "session", prefix: "session" },
  { key: "flow", label: "Login flow", name: "login flow", prefix: "flow" },
  { key: "device", label: "Device", name: "device", prefix: "device" },
] as const;
export type ValueFilter = (typeof VALUE_FILTERS)[number];
type ValueFilterKey = ValueFilter["key"];
/** The filters that hold one value each: all but the type. */
type IdFilterKey = Exclude<ValueFilterKey, "type">;

const FILTER_BY_KEY = Object.fromEntries(VALUE_FILTERS.map((filter) => [filter.key, filter])) as {
  [K in ValueFilterKey]: Extract<ValueFilter, { key: K }>;
};

/** The value of an event each filter matches. */
const EVENT_VALUE: Record<ValueFilterKey, (event: LogEvent) => string | null | undefined> = {
  type: (event) => event.event_type,
  actor: (event) => event.actor_id,
  resource: (event) => event.entity_id,
  resource_type: (event) => event.entity_type,
  client: (event) => event.client_id,
  operation: (event) =>
    event.event_type === "request.api" ? event.payload.operation_id || undefined : undefined,
  request: (event) => event.request_id,
  session: (event) => event.session_id,
  flow: (event) => event.flow_id,
  device: (event) => event.fingerprint,
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
 *
 * The time is either `since`, counted back from when the list loads, or a
 * range with fixed ends, `from` and `to` (RFC 3339, either may be open);
 * never both.
 */
export type LogsSearch = {
  view: LogView;
  category?: AuditCategory;
  since?: TimeRange;
  from?: string;
  to?: string;
  type?: string[];
  status?: StatusClass[];
} & Partial<Record<IdFilterKey, string>>;

/**
 * The classes of an API request's response status the requests can be
 * narrowed to, as the API names them (`status_class`). `1xx` is the API's too,
 * but the server answers no request with one.
 */
export const STATUS_CLASSES = ["2xx", "3xx", "4xx", "5xx"] as const;
export type StatusClass = (typeof STATUS_CLASSES)[number];

/** The failed requests: the caller's mistakes and the server's. */
export const FAILED_STATUS: readonly StatusClass[] = ["4xx", "5xx"];

/** Whether the list is narrowed by what only an API request carries: its operation or its status. */
function byRequest(search: LogsSearch): boolean {
  return Boolean(search.operation || search.status?.length);
}

/**
 * Filters brought to a combination that means something. The server bounds
 * every read (root ADR 048): what no single index holds is matched over a
 * fixed number of events a request, and the page says when it stopped short.
 * So the list refuses no combination, and only these give way, on every way
 * into a list (the URL, a click, the request itself):
 *
 * - An operation and a status class are an API request's, so they read the
 *   API requests view, with no category or type beside them.
 * - A type names its own category, so it reads the All view and takes no
 *   category beside it. That also keeps types on their own one range of
 *   their index each, which always fills its pages.
 * - The requests are one category themselves, so they take no other.
 * - A range with fixed ends replaces one counted back from now.
 *
 * Everything else combines: the ids with each other, with types, with any
 * view and with a category.
 */
export function servedSearch(search: LogsSearch): LogsSearch {
  const time = search.from || search.to ? { ...search, since: undefined } : search;
  if (byRequest(time)) return { ...time, view: "requests", category: undefined, type: undefined };
  if (time.type?.length) return { ...time, view: "all", category: undefined };
  if (time.view === "requests") return { ...time, category: undefined };
  return time;
}

/** An RFC 3339 moment, normalised; anything unparseable is no bound at all. */
function moment(value: unknown): string | undefined {
  if (typeof value !== "string" || value.trim() === "") return undefined;
  const parsed = new Date(value.trim());
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

/** An event type: lowercase words joined by dots, as `auth.check.failed`. */
const EVENT_TYPE = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/;

/**
 * The types a URL names: one (`?type=user.created`, as links made before the
 * list took several still read) or several. A type the console does not know
 * yet is kept if it has a type's shape: the server may write it already.
 */
function eventTypes(value: unknown): string[] | undefined {
  const values = Array.isArray(value) ? value : [value];
  const types = values
    .filter((type): type is string => typeof type === "string")
    .map((type) => type.trim())
    .filter((type) => EVENT_TYPE.test(type));
  return types.length > 0 ? [...new Set(types)] : undefined;
}

/** The status classes a URL names, once each, in their order; any other value is dropped. */
function statusClasses(value: unknown): StatusClass[] | undefined {
  const values = Array.isArray(value) ? value : [value];
  const classes = STATUS_CLASSES.filter((known) => values.includes(known));
  return classes.length > 0 ? classes : undefined;
}

/**
 * The filters a URL may carry. Anything else is dropped rather than sent: an
 * unknown view is the default one, a range whose start is not before its end
 * is no range, and what does not combine gives way ({@link servedSearch}).
 */
export function parseLogsSearch(search: Record<string, unknown>): LogsSearch {
  let from = moment(search.from);
  let to = moment(search.to);
  if (from && to && from >= to) {
    from = undefined;
    to = undefined;
  }
  // Every key, even unset: the router lays this over the raw search, so a key
  // left out would keep the URL's value.
  const parsed: LogsSearch = {
    view: LOG_VIEWS.find((known) => known === search.view) ?? "audit",
    category: AUDIT_CATEGORIES.find((known) => known === search.category),
    since: TIME_RANGES.find((known) => known === search.since),
    from,
    to,
    type: eventTypes(search.type),
    status: statusClasses(search.status),
  };
  for (const { key } of VALUE_FILTERS) {
    if (key === "type") continue;
    const value = search[key];
    parsed[key] = typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
  }
  return servedSearch(parsed);
}

/** Whether the list reads a range with fixed ends rather than one counted back from now. */
export function hasCustomRange(search: LogsSearch): boolean {
  return Boolean(search.from || search.to);
}

/** How many filters narrow the view beyond the view itself; the time is one, however set. */
export function filterCount(search: LogsSearch): number {
  return (
    Number(Boolean(search.category)) +
    Number(Boolean(search.since) || hasCustomRange(search)) +
    Number(Boolean(search.status?.length)) +
    VALUE_FILTERS.filter(({ key }) => (key === "type" ? search.type?.length : search[key])).length
  );
}

/** Whether anything narrows the view beyond the view itself. */
export function isNarrowed(search: LogsSearch): boolean {
  return filterCount(search) > 0;
}

/** Whether the list is narrowed to exactly this value already, so setting it would narrow no further. */
export function isNarrowedTo(search: LogsSearch, key: ValueFilterKey, value: string): boolean {
  if (key === "type") return search.type?.length === 1 && search.type[0] === value;
  return search[key] === value;
}

/**
 * What `GET /events` is asked for under these filters. `createdAfter` is the
 * start of a time range counted back from now, which the list computed when
 * it loaded ({@link rangeStart}); a range with fixed ends brings its own.
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
  | "entity_type"
  | "client_id"
  | "request_id"
  | "session_id"
  | "flow_id"
  | "fingerprint"
  | "operation_id"
  | "status_class"
  | "created_after"
  | "created_before"
> {
  const served = servedSearch(search);
  // An operation or a status class matches API requests alone: one range of
  // their own index, with no category to send beside it.
  const category: ListEventsParams["category"] = byRequest(served)
    ? undefined
    : served.view === "requests"
      ? ["request"]
      : served.category
        ? [served.category]
        : served.view === "audit"
          ? [...AUDIT_VIEW_CATEGORIES]
          : undefined;
  return {
    category,
    event_type: served.type,
    actor_id: served.actor,
    entity_id: served.resource,
    entity_type: served.resource_type,
    client_id: served.client,
    request_id: served.request,
    session_id: served.session,
    flow_id: served.flow,
    fingerprint: served.device,
    operation_id: served.operation ? [served.operation] : undefined,
    status_class: served.status,
    created_after: createdAfter ?? served.from,
    created_before: served.to,
  };
}

/** The list in another view. Only the All view holds types, and only the requests' an operation or a status. */
export function withView(current: LogsSearch, view: LogView): LogsSearch {
  return servedSearch({
    ...current,
    view,
    type: view === "all" ? current.type : undefined,
    operation: view === "requests" ? current.operation : undefined,
    status: view === "requests" ? current.status : undefined,
  });
}

/** The list narrowed to one category, or to none. A category takes no type beside it. */
export function withCategory(current: LogsSearch, category: AuditCategory | undefined): LogsSearch {
  return servedSearch({ ...current, category, type: category ? undefined : current.type });
}

/** The list over another time range counted back from now, or over everything retained. */
export function withTimeRange(current: LogsSearch, since: TimeRange | undefined): LogsSearch {
  return { ...current, since, from: undefined, to: undefined };
}

/** The list between two fixed moments; either may be open. */
export function withCustomRange(
  current: LogsSearch,
  from: string | undefined,
  to: string | undefined,
): LogsSearch {
  return servedSearch({ ...current, since: undefined, from: moment(from), to: moment(to) });
}

/**
 * The list narrowed to these event types, or to none. Types read the All view
 * with no category beside them ({@link servedSearch}); clearing them keeps the
 * view they left the list in.
 */
export function withTypes(current: LogsSearch, types: readonly string[]): LogsSearch {
  if (types.length === 0) return { ...current, type: undefined };
  return servedSearch({
    ...current,
    type: [...new Set(types)],
    operation: undefined,
    status: undefined,
  });
}

/**
 * The API requests narrowed to these status classes, or to none. Clearing
 * them keeps the requests view the list is in.
 */
export function withStatus(current: LogsSearch, classes: readonly StatusClass[]): LogsSearch {
  if (classes.length === 0) return { ...current, status: undefined };
  return servedSearch({
    ...current,
    status: STATUS_CLASSES.filter((known) => classes.includes(known)),
  });
}

/**
 * The list with one value filter set, on top of what already narrows it, or
 * cleared when `value` is empty.
 *
 * - An actor, a resource, a resource type, an application and a device keep
 *   the view and the category: "what did this person change" is the audit
 *   view by one actor, "what happened to this user" the audit view by one
 *   resource.
 * - A request, a session and a login flow read every view: they tie audit
 *   events to the API requests behind them, and a request's own event is not
 *   an audit event.
 * - A type reads every view too, with no category beside it, and replaces the
 *   types chosen before ({@link withTypes}).
 */
export function narrowedBy(
  current: LogsSearch,
  key: ValueFilterKey,
  value: string | undefined,
): LogsSearch {
  if (key === "type") return withTypes(current, value ? [value] : []);
  if (!value) return { ...current, [key]: undefined };
  if (key === "request" || key === "session" || key === "flow") {
    return servedSearch({ ...current, view: "all", [key]: value });
  }
  // An operation reads the requests view ({@link servedSearch}).
  return servedSearch({ ...current, [key]: value });
}

/**
 * The list of everything that shares one value with an event, in every view
 * and under no other filter: where the event's panel leads on to.
 */
export function sharing(key: ValueFilterKey, value: string): LogsSearch {
  if (key === "type") return { view: "all", type: [value] };
  if (key === "operation") return { view: "requests", operation: value };
  return { view: "all", [key]: value };
}

/**
 * The filters set by a pasted value, in the order the search draws them as
 * chips: every one but the type, which the sidebar chooses.
 */
export function chipFilters(search: LogsSearch): { filter: ValueFilter; value: string }[] {
  return VALUE_FILTERS.flatMap((filter) => {
    if (filter.key === "type") return [];
    const value = search[filter.key];
    return value ? [{ filter, value }] : [];
  });
}

/** What a pasted or typed term can mean to the list. */
export type SearchMeaning =
  | { kind: "event"; id: string }
  | { kind: "filter"; filter: ValueFilter; value: string };

/** A request id as a W3C trace id: 32 hex digits. */
const TRACE_ID = /^[0-9a-f]{32}$/i;
/** An API operation: one camel-cased word, as `createUser`. IDs carry an underscore. */
const OPERATION = /^[a-z]+(?:[A-Z][a-z0-9]*)+$/;

/** A filter named before its value, as `actor:user_1`. */
const NAMED = /^([a-z_]+):(\S+)$/;
/** The prefixes a term may name a filter by: each filter's own, and `application` for the app. */
const PREFIXES: Record<string, ValueFilterKey> = {
  ...Object.fromEntries(VALUE_FILTERS.map((filter) => [filter.prefix, filter.key])),
  application: "client",
};

/**
 * What a term in the search above the table means: the filters it could set,
 * or the event it names. The list is searched by exact value on a field the
 * server holds, never by text, so a term says which field, or is read by its
 * shape:
 *
 * - `actor:…`, `resource:…`, `resource_type:…`, `app:…`, `device:…` and the
 *   other filters' prefixes ({@link VALUE_FILTERS}) name the filter.
 * - `evt_…` is an event, and opens it.
 * - `req_…` (or a 32-digit trace id), `sess_…`, `flow_…` and `app_…` are a
 *   request, a session, a login flow and an application.
 * - Words joined by dots are an event type, and one camel-cased word, as
 *   `createUser`, is an API operation.
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
  const named = NAMED.exec(value);
  const key = named?.[1] ? PREFIXES[named[1]] : undefined;
  if (named?.[2] && key) return [{ kind: "filter", filter: FILTER_BY_KEY[key], value: named[2] }];
  if (value.startsWith("evt_")) return [{ kind: "event", id: value }];
  if (value.startsWith("req_") || TRACE_ID.test(value)) return [filter("request")];
  if (value.startsWith("sess_")) return [filter("session")];
  if (value.startsWith("flow_")) return [filter("flow")];
  if (value.startsWith("app_")) return [filter("client")];
  if (EVENT_TYPE.test(value)) return [filter("type")];
  if (OPERATION.test(value)) return [filter("operation")];
  return [filter("actor"), filter("resource")];
}

/** One loaded event as a row of the exported CSV, in {@link CSV_COLUMNS}' order. */
const CSV_COLUMNS = [
  ["id", (event: LogEvent) => event.id],
  ["occurred_at", (event: LogEvent) => event.occurred_at],
  ["created_at", (event: LogEvent) => event.created_at],
  ["event_type", (event: LogEvent) => event.event_type],
  ["category", (event: LogEvent) => event.category],
  ["actor_id", (event: LogEvent) => event.actor_id],
  ["actor_type", (event: LogEvent) => event.actor_type],
  ["entity_type", (event: LogEvent) => event.entity_type],
  ["entity_id", (event: LogEvent) => event.entity_id],
  ["client_id", (event: LogEvent) => event.client_id],
  ["request_id", (event: LogEvent) => event.request_id],
  ["session_id", (event: LogEvent) => event.session_id],
  ["flow_id", (event: LogEvent) => event.flow_id],
  ["fingerprint", (event: LogEvent) => event.fingerprint],
  ["payload", (event: LogEvent) => JSON.stringify(event.payload)],
] as const;

/** A CSV field, quoted when it holds a comma, a quote or a line break. */
function csvField(value: string | null | undefined): string {
  const text = value ?? "";
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * The loaded events as CSV, one row each under a header: the envelope's
 * values, and the payload as JSON in one field. Only what the list loaded:
 * the API has no export, so a longer log is paged first, or read through the
 * CLI.
 */
export function eventsCsv(events: readonly LogEvent[]): string {
  const header = CSV_COLUMNS.map(([name]) => name).join(",");
  const rows = events.map((event) =>
    CSV_COLUMNS.map(([, read]) => csvField(read(event))).join(","),
  );
  return `${[header, ...rows].join("\r\n")}\r\n`;
}
