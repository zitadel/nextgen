import { describe, expect, it } from "vitest";

import {
  eventFields,
  eventFilterValues,
  eventSubject,
  eventsQuery,
  isNarrowed,
  type LogEvent,
  narrowedBy,
  parseLogsSearch,
  sharing,
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

describe("parseLogsSearch", () => {
  it("opens on the audit events with nothing narrowing them", () => {
    expect(parseLogsSearch({})).toEqual({
      view: "audit",
      category: undefined,
      request: undefined,
      session: undefined,
      flow: undefined,
    });
  });

  it("keeps what the list can send and drops the rest", () => {
    const parsed = parseLogsSearch({
      view: "all",
      category: "admin",
      request: " req_1 ",
      flow: "",
      session: 7,
      unknown: "x",
    });
    expect(parsed).toMatchObject({ view: "all", category: "admin", request: "req_1" });
    expect(parsed.flow).toBeUndefined();
    expect(parsed.session).toBeUndefined();
    expect(parsed).not.toHaveProperty("unknown");
  });

  it("drops the filters the API takes but no index serves", () => {
    const parsed = parseLogsSearch({ type: "user.deleted", actor: "user_1", resource: "user_2" });
    expect(parsed).not.toHaveProperty("type");
    expect(parsed).not.toHaveProperty("actor");
    expect(parsed).not.toHaveProperty("resource");
  });

  it("has no category among the requests, nor one the API does not narrow audit events by", () => {
    expect(parseLogsSearch({ view: "requests", category: "auth" }).category).toBeUndefined();
    expect(parseLogsSearch({ category: "request" }).category).toBeUndefined();
    expect(parseLogsSearch({ view: "nope" }).view).toBe("audit");
  });
});

describe("eventsQuery", () => {
  it("asks for every category but the requests' on the audit view", () => {
    expect(eventsQuery(parseLogsSearch({})).category).toEqual([
      "auth",
      "session",
      "admin",
      "entity",
      "signal",
    ]);
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
      parseLogsSearch({ view: "all", request: "req_1", session: "sess_1", flow: "flow_1" }),
    );
    expect(query).toEqual({
      category: undefined,
      request_id: "req_1",
      session_id: "sess_1",
      flow_id: "flow_1",
    });
  });
});

describe("narrowing by an event", () => {
  it("offers a filter per value the event carries that an index serves", () => {
    const carried = eventFilterValues(
      event({ actor_id: "user_1", entity_id: "user_2", request_id: "req_1", session_id: null }),
    );
    expect(carried.map(({ filter, value }) => [filter.key, value])).toEqual([["request", "req_1"]]);
  });

  it("adds a value to what already narrows the list, and reads every view", () => {
    const current = parseLogsSearch({ category: "entity" });
    for (const key of ["request", "session", "flow"] as const) {
      expect(narrowedBy(current, key, "id_1")).toMatchObject({
        view: "all",
        category: "entity",
        [key]: "id_1",
      });
    }
  });

  it("starts over from one shared value on the event's page", () => {
    expect(sharing("request", "req_1")).toEqual({ view: "all", request: "req_1" });
  });

  it("knows a narrowed list from a whole view", () => {
    expect(isNarrowed(parseLogsSearch({ view: "requests" }))).toBe(false);
    expect(isNarrowed(parseLogsSearch({ category: "auth" }))).toBe(true);
    expect(isNarrowed(parseLogsSearch({ flow: "flow_1" }))).toBe(true);
  });
});
