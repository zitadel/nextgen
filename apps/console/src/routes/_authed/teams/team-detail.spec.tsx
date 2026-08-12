import { render, screen } from "@testing-library/react";
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

const TEAM_ID = "team_1";
const TEAM_URL = `http://localhost/api/teams/${TEAM_ID}`;
const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
afterEach(() => server.resetHandlers());
afterAll(() => {
  server.close();
  vi.unstubAllEnvs();
});

function team(overrides: Record<string, unknown> = {}) {
  return {
    id: TEAM_ID,
    name: "Acme Web",
    status: "active",
    created_at: "2026-07-08T09:00:00Z",
    updated_at: "2026-07-08T09:00:00Z",
    ...overrides,
  };
}

async function renderDetail() {
  const [{ RouterProvider, createMemoryHistory }, { createAppRouter }] = await Promise.all([
    import("@tanstack/react-router"),
    import("../../../router"),
  ]);
  const router = createAppRouter({
    history: createMemoryHistory({ initialEntries: [`/teams/${TEAM_ID}`] }),
  });
  render(<RouterProvider router={router} />);
  return router;
}

describe("team detail", () => {
  it("renders the name, the id and the created date", async () => {
    server.use(http.get(TEAM_URL, () => HttpResponse.json(team())));
    await renderDetail();

    expect(await screen.findByRole("heading", { name: "Acme Web" })).toBeInTheDocument();
    expect(screen.getByText(TEAM_ID)).toBeInTheDocument();
    expect(screen.getByText("Team ID")).toBeInTheDocument();
    expect(screen.getByText("Created")).toBeInTheDocument();
  });

  it("shows the team's status beside its name", async () => {
    server.use(http.get(TEAM_URL, () => HttpResponse.json(team({ status: "deactivated" }))));
    await renderDetail();

    // The status sits on the detail as well as the list, so a deactivated team
    // reads as deactivated on its own screen.
    await screen.findByRole("heading", { name: "Acme Web" });
    expect(screen.getByText("deactivated")).toBeInTheDocument();
  });

  it("leaves out the primary domain the API does not carry", async () => {
    server.use(http.get(TEAM_URL, () => HttpResponse.json(team())));
    await renderDetail();
    await screen.findByRole("heading", { name: "Acme Web" });

    // The design draws a `PRIMARY DOMAIN` cell, but no domain field exists on
    // `team-response`. An empty labelled cell would read as "this team has no
    // domain" rather than "the API cannot say".
    expect(screen.queryByText(/primary domain/i)).not.toBeInTheDocument();
  });

  it("keeps Save disabled until the name changes", async () => {
    server.use(http.get(TEAM_URL, () => HttpResponse.json(team())));
    await renderDetail();

    const field = await screen.findByLabelText("Tenant name");
    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();

    await userEvent.type(field, " Ltd");
    expect(save).toBeEnabled();
  });

  it("saves the new name through PATCH", async () => {
    const patched: unknown[] = [];
    server.use(
      http.get(TEAM_URL, () => HttpResponse.json(team())),
      http.patch(TEAM_URL, async ({ request }) => {
        patched.push(await request.json());
        return HttpResponse.json(team({ name: "Acme Group" }));
      }),
    );
    await renderDetail();

    const field = await screen.findByLabelText("Tenant name");
    await userEvent.clear(field);
    await userEvent.type(field, "Acme Group");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    // `name` is the only property `PATCH /teams/{team_id}` accepts.
    expect(patched).toEqual([{ name: "Acme Group" }]);
  });
});
