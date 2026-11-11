import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
import { _resetLiveForTesting } from "@/features/events/use-live-events";
import { formatLogTime } from "@/lib/date";
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
/** The filter of the API the list has no field for: it never sends it. */
const UNOFFERED = ["team_id"];
/** As many events as the list asks for at once (`LIST_PAGE_SIZE`). */
const PAGE_SIZE = 25;

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

/** A page as full as the list asks for: `user.deleted` events, ids under `prefix`. */
function fullPage(prefix: string) {
  return Array.from({ length: PAGE_SIZE }, (_, index) => event(`${prefix}_${index}`));
}

/** Whether a `GET /events` is the drawer's read of one request's events, oldest first. */
function isRequestRead(query: URLSearchParams): boolean {
  return query.get("order") === "asc" && query.has("request_id");
}

/**
 * `GET /events`, answering each of the list's calls with the next of `pages`;
 * records their queries. The drawer's read of a request's events is answered
 * apart, with none unless `serveRequestEvents` says otherwise, and is not
 * recorded: it is not the list's.
 */
function serveEvents(...pages: { data: unknown[]; next_page_token?: string }[]) {
  const queries: URLSearchParams[] = [];
  server.use(
    http.get(EVENTS_URL, ({ request: call }) => {
      const query = new URL(call.url).searchParams;
      if (isRequestRead(query)) return HttpResponse.json({ data: [] });
      queries.push(query);
      const page = pages[Math.min(queries.length, pages.length) - 1];
      return HttpResponse.json(page);
    }),
  );
  return queries;
}

/** The drawer's read of one request's events: these, oldest first; records the queries. */
function serveRequestEvents(data: unknown[], more = false) {
  const queries: URLSearchParams[] = [];
  server.use(
    http.get(EVENTS_URL, ({ request: call }) => {
      const query = new URL(call.url).searchParams;
      if (!isRequestRead(query)) return undefined;
      queries.push(query);
      return HttpResponse.json({ data, next_page_token: more ? "more" : undefined });
    }),
  );
  return queries;
}

/** `GET /events/{id}`, answering with one of `events` by its id. */
function serveEvent(...events: ReturnType<typeof event>[]) {
  server.use(
    http.get(`${EVENTS_URL}/:id`, ({ params }) => {
      const found = events.find((candidate) => candidate.id === params.id);
      return found
        ? HttpResponse.json(found)
        : HttpResponse.json(
            { code: "evt.not_found", message: "event: not found" },
            { status: 404 },
          );
    }),
  );
}

/** The drawer an event opens in. */
async function drawer() {
  return within(await screen.findByRole("dialog"));
}

afterEach(() => {
  _resetLiveForTesting();
});

async function renderAt(path: string) {
  const router = createAppRouter({
    history: createMemoryHistory({ initialEntries: [scopedPath(path)] }),
  });
  render(<RouterProvider router={router} />);
  return router;
}

/** The Logs list of the sidebar: the heading back, then the view picker. */
async function logsNav() {
  return within(await screen.findByRole("navigation", { name: "Logs" }));
}

/** The sidebar's view picker, which names the view the list is in. */
async function viewPicker(view: string) {
  return (await logsNav()).getByRole("button", { name: `View: ${view}` });
}

/** Chooses a view from the sidebar's picker. */
async function chooseView(view: string) {
  await userEvent.click((await logsNav()).getByRole("button", { name: /^View: / }));
  await userEvent.click(await screen.findByRole("menuitem", { name: new RegExp(`^${view}`) }));
}

/** The search above the table, where pasted values narrow the list. */
const find = () =>
  screen.findByRole("searchbox", { name: "Search logs by ID, event type or operation" });

/** Types a term into the search and applies it. */
async function searchFor(term: string) {
  await userEvent.type(await find(), `${term}{Enter}`);
}

