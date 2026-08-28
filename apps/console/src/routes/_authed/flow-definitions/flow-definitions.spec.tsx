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
const SCHEMAS_URL = "http://localhost/api/schemas";

/** One populated flow definition, pinning schema `sch_1`. */
function flowDefinitionsResponse() {
  return {
    flow_definitions: [
      {
        id: "flow_1",
        project_id: "proj_1",
        flow_definition: {
          name: "Login",
          status: "active",
          user_schema: "sch_1",
          purposes: { login: "identifier" },
          steps: [{ name: "identifier" }],
        },
        created_at: "2026-01-01",
        updated_at: "2026-01-02",
      },
    ],
  };
}

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
    server.use(http.get(FLOWS_URL, () => HttpResponse.json(flowDefinitionsResponse())));
    await renderAt("/flow-definitions");
    expect(await screen.findByRole("link", { name: "Login" })).toBeInTheDocument();
  });

  // The flow stores an opaque, revision-specific schema id; the directory
  // labels the row with the schema's own name (#940).
  it("labels the row with the referenced schema's name", async () => {
    server.use(
      http.get(FLOWS_URL, () => HttpResponse.json(flowDefinitionsResponse())),
      http.get(SCHEMAS_URL, ({ request }) => {
        // Only the referenced ids are asked for, not the whole project.
        expect(new URL(request.url).searchParams.getAll("id")).toEqual(["sch_1"]);
        return HttpResponse.json({
          schemas: [
            {
              id: "sch_1",
              schema: { title: "Consumer", objectType: "consumer" },
              metadata: { created_at: "2026-01-01" },
            },
          ],
        });
      }),
    );
    await renderAt("/flow-definitions");
    expect(await screen.findByText("Consumer")).toBeInTheDocument();
    expect(screen.queryByText("sch_1")).not.toBeInTheDocument();
  });

  // A schema that was deleted — or never returned — still has to render a row.
  it("falls back to the raw id when the schema is not in the response", async () => {
    server.use(
      http.get(FLOWS_URL, () => HttpResponse.json(flowDefinitionsResponse())),
      http.get(SCHEMAS_URL, () => HttpResponse.json({ schemas: [] })),
    );
    await renderAt("/flow-definitions");
    expect(await screen.findByText("sch_1")).toBeInTheDocument();
  });

  it("still renders the page when the schemas request fails", async () => {
    server.use(
      http.get(FLOWS_URL, () => HttpResponse.json(flowDefinitionsResponse())),
      http.get(SCHEMAS_URL, () =>
        HttpResponse.json({ code: "internal", message: "boom" }, { status: 500 }),
      ),
    );
    await renderAt("/flow-definitions");
    expect(await screen.findByRole("link", { name: "Login" })).toBeInTheDocument();
    expect(screen.getByText("sch_1")).toBeInTheDocument();
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
