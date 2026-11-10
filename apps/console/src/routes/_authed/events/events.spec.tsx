import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";
import { formatTimestamp } from "@/lib/date";
import { scopedPath } from "@/test/project-scope.fixture";
import { server } from "@/test/msw";
import { createAppRouter } from "../../../router";

// The `_authed` layout guards every screen behind `GET /sessions/me`
// (Console ADR 0003); mock the auth module so routes render as signed in.
vi.mock("@/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/auth/session")>();
  const { makeTestSession } = await import("@/test/session.fixture");
  return { ...actual, fetchSession: vi.fn(async () => makeTestSession()) };
});

// Absolute base so requests parse under jsdom/undici and MSW can intercept.
const EVENTS_URL = "http://localhost/api/v1/events";

const OCCURRED_AT = "2026-11-10T08:15:43Z";

/** One entry of `GET /events`: a deleted user unless told otherwise. */
function event(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    project_id: "proj_test",
    team_id: null,
    event_type: "user.deleted",
    category: "entity",
    occurred_at: OCCURRED_AT,
    created_at: OCCURRED_AT,
    actor_id: "user_admin",
    actor_type: "human",
    entity_type: "user",
    entity_id: "user_gone",
    client_id: "",
    request_id: "0af7651916cd43dd8448eb211c80319c",
    session_id: null,
    flow_id: null,
    payload: {},
    metadata: {},
    ...overrides,
  };
}

/** A `request.api` event: the API call the server recorded. */
function request(id: string, payload: Record<string, unknown> = {}) {
  return event(id, {
    event_type: "request.api",
    category: "request",
    entity_type: null,
    entity_id: null,
    payload: {
      operation_id: "deleteUserByID",
      method: "DELETE",
      // The server records the operation as the route, never the raw path.
      route_template: "deleteUserByID",
      status: 204,
      duration_ms: 12,
      ...payload,
    },
  });
}

/** `GET /events`, answering each call with the next of `pages`; records the queries. */
function serveEvents(...pages: { data: unknown[]; next_page_token?: string }[]) {
  const queries: URLSearchParams[] = [];
  server.use(
    http.get(EVENTS_URL, ({ request: call }) => {
      queries.push(new URL(call.url).searchParams);
      const page = pages[Math.min(queries.length, pages.length) - 1];
      return HttpResponse.json(page);
    }),
  );
  return queries;
}

async function renderAt(path: string) {
  const router = createAppRouter({
    history: createMemoryHistory({ initialEntries: [scopedPath(path)] }),
  });
  render(<RouterProvider router={router} />);
  return router;
}

describe("logs", () => {
  it("shows the empty state when the project has no events", async () => {
    const queries = serveEvents({ data: [] });
    await renderAt("/events");

    expect(await screen.findByRole("heading", { name: "Logs" })).toBeInTheDocument();
    expect(screen.getByText("This project has no events.")).toBeInTheDocument();
    // The selected project's events, a page at a time.
    expect(queries[0]?.get("project_id")).toBe("proj_test");
    expect(queries[0]?.get("limit")).toBe("25");
  });

  it("lists each event with its type, what it was about, its actor and its time", async () => {
    serveEvents({
      data: [
        request("evt_2"),
        event("evt_1"),
        event("evt_0", {
          event_type: "auth.attempt.created",
          category: "auth",
          actor_id: null,
          actor_type: null,
          entity_type: "auth_attempt",
          entity_id: "att_1",
        }),
      ],
    });
    await renderAt("/events");

    const rows = await screen.findAllByRole("row");
    // The header row, then the three events in the server's order, newest first.
    expect(rows).toHaveLength(4);
    const [, requestRow, changeRow, anonymousRow] = rows as HTMLElement[];

    // An API request reads as its method, route and status.
    const first = within(requestRow as HTMLElement);
    expect(first.getByRole("link", { name: "request.api" })).toHaveAttribute(
      "href",
      scopedPath("/events/evt_2"),
    );
    expect(first.getByText("DELETE deleteUserByID")).toBeInTheDocument();
    expect(first.getByText("204")).toBeInTheDocument();
    expect(first.getByText(formatTimestamp(OCCURRED_AT))).toBeInTheDocument();

    // Any other event reads as the record it touched, and who caused it.
    const second = within(changeRow as HTMLElement);
    expect(second.getByRole("link", { name: "user.deleted" })).toHaveAttribute(
      "href",
      scopedPath("/events/evt_1"),
    );
    expect(second.getByText("user")).toBeInTheDocument();
    expect(second.getByText("user_gone")).toBeInTheDocument();
    expect(second.getByText("user_admin")).toBeInTheDocument();

    // The record's type is the API's value with its underscores read as
    // spaces; an event nobody signed in for has no actor.
    const third = within(anonymousRow as HTMLElement);
    expect(third.getByText("auth attempt")).toBeInTheDocument();
    expect(third.getByText("—")).toBeInTheDocument();
  });

  it("appends the next page on Load more", async () => {
    const queries = serveEvents(
      { data: [event("evt_2")], next_page_token: "page-2" },
      { data: [event("evt_1", { event_type: "user.created" })] },
    );
    await renderAt("/events");

    await userEvent.click(await screen.findByRole("button", { name: "Load more" }));

    expect(await screen.findByRole("link", { name: "user.created" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "user.deleted" })).toBeInTheDocument();
    expect(queries[1]?.get("page_token")).toBe("page-2");
    // Absent rather than disabled: its absence says the list is complete.
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
  });

  it("reads the list again from the newest event on Refresh", async () => {
    const queries = serveEvents(
      { data: [event("evt_1")] },
      { data: [event("evt_2", { event_type: "user.created" }), event("evt_1")] },
    );
    await renderAt("/events");
    await screen.findByRole("link", { name: "user.deleted" });

    await userEvent.click(screen.getByRole("button", { name: "Refresh" }));

    expect(await screen.findByRole("link", { name: "user.created" })).toBeInTheDocument();
    // From the top: a refresh never carries a page token.
    expect(queries).toHaveLength(2);
    expect(queries[1]?.has("page_token")).toBe(false);
  });

  it("opens an event from its row", async () => {
    serveEvents({ data: [event("evt_1")] });
    server.use(http.get(`${EVENTS_URL}/evt_1`, () => HttpResponse.json(event("evt_1"))));
    const router = await renderAt("/events");

    await userEvent.click(await screen.findByRole("link", { name: "user.deleted" }));

    await waitFor(() => expect(router.state.resolvedLocation?.pathname).toBe("/events/evt_1"));
  });
});

