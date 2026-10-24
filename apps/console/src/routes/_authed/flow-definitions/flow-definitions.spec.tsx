import { render, screen } from "@testing-library/react";
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

// Absolute base so requests parse under jsdom/undici and MSW can intercept.
const FLOWS_URL = "http://localhost/api/flow_definitions";
const FLOW_URL = "http://localhost/api/flow_definitions/flow_1";
const SCHEMAS_URL = "http://localhost/api/schemas";

/**
 * A definition serving both purposes out of order, so the row's fixed purpose
 * ordering is exercised rather than the JSON's own.
 */
const DEFINITION = {
  name: "default-login",
  status: "active",
  user_schema: "human-user",
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
const SCHEMA_EMBED = {
  id: "sch_1",
  schema: SCHEMA,
  metadata: { created_at: "2026-01-01T00:00:00Z" },
};

const DETAIL_RESPONSE = {
  id: "flow_1",
  project_id: "proj_1",
  flow_definition: DEFINITION,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-02T00:00:00Z",
};

/** `GET /schemas` answering with the newest revision of the flow's schema. */
function schemasResponse() {
  return { schemas: [SCHEMA_EMBED], next_page_token: null };
}

function listResponse() {
  return { flow_definitions: [{ ...DETAIL_RESPONSE, user_schema: SCHEMA_EMBED }] };
}

async function renderAt(path: string, project?: string) {
  const [{ RouterProvider, createMemoryHistory }, { createAppRouter }] = await Promise.all([
    import("@tanstack/react-router"),
    import("../../../router"),
  ]);
  const router = createAppRouter({
    history: createMemoryHistory({ initialEntries: [scopedPath(path, project)] }),
  });
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
    expect(schema).toHaveAttribute("href", scopedPath("/schemas/sch_1"));
  });

  it("marks a draft flow and leaves an active one unmarked", async () => {
    const draft = {
      ...DETAIL_RESPONSE,
      id: "flow_2",
      flow_definition: { ...DEFINITION, name: "passkey-login", status: "draft" },
      user_schema: SCHEMA_EMBED,
    };
    server.use(
      http.get(FLOWS_URL, () =>
        HttpResponse.json({
          flow_definitions: [{ ...DETAIL_RESPONSE, user_schema: SCHEMA_EMBED }, draft],
        }),
      ),
    );
    await renderAt("/flow-definitions");

    // Only the draft is marked: the engine picks the newest *active*
    // definition, so an all-active list stays exactly as the design draws it.
    await screen.findByRole("link", { name: "Default login" });
    expect(screen.getByText("draft")).toBeInTheDocument();
    expect(screen.queryByText("active")).not.toBeInTheDocument();
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
          HttpResponse.json(
            { code: "internal", message: "boom" },
            { status: 500, headers: { "x-request-id": "req_01TEST" } },
          ),
        ),
      );
      await renderAt("/flow-definitions");
      expect(await screen.findByText("Something went wrong")).toBeInTheDocument();
      expect(screen.getByText("Error 500")).toBeInTheDocument();
      expect(screen.getByText("boom")).toBeInTheDocument();
      // The references to quote: the code and the request ID from the response.
      expect(screen.getByText("internal")).toBeInTheDocument();
      expect(screen.getByText("req_01TEST")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
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
      http.get(SCHEMAS_URL, () => HttpResponse.json(schemasResponse())),
    );
    await renderAt("/flow-definitions/flow_1");

    expect(await screen.findByRole("heading", { name: "Default login" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Minimal" })).toHaveAttribute(
      "href",
      scopedPath("/schemas/sch_1"),
    );
    expect(screen.getByText("flow_1")).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "submit, passkey" })).toBeInTheDocument();
    // A terminal step collects nothing and offers nothing.
    expect(screen.getAllByRole("cell", { name: "—" })).toHaveLength(2);
  });

  it("names the newest revision of the schema in the selected project", async () => {
    // The flow names its schema by objectType, which means the project's
    // newest revision of it, so the badge's lookup names both.
    const queries: URLSearchParams[] = [];
    server.use(
      http.get(FLOW_URL, () => HttpResponse.json(DETAIL_RESPONSE)),
      http.get("*/api/projects/proj_other", () =>
        HttpResponse.json({ id: "proj_other", name: "Other project" }),
      ),
      http.get(SCHEMAS_URL, ({ request }) => {
        queries.push(new URL(request.url).searchParams);
        return HttpResponse.json(schemasResponse());
      }),
    );
    await renderAt("/flow-definitions/flow_1", "proj_other");

    expect(await screen.findByRole("link", { name: "Minimal" })).toBeInTheDocument();
    expect(queries).toHaveLength(1);
    expect(queries[0]?.get("project_id")).toBe("proj_other");
    expect(queries[0]?.get("object_type")).toBe("human-user");
    expect(queries[0]?.get("revisions")).toBe("latest");
  });

  it("drops the schema badge when the schema cannot be read", async () => {
    server.use(
      http.get(FLOW_URL, () => HttpResponse.json(DETAIL_RESPONSE)),
      http.get(SCHEMAS_URL, () =>
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
