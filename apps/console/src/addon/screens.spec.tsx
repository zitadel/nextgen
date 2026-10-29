import { render, screen, within } from "@testing-library/react";
import { Receipt } from "lucide-react";
import { describe, expect, it, vi } from "vitest";

import type { AddonScreenProps } from "@/addon/contract";
import { scopedPath } from "@/test/project-scope.fixture";

// The `_authed` layout guards every screen behind `GET /sessions/me`
// (Console ADR 0003); mock the auth module so routes render as signed in.
vi.mock("@/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/auth/session")>();
  const { makeTestSession } = await import("@/test/session.fixture");
  return { ...actual, fetchSession: vi.fn(async () => makeTestSession()) };
});

// An add-on with one Settings screen, in place of the empty one this build
// compiles in. Module state is per spec file, so the screen it mounts stays
// in this file's router.
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
  },
}));

async function renderAt(path: string) {
  const [{ RouterProvider, createMemoryHistory }, { createAppRouter }] = await Promise.all([
    import("@tanstack/react-router"),
    import("../router"),
  ]);
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
