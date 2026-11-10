import { describe, expect, it } from "vitest";

import {
  AUDIT_CATEGORIES,
  eventFields,
  eventFilterValues,
  eventSubject,
  eventsQuery,
  filterCount,
  isNarrowed,
  LOG_VIEWS,
  type LogEvent,
  type LogsSearch,
  narrowedBy,
  parseLogsSearch,
  rangeStart,
  searchMeanings,
  servedSearch,
  sharing,
  TIME_RANGES,
  VALUE_FILTERS,
  withCategory,
  withTimeRange,
  withView,
} from "./model";

/** An event's envelope, with the type and payload a test names. */
function event(overrides: Record<string, unknown>): LogEvent {
  return {
    id: "evt_1",
    project_id: "proj_test",
    event_type: "user.deleted",
    category: "entity",
    occurred_at: "2026-11-10T08:15:43Z",
    created_at: "2026-11-10T08:15:43Z",
    client_id: "",
    payload: {},
    ...overrides,
  } as LogEvent;
}

describe("eventSubject", () => {
  it("reads an API request as its method, route and status", () => {
    const request = event({
      event_type: "request.api",
      category: "request",
      payload: {
        operation_id: "getUserByID",
        method: "GET",
        // The server records the operation as the route, never the raw path.
        route_template: "getUserByID",
        status: 404,
        duration_ms: 3,
      },
    });
    expect(eventSubject(request)).toEqual({
      kind: "request",
      method: "GET",
      route: "getUserByID",
      status: 404,
    });
  });

  it("reads any other event as the record it touched", () => {
    expect(eventSubject(event({ entity_type: "user", entity_id: "user_1" }))).toEqual({
      kind: "record",
      type: "user",
      id: "user_1",
    });
  });

  it("keeps the record's type when the event carries no id", () => {
    // Tokens revoked with their session: the server no longer knows their ids.
    const revoked = event({
      event_type: "auth.token.revoked",
      entity_type: "token",
      entity_id: "",
    });
    expect(eventSubject(revoked)).toEqual({ kind: "record", type: "token", id: undefined });
  });

  it("has no subject when the event names no record", () => {
    expect(eventSubject(event({ entity_type: null, entity_id: null }))).toBeUndefined();
  });
});

describe("eventFields", () => {
  it("lists the values the event carries, and no row for an unset one", () => {
    const fields = eventFields(
      event({
        actor_id: "user_1",
        actor_type: "human",
        // Unset on the wire as an empty string or `null`.
        client_id: "",
        token_id: "",
        team_id: null,
        entity_type: "user",
        entity_id: "user_2",
        request_id: "0af7651916cd43dd8448eb211c80319c",
      }),
    );
    expect(fields).toEqual([
      { label: "Category", value: "entity" },
      { label: "Actor", value: "user_1", id: true },
      { label: "Actor type", value: "human" },
      { label: "Resource type", value: "user" },
      { label: "Resource ID", value: "user_2", id: true },
      { label: "Request ID", value: "0af7651916cd43dd8448eb211c80319c", id: true },
    ]);
  });
});

/** Every category but the requests', which the audit view asks for. */
const AUDIT = ["auth", "session", "admin", "entity", "signal"];

describe("parseLogsSearch", () => {
  it("opens on the audit events with nothing narrowing them", () => {
    expect(parseLogsSearch({})).toEqual({
      view: "audit",
      category: undefined,
      since: undefined,
      type: undefined,
      actor: undefined,
      resource: undefined,
      request: undefined,
      session: undefined,
      flow: undefined,
    });
  });

  it("keeps what the list can send and drops the rest", () => {
    const parsed = parseLogsSearch({
      view: "all",
      category: "admin",
      since: "7d",
      actor: "user_1",
      resource: "user_2",
      request: " req_1 ",
      flow: "",
      session: 7,
      unknown: "x",
      // Filters the API takes but no index serves.
      client_id: "app_1",
      fingerprint: "fp_1",
      team_id: "team_1",
      entity_type: "user",
    });
    expect(parsed).toMatchObject({
      view: "all",
      category: "admin",
      since: "7d",
      actor: "user_1",
      resource: "user_2",
      request: "req_1",
    });
    expect(parsed.flow).toBeUndefined();
    expect(parsed.session).toBeUndefined();
    for (const key of ["unknown", "client_id", "fingerprint", "team_id", "entity_type"]) {
      expect(parsed).not.toHaveProperty(key);
    }
  });

  it("has no category among the requests, nor one the API does not narrow audit events by", () => {
    expect(parseLogsSearch({ view: "requests", category: "auth" }).category).toBeUndefined();
    expect(parseLogsSearch({ category: "request" }).category).toBeUndefined();
    expect(parseLogsSearch({ view: "nope" }).view).toBe("audit");
    expect(parseLogsSearch({ since: "30d" }).since).toBeUndefined();
  });

  it("reads a type on its own, whatever the URL puts beside it", () => {
    expect(
      parseLogsSearch({
        view: "audit",
        category: "auth",
        type: "user.deleted",
        actor: "user_1",
        resource: "user_2",
        since: "24h",
      }),
    ).toMatchObject({
      view: "all",
      category: undefined,
      type: "user.deleted",
      actor: undefined,
      // A resource holds few events and a range only bounds: both stay.
      resource: "user_2",
      since: "24h",
    });
  });
});

