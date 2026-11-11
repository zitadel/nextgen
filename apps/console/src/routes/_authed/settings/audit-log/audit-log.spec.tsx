import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { _setRuntimeForTesting } from "@/runtime/runtime";
import { server } from "@/test/msw";
import { scopedPath } from "@/test/project-scope.fixture";
import { createAppRouter } from "../../../../router";

// The `_authed` layout guards every screen behind `GET /sessions/me`
// (Console ADR 0003); mock the auth module so routes render as signed in.
vi.mock("@/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/auth/session")>();
  const { makeTestSession } = await import("@/test/session.fixture");
  return { ...actual, fetchSession: vi.fn(async () => makeTestSession()) };
});

const PLATFORM = "*/api/v1/projects/proj_platform";
const EVENTS = "*/api/v1/events";

const OCCURRED_AT = "2026-11-10T08:15:43Z";
const REQUEST_ID = "req_01TESTREQUEST";
/** Every category but the requests', which the audit events are. */
const AUDIT = ["auth", "session", "admin", "entity", "signal"];
/** As many events as the list asks for at once (`LIST_PAGE_SIZE`). */
const PAGE_SIZE = 25;

/** One of the platform project's events: a deleted console account unless told otherwise. */
function event(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    project_id: "proj_platform",
    team_id: null,
    event_type: "user.deleted",
    category: "entity",
    occurred_at: OCCURRED_AT,
    created_at: OCCURRED_AT,
    actor_id: "user_operator",
    actor_type: "human",
    entity_type: "user",
    entity_id: "user_gone",
    client_id: "",
    request_id: REQUEST_ID,
    session_id: "sess_1",
    flow_id: null,
    payload: {},
    metadata: {},
    ...overrides,
  };
}

/** A `request.api` event: the API call behind a change. */
function request(id: string) {
  return event(id, {
    event_type: "request.api",
    category: "request",
    entity_type: null,
    entity_id: null,
    payload: {
      operation_id: "deleteUserByID",
      method: "DELETE",
      route_template: "deleteUserByID",
      status: 204,
      duration_ms: 12,
    },
  });
}

/** Whether a `GET /events` is the drawer's read of one request's events, oldest first. */
function isRequestRead(query: URLSearchParams): boolean {
  return query.get("order") === "asc" && query.has("request_id");
}

/**
 * `GET /events`: each of the list's reads answered with the next of `pages`,
 * their queries recorded; the drawer's read of a request's events answers
 * `steps`, apart.
 */
function serveEvents(
  pages: { data: unknown[]; next_page_token?: string }[],
  steps: unknown[] = [],
) {
  const queries: URLSearchParams[] = [];
  server.use(
    http.get(EVENTS, ({ request: call }) => {
      const query = new URL(call.url).searchParams;
      if (isRequestRead(query)) return HttpResponse.json({ data: steps });
      queries.push(query);
      return HttpResponse.json(pages[Math.min(queries.length, pages.length) - 1]);
    }),
  );
  return queries;
}

/** `GET /events/{id}`: one of `events` by its id, else a 404; records the queries. */
function serveEvent(...events: ReturnType<typeof event>[]) {
  const queries: URLSearchParams[] = [];
  server.use(
    http.get(`${EVENTS}/:id`, ({ params, request: call }) => {
      queries.push(new URL(call.url).searchParams);
      const found = events.find((candidate) => candidate.id === params.id);
      return found
        ? HttpResponse.json(found)
        : HttpResponse.json(
            { code: "evt.not_found", message: "event: not found" },
            { status: 404 },
          );
    }),
  );
  return queries;
}

beforeEach(() => {
  // The console signs in to the reserved platform project, which the server
  // names (D41).
  _setRuntimeForTesting({
    mode: "standalone",
    console_project_id: "proj_platform",
    publishable_key: "pk",
    platform_project_id: "proj_platform",
  });
  // The person may act on it: the read of the project answers.
  server.use(
    http.get(PLATFORM, () =>
      HttpResponse.json({
        id: "proj_platform",
        name: "Platform",
        origins: [],
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      }),
    ),
  );
});