describe("event detail", () => {
  it("shows the event's identity, the values it carries and its document", async () => {
    const queries: URLSearchParams[] = [];
    server.use(
      http.get(`${EVENTS_URL}/evt_1`, ({ request: call }) => {
        queries.push(new URL(call.url).searchParams);
        return HttpResponse.json(event("evt_1"));
      }),
    );
    await renderAt("/events/evt_1");

    expect(await screen.findByRole("heading", { name: "user.deleted" })).toBeInTheDocument();
    // An event is read within its project: the id alone does not find it.
    expect(queries[0]?.get("project_id")).toBe("proj_test");
    expect(screen.getByText("evt_1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy Event ID" })).toBeInTheDocument();
    expect(screen.getByText(formatTimestamp(OCCURRED_AT))).toBeInTheDocument();

    const details = within(
      screen.getByRole("heading", { name: "Details" }).closest("[data-slot='card']") as HTMLElement,
    );
    expect(details.getByText("Actor")).toBeInTheDocument();
    expect(details.getByText("user_admin")).toBeInTheDocument();
    expect(details.getByRole("button", { name: "Copy Actor" })).toBeInTheDocument();
    expect(details.getByText("Resource ID")).toBeInTheDocument();
    expect(details.getByText("user_gone")).toBeInTheDocument();
    expect(details.getByRole("button", { name: "Copy Request ID" })).toBeInTheDocument();
    // A plain value has nothing to copy, and an unset one has no row.
    expect(details.queryByRole("button", { name: "Copy Category" })).not.toBeInTheDocument();
    expect(details.queryByText("Session ID")).not.toBeInTheDocument();

    // The event as the API returns it, to copy whole. Nothing deploys an
    // event, so the viewer names no command.
    expect(
      screen.getByRole("button", { name: "Copy the event document as JSON" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/deploy your changes/)).not.toBeInTheDocument();
  });

  it("says the event is gone when the project does not hold it, and leads back to Logs", async () => {
    // The loader error is expected: silence the error boundary's dump and the
    // router's route-match warning.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      server.use(
        http.get(`${EVENTS_URL}/evt_gone`, () =>
          HttpResponse.json(
            { code: "evt.not_found", message: "event: not found" },
            { status: 404 },
          ),
        ),
      );
      serveEvents({ data: [] });
      const router = await renderAt("/events/evt_gone");

      // Retention deletes an event by age, so a kept link can outlive it.
      expect(await screen.findByRole("heading", { name: "Event not found" })).toBeInTheDocument();

      await userEvent.click(screen.getByRole("link", { name: "Back to Logs" }));
      await waitFor(() => expect(router.state.resolvedLocation?.pathname).toBe("/events"));
    } finally {
      errorSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });
});
