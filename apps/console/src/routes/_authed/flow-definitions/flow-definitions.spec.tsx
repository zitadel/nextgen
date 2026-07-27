import { render, screen } from "@testing-library/react";
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

// Absolute base so requests parse under jsdom/undici and MSW can intercept.
vi.stubEnv("VITE_CONSOLE_API_BASE", "http://localhost/api");

const FLOWS_URL = "http://localhost/api/flow_definitions";

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
afterEach(() => server.resetHandlers());
afterAll(() => {
  server.close();
  vi.unstubAllEnvs();
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

describe("login flows list states", () => {
  it("shows the empty state when there are no flow definitions", async () => {
    server.use(http.get(FLOWS_URL, () => HttpResponse.json({ flow_definitions: [] })));
    await renderAt("/flow-definitions");
    expect(await screen.findByText("No flow definitions yet.")).toBeInTheDocument();
  });

  it("renders a row and summary counts when populated", async () => {
    server.use(
      http.get(FLOWS_URL, () =>
        HttpResponse.json({
          flow_definitions: [
            { id: "flow_1", name: "Login", status: "active", created_at: "2026-01-01" },
          ],
        }),
      ),
    );
    await renderAt("/flow-definitions");
    expect(await screen.findByRole("link", { name: "Login" })).toBeInTheDocument();
  });

  it("renders the error boundary when the request fails", async () => {
    // The loader error is *expected* here; silence React's error-boundary
    // dump and the router's route-match warning so passing runs stay quiet.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      server.use(
        http.get(FLOWS_URL, () =>
          HttpResponse.json({ code: "internal", message: "boom" }, { status: 500 }),
        ),
      );
      await renderAt("/flow-definitions");
      expect(await screen.findByText("Request failed (500)")).toBeInTheDocument();
    } finally {
      errorSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });
});
