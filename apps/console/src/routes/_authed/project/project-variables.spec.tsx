import { render, screen, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { scopedPath } from "@/test/project-scope.fixture";
import { server } from "@/test/msw";

// The `_authed` layout guards every screen behind `GET /sessions/me`
// (Console ADR 0003); mock the auth module so routes render as signed in.
vi.mock("@/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/auth/session")>();
  const { makeTestSession } = await import("@/test/session.fixture");
  return { ...actual, fetchSession: vi.fn(async () => makeTestSession()) };
});

/**
 * The variables section of the project page (#2319): the project's names with
 * the value each kind holds, read from one `GET /variables` without a kind.
 */
const PROJECT_ID = "proj_1";
const VARIABLES_URL = "http://localhost/api/variables";

beforeEach(() =>
  server.use(
    http.get(`http://localhost/api/projects/${PROJECT_ID}`, () =>
      HttpResponse.json({
        id: PROJECT_ID,
        name: "River",
        origins: [],
        created_at: "2026-07-08T09:00:00Z",
        updated_at: "2026-07-08T09:00:00Z",
      }),
    ),
    http.post("http://localhost/api/grants/query", () => HttpResponse.json({ grants: [] })),
    http.get("http://localhost/api/policies", () =>
      HttpResponse.json({ policies: [], next_page_token: null }),
    ),
    http.get("http://localhost/api/users/me/projects", () =>
      HttpResponse.json({ projects: [{ id: PROJECT_ID, name: "River" }] }),
    ),
  ),
);

/** `GET /variables` answering `body`, and the project each read named. */
function stubVariables(body: Record<string, unknown>, status = 200) {
  const projects: (string | null)[] = [];
  server.use(
    http.get(VARIABLES_URL, ({ request }) => {
      projects.push(new URL(request.url).searchParams.get("project_id"));
      return HttpResponse.json(body, { status });
    }),
  );
  return projects;
}

async function renderProject() {
  const [{ RouterProvider, createMemoryHistory }, { createAppRouter }] = await Promise.all([
    import("@tanstack/react-router"),
    import("../../../router"),
  ]);
  const router = createAppRouter({
    history: createMemoryHistory({ initialEntries: [scopedPath("/project", PROJECT_ID)] }),
  });
  render(<RouterProvider router={router} />);
  return router;
}

async function variables() {
  return within(await screen.findByRole("region", { name: "Variables and Secrets" }));
}

describe("project variables", () => {
  it("lists each name with its value per kind, from the route's project", async () => {
    const projects = stubVariables({
      GOOGLE_CLIENT_SECRET: { primary: { secret: true } },
      GOOGLE_CLIENT_ID: { primary: "prod-client-123", preview: "preview-client-456" },
      RETRY_COUNT: { preview: 3 },
    });
    await renderProject();

    const section = await variables();
    expect(projects).toEqual([PROJECT_ID]);
    const [idRow, secretRow, countRow] = section.getAllByRole("row").slice(1);
    expect(
      [idRow, secretRow, countRow].map((row) => within(row!).getAllByRole("cell")[0]?.textContent),
    ).toEqual(["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "RETRY_COUNT"]);

    // A plain value is shown in full and copyable, per kind.
    const id = within(idRow!);
    expect(id.getByText("Variable")).toBeInTheDocument();
    expect(id.getByText("prod-client-123")).toBeInTheDocument();
    expect(
      id.getByRole("button", { name: "Copy GOOGLE_CLIENT_ID primary value" }),
    ).toBeInTheDocument();
    expect(id.getByText("preview-client-456")).toBeInTheDocument();

    // A secret is held, never shown; the kind with no value says so. Nothing
    // falls back from primary to preview.
    const secret = within(secretRow!);
    expect(secret.getByText("Secret")).toBeInTheDocument();
    expect(secret.getByText("Configured")).toBeInTheDocument();
    expect(secret.getByText("Not configured")).toBeInTheDocument();
    expect(secret.queryByRole("button", { name: /value/ })).toBeNull();

    // A number reads as the CLI would print it.
    const count = within(countRow!);
    expect(count.getByText("Not configured")).toBeInTheDocument();
    expect(count.getByText("3")).toBeInTheDocument();
  });

  it("points at the CLI when no variable is set", async () => {
    stubVariables({});
    await renderProject();

    const section = await variables();
    expect(section.queryByRole("table")).toBeNull();
    expect(section.getByText(/No variables have been set/)).toBeInTheDocument();
    expect(section.getByText("npx @zitadel/cli@latest variable set")).toBeInTheDocument();
  });

  // The person may act on the project but not read its variables.
  it("calls a name that is plain for one kind and secret for the other Mixed", async () => {
    stubVariables({ API_KEY: { primary: "abc", preview: { secret: true } } });
    await renderProject();

    const [row] = (await variables()).getAllByRole("row").slice(1);
    expect(row).toHaveTextContent("Mixed");
    expect(within(row!).getByText("abc")).toBeInTheDocument();
    expect(within(row!).getByText("Configured")).toBeInTheDocument();
  });
});
