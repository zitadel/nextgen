import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";
import { scopedPath } from "@/test/project-scope.fixture";
import { server } from "@/test/msw";

// The `_authed` layout guards every screen behind `GET /sessions/me`
// (Console ADR 0003); mock the auth module so routes render as signed in.
vi.mock("@/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/auth/session")>();
  const { makeTestSession } = await import("@/test/session.fixture");
  return { ...actual, fetchSession: vi.fn(async () => makeTestSession()) };
});

const TEAMS_URL = "http://localhost/api/teams/query";

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
    history: createMemoryHistory({ initialEntries: [scopedPath(entry)] }),
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
        HttpResponse.json({
          teams: [team({ id: "team_2", name: "Acme Mobile", status: "deactivated" })],
        }),
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

  it("opens the team when the row is clicked", async () => {
    server.use(
      http.post(TEAMS_URL, () => HttpResponse.json({ teams: [team()] })),
      // The click opens the team's page, whose loader reads the team.
      http.get(`http://localhost/api/teams/${team().id}`, () => HttpResponse.json(team())),
    );
    const router = await renderTeams();

    const row = (await screen.findByRole("link", { name: "Acme Web" })).closest("tr");
    expect(row).not.toBeNull();
    await userEvent.click(row as HTMLElement);

    // The team's page, not only its URL: the test ends once the page has read
    // its team, rather than with that read still in flight.
    expect(await screen.findByRole("heading", { name: "Acme Web" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(`/teams/${team().id}`);
  });

  it("offers View team from the row menu", async () => {
    server.use(http.post(TEAMS_URL, () => HttpResponse.json({ teams: [team()] })));
    await renderTeams();

    await userEvent.click(await screen.findByRole("button", { name: "Actions for Acme Web" }));
    const item = await screen.findByRole("menuitem", { name: "View team" });
    expect(item).toHaveAttribute("href", scopedPath(`/teams/${team().id}`));
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

  it("starts from the tab the URL carries", async () => {
    const bodies = recordQueries(() => HttpResponse.json({ teams: [team()] }));
    await renderTeams("/teams?status=deactivated");

    await screen.findByRole("table");
    expect(bodies.at(-1)).toMatchObject({
      filter: [{ field: "status", operation: "equals", value: "deactivated" }],
    });
    expect(screen.getByRole("tab", { name: "Deactivated" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
});
