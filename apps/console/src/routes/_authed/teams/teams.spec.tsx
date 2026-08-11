import { render, screen, within } from "@testing-library/react";
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

async function renderTeams() {
  const [{ RouterProvider, createMemoryHistory }, { createAppRouter }] = await Promise.all([
    import("@tanstack/react-router"),
    import("../../../router"),
  ]);
  const router = createAppRouter({
    history: createMemoryHistory({ initialEntries: ["/teams"] }),
  });
  render(<RouterProvider router={router} />);
  return router;
}

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

    expect(await screen.findByText("No teams yet.")).toBeInTheDocument();
  });

  it("opens the team when the row is clicked", async () => {
    server.use(http.post(TEAMS_URL, () => HttpResponse.json({ teams: [team()] })));
    const router = await renderTeams();

    const row = (await screen.findByRole("link", { name: "Acme Web" })).closest("tr");
    expect(row).not.toBeNull();
    await userEvent.click(row as HTMLElement);

    expect(router.state.location.pathname).toBe(`/teams/${team().id}`);
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
    server.use(
      http.post(TEAMS_URL, () => {
        call += 1;
        return call === 1
          ? HttpResponse.json({ teams: [team()], next_page_token: "page-2" })
          : HttpResponse.json({ teams: [team({ id: "team_2", name: "Acme Mobile" })] });
      }),
    );
    await renderTeams();

    const loadMore = await screen.findByRole("button", { name: "Load more" });
    await userEvent.click(loadMore);

    expect(await screen.findByRole("link", { name: "Acme Mobile" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Acme Web" })).toBeInTheDocument();
    // Absent rather than disabled: its absence is how the screen says the list
    // is complete (design decisions log D5 — no total count to show instead).
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
  });
});