/** The filters the search holds, as chips. */
async function chips() {
  return within(await screen.findByRole("list", { name: "Search filters" }));
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
 * What the list gives way on, and nothing else: it sends no filter it has no
 * field for, a type takes no category beside it, and the requests are one
 * category. The server bounds every read, so anything else may be combined.
 */
function expectServed(query: URLSearchParams | undefined) {
  for (const key of UNOFFERED) expect(query?.has(key), key).toBe(false);
  const categories = query?.getAll("category") ?? [];
  if (query?.has("event_type")) expect(categories).toEqual([]);
  if (categories.includes("request")) expect(categories).toEqual(["request"]);
}

describe("logs", () => {
  it("opens on the audit events, and says so when the project has none", async () => {
    const queries = serveEvents({ data: [] });
    await renderAt("/events");

    expect(await screen.findByRole("heading", { name: "Logs" })).toBeInTheDocument();
    expect(await viewPicker("Audit events")).toBeInTheDocument();
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
    // It opens in the drawer over the list, under the list's filters.
    expect(first.getByRole("link", { name: "request.api" })).toHaveAttribute(
      "href",
      scopedPath("/events/evt_2?view=all"),
    );
    expect(first.getByText("DELETE deleteUserByID")).toBeInTheDocument();
    expect(first.getByText("204")).toBeInTheDocument();
    expect(first.getByText(formatLogTime(OCCURRED_AT))).toBeInTheDocument();

    // Any other event reads as the record it touched, and who caused it.
    const second = within(changeRow as HTMLElement);
    expect(second.getByRole("link", { name: "user.deleted" })).toHaveAttribute(
      "href",
      scopedPath("/events/evt_1?view=all"),
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
      { data: fullPage("evt_a"), next_page_token: "page-2" },
      { data: [event("evt_1", { event_type: "user.created" })] },
    );
    await renderAt("/events?category=entity&session=sess_1&since=24h");

    await userEvent.click(await screen.findByRole("button", { name: "Load more" }));

    expect(await screen.findByRole("link", { name: "user.created" })).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "user.deleted" })).toHaveLength(PAGE_SIZE);
    // A page token answers the question the first page asked.
    expect(queries[1]?.get("page_token")).toBe("page-2");
    expect(queries[1]?.getAll("category")).toEqual(["entity"]);
    expect(queries[1]?.get("session_id")).toBe("sess_1");
    // The range was counted back once, when the list loaded: a second page
    // that counted again would slide past the rows between the two moments.
    const start = queries[0]?.get("created_after");
    expect(start).toBeTruthy();
    expect(queries[1]?.get("created_after")).toBe(start);
    // Absent rather than disabled: its absence says the list is complete.
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
  });

  it("says so when a page comes back short with more behind it, and keeps looking", async () => {
    // The server matched these filters over the events it read this request,
    // and stopped at its bound: one row so far, and a token for the rest.
    const queries = serveEvents(
      { data: [event("evt_3")], next_page_token: "page-2" },
      { data: fullPage("evt_b"), next_page_token: "page-3" },
      { data: [event("evt_1", { event_type: "user.created" })] },
    );
    await renderAt("/events?actor=user_admin&resource=user_gone");

    const keepLooking = await screen.findByRole("button", { name: "Keep looking" });
    expect(screen.getByText("Not every event has been read yet for these filters.")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
    // One click is one request: nothing follows the token on its own.
    expect(queries).toHaveLength(1);

    await userEvent.click(keepLooking);

    // A full page with a token is the ordinary case again.
    expect(await screen.findByRole("button", { name: "Load more" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Keep looking" })).not.toBeInTheDocument();
    expect(
      screen.queryByText("Not every event has been read yet for these filters."),
    ).not.toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "user.deleted" })).toHaveLength(PAGE_SIZE + 1);
    expect(queries).toHaveLength(2);
    expect(queries[1]?.get("page_token")).toBe("page-2");
    expect(queries[1]?.get("actor_id")).toBe("user_admin");
    expect(queries[1]?.get("entity_id")).toBe("user_gone");

    await userEvent.click(screen.getByRole("button", { name: "Load more" }));

    // A page without a token is the end, however few rows it holds.
    expect(await screen.findByRole("link", { name: "user.created" })).toBeInTheDocument();
    expect(queries[2]?.get("page_token")).toBe("page-3");
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Keep looking" })).not.toBeInTheDocument();
  });

  it("says nothing has matched so far for an empty page with more behind it", async () => {
    const queries = serveEvents(
      { data: [], next_page_token: "page-2" },
      { data: [], next_page_token: "page-3" },
      { data: [] },
    );
    await renderAt("/events?session=sess_1&resource=user_gone");

    // Not "no events match": events are still unread.
    expect(await screen.findByText("No events have matched so far.")).toBeInTheDocument();
    expect(screen.queryByText("No events match these filters.")).not.toBeInTheDocument();
    expect(screen.getByText("Not every event has been read yet for these filters.")).toBeVisible();

    await userEvent.click(screen.getByRole("button", { name: "Keep looking" }));

    // Still nothing, still more behind it: the same state, one request on.
    await waitFor(() => expect(queries).toHaveLength(2));
    expect(queries[1]?.get("page_token")).toBe("page-2");
    expect(await screen.findByRole("button", { name: "Keep looking" })).toBeEnabled();
    expect(screen.getByText("No events have matched so far.")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Keep looking" }));

    // Read to the end: now nothing matches.
    expect(await screen.findByText("No events match these filters.")).toBeInTheDocument();
    expect(queries[2]?.get("page_token")).toBe("page-3");
    expect(screen.queryByText("No events have matched so far.")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Keep looking" })).not.toBeInTheDocument();
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

  it("opens an event in a drawer over the list, without reading the list again", async () => {
    const queries = serveEvents({
      data: [event("evt_2", { event_type: "user.created" }), event("evt_1")],
    });
    serveEvent(event("evt_1"));
    const router = await renderAt("/events?category=entity");

    await userEvent.click(await screen.findByRole("link", { name: "user.deleted" }));

    expect(await (await drawer()).findByRole("heading", { name: "user.deleted" })).toBeVisible();
    await waitFor(() => expect(router.state.resolvedLocation?.pathname).toBe("/events/evt_1"));
    // The list stays, under its filters, with the open event's row marked.
    expect(router.state.resolvedLocation?.search).toMatchObject({ category: "entity" });
    const row = screen
      .getAllByRole("link", { name: "user.deleted" })[0]
      ?.closest("tr") as HTMLElement;
    expect(row).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("link", { name: "user.created" })).toBeInTheDocument();
    expect(queries).toHaveLength(1);
  });

  it("steps through the list from the drawer, by its arrows and by the keyboard", async () => {
    const rows = [
      event("evt_3", { event_type: "user.created" }),
      event("evt_2", { event_type: "user.updated" }),
      event("evt_1"),
    ];
    serveEvents({ data: rows });
    serveEvent(...rows);
    const router = await renderAt("/events/evt_3");
    const at = (id: string) =>
      waitFor(() => expect(router.state.resolvedLocation?.pathname).toBe(`/events/${id}`));

    const panel = await drawer();
    expect(await panel.findByRole("heading", { name: "user.created" })).toBeVisible();
    // The first row has none before it.
    expect(panel.getByRole("button", { name: "Previous event" })).toBeDisabled();

    await userEvent.click(panel.getByRole("button", { name: "Next event" }));
    await at("evt_2");
    expect(await panel.findByRole("heading", { name: "user.updated" })).toBeVisible();

    await userEvent.keyboard("{ArrowDown}");
    await at("evt_1");
    expect(await panel.findByRole("button", { name: "Next event" })).toBeDisabled();

    await userEvent.keyboard("k");
    await at("evt_2");
    // Opening one event after another reads the list once.
    expect(router.state.resolvedLocation?.search).not.toHaveProperty("type");
  });

  it("lists the other events of the event's request in the drawer, in the order they happened", async () => {
    const change = event("evt_1");
    const call = request("evt_2");
    serveEvents({ data: [call, change] });
    serveEvent(change, call);
    const requestQueries = serveRequestEvents([change, call]);
    await renderAt("/events/evt_1?view=all");

    const panel = await drawer();
    const section = within(
      (await panel.findByRole("heading", { name: "This request" })).closest(
        "section",
      ) as HTMLElement,
    );
    // One range of the request index, oldest first.
    expect(requestQueries[0]?.get("request_id")).toBe(REQUEST_ID);
    expect(requestQueries[0]?.get("order")).toBe("asc");
    const steps = section.getAllByRole("listitem");
    expect(steps).toHaveLength(2);
    // The open event is marked, not a link; the API call behind it opens.
    expect(
      within(steps[0] as HTMLElement)
        .getByText("user.deleted")
        .closest("[aria-current]"),
    ).not.toBeNull();
    await userEvent.click(within(steps[1] as HTMLElement).getByRole("link"));
    expect(await panel.findByRole("heading", { name: "request.api" })).toBeVisible();
    expect(panel.getByText("12 ms")).toBeInTheDocument();
  });

  it("closes the drawer back to the list, under the same filters", async () => {
    const queries = serveEvents({ data: [event("evt_1")] });
    serveEvent(event("evt_1"));
    const router = await renderAt("/events/evt_1?actor=user_admin");

    await userEvent.click((await drawer()).getByRole("button", { name: "Close" }));

    await waitFor(() => expect(router.state.resolvedLocation?.pathname).toBe("/events"));
    expect(router.state.resolvedLocation?.search).toMatchObject({ actor: "user_admin" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(queries).toHaveLength(1);
  });

  it("narrows the list to what the signed-in person did from the search, and back", async () => {
    const queries = serveEvents({ data: [event("evt_1")] });
    const router = await renderAt("/events?category=admin");
    await screen.findByRole("link", { name: "user.deleted" });

    // The empty field offers it; no glyph on the toolbar has to say it.
    await userEvent.click(await find());
    await userEvent.click(await screen.findByRole("button", { name: "My activity" }));

    // The session fixture's user, in the view and category the list is on.
    await waitFor(() => expect(queries.at(-1)?.get("actor_id")).toBe("user_test"));
    expect(queries.at(-1)?.getAll("category")).toEqual(["admin"]);
    // Its chip names the person, not their id.
    const chip = await chips();
    expect(chip.getByText("me")).toBeInTheDocument();
    // Set, it is no longer offered.
    await userEvent.click(await find());
    expect(screen.queryByRole("button", { name: "My activity" })).not.toBeInTheDocument();

    await userEvent.click(chip.getByRole("button", { name: "Remove the actor filter" }));
    await waitFor(() => expect(router.state.resolvedLocation?.search.actor).toBeUndefined());
  });

  it("adds what is recorded after the list loaded while Live is on", async () => {
    const newest = event("evt_1", { created_at: "2026-11-10T08:15:43.120Z" });
    const queries: URLSearchParams[] = [];
    server.use(
      http.get(EVENTS_URL, ({ request: call }) => {
        const query = new URL(call.url).searchParams;
        queries.push(query);
        if (query.get("order") !== "asc") return HttpResponse.json({ data: [newest] });
        // Oldest first, from the newest event held, which comes back too.
        return HttpResponse.json({
          data: [newest, event("evt_2", { event_type: "user.created" })],
        });
      }),
    );
    await renderAt("/events?actor=user_admin");
    await screen.findByRole("link", { name: "user.deleted" });

    const live = screen.getByRole("button", { name: "Live" });
    expect(live).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    await userEvent.click(live);

    // On, it says so under the toolbar, and when it last read.
    expect(await screen.findByRole("status")).toHaveTextContent(
      /^Live: new events appear at the top as they are recorded\./,
    );
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Checked just now."));
    // Above the list's rows, once each.
    expect(await screen.findByRole("link", { name: "user.created" })).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "user.deleted" })).toHaveLength(1);
    const read = queries.find((query) => query.get("order") === "asc");
    expect(read?.get("created_after")).toBe("2026-11-10T08:15:43.120Z");
    // Under the list's filters.
    expect(read?.get("actor_id")).toBe("user_admin");
    expect(read?.getAll("category")).toEqual(AUDIT);
    const rows = screen.getAllByRole("row");
    expect(within(rows[1] as HTMLElement).getByText("user.created")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Live" }));
    expect(screen.getByRole("button", { name: "Live" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("offers no Live for a range that has ended", async () => {
    serveEvents({ data: [] });
    await renderAt("/events?from=2026-11-10T08:00:00Z&to=2026-11-10T09:00:00Z");

    await screen.findByText("No events match these filters.");
    expect(screen.queryByRole("button", { name: "Live" })).not.toBeInTheDocument();
  });

  it("copies the loaded events as JSON", async () => {
    const writeText = vi.fn(async (_text: string) => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    serveEvents({ data: [event("evt_2", { event_type: "user.created" }), event("evt_1")] });
    await renderAt("/events");
    await screen.findByRole("link", { name: "user.created" });

    await userEvent.click(screen.getByRole("button", { name: "Export" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Copy loaded events" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledOnce());
    const copied = JSON.parse(writeText.mock.calls[0]?.[0] ?? "[]");
    expect(copied.map((copy: { id: string }) => copy.id)).toEqual(["evt_2", "evt_1"]);
  });
});

describe("logs views", () => {
  it("chooses the view from a picker in the sidebar, in place of the project's screens", async () => {
    serveEvents({ data: [] });
    await renderAt("/events");

    await userEvent.click(await viewPicker("Audit events"));

    // Each view by its name and what it holds, as Vercel's kinds of log.
    const items = await screen.findAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "Audit eventsSign-ins and changes to the project",
      "API requestsOne per call to the API",
      "AllBoth, in the order they happened",
    ]);
    expect(items[0]).toHaveAttribute("aria-current", "page");
    expect(items[1]).not.toHaveAttribute("aria-current");
    expect(screen.queryByRole("navigation", { name: "Primary" })).not.toBeInTheDocument();
    // The views are the sidebar's: the page repeats none of them.
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
  });

  it("lists the API requests alone in their view, which has no category to narrow by", async () => {
    const queries = serveEvents({ data: [event("evt_1")] }, { data: [request("evt_2")] });
    const router = await renderAt("/events");
    await screen.findByRole("link", { name: "user.deleted" });
    expect((await filters()).getByRole("combobox", { name: "Category" })).toBeInTheDocument();

    await chooseView("API requests");

    expect(await screen.findByRole("link", { name: "request.api" })).toBeInTheDocument();
    expect(queries[1]?.getAll("category")).toEqual(["request"]);
    await waitFor(() =>
      expect(router.state.resolvedLocation?.search).toMatchObject({ view: "requests" }),
    );
    expect(await viewPicker("API requests")).toBeInTheDocument();
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

    expect(await viewPicker("Audit events")).toBeInTheDocument();
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
      "Last 30 minutes",
      "Last hour",
      "Last 12 hours",
      "Last 24 hours",
      "Last 3 days",
      "Last 7 days",
      "Last 14 days",
      "Custom range",
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

  it("reads between two fixed moments from a custom range", async () => {
    const queries = serveEvents({ data: [event("evt_1")] });
    const router = await renderAt("/events?since=1h");
    await screen.findByRole("link", { name: "user.deleted" });

    await userEvent.click((await filters()).getByRole("combobox", { name: "Timeline" }));
    await userEvent.click(screen.getByRole("option", { name: "Custom range" }));
    const group = await filters();
    fireEvent.change(group.getByLabelText("From"), { target: { value: "2026-11-10T08:00" } });
    fireEvent.change(group.getByLabelText("To"), { target: { value: "2026-11-10T09:30" } });
    await userEvent.click(group.getByRole("button", { name: "Apply range" }));

    // The viewer's local time, sent as the moments it names.
    const from = new Date("2026-11-10T08:00").toISOString();
    const to = new Date("2026-11-10T09:30").toISOString();
    await waitFor(() => expect(queries.at(-1)?.get("created_before")).toBe(to));
    expect(queries.at(-1)?.get("created_after")).toBe(from);
    expect(router.state.resolvedLocation?.search).toMatchObject({ from, to });
    expect(router.state.resolvedLocation?.search.since).toBeUndefined();
  });

  it("reads the minutes around an event from its row menu, under no other filter", async () => {
    const queries = serveEvents({
      data: [event("evt_1", { created_at: "2026-11-10T08:15:43.000Z" })],
    });
    await renderAt("/events?actor=user_admin&category=entity");

    const menu = await openRowMenu("user.deleted");
    await userEvent.click(menu.getByRole("menuitem", { name: "Events around this one" }));

    await waitFor(() =>
      expect(queries.at(-1)?.get("created_after")).toBe("2026-11-10T08:10:43.000Z"),
    );
    expect(queries.at(-1)?.get("created_before")).toBe("2026-11-10T08:20:43.000Z");
    expect(queries.at(-1)?.has("actor_id")).toBe(false);
    expect(queries.at(-1)?.has("category")).toBe(false);
  });

  it("narrows to types chosen from the list, several at once, or to the failures", async () => {
    const queries = serveEvents({ data: [event("evt_1")] });
    const router = await renderAt("/events?category=auth");
    await screen.findByRole("link", { name: "user.deleted" });

    await userEvent.click((await filters()).getByRole("combobox", { name: "Event types" }));
    await userEvent.click(await screen.findByRole("option", { name: "user.created" }));
    await waitFor(() => expect(queries.at(-1)?.getAll("event_type")).toEqual(["user.created"]));
    await userEvent.click(await screen.findByRole("option", { name: "user.deleted" }));
    await waitFor(() =>
      expect(queries.at(-1)?.getAll("event_type")).toEqual(["user.created", "user.deleted"]),
    );
    // Types name their own category: none is sent beside them.
    expect(queries.at(-1)?.has("category")).toBe(false);
    expect(router.state.resolvedLocation?.search).toMatchObject({
      view: "all",
      type: ["user.created", "user.deleted"],
    });
    await userEvent.keyboard("{Escape}");
    expect((await filters()).getByRole("combobox", { name: "Event types" })).toHaveTextContent(
      "2 types",
    );

    // The shortcut is the list's first row, so the types it ticks show under it.
    await userEvent.click((await filters()).getByRole("combobox", { name: "Event types" }));
    await userEvent.click(await screen.findByRole("option", { name: /^Only failures/ }));

    await waitFor(() =>
      expect(queries.at(-1)?.getAll("event_type")).toEqual([
        "auth.check.failed",
        "auth.sso.authorization.failed",
        "auth.sso.exchange.failed",
        "user.create.failed",
      ]),
    );
    expect((await filters()).getByRole("combobox", { name: "Event types" })).toHaveTextContent(
      "Only failures",
    );
  });

  it("narrows by an application, a device and a resource type, named in the search", async () => {
    const queries = serveEvents({ data: [] });
    await renderAt("/events");
    await screen.findByText("This project has no audit events.");

    for (const [term, value, param] of [
      ["app_1", "app_1", "client_id"],
      ["device:fp_1", "fp_1", "fingerprint"],
      ["resource_type:user", "user", "entity_type"],
    ] as const) {
      await searchFor(term);
      await waitFor(() => expect(queries.at(-1)?.get(param)).toBe(value));
    }
    // Each keeps the view it is on: the audit events of one application.
    expect(queries.at(-1)?.getAll("category")).toEqual(AUDIT);
    expect(queries.at(-1)?.get("client_id")).toBe("app_1");
    // Each is a chip, by the name the search knows it by.
    expect((await chips()).getAllByRole("listitem").map((chip) => chip.textContent)).toEqual([
      "resource_type:user",
      "app:app_1",
      "device:fp_1",
    ]);
  });

  it("narrows the API requests by status, or to the failed ones, and by operation", async () => {
    const queries = serveEvents({ data: [request("evt_2")] });
    const router = await renderAt("/events?view=requests");
    await screen.findByRole("link", { name: "request.api" });

    // A request is one type: the requests narrow by status instead, and only
    // they have an operation.
    expect(
      (await filters()).queryByRole("combobox", { name: "Event types" }),
    ).not.toBeInTheDocument();
    await userEvent.click((await filters()).getByRole("combobox", { name: "Status classes" }));
    await userEvent.click(await screen.findByRole("option", { name: /^Only failed requests/ }));

    await waitFor(() => expect(queries.at(-1)?.getAll("status_class")).toEqual(["4xx", "5xx"]));
    // One range of the status index each: no category beside them.
    expect(queries.at(-1)?.has("category")).toBe(false);
    expect((await filters()).getByRole("combobox", { name: "Status classes" })).toHaveTextContent(
      "Only failed requests",
    );

    await searchFor("createUser");

    await waitFor(() => expect(queries.at(-1)?.getAll("operation_id")).toEqual(["createUser"]));
    expect(queries.at(-1)?.getAll("status_class")).toEqual(["4xx", "5xx"]);
    expect(router.state.resolvedLocation?.search).toMatchObject({
      view: "requests",
      operation: "createUser",
      status: ["4xx", "5xx"],
    });

    // Another view is not the requests': both give way.
    await chooseView("All");
    await waitFor(() => expect(queries.at(-1)?.has("operation_id")).toBe(false));
    expect(queries.at(-1)?.has("status_class")).toBe(false);
  });

  it("narrows by an ID pasted into the search, and removes it from its chip", async () => {
    const queries = serveEvents({ data: [event("evt_1")] });
    const router = await renderAt("/events?category=entity");
    await screen.findByRole("link", { name: "user.deleted" });

    // The value is matched whole: nothing is asked while it is being typed.
    await userEvent.type(await find(), "actor:user_admin");
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
    expect(await find()).toHaveValue("");

    await userEvent.click((await chips()).getByRole("button", { name: "Remove the actor filter" }));

    await waitFor(() => expect(queries.at(-1)?.has("actor_id")).toBe(false));
    expect(screen.queryByRole("list", { name: "Search filters" })).not.toBeInTheDocument();
  });

  it("removes the last chip with Backspace in the empty field", async () => {
    const queries = serveEvents({ data: [] });
    await renderAt("/events?view=all&session=sess_1&request=req_1");
    await screen.findByText("No events match these filters.");

    await userEvent.click(await find());
    await userEvent.keyboard("{Backspace}");

    // The last drawn: chips follow the filters' order, request before session.
    await waitFor(() => expect(queries.at(-1)?.has("session_id")).toBe(false));
    expect(queries.at(-1)?.get("request_id")).toBe("req_1");
  });

  it("keeps the pasted filters out of the sidebar, which holds what is chosen from a list", async () => {
    serveEvents({ data: [] });
    await renderAt("/events");

    const group = await filters();
    for (const name of ["Timeline", "Category", "Type"]) {
      expect(group.getByText(name)).toBeInTheDocument();
    }
    // The type is chosen from the types the server writes.
    expect(group.getByRole("combobox", { name: "Event types" })).toBeInTheDocument();
    expect(group.queryByRole("textbox")).not.toBeInTheDocument();
    // The API has no count of the events behind a value: none is drawn.
    expect(group.queryByText(/^\d+$/)).not.toBeInTheDocument();
  });

  it("reads a type in the All view with no category, and keeps the actor beside it", async () => {
    const queries = serveEvents({ data: [event("evt_1")] });
    const router = await renderAt("/events?category=entity&actor=user_admin");
    await screen.findByRole("link", { name: "user.deleted" });

    await userEvent.click((await filters()).getByRole("combobox", { name: "Event types" }));
    await userEvent.click(await screen.findByRole("option", { name: "user.deleted" }));

    await waitFor(() => expect(queries.at(-1)?.getAll("event_type")).toEqual(["user.deleted"]));
    // A type names its own category, so none is sent beside it. The actor
    // stays: the server bounds what the two read together.
    expect(queries.at(-1)?.has("category")).toBe(false);
    expect(queries.at(-1)?.get("actor_id")).toBe("user_admin");
    expectServed(queries.at(-1));
    expect(router.state.resolvedLocation?.search).toMatchObject({
      view: "all",
      type: ["user.deleted"],
      actor: "user_admin",
    });
    expect(router.state.resolvedLocation?.search.category).toBeUndefined();
    expect((await chips()).getByText("user_admin")).toBeInTheDocument();
  });

  describe("with a type set", () => {
    const START = "/events?view=all&type=user.deleted";

    it("keeps the type beside an actor", async () => {
      const queries = serveEvents({ data: [event("evt_1")] });
      const router = await renderAt(START);
      await screen.findByRole("link", { name: "user.deleted" });
      expect(queries[0]?.getAll("event_type")).toEqual(["user.deleted"]);

      await searchFor("actor:user_admin");

      await waitFor(() => expect(queries.at(-1)?.get("actor_id")).toBe("user_admin"));
      expect(queries.at(-1)?.getAll("event_type")).toEqual(["user.deleted"]);
      expect(router.state.resolvedLocation?.search).toMatchObject({
        view: "all",
        type: ["user.deleted"],
        actor: "user_admin",
      });
      expect((await filters()).getByRole("combobox", { name: "Event types" })).toHaveTextContent(
        "user.deleted",
      );
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

      await chooseView("Audit events");

      await waitFor(() => expect(queries.at(-1)?.getAll("category")).toEqual(AUDIT));
      expect(queries.at(-1)?.has("event_type")).toBe(false);
      expect(router.state.resolvedLocation?.search.type).toBeUndefined();
    });

    it("keeps the type beside a time range and a request", async () => {
      const queries = serveEvents({ data: [event("evt_1")] });
      await renderAt(`${START}&since=7d&request=${REQUEST_ID}`);
      await screen.findByRole("link", { name: "user.deleted" });

      expect(queries[0]?.getAll("event_type")).toEqual(["user.deleted"]);
      expect(queries[0]?.get("request_id")).toBe(REQUEST_ID);
      expect(queries[0]?.has("created_after")).toBe(true);
      expectServed(queries[0]);
    });
  });

  it("gives a type no category, and sends no filter it has no field for, whatever the URL says", async () => {
    const queries = serveEvents({ data: [] });
    await renderAt(
      "/events?view=audit&category=auth&type=user.deleted&actor=user_admin&client_id=app_1&team_id=team_1&entity_type=user",
    );

    await screen.findByText("No events match these filters.");
    // A type beside a category and an actor: the category gives way, the
    // actor stays.
    expect(queries[0]?.getAll("event_type")).toEqual(["user.deleted"]);
    expect(queries[0]?.has("category")).toBe(false);
    expect(queries[0]?.get("actor_id")).toBe("user_admin");
    expectServed(queries[0]);
    expect(await viewPicker("All")).toBeInTheDocument();
  });

  it("sends every filter the URL carries, together, and clears them all at once", async () => {
    const queries = serveEvents({ data: [] });
    const router = await renderAt(
      "/events?view=all&category=auth&since=7d&actor=user_admin&resource=user_gone&request=req_1&session=sess_1&flow=flow_1",
    );

    // Nothing matches, which is not the project having no events.
    expect(await screen.findByText("No events match these filters.")).toBeInTheDocument();
    // The server bounds what a combination reads, so none is refused here.
    expect(queries[0]?.getAll("category")).toEqual(["auth"]);
    expect(queries[0]?.get("actor_id")).toBe("user_admin");
    expect(queries[0]?.get("entity_id")).toBe("user_gone");
    expect(queries[0]?.get("request_id")).toBe("req_1");
    expect(queries[0]?.get("session_id")).toBe("sess_1");
    expect(queries[0]?.get("flow_id")).toBe("flow_1");
    expect(queries[0]?.has("created_after")).toBe(true);
    expectServed(queries[0]);
    // The search shows what the pasted values narrow the list to.
    expect((await chips()).getAllByRole("listitem").map((chip) => chip.textContent)).toEqual([
      "actor:user_admin",
      "resource:user_gone",
      "request:req_1",
      "session:sess_1",
      "flow:flow_1",
    ]);

    await userEvent.click((await filters()).getByRole("button", { name: "Clear filters" }));

    await waitFor(() => expect(queries.at(-1)?.has("flow_id")).toBe(false));
    expect(queries.at(-1)?.has("actor_id")).toBe(false);
    expect(queries.at(-1)?.has("category")).toBe(false);
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
    // The event, the minutes around it, then one item per value it carries;
    // it has no login flow, application or device.
    expect(menu.getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "View event",
      "Events around this one",
      "Only this type",
      "Only this actor",
      "Only this resource",
      "Only this resource type",
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
    // Set, it shows as a chip, and the row no longer offers it.
    expect((await chips()).getByText("user_admin")).toBeInTheDocument();
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
    expect(await viewPicker("All")).toBeInTheDocument();
  });
});

describe("logs search", () => {
  it("says in the field what it takes", async () => {
    serveEvents({ data: [] });
    await renderAt("/events");

    expect(await find()).toHaveAttribute("placeholder", "Search by ID, event type or operation");
  });

  it("lists the filters it can name under the empty field", async () => {
    serveEvents({ data: [] });
    await renderAt("/events");

    await userEvent.click(await find());

    expect(await screen.findByText(/name the filter:/)).toHaveTextContent(
      "actor:, resource:, resource_type:, app:, device:",
    );
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
      await searchFor(term);

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

    await searchFor("auth.check.failed");

    await waitFor(() =>
      expect(queries.at(-1)?.getAll("event_type")).toEqual(["auth.check.failed"]),
    );
    expect(queries.at(-1)?.has("category")).toBe(false);
    expect((await filters()).getByRole("combobox", { name: "Event types" })).toHaveTextContent(
      "auth.check.failed",
    );
  });

  it("narrows to an API operation from its name", async () => {
    const queries = serveEvents({ data: [event("evt_1")] });
    const router = await renderAt("/events");
    await screen.findByRole("link", { name: "user.deleted" });

    await searchFor("createUser");

    await waitFor(() => expect(queries.at(-1)?.getAll("operation_id")).toEqual(["createUser"]));
    expect(router.state.resolvedLocation?.search).toMatchObject({
      view: "requests",
      operation: "createUser",
    });
  });

  it("opens the event an event ID names", async () => {
    serveEvents({ data: [event("evt_1")] });
    server.use(http.get(`${EVENTS_URL}/evt_9`, () => HttpResponse.json(event("evt_9"))));
    const router = await renderAt("/events");
    await screen.findByRole("link", { name: "user.deleted" });

    await searchFor("evt_9");

    await waitFor(() => expect(router.state.resolvedLocation?.pathname).toBe("/events/evt_9"));
  });

  it("asks whether another ID is an actor or a resource, rather than guessing", async () => {
    const queries = serveEvents({ data: [event("evt_1")] });
    const router = await renderAt("/events");
    await screen.findByRole("link", { name: "user.deleted" });

    await searchFor("user_gone");

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

    await searchFor("failed sign in");

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

    // The whole Logs list, over the page: its view picker and its filters.
    const sheet = within(await screen.findByRole("dialog"));
    expect(sheet.getByRole("group", { name: "Filters" })).toBeInTheDocument();
    await userEvent.click(sheet.getByRole("button", { name: "View: Audit events" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: /^API requests/ }));

    await waitFor(() => expect(queries.at(-1)?.getAll("category")).toEqual(["request"]));
  });
});

describe("event drawer", () => {
  it("shows the event's identity, the values it carries and its document", async () => {
    const queries: URLSearchParams[] = [];
    server.use(
      http.get(`${EVENTS_URL}/evt_1`, ({ request: call }) => {
        queries.push(new URL(call.url).searchParams);
        return HttpResponse.json(event("evt_1"));
      }),
    );
    serveEvents({ data: [event("evt_1")] });
    await renderAt("/events/evt_1");

    const panel = await drawer();
    expect(await panel.findByRole("heading", { name: "user.deleted" })).toBeInTheDocument();
    // An event is read within its project: the id alone does not find it.
    expect(queries[0]?.get("project_id")).toBe("proj_test");
    expect(panel.getByText("evt_1")).toBeInTheDocument();
    expect(panel.getByRole("button", { name: "Copy Event ID" })).toBeInTheDocument();
    expect(panel.getByText(formatLogTime(OCCURRED_AT))).toBeInTheDocument();

    const details = within(
      panel.getByRole("heading", { name: "Details" }).closest("section") as HTMLElement,
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
      panel.getByRole("button", { name: "Copy the event document as JSON" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/deploy your changes/)).not.toBeInTheDocument();
  });

  it("leads on to the events that share one of its values, in every view", async () => {
    const opened = event("evt_1", { session_id: "sess_1" });
    serveEvent(opened);
    const queries = serveEvents({ data: [opened] }, { data: [request("evt_2"), opened] });
    const router = await renderAt("/events/evt_1");

    const panel = await drawer();
    const related = within(
      (await panel.findByRole("heading", { name: "Related events" })).closest(
        "section",
      ) as HTMLElement,
    );
    // One link per value the event carries, and the minutes around it.
    expect(related.getAllByRole("link").map((link) => link.textContent)).toEqual([
      "Same type",
      "Same actor",
      "Same resource",
      "Same resource type",
      "Same request",
      "Same session",
      "Around this time",
    ]);

    await userEvent.click(related.getByRole("link", { name: "Same request" }));

    await waitFor(() => expect(router.state.resolvedLocation?.pathname).toBe("/events"));
    expect(router.state.resolvedLocation?.search).toMatchObject({
      view: "all",
      request: REQUEST_ID,
      project: "proj_test",
    });
    await waitFor(() => expect(queries.at(-1)?.get("request_id")).toBe(REQUEST_ID));
    expect(queries.at(-1)?.has("category")).toBe(false);
    expect((await chips()).getByText(REQUEST_ID)).toBeInTheDocument();
  });

  it("keeps the list's view marked in the sidebar, where a filter narrows the list and closes it", async () => {
    serveEvent(event("evt_1"));
    const queries = serveEvents({ data: [event("evt_1")] });
    const router = await renderAt("/events/evt_1?view=all");
    await (await drawer()).findByRole("heading", { name: "user.deleted" });

    expect(await viewPicker("All")).toBeInTheDocument();

    await userEvent.click((await filters()).getByRole("combobox", { name: "Category" }));
    await userEvent.click(await screen.findByRole("option", { name: "auth" }));

    await waitFor(() => expect(router.state.resolvedLocation?.pathname).toBe("/events"));
    await waitFor(() => expect(queries.at(-1)?.getAll("category")).toEqual(["auth"]));
  });

  it("says the event is gone when the project does not hold it, and closes back to Logs", async () => {
    // The loader error is expected: silence the error boundary's dump and the
    // router's route-match warning.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      serveEvent();
      serveEvents({ data: [] });
      const router = await renderAt("/events/evt_gone");

      // Retention deletes an event by age, so a kept link can outlive it.
      const panel = await drawer();
      expect(await panel.findByRole("heading", { name: "Event not found" })).toBeInTheDocument();
      expect(panel.getByText("This project holds no event with this ID.")).toBeInTheDocument();

      await userEvent.click(panel.getByRole("button", { name: "Close" }));
      await waitFor(() => expect(router.state.resolvedLocation?.pathname).toBe("/events"));
    } finally {
      errorSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });
});
