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
const REQUEST_ID = "req_01TESTREQUEST";

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
    request_id: REQUEST_ID,
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

/** Opens the menu of the row that holds the link `name`, and returns its items' scope. */
async function openRowMenu(name: string) {
  const row = (await screen.findByRole("link", { name })).closest("tr") as HTMLElement;
  await userEvent.click(within(row).getByRole("button", { name: /^Actions for/ }));
  return within(await screen.findByRole("menu"));
}

describe("logs", () => {
  it("opens on the audit events, and says so when the project has none", async () => {
    const queries = serveEvents({ data: [] });
    await renderAt("/events");

    expect(await screen.findByRole("heading", { name: "Logs" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Audit events", selected: true })).toBeInTheDocument();
    expect(screen.getByText("This project has no audit events.")).toBeInTheDocument();
    // The selected project's events, a page at a time, without the API
    // requests: every category but theirs.
    expect(queries[0]?.get("project_id")).toBe("proj_test");
    expect(queries[0]?.get("limit")).toBe("25");
    expect(queries[0]?.getAll("category")).toEqual([
      "auth",
      "session",
      "admin",
      "entity",
      "signal",
    ]);
  });

  it("lists each event with its type, what it was about, its actor and its time", async () => {
    const queries = serveEvents({
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
    await renderAt("/events?view=all");

    const rows = await screen.findAllByRole("row");
    // The header row, then the three events in the server's order, newest first.
    expect(rows).toHaveLength(4);
    const [, requestRow, changeRow, anonymousRow] = rows as HTMLElement[];
    // Every event: no category is asked for.
    expect(queries[0]?.has("category")).toBe(false);

    // An API request reads as its method, operation and status.
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

  it("appends the next page on Load more, under the filters the list began with", async () => {
    const queries = serveEvents(
      { data: [event("evt_2")], next_page_token: "page-2" },
      { data: [event("evt_1", { event_type: "user.created" })] },
    );
    await renderAt("/events?category=entity&session=sess_1");

    await userEvent.click(await screen.findByRole("button", { name: "Load more" }));

    expect(await screen.findByRole("link", { name: "user.created" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "user.deleted" })).toBeInTheDocument();
    // A page token answers the question the first page asked.
    expect(queries[1]?.get("page_token")).toBe("page-2");
    expect(queries[1]?.getAll("category")).toEqual(["entity"]);
    expect(queries[1]?.get("session_id")).toBe("sess_1");
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

describe("logs filters", () => {
  it("lists the API requests alone on their tab, which has no category to narrow by", async () => {
    const queries = serveEvents({ data: [event("evt_1")] }, { data: [request("evt_2")] });
    const router = await renderAt("/events");
    await screen.findByRole("link", { name: "user.deleted" });
    expect(screen.getByRole("combobox", { name: "Filter by category" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: "API requests" }));

    expect(await screen.findByRole("link", { name: "request.api" })).toBeInTheDocument();
    expect(queries[1]?.getAll("category")).toEqual(["request"]);
    await waitFor(() =>
      expect(router.state.resolvedLocation?.search).toMatchObject({ view: "requests" }),
    );
    expect(screen.queryByRole("combobox", { name: "Filter by category" })).not.toBeInTheDocument();
  });

  it("says so when the project has no API requests", async () => {
    serveEvents({ data: [] });
    await renderAt("/events?view=requests");

    expect(await screen.findByText("This project has no API requests.")).toBeInTheDocument();
  });

  it("narrows the audit events to one category, and clears it again", async () => {
    const queries = serveEvents({ data: [event("evt_1")] });
    const router = await renderAt("/events");
    await screen.findByRole("link", { name: "user.deleted" });

    await userEvent.click(screen.getByRole("combobox", { name: "Filter by category" }));
    // The API's own values.
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
      "auth",
      "session",
      "admin",
      "entity",
    ]);
    await userEvent.click(screen.getByRole("option", { name: "auth" }));

    await waitFor(() => expect(queries.at(-1)?.getAll("category")).toEqual(["auth"]));
    expect(router.state.resolvedLocation?.search).toMatchObject({ category: "auth" });

    await userEvent.click(screen.getByRole("button", { name: "Clear the category filter" }));

    await waitFor(() =>
      expect(queries.at(-1)?.getAll("category")).toEqual([
        "auth",
        "session",
        "admin",
        "entity",
        "signal",
      ]),
    );
    expect(router.state.resolvedLocation?.search.category).toBeUndefined();
  });

  it("narrows by what an event carries from its row menu, on top of what is set", async () => {
    const queries = serveEvents({ data: [event("evt_1", { session_id: "sess_1" })] });
    const router = await renderAt("/events?category=entity");

    const menu = await openRowMenu("user.deleted");
    // The event's own page, then one item per value it carries that an index
    // serves; it has no login flow. Its type, actor and resource are not
    // offered: the server would read every event of the project for them.
    expect(menu.getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "View event",
      "Only this request",
      "Only this session",
    ]);
    await userEvent.click(menu.getByRole("menuitem", { name: "Only this session" }));

    await waitFor(() => expect(queries.at(-1)?.get("session_id")).toBe("sess_1"));
    // The category stays: the session narrows it further. A session ties
    // audit events to the requests behind them, so every view is read.
    expect(queries.at(-1)?.getAll("category")).toEqual(["entity"]);
    expect(router.state.resolvedLocation?.search).toMatchObject({
      view: "all",
      category: "entity",
      session: "sess_1",
    });
    // Set, it shows on the title row with its value, and the row no longer
    // offers it.
    expect(
      await screen.findByRole("button", { name: "Clear the session filter" }),
    ).toHaveTextContent("Sessionsess_1");
    const again = await openRowMenu("user.deleted");
    expect(again.queryByRole("menuitem", { name: "Only this session" })).not.toBeInTheDocument();
  });

  it("follows a request through every view, since its own event is not an audit event", async () => {
    const queries = serveEvents(
      { data: [event("evt_1")] },
      { data: [request("evt_2"), event("evt_1")] },
    );
    const router = await renderAt("/events");

    const menu = await openRowMenu("user.deleted");
    await userEvent.click(menu.getByRole("menuitem", { name: "Only this request" }));

    expect(await screen.findByRole("link", { name: "request.api" })).toBeInTheDocument();
    expect(queries[1]?.get("request_id")).toBe(REQUEST_ID);
    expect(queries[1]?.has("category")).toBe(false);
    expect(router.state.resolvedLocation?.search).toMatchObject({
      view: "all",
      request: REQUEST_ID,
    });
    expect(screen.getByRole("tab", { name: "All", selected: true })).toBeInTheDocument();
  });

  it("sends every filter the URL carries, and clears one from the title row", async () => {
    const queries = serveEvents({ data: [] });
    const router = await renderAt("/events?view=all&request=req_1&session=sess_1&flow=flow_1");

    // Nothing matches, which is not the project having no events.
    expect(await screen.findByText("No events match these filters.")).toBeInTheDocument();
    expect(queries[0]?.get("request_id")).toBe("req_1");
    expect(queries[0]?.get("session_id")).toBe("sess_1");
    expect(queries[0]?.get("flow_id")).toBe("flow_1");

    await userEvent.click(screen.getByRole("button", { name: "Clear the login flow filter" }));

    await waitFor(() => expect(queries.at(-1)?.has("flow_id")).toBe(false));
    expect(queries.at(-1)?.get("session_id")).toBe("sess_1");
    expect(router.state.resolvedLocation?.search.flow).toBeUndefined();
    expect(
      screen.queryByRole("button", { name: "Clear the login flow filter" }),
    ).not.toBeInTheDocument();
  });

  it("never sends a filter no index serves, though the API would take it", async () => {
    const queries = serveEvents({ data: [event("evt_1")] });
    await renderAt("/events?type=user.deleted&actor=user_admin&resource=user_gone");

    await screen.findByRole("link", { name: "user.deleted" });
    expect(queries[0]?.has("event_type")).toBe(false);
    expect(queries[0]?.has("actor_id")).toBe(false);
    expect(queries[0]?.has("entity_id")).toBe(false);
    expect(screen.queryByRole("button", { name: /^Clear the/ })).not.toBeInTheDocument();
  });

  it("opens on the default view for a view or a category the URL makes up", async () => {
    const queries = serveEvents({ data: [] });
    await renderAt("/events?view=everything&category=request");

    expect(
      await screen.findByRole("tab", { name: "Audit events", selected: true }),
    ).toBeInTheDocument();
    expect(queries[0]?.getAll("category")).toEqual([
      "auth",
      "session",
      "admin",
      "entity",
      "signal",
    ]);
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

  it("leads on to the events of its request, session or login flow, in every view", async () => {
    const opened = event("evt_1", { session_id: "sess_1" });
    server.use(http.get(`${EVENTS_URL}/evt_1`, () => HttpResponse.json(opened)));
    const queries = serveEvents({ data: [request("evt_2"), opened] });
    const router = await renderAt("/events/evt_1");

    const related = within(
      (await screen.findByRole("heading", { name: "Related events" })).closest(
        "[data-slot='card']",
      ) as HTMLElement,
    );
    // One link per value the event carries: it has no login flow.
    expect(related.getAllByRole("link").map((link) => link.textContent)).toEqual([
      "Same request",
      "Same session",
    ]);

    await userEvent.click(related.getByRole("link", { name: "Same request" }));

    await waitFor(() => expect(router.state.resolvedLocation?.pathname).toBe("/events"));
    expect(router.state.resolvedLocation?.search).toMatchObject({
      view: "all",
      request: REQUEST_ID,
      project: "proj_test",
    });
    expect(queries[0]?.get("request_id")).toBe(REQUEST_ID);
    expect(queries[0]?.has("category")).toBe(false);
    expect(
      await screen.findByRole("button", { name: "Clear the request filter" }),
    ).toBeInTheDocument();
  });

  it("leads on to nothing from an event outside any request, session and login flow", async () => {
    server.use(
      http.get(`${EVENTS_URL}/evt_1`, () =>
        HttpResponse.json(
          event("evt_1", { request_id: null, actor_id: null, actor_type: "system" }),
        ),
      ),
    );
    await renderAt("/events/evt_1");

    expect(await screen.findByRole("heading", { name: "Details" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Related events" })).not.toBeInTheDocument();
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
