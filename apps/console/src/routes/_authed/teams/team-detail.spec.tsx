import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { scopedPath } from "@/test/project-scope.fixture";
import { server } from "@/test/msw";

// The `_authed` layout guards every screen behind `GET /sessions/me`
// (Console ADR 0003); mock the auth module so routes render as signed in.
vi.mock("@/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/auth/session")>();
  const { makeTestSession } = await import("@/test/session.fixture");
  return { ...actual, fetchSession: vi.fn(async () => makeTestSession()) };
});

const TEAM_ID = "team_1";
const TEAM_URL = `http://localhost/api/v1/teams/${TEAM_ID}`;
const USERS_QUERY_URL = "*/api/v1/users/query";

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
    history: createMemoryHistory({ initialEntries: [scopedPath(`/teams/${TEAM_ID}`)] }),
  });
  render(<RouterProvider router={router} />);
  return router;
}

describe("team detail", () => {
  // The top bar's team switcher lists the project's teams beside the open one,
  // and the Members tab's first page loads with the team.
  beforeEach(() =>
    server.use(
      http.post("*/api/v1/teams/query", () => HttpResponse.json({ teams: [team()] })),
      http.post(USERS_QUERY_URL, () => HttpResponse.json({ users: [] })),
    ),
  );

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

  it("renames the team in the top bar's switcher too", async () => {
    let name = "Acme Web";
    server.use(
      http.get(TEAM_URL, () => HttpResponse.json(team({ name }))),
      http.post("*/api/v1/teams/query", () => HttpResponse.json({ teams: [team({ name })] })),
      http.patch(TEAM_URL, async ({ request }) => {
        name = ((await request.json()) as { name: string }).name;
        return HttpResponse.json(team({ name }));
      }),
    );
    await renderDetail();

    const switcher = await screen.findByRole("button", { name: "Switch team" });
    await waitFor(() => expect(switcher).toHaveTextContent("Acme Web"));

    const field = await screen.findByLabelText("Tenant name");
    await userEvent.clear(field);
    await userEvent.type(field, "Acme Group");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(switcher).toHaveTextContent("Acme Group"));
  });

  it("lists the team's members on the Members tab", async () => {
    const bodies: unknown[] = [];
    server.use(
      http.get(TEAM_URL, () => HttpResponse.json(team())),
      http.post(USERS_QUERY_URL, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({
          users: [
            {
              id: "user_1",
              display: "Ada Lovelace",
              identifier: "ada@example.com",
              metadata: { status: "active" },
            },
          ],
        });
      }),
    );
    await renderDetail();

    await userEvent.click(await screen.findByRole("tab", { name: "Members" }));
    expect(await screen.findByRole("link", { name: "Ada Lovelace" })).toHaveAttribute(
      "href",
      scopedPath("/users/user_1"),
    );
    expect(screen.getByText("ada@example.com")).toBeInTheDocument();
    // Membership is the `team_id` filter, not a per-user roster read.
    expect(bodies).toEqual([
      expect.objectContaining({
        filter: [{ field: "team_id", operation: "equals", value: TEAM_ID }],
      }),
    ]);
  });

  it("keeps the team's page when its members may not be read", async () => {
    server.use(
      http.get(TEAM_URL, () => HttpResponse.json(team())),
      http.post(USERS_QUERY_URL, () =>
        HttpResponse.json({ code: "user.permission_denied" }, { status: 403 }),
      ),
    );
    await renderDetail();

    await userEvent.click(await screen.findByRole("tab", { name: "Members" }));
    expect(
      await screen.findByText("Your access does not include this team's members."),
    ).toBeInTheDocument();
  });
});
