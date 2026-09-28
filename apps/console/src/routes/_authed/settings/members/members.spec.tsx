import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, describe, expect, it, vi } from "vitest";

// The `_authed` layout guards every screen behind `GET /sessions/me`
// (Console ADR 0003); mock the auth module so routes render as signed in.
vi.mock("@/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/auth/session")>();
  const { makeTestSession } = await import("@/auth/session.fixture");
  return { ...actual, fetchSession: vi.fn(async () => makeTestSession()) };
});

vi.stubEnv("VITE_CONSOLE_API_BASE", "http://localhost/api");
afterAll(() => vi.unstubAllEnvs());

async function renderMembers() {
  const { createAppRouter } = await import("../../../../router");
  const router = createAppRouter({
    history: createMemoryHistory({ initialEntries: ["/settings/members"] }),
  });
  render(<RouterProvider router={router} />);
  return router;
}

/**
 * Settings › Members is design ahead of the API: it renders the static list in
 * `settings-members.fixture.ts`. What is guarded here is the MVP shape — one
 * role, so no Level column and no owner actions — and the per-status menus.
 */
describe("settings members", () => {
  it("lists members by email and status, with no level column", async () => {
    await renderMembers();

    expect(await screen.findByRole("heading", { name: "Members" })).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader").map((header) => header.textContent?.trim())).toEqual(
      ["Email", "Status", ""],
    );
    expect(screen.getByText("sam.lee@partner.io")).toBeInTheDocument();
    expect(screen.getByText("Pending")).toBeInTheDocument();
  });

  it("offers Remove for a member and Resend / Revoke for a pending invite", async () => {
    await renderMembers();

    await userEvent.click(await screen.findByRole("button", { name: "Actions for Priya Raman" }));
    const memberMenu = within(await screen.findByRole("menu"));
    expect(memberMenu.getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["Remove"]);
    await userEvent.keyboard("{Escape}");

    await userEvent.click(screen.getByRole("button", { name: "Actions for sam.lee@partner.io" }));
    const inviteMenu = within(await screen.findByRole("menu"));
    expect(inviteMenu.getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "Resend invite",
      "Revoke invite",
    ]);
  });

  it("adds an invite as a pending row", async () => {
    await renderMembers();

    await userEvent.click(await screen.findByRole("button", { name: "Invite" }));
    await userEvent.type(await screen.findByLabelText("Email"), "noah.kim@acme.dev");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));

    const row = (await screen.findByText("noah.kim@acme.dev")).closest("tr");
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByText("Pending")).toBeInTheDocument();
  });
});
