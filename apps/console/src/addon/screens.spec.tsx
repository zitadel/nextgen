import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import { Receipt } from "lucide-react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AddonScreenProps } from "@/addon/contract";
import { scopedPath } from "@/test/project-scope.fixture";
import { makeTestSession } from "@/test/session.fixture";
import { createAppRouter } from "../router";

// The `_authed` layout guards every screen behind `GET /sessions/me`
// (Console ADR 0003); mock the auth module so routes render as signed in,
// unless a test signs the visitor out.
const fetchSession = vi.fn();
vi.mock("@/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/auth/session")>();
  return { ...actual, fetchSession: (...args: []) => fetchSession(...args) };
});
beforeEach(() => {
  fetchSession.mockReset();
  fetchSession.mockResolvedValue(makeTestSession());
});

// An add-on with one Settings screen and one signed-out screen, in place of
// the empty one this build compiles in. Module state is per spec file, so the
// screens it mounts stay in this file's router.
vi.mock("@/addon", () => ({
  addon: {
    screens: [
      {
        path: "/settings/invoices",
        nav: { label: "Invoices", view: "settings", order: 2, icon: Receipt },
        load: async () => ({ count: 3 }),
        Screen: ({ data }: AddonScreenProps<{ count: number }>) => <h1>{data.count} invoices</h1>,
      },
    ],
    signedOutScreens: [
      {
        path: "/welcome",
        Screen: ({ next }: { next?: string }) => <h1>Welcome, then {next}</h1>,
      },
    ],
  },
}));

async function renderAt(path: string) {
  const router = createAppRouter({
    history: createMemoryHistory({ initialEntries: [scopedPath(path)] }),
  });
  render(<RouterProvider router={router} />);
  return router;
}

describe("an add-on's screens", () => {
  it("render beneath the signed-in shell with what their load returned", async () => {
    await renderAt("/settings/invoices");
    expect(await screen.findByRole("heading", { name: "3 invoices" })).toBeInTheDocument();
  });

  it("list themselves in the view their entry names, after the console's own", async () => {
    await renderAt("/settings/invoices");
    const nav = await screen.findByRole("navigation", { name: "Account settings" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual(["Settings", "Invoices"]);
  });
});

describe("an add-on's signed-out screens", () => {
  it("render for a visitor who is not signed in, with the ?next= to land on", async () => {
    fetchSession.mockResolvedValue(null);
    await renderAt("/welcome?next=/settings/invoices");
    expect(
      await screen.findByRole("heading", { name: "Welcome, then /settings/invoices" }),
    ).toBeInTheDocument();
  });

  it("send a visitor who is signed in on to ?next=, as /login does", async () => {
    const router = await renderAt("/welcome?next=/settings/invoices");
    expect(await screen.findByRole("heading", { name: "3 invoices" })).toBeInTheDocument();
    await waitFor(() => expect(router.state.resolvedLocation?.pathname).toBe("/settings/invoices"));
  });
});
