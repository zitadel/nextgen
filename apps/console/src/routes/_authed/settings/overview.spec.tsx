import { render, screen, within } from "@testing-library/react";
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

const MY_TEAMS_URL = "*/api/users/me/teams";
const TEAM_URL = "http://localhost/api/teams/team_2";

function myTeam(id: string, name: string) {
  return {
    id,
    name,
    membership_status: "active",
    created_at: "2026-07-08T09:00:00Z",
    updated_at: "2026-07-08T09:00:00Z",
  };
}

async function renderAt(path: string) {
  const [{ RouterProvider, createMemoryHistory }, { createAppRouter }] = await Promise.all([
    import("@tanstack/react-router"),
    import("../../../router"),
  ]);
  const router = createAppRouter({
    history: createMemoryHistory({ initialEntries: [scopedPath(path)] }),
  });
  render(<RouterProvider router={router} />);
}

describe("account settings overview", () => {
  it("lists the teams the person is on, badging their account", async () => {
    server.use(
      http.get(MY_TEAMS_URL, () =>
        HttpResponse.json({ teams: [myTeam("team_1", "Ada's account"), myTeam("team_2", "Acme")] }),
      ),
    );
    await renderAt("/settings");

    const main = await screen.findByRole("main");
    expect(await within(main).findByRole("link", { name: "Acme" })).toHaveAttribute(
      "href",
      scopedPath("/settings/teams/team_2"),
    );
    // The first team on the roster is the account the sidebar footer names.
    const accountRow = within(main).getByRole("link", { name: "Ada's account" }).closest("tr");
    expect(accountRow).toHaveTextContent("Your account");
    const otherRow = within(main).getByRole("link", { name: "Acme" }).closest("tr");
    expect(otherRow).not.toHaveTextContent("Your account");
  });

  it("says so when the person is on no team", async () => {
    server.use(http.get(MY_TEAMS_URL, () => HttpResponse.json({ teams: [] })));
    await renderAt("/settings");

    expect(await screen.findByText("You are not on a team yet.")).toBeInTheDocument();
  });

  it("nests the open team under Overview in the sidebar", async () => {
    server.use(
      http.get(TEAM_URL, () =>
        HttpResponse.json({
          id: "team_2",
          name: "Acme",
          status: "active",
          created_at: "2026-07-08T09:00:00Z",
          updated_at: "2026-07-08T09:00:00Z",
        }),
      ),
    );
    await renderAt("/settings/teams/team_2");

    expect(await screen.findByLabelText("Team name")).toHaveValue("Acme");
    const nav = screen.getByRole("navigation", { name: "Account settings" });
    // The nested row says where you are; Overview above it is the way back.
    expect(within(nav).getByRole("link", { name: "Acme" })).toHaveAttribute("data-active", "true");
    expect(within(nav).getByRole("link", { name: "Overview" })).toHaveAttribute(
      "data-active",
      "false",
    );
    expect(screen.getByText("Team")).toBeInTheDocument();
  });

  it("offers no rename on a team the person does not own", async () => {
    server.use(
      http.get(TEAM_URL, () =>
        HttpResponse.json({ code: "team.permission_denied" }, { status: 403 }),
      ),
    );
    await renderAt("/settings/teams/team_2");

    expect(
      await screen.findByText("Only the team's owners can change its settings."),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Team name")).not.toBeInTheDocument();
  });
});
