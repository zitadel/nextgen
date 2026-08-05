import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// The `_authed` layout guards every screen behind `GET /sessions/me`
// (Console ADR 0003); mock the auth module so routes render as signed in.
vi.mock("@/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/auth/session")>();
  const { makeTestSession } = await import("@/auth/session.fixture");
  return { ...actual, fetchSession: vi.fn(async () => makeTestSession()) };
});


async function renderAt(path: string) {
  const [{ RouterProvider, createMemoryHistory }, { createAppRouter }] = await Promise.all([
    import("@tanstack/react-router"),
    import("../../../router"),
  ]);
  const router = createAppRouter({ history: createMemoryHistory({ initialEntries: [path] }) });
  render(<RouterProvider router={router} />);
  return router;
}

describe("schemas list", () => {
  it("shows an honest coming-soon empty state (no fake data)", async () => {
    await renderAt("/schemas");
    expect(await screen.findByText("Coming soon")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Schemas" })).toBeInTheDocument();
  });
});
