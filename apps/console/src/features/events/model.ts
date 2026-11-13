import type { ListEvents200DataItem, ListEventsParams } from "@zitadel/api/generated/model";

/**
 * One event, as `GET /events` and `GET /events/{id}` return it: an
 * append-only record of something that happened in a project, a sign-in
 * step, a change to a record or an API request. The API, the CLI and
 * the console's Events screen all call them events.
 */
export type ProjectEvent = ListEvents200DataItem;

/** What Events' audit view, and Overview's card of it, say of a project with none. */
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

export function eventSubject(event: ProjectEvent): EventSubject | undefined {
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
 * The envelope values an event carries, in reading order: who, whose account,
 * through what, on what, and the ids that tie it to other events. A value the event does
 * not carry has no row, since the server stores an unset one as empty or
 * `null` and neither says anything.
 */
export function eventFields(event: ProjectEvent): EventField[] {
  const fields: (Omit<EventField, "value"> & { value: string | null | undefined })[] = [
    { label: "Category", value: event.category },
    { label: "Actor", value: event.actor_id, id: true },
    { label: "Actor type", value: event.actor_type },
    { label: "User", value: event.user_id, id: true },
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
 * The list's views. The server keeps two kinds of event: the changes
 * and sign-ins it writes with what they record, which are the project's audit
 * events, and one per API request, written in batches and dropped under load.
 * `audit` leaves the requests out, since every screen that is opened adds
 * some; `requests` is them alone; `all` reads both together, as following one
 * request through its changes needs.
 *
 * `signins` lists one row per sign-in, as Vercel's Request Logs list one row
 * per request and its Traces one per trace: the event each sign-in ends in
 * ({@link SIGNIN_OUTCOME_TYPES}), read from the type index, so its pages fill
 * and no sign-in is put together from the rows a page happens to hold. Its
 * steps open with the event, through the login flow they share.
 */
export const EVENT_VIEWS = ["audit", "signins", "requests", "all"] as const;
export type EventView = (typeof EVENT_VIEWS)[number];

/** What the views call themselves in the Events list of the sidebar. */
export const VIEW_LABEL: Record<EventView, string> = {
  audit: "Audit events",
  signins: "Sign-ins",
  requests: "API requests",
  all: "All",
};

/** What each view holds, under its name in the view picker. */
export const VIEW_DESCRIPTION: Record<EventView, string> = {
  audit: "Sign-ins and changes to the project",
  signins: "One row per sign-in, and how it ended",
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
 * Events offers the same steps. Unset, it reads everything the server still
 * retains. A range with both ends set is `from` and `to` instead
 * ({@link EventsSearch}).
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
export function around(event: Pick<ProjectEvent, "created_at">): EventsSearch {
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
  "application.created",
  "application.updated",
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
  "flow.signup_challenge.consumed",
  "flow.signup_challenge.issued",
  "flowdef.created",
  "flowdef.deleted",
  "flowdef.updated",
  "idp.created",
  "idp.identity_link.created",
  "idp.updated",
  "invitation.accepted",
  "invitation.cancelled",
  "invitation.created",
  "invitation.rejected",
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
  "webhook.created",
  "webhook.deleted",
  "webhook.disabled",
  "webhook.secret_rotated",
  "webhook.updated",
] as const satisfies readonly ProjectEvent["event_type"][];

// Fails to compile while the API knows a type the list above lacks.
const EVERY_EVENT_TYPE: [
  Exclude<ProjectEvent["event_type"], (typeof EVENT_TYPES)[number]>,
] extends [never]
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
export function isFailure(event: ProjectEvent): boolean {
  if (FAILURE_TYPES.includes(event.event_type)) return true;
  return event.event_type === "request.api" && event.payload.status >= 500;
}

/**
 * How a sign-in ended, as the Sign-ins view narrows by it: a session that
 * the sign-in gave its user, or a proof or an identity provider's answer that
 * was rejected.
 */
export const SIGNIN_OUTCOMES = ["signed_in", "failed"] as const;
export type SigninOutcome = (typeof SIGNIN_OUTCOMES)[number];

export const SIGNIN_OUTCOME_LABEL: Record<SigninOutcome, string> = {
  signed_in: "Signed in",
  failed: "Failed",
};

/** The event types each outcome is written as: each one range of the type index. */
const OUTCOME_TYPES: Record<SigninOutcome, readonly ProjectEvent["event_type"][]> = {
  signed_in: ["session.established"],
  failed: ["auth.check.failed", "auth.sso.authorization.failed", "auth.sso.exchange.failed"],
};

/** Every type a sign-in ends in: what the Sign-ins view reads. */
export const SIGNIN_OUTCOME_TYPES: readonly string[] = SIGNIN_OUTCOMES.flatMap(
  (outcome) => OUTCOME_TYPES[outcome],
);

/**
 * A check's type as a person reads it. The server writes its enum's name
 * (`Password`, `SSOCallback`); a type the console does not know yet is shown
 * as it is.
 */
const CHECK_LABEL: Record<string, string> = {
  user: "User",
  password: "Password",
  passkey: "Passkey",
  passkeyregistration: "Passkey registration",
  ssocallback: "Single sign-on",
  sso: "Single sign-on",
};

function checkLabel(checkType: string | undefined): string | undefined {
  if (!checkType) return undefined;
  return CHECK_LABEL[checkType.toLowerCase()] ?? checkType;
}

/**
 * One row of the Sign-ins view: how the sign-in ended, whose account it was
 * (`user_id`, or for a session written before the column the user its payload
 * names), and for a failure what failed.
 *
 * `session.established` is also written for a session opened without a user
 * (an anonymous `POST /sessions`): that row is `opened`, not a sign-in, and
 * says so rather than being left out, since the type index cannot tell the
 * two apart.
 */
export interface Signin {
  outcome: SigninOutcome | "opened";
  userId?: string;
  failure?: string;
}

export function signinOf(event: ProjectEvent): Signin | undefined {
  if (event.event_type === "session.established") {
    const userId = event.user_id || event.payload.user_id || undefined;
    return userId ? { outcome: "signed_in", userId } : { outcome: "opened" };
  }
  if (OUTCOME_TYPES.failed.includes(event.event_type)) {
    const check =
      "check_type" in event.payload && typeof event.payload.check_type === "string"
        ? checkLabel(event.payload.check_type)
        : undefined;
    // A user check fails when no account has the identifier: a mistyped
    // address, or the first step of a sign-up, which the server records the
    // same way before it creates the account.
    const failure =
      event.event_type === "auth.check.failed"
        ? check === "User"
          ? "No account matched"
          : check
            ? `${check} check failed`
            : "A check failed"
        : "Single sign-on failed";
    return { outcome: "failed", userId: event.user_id || undefined, failure };
  }
  return undefined;
}

/**
 * How long an authentication attempt lives (the server's `AuthAttemptTTL`):
 * one that has ended nothing by then never will.
 */
export const ATTEMPT_LIFETIME_MS = 15 * MINUTE_MS;

/** What became of a login flow, as its events tell it. */
export type FlowOutcome = "signed_in" | "failed" | "abandoned" | "in_progress";

/**
 * A login flow told from its events, oldest first, for the head of the
 * event's drawer: what it came to, whose account, how the person proved who
 * they were, and how long it took. `complete` is whether the events are all
 * of the flow's; when they are not, only a sign-in is claimed: what is missing
 * could be the success that followed a failure. A flow whose attempt is still
 * alive is in progress, a failure in it included, since the visitor may try
 * again; once it has expired it failed, if anything was refused, or was
 * abandoned.
 */
export interface FlowSummary {
  title: string;
  outcome: FlowOutcome | undefined;
  userId?: string;
  startedAt: string;
  durationMs: number;
}

/** The check types a flow passed, in order, once each; the user check names no proof. */
function flowMethods(events: readonly ProjectEvent[]): string[] {
  const methods = events.flatMap((event) => {
    if (event.event_type === "auth.sso.exchange.succeeded") return ["single sign-on"];
    if (event.event_type !== "auth.check.succeeded") return [];
    const label = checkLabel(event.payload.check_type);
    return label && label !== "User" ? [label.toLowerCase()] : [];
  });
  return [...new Set(methods)];
}

const SPOKEN: Record<string, string> = {
  password: "a password",
  passkey: "a passkey",
  "passkey registration": "a new passkey",
  "single sign-on": "single sign-on",
};

export function flowSummary(
  events: readonly ProjectEvent[],
  { complete, now }: { complete: boolean; now: Date },
): FlowSummary | undefined {
  const first = events[0];
  const last = events.at(-1);
  if (!first || !last) return undefined;
  const signin = events
    .map(signinOf)
    .filter((step): step is Signin => step !== undefined && step.outcome !== "opened");
  const signedIn = signin.find((step) => step.outcome === "signed_in");
  const startedAt = first.occurred_at;
  const durationMs = flowPlaces(events).spanMs;
  const userId =
    signedIn?.userId ??
    [...events].reverse().find((event) => event.user_id)?.user_id ??
    signin.find((step) => step.userId)?.userId;

  let outcome: FlowOutcome | undefined;
  if (signedIn) outcome = "signed_in";
  else if (!complete) outcome = undefined;
  else if (now.getTime() - Date.parse(startedAt) <= ATTEMPT_LIFETIME_MS) outcome = "in_progress";
  else if (signin.length > 0) outcome = "failed";
  else outcome = "abandoned";

  const methods = flowMethods(events).map((method) => SPOKEN[method] ?? method);
  const signedUp = events.some((event) => event.event_type === "user.created");
  const title =
    outcome === "signed_in"
      ? `${signedUp ? "Signed up" : "Signed in"}${methods.length ? ` with ${methods.join(" and ")}` : ""}`
      : outcome === "failed"
        ? "Sign-in failed"
        : outcome === "abandoned"
          ? "Sign-in abandoned"
          : outcome === "in_progress"
            ? "Sign-in in progress"
            : "This login flow";
  return { title, outcome, userId, startedAt, durationMs };
}

/**
 * Where each step of a login flow falls, in milliseconds after its first
 * event, and how long the flow ran. The events one request wrote share the
 * request's first moment: the server stamps its `request.api` event at the
 * request's start and the others as it stores them, so a gap between them is
 * the request's own work, which its `duration_ms` tells, not a wait between
 * steps. The span runs from the first event to where the last request ended.
 */
export interface FlowPlaces {
  offsets: ReadonlyMap<string, number>;
  spanMs: number;
}

export function flowPlaces(events: readonly ProjectEvent[]): FlowPlaces {
  const offsets = new Map<string, number>();
  const at = (event: ProjectEvent) => Date.parse(event.occurred_at);
  if (events.length === 0) return { offsets, spanMs: 0 };
  const start = Math.min(...events.map(at));
  const requestStart = new Map<string, number>();
  for (const event of events) {
    if (!event.request_id) continue;
    const seen = requestStart.get(event.request_id);
    if (seen === undefined || at(event) < seen) requestStart.set(event.request_id, at(event));
  }
  let end = start;
  for (const event of events) {
    const moment = (event.request_id ? requestStart.get(event.request_id) : undefined) ?? at(event);
    offsets.set(event.id, moment - start);
    const took = event.event_type === "request.api" ? event.payload.duration_ms : 0;
    end = Math.max(end, at(event) + took);
  }
  return { offsets, spanMs: end - start };
}

/**
 * Whether the list may lack what a flow went on to write: anything but the
 * view and a start of the time narrows it, or the range ends before now. Then
 * an attempt with nothing after it says nothing about whether it was
 * abandoned.
 */
function hidesSteps(search: EventsSearch): boolean {
  if (search.to) return true;
  const time = Number(Boolean(search.since) || hasCustomRange(search));
  return filterCount(search) - time > 0;
}

/**
 * The steps that end a login flow: the attempt handed off, the session it
 * gave its user, or a proof or a provider's answer refused. A refused flow
 * says so on its own row; one that ends on a step without a user (no account)
 * writes the refused user check.
 */
const ENDING_TYPES: readonly string[] = [
  "auth.attempt.handed_off",
  "session.established",
  ...OUTCOME_TYPES.failed,
];

/**
 * The authentication attempts among the rows that were abandoned: started
 * longer ago than an attempt lives, as of `asOf` (when the list, or Live, last
 * read up to now), in a login flow that never ended: neither handed off, nor
 * given a session, nor refused. The list is newest first, so whatever ended a
 * flow is among the rows already. A flow the visitor left after a step (an
 * address entered) is abandoned too. Under a filter or a range end that could
 * hide the rest of a flow, or in a view without the attempts, none is marked.
 */
export function abandonedAttempts(
  rows: readonly ProjectEvent[],
  search: EventsSearch,
  asOf: Date,
): Set<string> {
  const abandoned = new Set<string>();
  if (search.view === "requests" || search.view === "signins" || hidesSteps(search)) {
    return abandoned;
  }
  const ended = new Set(
    rows
      .filter((row) => row.flow_id && ENDING_TYPES.includes(row.event_type))
      .map((row) => row.flow_id),
  );
  for (const row of rows) {
    if (row.event_type !== "auth.attempt.created" || !row.flow_id) continue;
    if (ended.has(row.flow_id)) continue;
    if (asOf.getTime() - Date.parse(row.occurred_at) <= ATTEMPT_LIFETIME_MS) continue;
    abandoned.add(row.id);
  }
  return abandoned;
}

/** The other loaded rows of an open event's login flow or request, and which of the two ties them. */
export interface Belonging {
  ids: ReadonlySet<string>;
  by?: "login flow" | "request";
}

/**
 * The loaded rows that belong with an open event: its login flow's, or else
 * its request's, as its drawer lists them. Only rows the list holds; the
 * drawer reads the rest.
 */
export function belongingWith(
  rows: readonly ProjectEvent[],
  open: ProjectEvent | undefined,
): Belonging {
  const key: "flow_id" | "request_id" | undefined = open?.flow_id
    ? "flow_id"
    : open?.request_id
      ? "request_id"
      : undefined;
  if (!open || !key) return { ids: new Set() };
  return {
    ids: new Set(
      rows.filter((row) => row.id !== open.id && row[key] === open[key]).map((row) => row.id),
    ),
    by: key === "flow_id" ? "login flow" : "request",
  };
}

/**
 * Events in the order they happened (`occurred_at`), keeping the server's
 * order between events of the same moment. A read of one request or login
 * flow comes back in the order the events were stored, and the API requests
 * are stored in batches, after the changes they made.
 */
export function inOccurrenceOrder(events: readonly ProjectEvent[]): ProjectEvent[] {
  return events
    .map((event, index) => ({ event, index, at: Date.parse(event.occurred_at) }))
    .sort((a, b) => a.at - b.at || a.index - b.index)
    .map(({ event }) => event);
}

/**
 * A span of time as the drawer's timeline writes it: `0 ms`, `29 ms`,
 * `1.5 s`, `19 s`, `2 min 5 s`.
 */
export function formatSpan(ms: number): string {
  const safe = Math.max(0, ms);
  if (safe < 999.5) return `${Math.round(safe)} ms`;
  // Tenths below ten seconds, unless they round up to ten.
  const tenths = Math.round(safe / 100);
  if (safe % 1000 !== 0 && tenths < 100) return `${(tenths / 10).toFixed(1)} s`;
  const seconds = Math.round(safe / 1000);
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes} min ${rest} s` : `${minutes} min`;
}

/**
 * The filters that narrow by one value the event carries: typed or pasted
 * into the Events list of the sidebar or the search above the table, or set
 * from an event (a row's menu, the event's panel). `name` is what the value
 * is called in a sentence: "Only this actor", "Clear the actor filter".
 *
 * The type is chosen from {@link EVENT_TYPES} rather than typed, and the list
 * takes several at once (`EventsSearch.type`); the others hold one value each.
 * Any of them combine: what no index holds is matched under the server's scan
 * budget (root ADR 048), and the list says when a page stopped short.
 */
export const VALUE_FILTERS = [
  { key: "type", label: "Type", name: "type", prefix: "type" },
  { key: "actor", label: "Actor", name: "actor", prefix: "actor" },
  { key: "user", label: "User", name: "user", prefix: "user" },
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
const EVENT_VALUE: Record<ValueFilterKey, (event: ProjectEvent) => string | null | undefined> = {
  type: (event) => event.event_type,
  actor: (event) => event.actor_id,
  user: (event) => event.user_id,
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
export function eventFilterValues(event: ProjectEvent): { filter: ValueFilter; value: string }[] {
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
export type EventsSearch = {
  view: EventView;
  category?: AuditCategory;
  since?: TimeRange;
  from?: string;
  to?: string;
  type?: string[];
  status?: StatusClass[];
  outcome?: SigninOutcome;
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
function byRequest(search: EventsSearch): boolean {
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
 * - The sign-ins are their own types, so they take no category; an outcome
 *   narrows them alone.
 * - A range with fixed ends replaces one counted back from now.
 *
 * Everything else combines: the ids with each other, with types, with any
 * view and with a category.
 */
export function servedSearch(search: EventsSearch): EventsSearch {
  const time = search.from || search.to ? { ...search, since: undefined } : search;
  if (byRequest(time)) {
    return { ...time, view: "requests", category: undefined, type: undefined, outcome: undefined };
  }
  if (time.type?.length) return { ...time, view: "all", category: undefined, outcome: undefined };
  if (time.view === "requests") return { ...time, category: undefined, outcome: undefined };
  if (time.view === "signins") return { ...time, category: undefined };
  return time.outcome ? { ...time, outcome: undefined } : time;
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
export function parseEventsSearch(search: Record<string, unknown>): EventsSearch {
  let from = moment(search.from);
  let to = moment(search.to);
  if (from && to && from >= to) {
    from = undefined;
    to = undefined;
  }
  // Every key, even unset: the router lays this over the raw search, so a key
  // left out would keep the URL's value.
  const parsed: EventsSearch = {
    view: EVENT_VIEWS.find((known) => known === search.view) ?? "audit",
    category: AUDIT_CATEGORIES.find((known) => known === search.category),
    since: TIME_RANGES.find((known) => known === search.since),
    from,
    to,
    type: eventTypes(search.type),
    status: statusClasses(search.status),
    outcome: SIGNIN_OUTCOMES.find((known) => known === search.outcome),
  };
  for (const { key } of VALUE_FILTERS) {
    if (key === "type") continue;
    const value = search[key];
    parsed[key] = typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
  }
  return servedSearch(parsed);
}

/** Whether the list reads a range with fixed ends rather than one counted back from now. */
export function hasCustomRange(search: EventsSearch): boolean {
  return Boolean(search.from || search.to);
}

/** How many filters narrow the view beyond the view itself; the time is one, however set. */
export function filterCount(search: EventsSearch): number {
  return (
    Number(Boolean(search.category)) +
    Number(Boolean(search.since) || hasCustomRange(search)) +
    Number(Boolean(search.status?.length)) +
    Number(Boolean(search.outcome)) +
    VALUE_FILTERS.filter(({ key }) => (key === "type" ? search.type?.length : search[key])).length
  );
}

/** Whether anything narrows the view beyond the view itself. */
export function isNarrowed(search: EventsSearch): boolean {
  return filterCount(search) > 0;
}

/** Whether the list is narrowed to exactly this value already, so setting it would narrow no further. */
export function isNarrowedTo(search: EventsSearch, key: ValueFilterKey, value: string): boolean {
  if (key === "type") return search.type?.length === 1 && search.type[0] === value;
  return search[key] === value;
}

/**
 * What `GET /events` is asked for under these filters. `createdAfter` is the
 * start of a time range counted back from now, which the list computed when
 * it loaded ({@link rangeStart}); a range with fixed ends brings its own.
 */
export function eventsQuery(
  search: EventsSearch,
  createdAfter?: string,
): Pick<
  ListEventsParams,
  | "category"
  | "event_type"
  | "actor_id"
  | "user_id"
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
  const category: ListEventsParams["category"] =
    byRequest(served) || served.view === "signins"
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
    event_type:
      served.view === "signins"
        ? [...(served.outcome ? OUTCOME_TYPES[served.outcome] : SIGNIN_OUTCOME_TYPES)]
        : served.type,
    actor_id: served.actor,
    user_id: served.user,
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

/**
 * The list in another view. Only the All view holds types, only the requests'
 * an operation or a status, and only the sign-ins' an outcome.
 */
export function withView(current: EventsSearch, view: EventView): EventsSearch {
  return servedSearch({
    ...current,
    view,
    type: view === "all" ? current.type : undefined,
    operation: view === "requests" ? current.operation : undefined,
    status: view === "requests" ? current.status : undefined,
    outcome: view === "signins" ? current.outcome : undefined,
  });
}

/** The sign-ins narrowed to one way of ending, or to none. */
export function withOutcome(
  current: EventsSearch,
  outcome: SigninOutcome | undefined,
): EventsSearch {
  return servedSearch({ ...current, outcome });
}

/** The list narrowed to one category, or to none. A category takes no type beside it. */
export function withCategory(
  current: EventsSearch,
  category: AuditCategory | undefined,
): EventsSearch {
  return servedSearch({ ...current, category, type: category ? undefined : current.type });
}

/** The list over another time range counted back from now, or over everything retained. */
export function withTimeRange(current: EventsSearch, since: TimeRange | undefined): EventsSearch {
  return { ...current, since, from: undefined, to: undefined };
}

/** The list between two fixed moments; either may be open. */
export function withCustomRange(
  current: EventsSearch,
  from: string | undefined,
  to: string | undefined,
): EventsSearch {
  return servedSearch({ ...current, since: undefined, from: moment(from), to: moment(to) });
}

/**
 * The list narrowed to these event types, or to none. Types read the All view
 * with no category beside them ({@link servedSearch}); clearing them keeps the
 * view they left the list in.
 */
export function withTypes(current: EventsSearch, types: readonly string[]): EventsSearch {
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
export function withStatus(current: EventsSearch, classes: readonly StatusClass[]): EventsSearch {
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
  current: EventsSearch,
  key: ValueFilterKey,
  value: string | undefined,
): EventsSearch {
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
export function sharing(key: ValueFilterKey, value: string): EventsSearch {
  if (key === "type") return { view: "all", type: [value] };
  if (key === "operation") return { view: "requests", operation: value };
  return { view: "all", [key]: value };
}

/**
 * The filters set by a pasted value, in the order the search draws them as
 * chips: every one but the type, which the sidebar chooses.
 */
export function chipFilters(search: EventsSearch): { filter: ValueFilter; value: string }[] {
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
 * - `actor:…`, `user:…`, `resource:…`, `resource_type:…`, `app:…`, `device:…`
 *   and the other filters' prefixes ({@link VALUE_FILTERS}) name the filter.
 * - `evt_…` is an event, and opens it.
 * - `req_…` (or a 32-digit trace id), `sess_…`, `flow_…` and `app_…` are a
 *   request, a session, a login flow and an application.
 * - Words joined by dots are an event type, and one camel-cased word, as
 *   `createUser`, is an API operation.
 * - `user_…` may be whose account something happened to or who did
 *   something, so it means both a user and an actor, and the person says
 *   which. What happened to the account holds the changes to the user too.
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
  if (value.startsWith("user_")) return [filter("user"), filter("actor")];
  if (EVENT_TYPE.test(value)) return [filter("type")];
  if (OPERATION.test(value)) return [filter("operation")];
  return [filter("actor"), filter("resource")];
}

/** One loaded event as a row of the exported CSV, in {@link CSV_COLUMNS}' order. */
const CSV_COLUMNS = [
  ["id", (event: ProjectEvent) => event.id],
  ["occurred_at", (event: ProjectEvent) => event.occurred_at],
  ["created_at", (event: ProjectEvent) => event.created_at],
  ["event_type", (event: ProjectEvent) => event.event_type],
  ["category", (event: ProjectEvent) => event.category],
  ["actor_id", (event: ProjectEvent) => event.actor_id],
  ["actor_type", (event: ProjectEvent) => event.actor_type],
  ["entity_type", (event: ProjectEvent) => event.entity_type],
  ["entity_id", (event: ProjectEvent) => event.entity_id],
  ["user_id", (event: ProjectEvent) => event.user_id],
  ["client_id", (event: ProjectEvent) => event.client_id],
  ["request_id", (event: ProjectEvent) => event.request_id],
  ["session_id", (event: ProjectEvent) => event.session_id],
  ["flow_id", (event: ProjectEvent) => event.flow_id],
  ["fingerprint", (event: ProjectEvent) => event.fingerprint],
  ["payload", (event: ProjectEvent) => JSON.stringify(event.payload)],
] as const;

/** A CSV field, quoted when it holds a comma, a quote or a line break. */
function csvField(value: string | null | undefined): string {
  const text = value ?? "";
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * The loaded events as CSV, one row each under a header: the envelope's
 * values, and the payload as JSON in one field. Only what the list loaded:
 * the API has no export, so a longer list is paged first, or read through the
 * CLI.
 */
export function eventsCsv(events: readonly ProjectEvent[]): string {
  const header = CSV_COLUMNS.map(([name]) => name).join(",");
  const rows = events.map((event) =>
    CSV_COLUMNS.map(([, read]) => csvField(read(event))).join(","),
  );
  return `${[header, ...rows].join("\r\n")}\r\n`;
}
