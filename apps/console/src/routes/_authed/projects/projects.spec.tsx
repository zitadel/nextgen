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

const PROJECTS_URL = "http://localhost/api/projects/query";
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

async function renderProjects() {
  const [{ RouterProvider, createMemoryHistory }, { createAppRouter }] = await Promise.all([
    import("@tanstack/react-router"),
    import("../../../router"),
  ]);
  const router = createAppRouter({
    history: createMemoryHistory({ initialEntries: ["/projects"] }),
  });
  render(<RouterProvider router={router} />);
  return router;
}

describe("projects screen", () => {
  it("renders the heading and a project row", async () => {
    server.use(
      http.post(PROJECTS_URL, () =>
        HttpResponse.json({
          projects: [
            { id: "proj_1", name: "River", created_at: "2026-07-08T09:00:00Z", updated_at: "2026-07-08T09:00:00Z" },
          ],
        }),
      ),
    );
    await renderProjects();

    expect(await screen.findByRole("heading", { name: "Projects" })).toBeInTheDocument();
    const table = within(await screen.findByRole("table"));
    expect(table.getByRole("link", { name: "River" })).toBeInTheDocument();
    expect(table.getByText(expectedDate("2026-07-08T09:00:00Z"))).toBeInTheDocument();
  });

  it("says so when there are no projects", async () => {
    server.use(http.post(PROJECTS_URL, () => HttpResponse.json({ projects: [] })));
    await renderProjects();

    expect(await screen.findByText("No projects yet.")).toBeInTheDocument();
  });

  it("appends the next page and drops the button when the list is complete", async () => {
    let call = 0;
    server.use(
      http.post(PROJECTS_URL, () => {
        call += 1;
        return call === 1
          ? HttpResponse.json({
              projects: [{ id: "proj_1", name: "River", created_at: "2026-07-08T09:00:00Z", updated_at: "2026-07-08T09:00:00Z" }],
              next_page_token: "page-2",
            })
          : HttpResponse.json({
              projects: [{ id: "proj_2", name: "Delta", created_at: "2026-07-09T09:00:00Z", updated_at: "2026-07-09T09:00:00Z" }],
            });
      }),
    );
    await renderProjects();

    const loadMore = await screen.findByRole("button", { name: "Load more" });
    await userEvent.click(loadMore);

    expect(await screen.findByRole("link", { name: "Delta" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "River" })).toBeInTheDocument();
    // Absent rather than disabled: its absence is how the screen says the list
    // is complete (design decisions log D5 — no total count to show instead).
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
  });
});
