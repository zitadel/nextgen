import { describe, expect, it } from "vitest";

import { eventFields, eventSubject, type LogEvent } from "./model";

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