describe("servedSearch", () => {
  it("gives a type the All view, and neither a category nor an actor", () => {
    expect(
      servedSearch({ view: "requests", category: "auth", type: "user.created", actor: "user_1" }),
    ).toEqual({ view: "all", category: undefined, type: "user.created", actor: undefined });
  });

  it("keeps a request, a session, a login flow, a resource and the range beside a type", () => {
    const search: LogsSearch = {
      view: "all",
      type: "user.created",
      resource: "user_2",
      request: "req_1",
      session: "sess_1",
      flow: "flow_1",
      since: "1h",
    };
    expect(servedSearch(search)).toEqual({ ...search, category: undefined, actor: undefined });
  });

  it("gives the requests no category", () => {
    expect(servedSearch({ view: "requests", category: "auth" }).category).toBeUndefined();
  });

  it("leaves alone what an index serves as it is", () => {
    const search: LogsSearch = {
      view: "audit",
      category: "entity",
      actor: "user_1",
      resource: "user_2",
      since: "7d",
    };
    expect(servedSearch(search)).toBe(search);
  });
});

describe("eventsQuery", () => {
  it("asks for every category but the requests' on the audit view", () => {
    expect(eventsQuery(parseLogsSearch({})).category).toEqual(AUDIT);
  });

  it("asks for the requests alone, or for no category at all", () => {
    expect(eventsQuery(parseLogsSearch({ view: "requests" })).category).toEqual(["request"]);
    expect(eventsQuery(parseLogsSearch({ view: "all" })).category).toBeUndefined();
  });

  it("narrows either view to the one category chosen", () => {
    expect(eventsQuery(parseLogsSearch({ category: "auth" })).category).toEqual(["auth"]);
    expect(eventsQuery(parseLogsSearch({ view: "all", category: "auth" })).category).toEqual([
      "auth",
    ]);
  });

  it("names each value filter as the API's parameter, and no other", () => {
    const query = eventsQuery(
      parseLogsSearch({
        view: "all",
        actor: "user_1",
        resource: "user_2",
        request: "req_1",
        session: "sess_1",
        flow: "flow_1",
      }),
    );
    // Exactly these: `client_id`, `fingerprint`, `team_id` and `entity_type`
    // are filters of the API that no index serves, so the list never sends them.
    expect(query).toEqual({
      category: undefined,
      event_type: undefined,
      actor_id: "user_1",
      entity_id: "user_2",
      request_id: "req_1",
      session_id: "sess_1",
      flow_id: "flow_1",
      created_after: undefined,
    });
  });

  it("asks for one type, with no category beside it", () => {
    const query = eventsQuery(parseLogsSearch({ type: "user.created" }));
    expect(query.event_type).toEqual(["user.created"]);
    expect(query.category).toBeUndefined();
  });

  it("never asks for a combination no index serves, even handed one", () => {
    // Not through the URL's parser: the request gives way itself.
    const query = eventsQuery({
      view: "audit",
      category: "auth",
      type: "user.created",
      actor: "user_1",
    });
    expect(query.event_type).toEqual(["user.created"]);
    expect(query.category).toBeUndefined();
    expect(query.actor_id).toBeUndefined();
  });

  it("sends the start of the time range it is given", () => {
    const start = "2026-11-09T08:00:00.000Z";
    expect(eventsQuery(parseLogsSearch({ since: "24h" }), start).created_after).toBe(start);
    // The range's start is the list's to compute, once: none given, none sent.
    expect(eventsQuery(parseLogsSearch({ since: "24h" })).created_after).toBeUndefined();
  });
});

