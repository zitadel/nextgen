import { describe, expect, it } from "vitest";

import {
  AROUND_MINUTES,
  AUDIT_CATEGORIES,
  chipFilters,
  around,
  EVENT_TYPE_GROUPS,
  EVENT_TYPES,
  eventFields,
  eventFilterValues,
  eventSubject,
  eventsCsv,
  eventsQuery,
  FAILED_STATUS,
  FAILURE_TYPES,
  filterCount,
  isFailure,
  isNarrowed,
  isNarrowedTo,
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
  withCustomRange,
  withStatus,
  withTimeRange,
  withTypes,
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
      from: undefined,
      to: undefined,
      type: undefined,
      actor: undefined,
      resource: undefined,
      resource_type: undefined,
      client: undefined,
      operation: undefined,
      request: undefined,
      session: undefined,
      flow: undefined,
      device: undefined,
      status: undefined,
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
      // The API's names, which the URL does not use, and the team, which the
      // list has no field for.
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

  it("reads a type in the All view with no category, whatever the URL puts beside it", () => {
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
      type: ["user.deleted"],
      // Every other filter combines with a type: the server bounds the read.
      actor: "user_1",
      resource: "user_2",
      since: "24h",
    });
  });

  it("keeps every value filter a URL carries, together", () => {
    expect(
      parseLogsSearch({
        category: "auth",
        since: "7d",
        actor: "user_1",
        resource: "user_2",
        request: "req_1",
        session: "sess_1",
        flow: "flow_1",
        resource_type: "user",
        client: "app_1",
        device: "fp_1",
      }),
    ).toEqual({
      view: "audit",
      category: "auth",
      since: "7d",
      from: undefined,
      to: undefined,
      type: undefined,
      actor: "user_1",
      resource: "user_2",
      resource_type: "user",
      client: "app_1",
      operation: undefined,
      request: "req_1",
      session: "sess_1",
      flow: "flow_1",
      device: "fp_1",
      status: undefined,
    });
  });

  it("reads one type or several, once each, and drops what is not a type", () => {
    expect(parseLogsSearch({ type: "user.created" }).type).toEqual(["user.created"]);
    expect(
      parseLogsSearch({ type: ["user.created", " auth.check.failed ", "user.created"] }).type,
    ).toEqual(["user.created", "auth.check.failed"]);
    // A type the console does not know yet is kept: the server may write it.
    expect(parseLogsSearch({ type: ["thing.happened"] }).type).toEqual(["thing.happened"]);
    expect(parseLogsSearch({ type: ["", "nodot", 7] }).type).toBeUndefined();
  });

  it("reads a range with fixed ends in place of one counted back from now", () => {
    expect(
      parseLogsSearch({ since: "1h", from: "2026-11-10T08:00:00Z", to: "2026-11-10T09:00:00Z" }),
    ).toMatchObject({
      since: undefined,
      from: "2026-11-10T08:00:00.000Z",
      to: "2026-11-10T09:00:00.000Z",
    });
    // Either end may be open.
    expect(parseLogsSearch({ to: "2026-11-10T09:00:00Z" })).toMatchObject({
      from: undefined,
      to: "2026-11-10T09:00:00.000Z",
    });
    // A start not before its end, or one that is no moment, is no range.
    expect(
      parseLogsSearch({ since: "1h", from: "2026-11-10T09:00:00Z", to: "2026-11-10T08:00:00Z" }),
    ).toMatchObject({ since: "1h", from: undefined, to: undefined });
    expect(parseLogsSearch({ from: "yesterday" }).from).toBeUndefined();
  });
});