/** Renders the console at `path`, with a customer project selected, as the selection stays (D36). */
function renderAt(path: string) {
  const router = createAppRouter({
    history: createMemoryHistory({ initialEntries: [scopedPath(path)] }),
  });
  render(<RouterProvider router={router} />);
  return router;
}

/** The drawer an event opens in. */
async function drawer() {
  return within(await screen.findByRole("dialog"));
}

describe("root audit log", () => {
  it("lists the platform project's audit events, newest first, under the Settings list", async () => {
    const queries = serveEvents([
      { data: [event("evt_2", { event_type: "user.created" }), event("evt_1")] },
    ]);
    renderAt("/settings/audit-log");

    expect(await screen.findByRole("heading", { name: "Audit log" })).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "user.created" })).toBeInTheDocument();
    // The platform project's audit events, a page at a time, everything
    // retained: never the selected project's.
    expect(queries[0]?.get("project_id")).toBe("proj_platform");
    expect(queries[0]?.getAll("category")).toEqual(AUDIT);
    expect(queries[0]?.get("limit")).toBe(String(PAGE_SIZE));
    expect(queries[0]?.has("created_after")).toBe(false);
    // The sidebar is Settings' list, with the page marked; Events' views and
    // filters, and the search that sets them, are the project's.
    const settings = within(await screen.findByRole("navigation", { name: "Settings" }));
    expect(settings.getByRole("link", { name: "Audit log" })).toHaveAttribute(
      "data-active",
      "true",
    );
    expect(screen.queryByRole("navigation", { name: "Events" })).not.toBeInTheDocument();
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
  });

  it("says so when nothing has been recorded", async () => {
    serveEvents([{ data: [] }]);
    renderAt("/settings/audit-log");

    expect(await screen.findByText("There are no audit events yet.")).toBeInTheDocument();
  });

  it("opens an event in the drawer over the root list, without reading the list again", async () => {
    const queries = serveEvents([
      { data: [event("evt_2", { event_type: "user.created" }), event("evt_1")] },
    ]);
    const reads = serveEvent(event("evt_1"));
    const router = renderAt("/settings/audit-log");

    const link = await screen.findByRole("link", { name: "user.deleted" });
    // The root's own drawer; the selected project rides along, unnamed.
    expect(link).toHaveAttribute("href", scopedPath("/settings/audit-log/evt_1"));
    await userEvent.click(link);

    expect(await (await drawer()).findByRole("heading", { name: "user.deleted" })).toBeVisible();
    await waitFor(() =>
      expect(router.state.resolvedLocation?.pathname).toBe("/settings/audit-log/evt_1"),
    );
    expect(router.state.resolvedLocation?.search).toEqual({ project: "proj_test" });
    // The event is read within the platform project.
    expect(reads[0]?.get("project_id")).toBe("proj_platform");
    expect(link.closest("tr")).toHaveAttribute("aria-selected", "true");
    expect(queries).toHaveLength(1);
  });

  it("offers no filter: a row's menu opens the event, and the drawer stays on the page", async () => {
    const change = event("evt_1");
    const call = request("evt_0");
    serveEvents([{ data: [change] }], [call, change]);
    serveEvent(change, call);
    const router = renderAt("/settings/audit-log");

    const row = (await screen.findByRole("link", { name: "user.deleted" })).closest(
      "tr",
    ) as HTMLElement;
    await userEvent.click(within(row).getByRole("button", { name: /^Actions for/ }));
    const menu = within(await screen.findByRole("menu"));
    expect(menu.getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["View event"]);
    await userEvent.click(menu.getByRole("menuitem", { name: "View event" }));

    const panel = await drawer();
    expect(await panel.findByRole("heading", { name: "user.deleted" })).toBeVisible();
    // No Related events: they set the project's Events filters.
    expect(panel.queryByRole("heading", { name: "Related events" })).not.toBeInTheDocument();
    // The request's API call opens in the same drawer, at the root.
    const steps = within(
      (await panel.findByRole("heading", { name: "This request" })).closest(
        "section",
      ) as HTMLElement,
    );
    await userEvent.click(steps.getByRole("link"));
    await waitFor(() =>
      expect(router.state.resolvedLocation?.pathname).toBe("/settings/audit-log/evt_0"),
    );
    expect(await panel.findByRole("heading", { name: "request.api" })).toBeVisible();
    // Nothing on the page leads into a project's Events.
    for (const link of screen.getAllByRole("link")) {
      expect(link.getAttribute("href") ?? "").not.toMatch(/^\/events/);
    }
  });

  it("closes the drawer back to the Audit log", async () => {
    const queries = serveEvents([{ data: [event("evt_1")] }]);
    serveEvent(event("evt_1"));
    const router = renderAt("/settings/audit-log/evt_1");

    await userEvent.click((await drawer()).getByRole("button", { name: "Close" }));

    await waitFor(() =>
      expect(router.state.resolvedLocation?.pathname).toBe("/settings/audit-log"),
    );
    expect(router.state.resolvedLocation?.search).toEqual({ project: "proj_test" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(queries).toHaveLength(1);
  });

  it("appends the next page on Load more, and keeps looking past a page cut short", async () => {
    const full = Array.from({ length: PAGE_SIZE }, (_, index) => event(`evt_a_${index}`));
    const queries = serveEvents([
      { data: full, next_page_token: "page-2" },
      { data: [event("evt_b", { event_type: "user.created" })], next_page_token: "page-3" },
      { data: [event("evt_c", { event_type: "auth.check.succeeded", category: "auth" })] },
    ]);
    renderAt("/settings/audit-log");

    await userEvent.click(await screen.findByRole("button", { name: "Load more" }));
    expect(await screen.findByRole("link", { name: "user.created" })).toBeInTheDocument();
    expect(queries[1]?.get("page_token")).toBe("page-2");
    expect(queries[1]?.get("project_id")).toBe("proj_platform");
    expect(queries[1]?.getAll("category")).toEqual(AUDIT);

    // A page short of its size with a token: the server stopped at its bound.
    expect(
      screen.getByText("Not every event has been read yet for these filters."),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Keep looking" }));
    expect(await screen.findByRole("link", { name: "auth.check.succeeded" })).toBeInTheDocument();
    expect(queries[2]?.get("page_token")).toBe("page-3");
    expect(
      screen.queryByRole("button", { name: /Load more|Keep looking/ }),
    ).not.toBeInTheDocument();
  });

  it("says the event is gone when the platform project does not hold it", async () => {
    // The loader error is expected: silence the error boundary's dump and the
    // router's route-match warning.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      serveEvents([{ data: [] }]);
      serveEvent();
      renderAt("/settings/audit-log/evt_gone");

      const panel = await drawer();
      expect(await panel.findByRole("heading", { name: "Event not found" })).toBeInTheDocument();
      expect(panel.getByText("The audit log holds no event with this ID.")).toBeInTheDocument();
    } finally {
      errorSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });

  it("is not there for someone who may not act on the platform project", async () => {
    const queries = serveEvents([{ data: [] }]);
    server.use(
      http.get(PLATFORM, () =>
        HttpResponse.json({ code: "proj.not_found", message: "not found" }, { status: 404 }),
      ),
    );
    const router = renderAt("/settings/audit-log");

    await waitFor(() => expect(router.state.resolvedLocation?.pathname).toBe("/settings"));
    expect(screen.queryByRole("heading", { name: "Audit log" })).not.toBeInTheDocument();
    expect(queries).toHaveLength(0);
  });
});