describe("the list in another view, category or range", () => {
  it("keeps the filters across the views, but a type only in All", () => {
    const current = parseLogsSearch({ view: "all", actor: "user_1", since: "7d" });
    expect(withView(current, "audit")).toMatchObject({
      view: "audit",
      actor: "user_1",
      since: "7d",
    });

    const typed = parseLogsSearch({ type: "user.created", session: "sess_1" });
    expect(withView(typed, "all").type).toBe("user.created");
    for (const view of ["audit", "requests"] as const) {
      expect(withView(typed, view)).toMatchObject({ view, type: undefined, session: "sess_1" });
    }
  });

  it("drops the category on the way into the requests", () => {
    const current = parseLogsSearch({ category: "auth" });
    expect(withView(current, "requests")).toMatchObject({ view: "requests", category: undefined });
    expect(withView(current, "all")).toMatchObject({ view: "all", category: "auth" });
  });

  it("gives up the type for a category, and keeps it when the category is cleared", () => {
    const typed = parseLogsSearch({ type: "user.created" });
    expect(withCategory(typed, "entity")).toMatchObject({
      view: "all",
      category: "entity",
      type: undefined,
    });
    expect(withCategory(typed, undefined).type).toBe("user.created");
  });

  it("keeps an actor beside a category", () => {
    const current = parseLogsSearch({ actor: "user_1" });
    expect(withCategory(current, "admin")).toMatchObject({
      view: "audit",
      category: "admin",
      actor: "user_1",
    });
  });

  it("changes the time range and nothing else", () => {
    const current = parseLogsSearch({ type: "user.created", request: "req_1" });
    expect(withTimeRange(current, "1h")).toEqual({ ...current, since: "1h" });
    expect(withTimeRange({ ...current, since: "1h" }, undefined)).toEqual(current);
  });
});

describe("narrowing by one value", () => {
  it("offers a filter per value the event carries", () => {
    const carried = eventFilterValues(
      event({
        actor_id: "user_1",
        entity_id: "user_2",
        request_id: "req_1",
        session_id: null,
        flow_id: "",
      }),
    );
    expect(carried.map(({ filter, value }) => [filter.key, value])).toEqual([
      ["type", "user.deleted"],
      ["actor", "user_1"],
      ["resource", "user_2"],
      ["request", "req_1"],
    ]);
  });

  it("follows a request, a session or a login flow through every view", () => {
    const current = parseLogsSearch({ category: "entity" });
    for (const key of ["request", "session", "flow"] as const) {
      expect(narrowedBy(current, key, "id_1")).toMatchObject({
        view: "all",
        category: "entity",
        [key]: "id_1",
      });
    }
  });

  it("narrows the view it is on by an actor or a resource", () => {
    const current = parseLogsSearch({ category: "entity", since: "24h" });
    for (const key of ["actor", "resource"] as const) {
      expect(narrowedBy(current, key, "user_1")).toMatchObject({
        view: "audit",
        category: "entity",
        since: "24h",
        [key]: "user_1",
      });
    }
  });

  it("reads a type on its own: the All view, no category, no actor", () => {
    const current = parseLogsSearch({ category: "auth", actor: "user_1", resource: "user_2" });
    expect(narrowedBy(current, "type", "user.created")).toMatchObject({
      view: "all",
      category: undefined,
      type: "user.created",
      actor: undefined,
      resource: "user_2",
    });
  });

  it("gives up the type for an actor", () => {
    const current = parseLogsSearch({ type: "user.created" });
    expect(narrowedBy(current, "actor", "user_1")).toMatchObject({
      view: "all",
      type: undefined,
      actor: "user_1",
    });
  });

  it("clears one filter and leaves the others", () => {
    const current = parseLogsSearch({ category: "auth", actor: "user_1", session: "sess_1" });
    for (const empty of [undefined, ""]) {
      expect(narrowedBy(current, "actor", empty)).toEqual({ ...current, actor: undefined });
    }
  });

  it("starts over from one shared value on the event's page", () => {
    expect(sharing("request", "req_1")).toEqual({ view: "all", request: "req_1" });
    expect(sharing("type", "user.created")).toEqual({ view: "all", type: "user.created" });
  });

  it("knows a narrowed list from a whole view, and by how much", () => {
    expect(isNarrowed(parseLogsSearch({ view: "requests" }))).toBe(false);
    expect(filterCount(parseLogsSearch({ view: "all" }))).toBe(0);
    expect(isNarrowed(parseLogsSearch({ category: "auth" }))).toBe(true);
    expect(isNarrowed(parseLogsSearch({ since: "1h" }))).toBe(true);
    expect(
      filterCount(parseLogsSearch({ category: "auth", since: "1h", actor: "user_1", flow: "f" })),
    ).toBe(4);
  });
});