describe("servedSearch", () => {
  it("gives a type the All view and no category", () => {
    expect(
      servedSearch({
        view: "requests",
        category: "auth",
        type: ["user.created", "user.deleted"],
        actor: "user_1",
      }),
    ).toEqual({
      view: "all",
      category: undefined,
      type: ["user.created", "user.deleted"],
      actor: "user_1",
    });
  });

  it("keeps every other value filter and the range beside a type", () => {
    const search: LogsSearch = {
      view: "all",
      type: ["user.created"],
      actor: "user_1",
      resource: "user_2",
      request: "req_1",
      session: "sess_1",
      flow: "flow_1",
      since: "1h",
    };
    expect(servedSearch(search)).toEqual(search);
  });

  it("gives the requests no category", () => {
    expect(servedSearch({ view: "requests", category: "auth" }).category).toBeUndefined();
  });

  it("leaves every other combination as it is", () => {
    const search: LogsSearch = {
      view: "audit",
      category: "entity",
      actor: "user_1",
      resource: "user_2",
      request: "req_1",
      session: "sess_1",
      flow: "flow_1",
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
        resource_type: "user",
        client: "app_1",
        device: "fp_1",
        from: "2026-11-10T08:00:00Z",
        to: "2026-11-10T09:00:00Z",
      }),
    );
    // Exactly these, all together: `team_id` is a filter of the API the list
    // has no field for.
    expect(query).toEqual({
      category: undefined,
      event_type: undefined,
      actor_id: "user_1",
      entity_id: "user_2",
      entity_type: "user",
      client_id: "app_1",
      request_id: "req_1",
      session_id: "sess_1",
      flow_id: "flow_1",
      fingerprint: "fp_1",
      operation_id: undefined,
      status_class: undefined,
      created_after: "2026-11-10T08:00:00.000Z",
      created_before: "2026-11-10T09:00:00.000Z",
    });
  });

  it("asks for one type or several, with no category beside them", () => {
    const query = eventsQuery(parseLogsSearch({ type: "user.created" }));
    expect(query.event_type).toEqual(["user.created"]);
    expect(query.category).toBeUndefined();
    expect(eventsQuery(parseLogsSearch({ type: [...FAILURE_TYPES] })).event_type).toEqual([
      ...FAILURE_TYPES,
    ]);
  });

  it("gives way itself, handed a search that did not", () => {
    // Not through the URL's parser: a type still takes no category.
    const query = eventsQuery({
      view: "audit",
      category: "auth",
      type: ["user.created"],
      actor: "user_1",
    });
    expect(query.event_type).toEqual(["user.created"]);
    expect(query.category).toBeUndefined();
    expect(query.actor_id).toBe("user_1");
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
    expect(withView(typed, "all").type).toEqual(["user.created"]);
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
    expect(withCategory(typed, undefined).type).toEqual(["user.created"]);
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

  it("swaps a range counted back from now and one with fixed ends for each other", () => {
    const current = parseLogsSearch({ since: "1h", actor: "user_1" });
    const fixed = withCustomRange(current, "2026-11-10T08:00:00Z", undefined);
    expect(fixed).toMatchObject({
      since: undefined,
      from: "2026-11-10T08:00:00.000Z",
      to: undefined,
      actor: "user_1",
    });
    expect(withTimeRange(fixed, "24h")).toMatchObject({
      since: "24h",
      from: undefined,
      to: undefined,
      actor: "user_1",
    });
  });

  it("reads everything in the minutes around an event, under no other filter", () => {
    expect(around({ created_at: "2026-11-10T08:15:43.000Z" })).toEqual({
      view: "all",
      from: "2026-11-10T08:10:43.000Z",
      to: "2026-11-10T08:20:43.000Z",
    });
    expect(AROUND_MINUTES).toBe(5);
  });

  it("narrows to several types, and back to any", () => {
    const current = parseLogsSearch({ category: "auth", actor: "user_1" });
    const typed = withTypes(current, ["user.created", "user.created", "user.deleted"]);
    expect(typed).toMatchObject({
      view: "all",
      category: undefined,
      type: ["user.created", "user.deleted"],
      actor: "user_1",
    });
    expect(withTypes(typed, [])).toMatchObject({ view: "all", type: undefined, actor: "user_1" });
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
    expect(
      eventFilterValues(
        event({ entity_type: "user", client_id: "app_1", fingerprint: "fp_1" }),
      ).map(({ filter }) => filter.key),
    ).toEqual(["type", "resource_type", "client", "device"]);
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

  it("narrows the view it is on by an actor, a resource, its type, an application or a device", () => {
    const current = parseLogsSearch({ category: "entity", since: "24h" });
    for (const key of ["actor", "resource", "resource_type", "client", "device"] as const) {
      expect(narrowedBy(current, key, "user_1")).toMatchObject({
        view: "audit",
        category: "entity",
        since: "24h",
        [key]: "user_1",
      });
    }
  });

  it("reads a type in the All view with no category, beside what else is set", () => {
    const current = parseLogsSearch({ category: "auth", actor: "user_1", resource: "user_2" });
    expect(narrowedBy(current, "type", "user.created")).toMatchObject({
      view: "all",
      category: undefined,
      type: ["user.created"],
      actor: "user_1",
      resource: "user_2",
    });
  });

  it("keeps a type beside an actor", () => {
    const current = parseLogsSearch({ type: "user.created" });
    expect(narrowedBy(current, "actor", "user_1")).toMatchObject({
      view: "all",
      type: ["user.created"],
      actor: "user_1",
    });
  });

  it("knows the value the list is narrowed to already", () => {
    const current = parseLogsSearch({ type: "user.created", actor: "user_1" });
    expect(isNarrowedTo(current, "type", "user.created")).toBe(true);
    expect(isNarrowedTo(current, "actor", "user_1")).toBe(true);
    expect(isNarrowedTo(current, "actor", "user_2")).toBe(false);
    // Among several types, one is not what the list is narrowed to.
    expect(
      isNarrowedTo(withTypes(current, ["user.created", "user.deleted"]), "type", "user.created"),
    ).toBe(false);
  });

  it("sets one ID beside another, whichever came first", () => {
    const keys = [
      "actor",
      "resource",
      "resource_type",
      "client",
      "request",
      "session",
      "flow",
      "device",
    ] as const;
    for (const set of keys) {
      for (const next of keys) {
        if (next === set) continue;
        const current = parseLogsSearch({ view: "all", [set]: "value_1" });
        expect(narrowedBy(current, next, "value_2")).toMatchObject({
          [set]: "value_1",
          [next]: "value_2",
        });
      }
    }
  });

  it("clears one filter and leaves the others", () => {
    const current = parseLogsSearch({ category: "auth", actor: "user_1", session: "sess_1" });
    for (const empty of [undefined, ""]) {
      expect(narrowedBy(current, "actor", empty)).toEqual({ ...current, actor: undefined });
    }
  });

  it("starts over from one shared value on the event's page", () => {
    expect(sharing("request", "req_1")).toEqual({ view: "all", request: "req_1" });
    expect(sharing("type", "user.created")).toEqual({ view: "all", type: ["user.created"] });
  });

  it("knows a narrowed list from a whole view, and by how much", () => {
    expect(isNarrowed(parseLogsSearch({ view: "requests" }))).toBe(false);
    expect(filterCount(parseLogsSearch({ view: "all" }))).toBe(0);
    expect(isNarrowed(parseLogsSearch({ category: "auth" }))).toBe(true);
    expect(isNarrowed(parseLogsSearch({ since: "1h" }))).toBe(true);
    expect(
      filterCount(parseLogsSearch({ from: "2026-11-10T08:00:00Z", to: "2026-11-10T09:00:00Z" })),
    ).toBe(1);
    expect(filterCount(parseLogsSearch({ type: ["user.created", "user.deleted"] }))).toBe(1);
    expect(
      filterCount(parseLogsSearch({ category: "auth", since: "1h", actor: "user_1", flow: "f" })),
    ).toBe(4);
  });
});

describe("what gives way, on every way into a list", () => {
  /**
   * The two rules, and nothing else given up: the server bounds every read,
   * so any other combination is sent as it is.
   */
  function expectServed(search: LogsSearch) {
    const query = eventsQuery(search);
    // A type names its own category: no category beside types.
    if (query.event_type) {
      expect(query.event_type.length).toBeGreaterThan(0);
      expect(query.category, JSON.stringify(search)).toBeUndefined();
    }
    // The requests are one category, never one of several.
    if (query.category?.includes("request")) expect(query.category).toEqual(["request"]);
    // What the URL holds is what is asked for: giving way changes nothing more.
    expect(servedSearch(search)).toEqual(search);
    expect(Object.keys(query).sort()).toEqual([
      "actor_id",
      "category",
      "client_id",
      "created_after",
      "created_before",
      "entity_id",
      "entity_type",
      "event_type",
      "fingerprint",
      "flow_id",
      "operation_id",
      "request_id",
      "session_id",
      "status_class",
    ]);
  }

  /** A value a URL may carry for each filter: a type has a type's shape. */
  const urlValue = (key: string) => (key === "type" ? "user.created" : `${key}_1`);

  /**
   * Every URL over the views, the categories, a range, and each of five filters
   * set or not (the type, an ID read through every view, one kept in the view,
   * and two the server matches under its budget); then each filter alone.
   */
  const COMBINED = ["type", "request", "actor", "resource_type", "device"] as const;
  const urls: Record<string, unknown>[] = [];
  for (const view of [...LOG_VIEWS, undefined]) {
    for (const category of [...AUDIT_CATEGORIES, undefined]) {
      for (const range of [{}, { since: "1h" }, { from: "2026-11-10T08:00:00Z" }]) {
        for (let bits = 0; bits < 2 ** COMBINED.length; bits++) {
          const url: Record<string, unknown> = { view, category, ...range };
          COMBINED.forEach((key, index) => {
            if (bits & (1 << index)) url[key] = urlValue(key);
          });
          urls.push(url);
        }
      }
      for (const { key } of VALUE_FILTERS) urls.push({ view, category, [key]: urlValue(key) });
    }
  }

  it("holds in every URL", () => {
    for (const url of urls) expectServed(parseLogsSearch(url));
  });

  it("drops no value filter a URL carries", () => {
    for (const url of urls) {
      const parsed = parseLogsSearch(url);
      for (const { key } of VALUE_FILTERS) {
        const expected = key === "type" && url.type ? [url.type] : url[key];
        expect(parsed[key], JSON.stringify(url)).toEqual(expected);
      }
    }
  });

  it("holds one click on from every URL", () => {
    for (const url of urls) {
      const current = parseLogsSearch(url);
      for (const view of LOG_VIEWS) expectServed(withView(current, view));
      for (const category of [...AUDIT_CATEGORIES, undefined]) {
        expectServed(withCategory(current, category));
      }
      for (const since of [...TIME_RANGES, undefined]) expectServed(withTimeRange(current, since));
      expectServed(withCustomRange(current, "2026-11-10T08:00:00Z", "2026-11-10T09:00:00Z"));
      expectServed(withTypes(current, FAILURE_TYPES));
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
    expect(rangeStart("30m", now)).toBe("2026-11-10T07:45:43.000Z");
    expect(rangeStart("1h", now)).toBe("2026-11-10T07:15:43.000Z");
    expect(rangeStart("12h", now)).toBe("2026-11-09T20:15:43.000Z");
    expect(rangeStart("24h", now)).toBe("2026-11-09T08:15:43.000Z");
    expect(rangeStart("3d", now)).toBe("2026-11-07T08:15:43.000Z");
    expect(rangeStart("7d", now)).toBe("2026-11-03T08:15:43.000Z");
    expect(rangeStart("14d", now)).toBe("2026-10-27T08:15:43.000Z");
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
    expect(meanings("app_1")).toEqual(["client app_1"]);
  });

  it("reads one camel-cased word as an API operation", () => {
    expect(meanings("createUser")).toEqual(["operation createUser"]);
    expect(meanings("deleteUserByID")).toEqual(["operation deleteUserByID"]);
    // A lowercase word or an ID is not one.
    expect(meanings("admin")).toEqual(["actor admin", "resource admin"]);
  });

  it("reads a filter named before its value, whatever the value's shape", () => {
    expect(meanings("actor:user_1")).toEqual(["actor user_1"]);
    expect(meanings("resource:user_1")).toEqual(["resource user_1"]);
    expect(meanings("resource_type:user")).toEqual(["resource_type user"]);
    expect(meanings("device:fp_1")).toEqual(["device fp_1"]);
    expect(meanings("app:x")).toEqual(["client x"]);
    expect(meanings("application:x")).toEqual(["client x"]);
    expect(meanings("operation:getProject")).toEqual(["operation getProject"]);
    // A name the search does not know is no name: the term is read whole.
    expect(meanings("owner:user_1")).toEqual(["actor owner:user_1", "resource owner:user_1"]);
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

describe("failures", () => {
  it("are the types that record something failing", () => {
    expect(FAILURE_TYPES).toEqual([
      "auth.check.failed",
      "auth.sso.authorization.failed",
      "auth.sso.exchange.failed",
      "user.create.failed",
    ]);
    for (const type of FAILURE_TYPES) expect(EVENT_TYPES).toContain(type);
  });

  it("mark a failure type, or a request the server answered with 5xx", () => {
    expect(isFailure(event({ event_type: "auth.check.failed" }))).toBe(true);
    expect(isFailure(event({ event_type: "user.created" }))).toBe(false);
    const request = (status: number) =>
      event({ event_type: "request.api", category: "request", payload: { status } });
    expect(isFailure(request(503))).toBe(true);
    // A 4xx is the caller's mistake, not the server's: its status says it.
    expect(isFailure(request(404))).toBe(false);
    expect(isFailure(request(200))).toBe(false);
  });
});

describe("eventsCsv", () => {
  it("writes a header and a row per event, quoting what needs it", () => {
    const csv = eventsCsv([
      event({
        id: "evt_1",
        actor_id: "user_1",
        entity_type: "user",
        entity_id: "user_2",
        payload: { note: 'a "quoted", value' },
      }),
    ]);
    const [header, row, end] = csv.split("\r\n");
    expect(header).toBe(
      "id,occurred_at,created_at,event_type,category,actor_id,actor_type,entity_type,entity_id,client_id,request_id,session_id,flow_id,fingerprint,payload",
    );
    expect(row).toBe(
      'evt_1,2026-11-10T08:15:43Z,2026-11-10T08:15:43Z,user.deleted,entity,user_1,,user,user_2,,,,,,"{""note"":""a \\""quoted\\"", value""}"',
    );
    expect(end).toBe("");
  });
});

describe("the API requests by operation and status", () => {
  it("reads them in the requests view, with no category or type beside them", () => {
    const parsed = parseLogsSearch({
      view: "audit",
      category: "auth",
      type: "user.created",
      operation: "createUser",
      status: ["5xx", "4xx", "4xx", "6xx"],
      actor: "user_1",
    });
    expect(parsed).toMatchObject({
      view: "requests",
      category: undefined,
      type: undefined,
      operation: "createUser",
      status: ["4xx", "5xx"],
      actor: "user_1",
    });
    // One range of the request indexes: no category is sent beside them.
    expect(eventsQuery(parsed)).toMatchObject({
      category: undefined,
      event_type: undefined,
      operation_id: ["createUser"],
      status_class: ["4xx", "5xx"],
      actor_id: "user_1",
    });
  });

  it("are dropped for a view that is not the requests', or for a type", () => {
    const current = parseLogsSearch({ operation: "createUser", status: "5xx" });
    for (const view of ["audit", "all"] as const) {
      expect(withView(current, view)).toMatchObject({
        view,
        operation: undefined,
        status: undefined,
      });
    }
    expect(withView(current, "requests")).toMatchObject({
      operation: "createUser",
      status: ["5xx"],
    });
    expect(withTypes(current, ["user.created"])).toMatchObject({
      view: "all",
      type: ["user.created"],
      operation: undefined,
      status: undefined,
    });
  });

  it("narrows to status classes in their order, or the failed requests, and back to any", () => {
    const current = parseLogsSearch({ view: "requests", since: "1h" });
    const failed = withStatus(current, [...FAILED_STATUS].reverse());
    expect(failed).toMatchObject({ view: "requests", status: ["4xx", "5xx"], since: "1h" });
    expect(eventsQuery(failed).status_class).toEqual(["4xx", "5xx"]);
    expect(withStatus(failed, [])).toMatchObject({ view: "requests", status: undefined });
    expect(filterCount(failed)).toBe(2);
  });

  it("narrows by a request's operation from the request, and leads on to its other calls", () => {
    const call = event({
      event_type: "request.api",
      category: "request",
      entity_type: null,
      entity_id: null,
      payload: {
        operation_id: "createUser",
        method: "POST",
        route_template: "createUser",
        status: 201,
      },
    });
    expect(eventFilterValues(call).map(({ filter, value }) => [filter.key, value])).toContainEqual([
      "operation",
      "createUser",
    ]);
    expect(narrowedBy(parseLogsSearch({ view: "all" }), "operation", "createUser")).toMatchObject({
      view: "requests",
      operation: "createUser",
    });
    expect(sharing("operation", "createUser")).toEqual({
      view: "requests",
      operation: "createUser",
    });
  });
});

describe("chipFilters", () => {
  it("lists the pasted filters in the filters' order, by their search names, and never the type", () => {
    const search = parseLogsSearch({
      view: "all",
      type: "user.created",
      device: "fp_1",
      actor: "user_1",
      client: "app_1",
      request: "req_1",
    });
    expect(chipFilters(search).map(({ filter, value }) => `${filter.prefix}:${value}`)).toEqual([
      "actor:user_1",
      "app:app_1",
      "request:req_1",
      "device:fp_1",
    ]);
    // Each name reads back as the filter it came from.
    for (const { filter, value } of chipFilters(search)) {
      expect(
        searchMeanings(`${filter.prefix}:${value}`).map((meaning) =>
          meaning.kind === "filter" ? meaning.filter.key : meaning.kind,
        ),
      ).toEqual([filter.key]);
    }
  });
});

describe("EVENT_TYPE_GROUPS", () => {
  it("holds every type once, under its first word", () => {
    expect(
      EVENT_TYPE_GROUPS.flatMap((group) => group.options.map((option) => option.value)),
    ).toEqual([...EVENT_TYPES]);
    for (const group of EVENT_TYPE_GROUPS) {
      for (const option of group.options) {
        expect(option.value.split(".")[0]).toBe(group.heading);
        expect(option.label).toBe(option.value);
      }
    }
    const headings = EVENT_TYPE_GROUPS.map((group) => group.heading);
    expect(new Set(headings).size).toBe(headings.length);
  });
});
