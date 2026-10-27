import { render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";
import { server } from "@/test/msw";

// The `_authed` layout guards every screen behind `GET /sessions/me`
// (Console ADR 0003); mock the auth module so routes render as signed in.
vi.mock("@/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/auth/session")>();
  const { makeTestSession } = await import("@/test/session.fixture");
  return { ...actual, fetchSession: vi.fn(async () => makeTestSession()) };
});

// Readiness, not liveness: `/readyz` answers once the server's database does.
const READY_URL = "http://localhost/api/readyz";

async function renderSystem() {
  const [{ RouterProvider, createMemoryHistory }, { createAppRouter }] = await Promise.all([
    import("@tanstack/react-router"),
    import("../../../router"),
  ]);
  const router = createAppRouter({ history: createMemoryHistory({ initialEntries: ["/system"] }) });
  render(<RouterProvider router={router} />);
  return router;
}

describe("system", () => {
  it("says the server is healthy once it and its database answer", async () => {
    server.use(http.get(READY_URL, () => HttpResponse.text("ok")));
    await renderSystem();

    expect(await screen.findByText("Healthy")).toBeInTheDocument();
  });

  it("does not say so while the database does not answer", async () => {
    // The loader error is *expected* here; silence React's error-boundary
    // dump and the router's route-match warning so passing runs stay quiet.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      server.use(http.get(READY_URL, () => HttpResponse.text("fail", { status: 503 })));
      await renderSystem();

      expect(await screen.findByText("Error 503")).toBeInTheDocument();
      expect(screen.queryByText("Healthy")).toBeNull();
    } finally {
      errorSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });
});
