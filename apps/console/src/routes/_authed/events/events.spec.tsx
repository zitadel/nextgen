import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
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
/** Every category but the requests', which the audit view asks for. */
const AUDIT = ["auth", "session", "admin", "entity", "signal"];
/** The filters the console must never send: no index serves them. */
const UNSERVED = ["client_id", "fingerprint", "team_id", "entity_type", "created_before"];

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

/** The Logs list of the sidebar: its views, then its filters. */
async function logsNav() {
  return within(await screen.findByRole("navigation", { name: "Logs" }));
}

async function filters() {
  return within(await screen.findByRole("group", { name: "Filters" }));
}

/** Opens the menu of the row that holds the link `name`, and returns its items' scope. */
async function openRowMenu(name: string) {
  const row = (await screen.findByRole("link", { name })).closest("tr") as HTMLElement;
  await userEvent.click(within(row).getByRole("button", { name: /^Actions for/ }));
  return within(await screen.findByRole("menu"));
}

/**
 * Nothing the console sends may be a filter no index serves, or more than one
 * range of one index: a filter that reads on its own has nothing beside it.
 */
function expectServed(query: URLSearchParams | undefined) {
  for (const key of UNSERVED) expect(query?.has(key), key).toBe(false);
  const alone = ["event_type", "entity_id", "request_id", "session_id", "flow_id"].filter((key) =>
    query?.has(key),
  );
  expect(alone.length, alone.join()).toBeLessThanOrEqual(1);
  if (alone.length === 1) {
    expect(query?.has("category"), alone[0]).toBe(false);
    expect(query?.has("actor_id"), alone[0]).toBe(false);
  }
}

