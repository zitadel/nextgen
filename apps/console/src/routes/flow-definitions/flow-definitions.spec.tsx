import { render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

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
    import("../../router"),
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
    server.use(
      http.get(FLOWS_URL, () =>
        HttpResponse.json({ code: "internal", message: "boom" }, { status: 500 }),
      ),
    );
    await renderAt("/flow-definitions");
    expect(await screen.findByText("Request failed (500)")).toBeInTheDocument();
  });
});
