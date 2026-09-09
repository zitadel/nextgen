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
const FLOW_URL = "http://localhost/api/flow_definitions/flow_1";
const SCHEMA_URL = "http://localhost/api/schemas/sch_1";

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
afterEach(() => server.resetHandlers());
afterAll(() => {
  server.close();
  vi.unstubAllEnvs();
});

/**
 * A definition serving both purposes out of order, so the row's fixed purpose
 * ordering is exercised rather than the JSON's own.
 */
const DEFINITION = {
  name: "default-login",
  status: "active",
  user_schema: "sch_1",
  purposes: { register: "register", login: "identifier" },
  steps: [
    {
      name: "identifier",
      fields: ["email"],
      actions: [
        { name: "submit", kind: "submit" },
        { name: "passkey", kind: "passkey" },
      ],
    },
    { name: "passkey-upsell" },
  ],
};

const SCHEMA = { title: "Minimal", type: "object" };

// `expand=user_schema` embeds the same envelope `GET /schemas/{id}` returns,
// not the bare document — the row reads the name one level in.
const SCHEMA_EMBED = { id: "sch_1", schema: SCHEMA, metadata: { created_at: "2026-01-01T00:00:00Z" } };

const DETAIL_RESPONSE = {
  id: "flow_1",
  project_id: "proj_1",
  flow_definition: DEFINITION,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-02T00:00:00Z",
};

function listResponse() {
  return { flow_definitions: [{ ...DETAIL_RESPONSE, user_schema: SCHEMA_EMBED }] };
}

async function renderAt(path: string) {
  const [{ RouterProvider, createMemoryHistory }, { createAppRouter }] = await Promise.all([
    import("@tanstack/react-router"),
    import("../../../router"),
  ]);
  const router = createAppRouter({ history: createMemoryHistory({ initialEntries: [path] }) });
  render(<RouterProvider router={router} />);
  return router;
}

describe("login flows list", () => {
  it("shows the empty state when there are no flow definitions", async () => {
    server.use(http.get(FLOWS_URL, () => HttpResponse.json({ flow_definitions: [] })));
    await renderAt("/flow-definitions");
    expect(await screen.findByText("This project has no login flows.")).toBeInTheDocument();
  });

  it("renders a row with its humanised name, purposes, steps and schema", async () => {
    server.use(http.get(FLOWS_URL, () => HttpResponse.json(listResponse())));
    await renderAt("/flow-definitions");

    // `default-login` is a slug on the wire; the row is the only place it
    // becomes a label.
    expect(await screen.findByRole("link", { name: "Default login" })).toBeInTheDocument();
    // Fixed order, not the object's: the response lists `register` first.
    expect(screen.getByText("Login + Register")).toBeInTheDocument();
    expect(screen.getByText("identifier")).toBeInTheDocument();
    expect(screen.getByText("passkey-upsell")).toBeInTheDocument();
    // The schema name comes from the `expand=user_schema` embed, not the id,
    // and links to the schema it names.
    const schema = screen.getByRole("link", { name: "Minimal" });
    expect(schema).toHaveAttribute("href", "/schemas/sch_1");
  });

  it("asks for the embedded user schema", async () => {
    const seen: string[] = [];
    server.use(
      http.get(FLOWS_URL, ({ request }) => {
        seen.push(new URL(request.url).searchParams.getAll("expand").join(","));
        return HttpResponse.json(listResponse());
      }),
    );
    await renderAt("/flow-definitions");
    await screen.findByRole("link", { name: "Default login" });
    expect(seen).toEqual(["user_schema"]);
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

describe("login flow detail", () => {
  it("renders the steps table, the schema badge and the flow id", async () => {
    server.use(
      http.get(FLOW_URL, () => HttpResponse.json(DETAIL_RESPONSE)),
      http.get(SCHEMA_URL, () => HttpResponse.json({ schema: SCHEMA })),
    );
    await renderAt("/flow-definitions/flow_1");

    expect(await screen.findByRole("heading", { name: "Default login" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Minimal" })).toHaveAttribute("href", "/schemas/sch_1");
    expect(screen.getByText("flow_1")).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "submit, passkey" })).toBeInTheDocument();
    // A terminal step collects nothing and offers nothing.
    expect(screen.getAllByRole("cell", { name: "—" })).toHaveLength(2);
  });

  it("drops the schema badge when the schema cannot be read", async () => {
    server.use(
      http.get(FLOW_URL, () => HttpResponse.json(DETAIL_RESPONSE)),
      http.get(SCHEMA_URL, () =>
        HttpResponse.json({ code: "sch.permission_denied", message: "no" }, { status: 403 }),
      ),
    );
    await renderAt("/flow-definitions/flow_1");

    // The screen still renders — the badge is decoration on a route that is
    // useful without it.
    expect(await screen.findByRole("heading", { name: "Default login" })).toBeInTheDocument();
    expect(screen.queryByText("Minimal")).not.toBeInTheDocument();
  });
});