describe("logs", () => {
  it("opens on the audit events, and says so when the project has none", async () => {
    const queries = serveEvents({ data: [] });
    await renderAt("/events");

    expect(await screen.findByRole("heading", { name: "Logs" })).toBeInTheDocument();
    expect((await logsNav()).getByRole("link", { name: "Audit events" })).toHaveAttribute(
      "data-active",
      "true",
    );
    expect(screen.getByText("This project has no audit events.")).toBeInTheDocument();
    // The selected project's events, a page at a time, without the API
    // requests: every category but theirs, and everything retained.
    expect(queries[0]?.get("project_id")).toBe("proj_test");
    expect(queries[0]?.get("limit")).toBe("25");
    expect(queries[0]?.getAll("category")).toEqual(AUDIT);
    expect(queries[0]?.has("created_after")).toBe(false);
    expectServed(queries[0]);
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

  it("appends the next page on Load more, under the filters and the range the list began with", async () => {
    const queries = serveEvents(
      { data: [event("evt_2")], next_page_token: "page-2" },
      { data: [event("evt_1", { event_type: "user.created" })] },
    );
    await renderAt("/events?category=entity&actor=user_admin&since=24h");

    await userEvent.click(await screen.findByRole("button", { name: "Load more" }));

    expect(await screen.findByRole("link", { name: "user.created" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "user.deleted" })).toBeInTheDocument();
    // A page token answers the question the first page asked.
    expect(queries[1]?.get("page_token")).toBe("page-2");
    expect(queries[1]?.getAll("category")).toEqual(["entity"]);
    expect(queries[1]?.get("actor_id")).toBe("user_admin");
    // The range was counted back once, when the list loaded: a second page
    // that counted again would slide past the rows between the two moments.
    const start = queries[0]?.get("created_after");
    expect(start).toBeTruthy();
    expect(queries[1]?.get("created_after")).toBe(start);
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

describe("logs views", () => {
  it("lists the views in the sidebar, in place of the project's screens", async () => {
    serveEvents({ data: [] });
    await renderAt("/events");

    const nav = await logsNav();
    expect(nav.getAllByRole("link").map((link) => link.textContent?.trim())).toEqual([
      "Logs",
      "Audit events",
      "API requests",
      "All",
    ]);
    expect(screen.queryByRole("navigation", { name: "Primary" })).not.toBeInTheDocument();
    // The views are the sidebar's: the page repeats none of them.
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
  });

  it("lists the API requests alone in their view, which has no category to narrow by", async () => {
    const queries = serveEvents({ data: [event("evt_1")] }, { data: [request("evt_2")] });
    const router = await renderAt("/events");
    await screen.findByRole("link", { name: "user.deleted" });
    expect((await filters()).getByRole("combobox", { name: "Category" })).toBeInTheDocument();

    await userEvent.click((await logsNav()).getByRole("link", { name: "API requests" }));

    expect(await screen.findByRole("link", { name: "request.api" })).toBeInTheDocument();
    expect(queries[1]?.getAll("category")).toEqual(["request"]);
    await waitFor(() =>
      expect(router.state.resolvedLocation?.search).toMatchObject({ view: "requests" }),
    );
    expect((await logsNav()).getByRole("link", { name: "API requests" })).toHaveAttribute(
      "data-active",
      "true",
    );
    expect((await filters()).queryByRole("combobox", { name: "Category" })).not.toBeInTheDocument();
  });

  it("says so when the project has no API requests", async () => {
    serveEvents({ data: [] });
    await renderAt("/events?view=requests");

    expect(await screen.findByText("This project has no API requests.")).toBeInTheDocument();
  });

  it("opens on the default view for a view or a category the URL makes up", async () => {
    const queries = serveEvents({ data: [] });
    await renderAt("/events?view=everything&category=request&since=forever");

    expect((await logsNav()).getByRole("link", { name: "Audit events" })).toHaveAttribute(
      "data-active",
      "true",
    );
    expect(queries[0]?.getAll("category")).toEqual(AUDIT);
    expect(queries[0]?.has("created_after")).toBe(false);
  });
});

describe("logs filters", () => {
  it("narrows the audit events to one category, and back to all of them", async () => {
    const queries = serveEvents({ data: [event("evt_1")] });
    const router = await renderAt("/events");
    await screen.findByRole("link", { name: "user.deleted" });

    await userEvent.click((await filters()).getByRole("combobox", { name: "Category" }));
    // The API's own values, under the choice of none.
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
      "Any category",
      "auth",
      "session",
      "admin",
      "entity",
    ]);
    await userEvent.click(screen.getByRole("option", { name: "auth" }));

    await waitFor(() => expect(queries.at(-1)?.getAll("category")).toEqual(["auth"]));
    expect(router.state.resolvedLocation?.search).toMatchObject({ category: "auth" });

    await userEvent.click((await filters()).getByRole("combobox", { name: "Category" }));
    await userEvent.click(screen.getByRole("option", { name: "Any category" }));

    await waitFor(() => expect(queries.at(-1)?.getAll("category")).toEqual(AUDIT));
    expect(router.state.resolvedLocation?.search.category).toBeUndefined();
  });

  it("reads back only as far as the time range", async () => {
    const queries = serveEvents({ data: [event("evt_1")] });
    const router = await renderAt("/events");
    await screen.findByRole("link", { name: "user.deleted" });

    await userEvent.click((await filters()).getByRole("combobox", { name: "Timeline" }));
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
      "Everything retained",
      "Last hour",
      "Last 24 hours",
      "Last 7 days",
    ]);
    const before = Date.now();
    await userEvent.click(screen.getByRole("option", { name: "Last 24 hours" }));

    await waitFor(() => expect(queries.at(-1)?.has("created_after")).toBe(true));
    const start = Date.parse(queries.at(-1)?.get("created_after") ?? "");
    const day = 24 * 60 * 60 * 1000;
    expect(start).toBeGreaterThanOrEqual(before - day);
    expect(start).toBeLessThanOrEqual(Date.now() - day);
    // The range bounds the view it is on: the categories stay.
    expect(queries.at(-1)?.getAll("category")).toEqual(AUDIT);
    expect(router.state.resolvedLocation?.search).toMatchObject({ since: "24h" });
  });

  it("narrows by a value typed into its field, and clears it there", async () => {
    const queries = serveEvents({ data: [event("evt_1")] });
    const router = await renderAt("/events?category=entity");
    await screen.findByRole("link", { name: "user.deleted" });

    const actor = (await filters()).getByRole("textbox", { name: "Actor" });
    // The value is matched whole: nothing is asked while it is being typed.
    await userEvent.type(actor, "user_admin");
    expect(queries).toHaveLength(1);
    await userEvent.keyboard("{Enter}");

    await waitFor(() => expect(queries.at(-1)?.get("actor_id")).toBe("user_admin"));
    // An actor narrows the view it is on: what this person changed.
    expect(queries.at(-1)?.getAll("category")).toEqual(["entity"]);
    expect(router.state.resolvedLocation?.search).toMatchObject({
      view: "audit",
      category: "entity",
      actor: "user_admin",
    });
    expectServed(queries.at(-1));

    await userEvent.click(
      (await filters()).getByRole("button", { name: "Clear the actor filter" }),
    );

    await waitFor(() => expect(queries.at(-1)?.has("actor_id")).toBe(false));
    expect((await filters()).getByRole("textbox", { name: "Actor" })).toHaveValue("");
  });

  it("applies a typed value with the field's button too", async () => {
    const queries = serveEvents({ data: [] });
    await renderAt("/events?view=all");
    await screen.findByText("This project has no events.");

    await userEvent.type((await filters()).getByRole("textbox", { name: "Resource" }), "team_1");
    await userEvent.click(
      (await filters()).getByRole("button", { name: "Apply the resource filter" }),
    );

    await waitFor(() => expect(queries.at(-1)?.get("entity_id")).toBe("team_1"));
  });

  it("has a field for each value an event carries", async () => {
    serveEvents({ data: [] });
    await renderAt("/events");

    const group = await filters();
    for (const name of ["Type", "Actor", "Resource", "Request", "Session", "Login flow"]) {
      expect(group.getByRole("textbox", { name })).toBeInTheDocument();
    }
    // The API has no count of the events behind a value: none is drawn.
    expect(group.queryByText(/^\d+$/)).not.toBeInTheDocument();
  });

  it("reads a type on its own: it takes the All view, and no category or actor", async () => {
    const queries = serveEvents({ data: [event("evt_1")] });
    const router = await renderAt("/events?category=entity&actor=user_admin");
    await screen.findByRole("link", { name: "user.deleted" });

    await userEvent.type((await filters()).getByRole("textbox", { name: "Type" }), "user.deleted");
    await userEvent.keyboard("{Enter}");

    await waitFor(() => expect(queries.at(-1)?.getAll("event_type")).toEqual(["user.deleted"]));
    // The type's index holds no category and no actor, so neither is sent.
    expect(queries.at(-1)?.has("category")).toBe(false);
    expect(queries.at(-1)?.has("actor_id")).toBe(false);
    expect(router.state.resolvedLocation?.search).toMatchObject({
      view: "all",
      type: "user.deleted",
    });
    expect(router.state.resolvedLocation?.search.category).toBeUndefined();
    expect(router.state.resolvedLocation?.search.actor).toBeUndefined();
    expect((await filters()).getByRole("textbox", { name: "Actor" })).toHaveValue("");
  });

  describe("with a type set", () => {
    const START = "/events?view=all&type=user.deleted";

    it("gives up the type for an actor", async () => {
      const queries = serveEvents({ data: [event("evt_1")] });
      const router = await renderAt(START);
      await screen.findByRole("link", { name: "user.deleted" });
      expect(queries[0]?.getAll("event_type")).toEqual(["user.deleted"]);

      await userEvent.type(
        (await filters()).getByRole("textbox", { name: "Actor" }),
        "user_admin{Enter}",
      );

      await waitFor(() => expect(queries.at(-1)?.get("actor_id")).toBe("user_admin"));
      expect(queries.at(-1)?.has("event_type")).toBe(false);
      expect(router.state.resolvedLocation?.search.type).toBeUndefined();
      expect((await filters()).getByRole("textbox", { name: "Type" })).toHaveValue("");
    });

    it("gives up the type for a category", async () => {
      const queries = serveEvents({ data: [event("evt_1")] });
      const router = await renderAt(START);
      await screen.findByRole("link", { name: "user.deleted" });

      await userEvent.click((await filters()).getByRole("combobox", { name: "Category" }));
      await userEvent.click(screen.getByRole("option", { name: "entity" }));

      await waitFor(() => expect(queries.at(-1)?.getAll("category")).toEqual(["entity"]));
      expect(queries.at(-1)?.has("event_type")).toBe(false);
      expect(router.state.resolvedLocation?.search.type).toBeUndefined();
    });

    it("gives up the type for a view other than All", async () => {
      const queries = serveEvents({ data: [event("evt_1")] });
      const router = await renderAt(START);
      await screen.findByRole("link", { name: "user.deleted" });

      await userEvent.click((await logsNav()).getByRole("link", { name: "Audit events" }));

      await waitFor(() => expect(queries.at(-1)?.getAll("category")).toEqual(AUDIT));
      expect(queries.at(-1)?.has("event_type")).toBe(false);
      expect(router.state.resolvedLocation?.search.type).toBeUndefined();
    });

    it("keeps the type beside a time range", async () => {
      const queries = serveEvents({ data: [event("evt_1")] });
      await renderAt(`${START}&since=7d`);
      await screen.findByRole("link", { name: "user.deleted" });

      expect(queries[0]?.getAll("event_type")).toEqual(["user.deleted"]);
      expect(queries[0]?.has("created_after")).toBe(true);
      expectServed(queries[0]);
    });
  });

  it("never sends a combination no index serves, whatever the URL says", async () => {
    const queries = serveEvents({ data: [] });
    await renderAt(
      "/events?view=audit&category=auth&type=user.deleted&actor=user_admin&client_id=app_1&team_id=team_1&entity_type=user",
    );

    await screen.findByText("No events match these filters.");
    // A type beside a category and an actor: the type is read on its own.
    expect(queries[0]?.getAll("event_type")).toEqual(["user.deleted"]);
    expect(queries[0]?.has("category")).toBe(false);
    expect(queries[0]?.has("actor_id")).toBe(false);
    expectServed(queries[0]);
    expect((await logsNav()).getByRole("link", { name: "All" })).toHaveAttribute(
      "data-active",
      "true",
    );
  });

  it("reads one ID on its own, whatever the URL puts beside it, and clears the filters at once", async () => {
    const queries = serveEvents({ data: [] });
    const router = await renderAt(
      "/events?view=audit&category=auth&since=7d&actor=user_admin&resource=user_gone&request=req_1&session=sess_1&flow=flow_1",
    );

    // Nothing matches, which is not the project having no events.
    expect(await screen.findByText("No events match these filters.")).toBeInTheDocument();
    // A session or a resource can hold as many events as the project, so
    // nothing is matched row by row over one: the request reads alone.
    expect(queries[0]?.get("request_id")).toBe("req_1");
    for (const dropped of ["actor_id", "entity_id", "session_id", "flow_id", "category"]) {
      expect(queries[0]?.has(dropped), dropped).toBe(false);
    }
    expect(queries[0]?.has("created_after")).toBe(true);
    expectServed(queries[0]);
    // The fields show what the list is narrowed to, and nothing it is not.
    expect((await filters()).getByRole("textbox", { name: "Request" })).toHaveValue("req_1");
    expect((await filters()).getByRole("textbox", { name: "Session" })).toHaveValue("");
    expect(router.state.resolvedLocation?.search).toMatchObject({ view: "all", request: "req_1" });
    expect(router.state.resolvedLocation?.search.session).toBeUndefined();

    await userEvent.click((await filters()).getByRole("button", { name: "Clear filters" }));

    await waitFor(() => expect(queries.at(-1)?.has("request_id")).toBe(false));
    expect(queries.at(-1)?.has("created_after")).toBe(false);
    // The view stays: clearing the filters is not leaving it.
    expect(router.state.resolvedLocation?.search).toMatchObject({ view: "all" });
    expect(await screen.findByText("This project has no events.")).toBeInTheDocument();
    expect(
      (await filters()).queryByRole("button", { name: "Clear filters" }),
    ).not.toBeInTheDocument();
  });

  it("narrows by what an event carries from its row menu, on top of what is set", async () => {
    const queries = serveEvents({ data: [event("evt_1", { session_id: "sess_1" })] });
    const router = await renderAt("/events?category=entity");

    const menu = await openRowMenu("user.deleted");
    // The event's own page, then one item per value it carries; it has no
    // login flow.
    expect(menu.getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "View event",
      "Only this type",
      "Only this actor",
      "Only this resource",
      "Only this request",
      "Only this session",
    ]);
    await userEvent.click(menu.getByRole("menuitem", { name: "Only this actor" }));

    await waitFor(() => expect(queries.at(-1)?.get("actor_id")).toBe("user_admin"));
    // The category stays: the actor narrows it further.
    expect(queries.at(-1)?.getAll("category")).toEqual(["entity"]);
    expect(router.state.resolvedLocation?.search).toMatchObject({
      view: "audit",
      category: "entity",
      actor: "user_admin",
    });
    // Set, it shows in its field, and the row no longer offers it.
    expect((await filters()).getByRole("textbox", { name: "Actor" })).toHaveValue("user_admin");
    const again = await openRowMenu("user.deleted");
    expect(again.queryByRole("menuitem", { name: "Only this actor" })).not.toBeInTheDocument();
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
    expect((await logsNav()).getByRole("link", { name: "All" })).toHaveAttribute(
      "data-active",
      "true",
    );
  });
});

describe("logs search", () => {
  const find = () => screen.findByRole("searchbox", { name: "Find events by ID or event type" });

  it("says in the field what it takes", async () => {
    serveEvents({ data: [] });
    await renderAt("/events");

    expect(await find()).toHaveAttribute("placeholder", "Find by ID or event type");
  });

  it("follows a request, a session or a login flow from its ID", async () => {
    const queries = serveEvents({ data: [event("evt_1")] });
    const router = await renderAt("/events");
    await screen.findByRole("link", { name: "user.deleted" });

    for (const [term, param, key] of [
      ["req_1", "request_id", "request"],
      ["sess_1", "session_id", "session"],
      ["flow_1", "flow_id", "flow"],
      // A request ID as a trace ID.
      ["0af7651916cd43dd8448eb211c80319c", "request_id", "request"],
    ] as const) {
      await userEvent.type(await find(), `${term}{Enter}`);

      await waitFor(() => expect(queries.at(-1)?.get(param)).toBe(term));
      expect(router.state.resolvedLocation?.search).toMatchObject({ view: "all", [key]: term });
      // The term became a filter: the field is ready for the next one.
      expect(await find()).toHaveValue("");
    }
  });

  it("narrows to an event type from its name", async () => {
    const queries = serveEvents({ data: [event("evt_1")] });
    await renderAt("/events");
    await screen.findByRole("link", { name: "user.deleted" });

    await userEvent.type(await find(), "auth.check.failed{Enter}");

    await waitFor(() =>
      expect(queries.at(-1)?.getAll("event_type")).toEqual(["auth.check.failed"]),
    );
    expect(queries.at(-1)?.has("category")).toBe(false);
    expect((await filters()).getByRole("textbox", { name: "Type" })).toHaveValue(
      "auth.check.failed",
    );
  });

  it("opens the event an event ID names", async () => {
    serveEvents({ data: [event("evt_1")] });
    server.use(http.get(`${EVENTS_URL}/evt_9`, () => HttpResponse.json(event("evt_9"))));
    const router = await renderAt("/events");
    await screen.findByRole("link", { name: "user.deleted" });

    await userEvent.type(await find(), "evt_9{Enter}");

    await waitFor(() => expect(router.state.resolvedLocation?.pathname).toBe("/events/evt_9"));
  });

  it("asks whether another ID is an actor or a resource, rather than guessing", async () => {
    const queries = serveEvents({ data: [event("evt_1")] });
    const router = await renderAt("/events");
    await screen.findByRole("link", { name: "user.deleted" });

    await userEvent.type(await find(), "user_gone{Enter}");

    // Enter chose nothing: both readings are offered.
    expect(queries).toHaveLength(1);
    expect(await screen.findByText("This ID can be either. Choose one:")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Actor user_gone/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /^Resource user_gone/ }));

    await waitFor(() => expect(queries.at(-1)?.get("entity_id")).toBe("user_gone"));
    expect(queries.at(-1)?.has("actor_id")).toBe(false);
    expect(router.state.resolvedLocation?.search).toMatchObject({ resource: "user_gone" });
  });

  it("reaches the choices with the arrow key", async () => {
    const queries = serveEvents({ data: [event("evt_1")] });
    await renderAt("/events");
    await screen.findByRole("link", { name: "user.deleted" });

    await userEvent.type(await find(), "user_admin{ArrowDown}");
    expect(await screen.findByRole("button", { name: /^Actor user_admin/ })).toHaveFocus();
    await userEvent.keyboard("{Enter}");

    await waitFor(() => expect(queries.at(-1)?.get("actor_id")).toBe("user_admin"));
  });

  it("is not a text search, and says so", async () => {
    const queries = serveEvents({ data: [event("evt_1")] });
    await renderAt("/events");
    await screen.findByRole("link", { name: "user.deleted" });

    await userEvent.type(await find(), "failed sign in{Enter}");

    expect(await screen.findByText(/There is no text search\./)).toBeInTheDocument();
    expect(queries).toHaveLength(1);
  });
});

