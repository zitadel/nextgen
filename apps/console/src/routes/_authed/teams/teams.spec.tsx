import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// The `_authed` layout guards every screen behind `GET /sessions/me`
// (Console ADR 0003); mock the auth module so routes render as signed in.
vi.mock("@/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/auth/session")>();
  const { makeTestSession } = await import("@/auth/session.fixture");
  return { ...actual, fetchSession: vi.fn(async () => makeTestSession()) };
});

vi.stubEnv("VITE_CONSOLE_API_BASE", "http://localhost/api");

const TEAMS_URL = "http://localhost/api/teams/query";
const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
afterEach(() => server.resetHandlers());
afterAll(() => {
  server.close();
  vi.unstubAllEnvs();
});

/** The same locale-derived string the screen renders, rather than one locale's output. */
function expectedDate(value: string): string {
  return new Date(value).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function team(overrides: Record<string, unknown> = {}) {
  return {
    id: "team_1",
    name: "Acme Web",
    status: "active",
    created_at: "2026-07-08T09:00:00Z",
    updated_at: "2026-07-08T09:00:00Z",
    ...overrides,
  };
}

async function renderTeams(entry = "/teams") {
  const [{ RouterProvider, createMemoryHistory }, { createAppRouter }] = await Promise.all([
    import("@tanstack/react-router"),
    import("../../../router"),
  ]);
  const router = createAppRouter({
    history: createMemoryHistory({ initialEntries: [entry] }),
  });
  render(<RouterProvider router={router} />);
  return router;
}

/** Records every `POST /teams/query` body, so the filter sent can be asserted. */
function recordQueries(response: () => Response) {
  const bodies: Record<string, unknown>[] = [];
  server.use(
    http.post(TEAMS_URL, async ({ request }) => {
      bodies.push((await request.json()) as Record<string, unknown>);
      return response();
    }),
  );
  return bodies;
}

const ACTIVE_FILTER = { field: "status", operation: "equals", value: "active" };

describe("teams screen", () => {
  it("renders the heading, a team row and its status", async () => {
    server.use(http.post(TEAMS_URL, () => HttpResponse.json({ teams: [team()] })));
    await renderTeams();

    expect(await screen.findByRole("heading", { name: "Teams" })).toBeInTheDocument();
    const table = within(await screen.findByRole("table"));
    // Scoped to the table: the app shell's context switcher also renders a team
    // name.
    expect(table.getByRole("link", { name: "Acme Web" })).toBeInTheDocument();
    expect(table.getByText("active")).toBeInTheDocument();
    expect(table.getByText(expectedDate("2026-07-08T09:00:00Z"))).toBeInTheDocument();
  });

  it("shows the status the API returns rather than the mock's wording", async () => {
    server.use(
      http.post(TEAMS_URL, () =>
        HttpResponse.json({ teams: [team({ id: "team_2", name: "Acme Mobile", status: "deactivated" })] }),
      ),
    );
    await renderTeams();

    // The design writes this state as `Inactive`; `team-status` calls it
    // `deactivated`, and the console does not invent a second vocabulary for one
    // state. The pill is title-cased by CSS, so the accessible text is the
    // API's own value.
    const table = within(await screen.findByRole("table"));
    expect(table.getByText("deactivated")).toBeInTheDocument();
    expect(table.queryByText("inactive")).not.toBeInTheDocument();
  });

  it("says so when there are no teams", async () => {
    server.use(http.post(TEAMS_URL, () => HttpResponse.json({ teams: [] })));
    await renderTeams();

    expect(await screen.findByText("No active teams yet.")).toBeInTheDocument();
  });

  it("names the search term when nothing matches it", async () => {
    server.use(http.post(TEAMS_URL, () => HttpResponse.json({ teams: [] })));
    await renderTeams("/teams?q=zzz");

    // An empty table means something different once a question has been asked
    // of it: nothing matched, rather than there being nothing there.
    expect(await screen.findByText("No teams match “zzz”.")).toBeInTheDocument();
  });

  it("opens the team when the row is clicked", async () => {
    server.use(http.post(TEAMS_URL, () => HttpResponse.json({ teams: [team()] })));
    const router = await renderTeams();

    const row = (await screen.findByRole("link", { name: "Acme Web" })).closest("tr");
    expect(row).not.toBeNull();
    await userEvent.click(row as HTMLElement);

    expect(router.state.location.pathname).toBe(`/teams/${team().id}`);
  });

  it("offers View team from the row menu", async () => {
    server.use(http.post(TEAMS_URL, () => HttpResponse.json({ teams: [team()] })));
    await renderTeams();

    await userEvent.click(await screen.findByRole("button", { name: "Actions for Acme Web" }));
    const item = await screen.findByRole("menuitem", { name: "View team" });
    expect(item).toHaveAttribute("href", `/teams/${team().id}`);
  });

  it("creates a team from the Add drawer", async () => {
    const created: unknown[] = [];
    server.use(
      http.post(TEAMS_URL, () => HttpResponse.json({ teams: [] })),
      http.post("http://localhost/api/teams", async ({ request }) => {
        created.push(await request.json());
        return HttpResponse.json(team());
      }),
    );
    await renderTeams();

    await userEvent.click(await screen.findByRole("button", { name: /Add/ }));

    const name = await screen.findByLabelText("Team name");
    // `POST /teams` takes a single `name`, so the drawer is one field — not
    // schema-driven the way the Add user drawer is.
    expect(screen.getByRole("button", { name: "Add team" })).toBeDisabled();
    await userEvent.type(name, "Acme Web");
    await userEvent.click(screen.getByRole("button", { name: "Add team" }));

    expect(created).toEqual([{ name: "Acme Web" }]);
  });

  it("appends the next page and drops the button when the list is complete", async () => {
    let call = 0;
    const bodies = recordQueries(() => {
      call += 1;
      return call === 1
        ? HttpResponse.json({ teams: [team()], next_page_token: "page-2" })
        : HttpResponse.json({ teams: [team({ id: "team_2", name: "Acme Mobile" })] });
    });
    await renderTeams();

    const loadMore = await screen.findByRole("button", { name: "Load more" });
    await userEvent.click(loadMore);

    expect(await screen.findByRole("link", { name: "Acme Mobile" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Acme Web" })).toBeInTheDocument();
    // Absent rather than disabled: its absence is how the screen says the list
    // is complete (design decisions log D5 — no total count to show instead).
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
    // The token answers the question the first page asked, so page 2 repeats it.
    expect(bodies[1]).toMatchObject({ page_token: "page-2", filter: [ACTIVE_FILTER] });
  });

  it("asks for active teams, and for deactivated ones when the tab changes", async () => {
    const bodies = recordQueries(() => HttpResponse.json({ teams: [team()] }));
    await renderTeams();

    await screen.findByRole("table");
    // The tabs are a server-side filter, not a client-side narrowing of the
    // fetched page — `status` is a `team-filter-field`.
    expect(bodies.at(-1)).toMatchObject({ filter: [ACTIVE_FILTER] });

    await userEvent.click(screen.getByRole("tab", { name: "Deactivated" }));

    await waitFor(() =>
      expect(bodies.at(-1)).toMatchObject({
        filter: [{ field: "status", operation: "equals", value: "deactivated" }],
      }),
    );
  });

  it("filters by name once the search settles, and keeps the term in the URL", async () => {
    const bodies = recordQueries(() => HttpResponse.json({ teams: [team()] }));
    const router = await renderTeams();

    await userEvent.type(await screen.findByLabelText("Search teams"), "acme");

    await waitFor(() =>
      expect(bodies.at(-1)).toMatchObject({
        filter: [ACTIVE_FILTER, { field: "name", operation: "contains", value: "acme" }],
      }),
    );
    // In the URL rather than in component state: a filtered list is linkable and
    // moves with the back button.
    expect(router.state.location.search).toEqual({ status: "active", q: "acme" });
  });

  it("starts from the tab and term the URL carries", async () => {
    const bodies = recordQueries(() => HttpResponse.json({ teams: [team()] }));
    await renderTeams("/teams?status=deactivated&q=acme");

    await screen.findByRole("table");
    expect(bodies.at(-1)).toMatchObject({
      filter: [
        { field: "status", operation: "equals", value: "deactivated" },
        { field: "name", operation: "contains", value: "acme" },
      ],
    });
    expect(screen.getByRole("tab", { name: "Deactivated" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByLabelText("Search teams")).toHaveValue("acme");
  });
});