describe("no way to an unserved combination", () => {
  /** What the server's indexes answer in order: a type stands without a category or an actor. */
  function expectServed(search: LogsSearch) {
    const query = eventsQuery(search);
    if (query.event_type) {
      expect(query.event_type).toHaveLength(1);
      expect(query.category, JSON.stringify(search)).toBeUndefined();
      expect(query.actor_id, JSON.stringify(search)).toBeUndefined();
    }
    // The requests are one category, never one of several.
    if (query.category?.includes("request")) expect(query.category).toEqual(["request"]);
    // What the URL holds is what is asked for: giving way changes nothing more.
    expect(servedSearch(search)).toEqual(search);
    expect(Object.keys(query).sort()).toEqual([
      "actor_id",
      "category",
      "created_after",
      "entity_id",
      "event_type",
      "flow_id",
      "request_id",
      "session_id",
    ]);
  }

  /** Every URL over the views, the categories and each value filter set or not. */
  const urls: Record<string, unknown>[] = [];
  for (const view of [...LOG_VIEWS, undefined]) {
    for (const category of [...AUDIT_CATEGORIES, undefined]) {
      for (let bits = 0; bits < 2 ** VALUE_FILTERS.length; bits++) {
        const url: Record<string, unknown> = { view, category };
        VALUE_FILTERS.forEach(({ key }, index) => {
          if (bits & (1 << index)) url[key] = `${key}_1`;
        });
        urls.push(url);
      }
    }
  }

  it("has none in any URL", () => {
    for (const url of urls) expectServed(parseLogsSearch(url));
  });

  it("has none one click on from any URL", () => {
    for (const url of urls) {
      const current = parseLogsSearch(url);
      for (const view of LOG_VIEWS) expectServed(withView(current, view));
      for (const category of [...AUDIT_CATEGORIES, undefined]) {
        expectServed(withCategory(current, category));
      }
      for (const since of [...TIME_RANGES, undefined]) expectServed(withTimeRange(current, since));
      for (const { key } of VALUE_FILTERS) {
        expectServed(narrowedBy(current, key, "value_2"));
        expectServed(narrowedBy(current, key, undefined));
        expectServed(sharing(key, "value_2"));
      }
    }
  });
});

describe("rangeStart", () => {
  const now = new Date("2026-11-10T08:15:43.000Z");

  it("counts the range back from the moment it is given", () => {
    expect(rangeStart("1h", now)).toBe("2026-11-10T07:15:43.000Z");
    expect(rangeStart("24h", now)).toBe("2026-11-09T08:15:43.000Z");
    expect(rangeStart("7d", now)).toBe("2026-11-03T08:15:43.000Z");
  });

  it("has no start for everything retained", () => {
    expect(rangeStart(undefined, now)).toBeUndefined();
  });
});

describe("searchMeanings", () => {
  /** A term's meanings, as `event` or the filters' keys. */
  const meanings = (term: string) =>
    searchMeanings(term).map((meaning) =>
      meaning.kind === "event" ? `event ${meaning.id}` : `${meaning.filter.key} ${meaning.value}`,
    );

  it("opens the event an event ID names", () => {
    expect(meanings("evt_01ABC")).toEqual(["event evt_01ABC"]);
  });

  it("reads a request, a session and a login flow by their prefix", () => {
    expect(meanings("req_1")).toEqual(["request req_1"]);
    expect(meanings("sess_1")).toEqual(["session sess_1"]);
    expect(meanings("flow_1")).toEqual(["flow flow_1"]);
  });

  it("reads 32 hex digits as a request: its trace ID", () => {
    expect(meanings("0af7651916cd43dd8448eb211c80319c")).toEqual([
      "request 0af7651916cd43dd8448eb211c80319c",
    ]);
  });

  it("reads words joined by dots as an event type", () => {
    expect(meanings("user.created")).toEqual(["type user.created"]);
    expect(meanings("auth.check.failed")).toEqual(["type auth.check.failed"]);
    expect(meanings("auth.token_exchange.succeeded")).toEqual([
      "type auth.token_exchange.succeeded",
    ]);
  });

  it("leaves any other ID to the person: an actor or a resource", () => {
    expect(meanings("user_1")).toEqual(["actor user_1", "resource user_1"]);
    expect(meanings("team_1")).toEqual(["actor team_1", "resource team_1"]);
    // An email address is not an ID of an event, but it is one whole value.
    expect(meanings("User.Name@example.com")).toEqual([
      "actor User.Name@example.com",
      "resource User.Name@example.com",
    ]);
  });

  it("trims the term, and means nothing by text or by nothing", () => {
    expect(meanings("  req_1 ")).toEqual(["request req_1"]);
    expect(meanings("")).toEqual([]);
    expect(meanings("   ")).toEqual([]);
    expect(meanings("failed sign in")).toEqual([]);
  });
});