describe("logs with the sidebar as an icon rail", () => {
  afterEach(() => {
    // biome-ignore lint/suspicious/noDocumentCookie: the sidebar keeps its state in this cookie
    document.cookie = "sidebar_state=; path=/; max-age=0";
    vi.restoreAllMocks();
  });

  it("draws no way to the filters beside the open sidebar, which shows them", async () => {
    serveEvents({ data: [] });
    await renderAt("/events");

    await screen.findByRole("heading", { name: "Logs" });
    expect(screen.queryByRole("button", { name: /^Views and filters/ })).not.toBeInTheDocument();
  });

  it("names the view and the filters on the page, and opens the collapsed sidebar", async () => {
    // biome-ignore lint/suspicious/noDocumentCookie: the sidebar keeps its state in this cookie
    document.cookie = "sidebar_state=false; path=/";
    serveEvents({ data: [] });
    await renderAt("/events?view=all&actor=user_admin&since=24h");

    const open = await screen.findByRole("button", {
      name: "Views and filters: All, 2 filters",
    });
    await userEvent.click(open);

    // Open, the sidebar says it itself.
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /^Views and filters/ })).not.toBeInTheDocument(),
    );
  });

  it("opens the views and filters over the page on a phone", async () => {
    vi.spyOn(window, "matchMedia").mockImplementation(
      (query) =>
        ({
          matches: query.includes("max-width"),
          media: query,
          onchange: null,
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
          addListener: () => undefined,
          removeListener: () => undefined,
          dispatchEvent: () => false,
        }) as unknown as MediaQueryList,
    );
    const queries = serveEvents({ data: [] });
    await renderAt("/events");

    await userEvent.click(
      await screen.findByRole("button", { name: "Views and filters: Audit events" }),
    );

    // The whole Logs list, over the page: its views and its filters.
    const sheet = within(await screen.findByRole("dialog"));
    expect(sheet.getByRole("link", { name: "API requests" })).toBeInTheDocument();
    await userEvent.type(sheet.getByRole("textbox", { name: "Session" }), "sess_1{Enter}");

    await waitFor(() => expect(queries.at(-1)?.get("session_id")).toBe("sess_1"));
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

  it("leads on to the events that share one of its values, in every view", async () => {
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
      "Same type",
      "Same actor",
      "Same resource",
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
    expect((await filters()).getByRole("textbox", { name: "Request" })).toHaveValue(REQUEST_ID);
  });

  it("keeps the Logs list in the sidebar, where a view or a filter opens the list", async () => {
    server.use(http.get(`${EVENTS_URL}/evt_1`, () => HttpResponse.json(event("evt_1"))));
    const queries = serveEvents({ data: [] });
    const router = await renderAt("/events/evt_1");
    await screen.findByRole("heading", { name: "user.deleted" });

    // No view is the event's: none is marked.
    const nav = await logsNav();
    for (const view of ["Audit events", "API requests", "All"]) {
      expect(nav.getByRole("link", { name: view })).not.toHaveAttribute("data-active", "true");
    }

    await userEvent.type(
      (await filters()).getByRole("textbox", { name: "Session" }),
      "sess_1{Enter}",
    );

    await waitFor(() => expect(router.state.resolvedLocation?.pathname).toBe("/events"));
    expect(queries[0]?.get("session_id")).toBe("sess_1");
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
