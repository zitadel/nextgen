import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";
import { formatDate } from "@/lib/date";
import { server } from "@/test/msw";
import { scopedPath } from "@/test/project-scope.fixture";

// The `_authed` layout guards every screen behind `GET /sessions/me`
// (Console ADR 0003); mock the auth module so routes render as signed in.
vi.mock("@/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/auth/session")>();
  const { makeTestSession } = await import("@/test/session.fixture");
  return { ...actual, fetchSession: vi.fn(async () => makeTestSession()) };
});

const IDPS_QUERY = "*/api/idps/query";
const IDP_BY_ID = "*/api/idps/:id";
const SCHEMAS = "*/api/schemas";
const FLOWS = "*/api/flow_definitions";

const CREATED_AT = "2026-07-12T16:59:04Z";
const UPDATED_AT = "2026-08-01T09:00:00Z";

function connection(id: string, slug: string, displayName: string, extra: object = {}) {
  return {
    id,
    revision_id: `${id}_rev`,
    slug,
    created_at: CREATED_AT,
    updated_at: UPDATED_AT,
    definition: {
      slug,
      protocol: "oidc",
      template: slug,
      display_name: displayName,
      oidc: {
        issuer: "https://accounts.example.com",
        client_id: "${{ CLIENT_ID }}",
        client_secret: "${{ CLIENT_SECRET }}",
        scopes: ["openid"],
      },
      ...extra,
    },
  };
}

const GOOGLE = connection("idp_google", "google", "Google");
/** A connection no schema lists. */
const GITHUB = connection("idp_github", "github", "GitHub");

function schema(id: string, title: string, methods: object, createdAt = CREATED_AT) {
  return { id, metadata: { created_at: createdAt }, schema: { title, "x-auth-methods": methods } };
}

/** Lists `google` and a slug no connection has. */
const CUSTOMERS = schema("sch_customers", "Customer users", {
  passkey: { enabled: true },
  password: { enabled: false },
  sso: { enabled: true, providers: ["google", "okta"] },
});

/** No `sso` at all. */
const EMPLOYEES = schema("sch_employees", "Employees", {
  passkey: { enabled: false },
  password: { enabled: true },
});

const LOGIN_FLOW = {
  id: "flow_login",
  project_id: "proj_test",
  created_at: CREATED_AT,
  updated_at: CREATED_AT,
  flow_definition: {
    name: "default-login",
    status: "active",
    user_schema: "sch_customers",
    purposes: { login: "identifier" },
    steps: [{ name: "identifier", sso_providers: ["google"] }],
  },
};

/**
 * The reads both screens make. `idps` is what the query answers, or `403` for
 * a caller without `idp.read`. Returns the bodies the query was sent, so a
 * spec can assert on the sorting.
 */
function serve({
  idps = [GOOGLE, GITHUB] as unknown[] | 403,
  schemas = [CUSTOMERS, EMPLOYEES],
  flows = [LOGIN_FLOW],
}: {
  idps?: unknown[] | 403;
  schemas?: unknown[];
  flows?: unknown[];
} = {}) {
  const bodies: Array<Record<string, unknown>> = [];
  server.use(
    http.post(IDPS_QUERY, async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      bodies.push(body);
      if (idps === 403) {
        return HttpResponse.json({ code: "idp.permission_denied", message: "no" }, { status: 403 });
      }
      return HttpResponse.json({ idps });
    }),
    http.get(SCHEMAS, () => HttpResponse.json({ schemas })),
    http.get(FLOWS, () => HttpResponse.json({ flow_definitions: flows })),
    http.get(IDP_BY_ID, ({ params }) => {
      const found = (idps === 403 ? [] : idps).find(
        (idp) => (idp as { id: string }).id === params.id,
      );
      return found
        ? HttpResponse.json(found)
        : HttpResponse.json({ code: "idp.not_found", message: "not found" }, { status: 404 });
    }),
  );
  return bodies;
}

async function renderAt(path: string) {
  const [{ RouterProvider, createMemoryHistory }, { createAppRouter }] = await Promise.all([
    import("@tanstack/react-router"),
    import("../../../router"),
  ]);
  const router = createAppRouter({
    history: createMemoryHistory({ initialEntries: [scopedPath(path)] }),
  });
  render(<RouterProvider router={router} />);
  return router;
}

/** The table row whose first cell reads `label`. */
function row(label: string) {
  const cell = screen.getByText(label).closest("tr");
  expect(cell).not.toBeNull();
  return within(cell as HTMLElement);
}

describe("authentication screen", () => {
  it("opens on Sign-in methods, one row per method in use with the schemas that allow it", async () => {
    serve();
    await renderAt("/authentication");

    expect(await screen.findByRole("heading", { name: "Authentication" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Sign-in methods" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    const table = within(await screen.findByRole("table"));
    for (const column of ["Method", "User schema", "Last change"]) {
      expect(table.getByRole("columnheader", { name: column })).toBeInTheDocument();
    }

    // Passkey, Password, then providers by name: the resolved slug under its
    // connection's name and the unresolved one as written. A connection no
    // schema lists is not a sign-in method.
    const labels = table
      .getAllByRole("row")
      .slice(1)
      .map((tr) => tr.querySelector("td")?.textContent);
    expect(labels).toEqual(["Passkey", "Password", "Google", "oktaNo connection"]);

    expect(row("Passkey").getByText("Customer users")).toBeInTheDocument();
    expect(row("Password").getByText("Employees")).toBeInTheDocument();
    expect(row("Google").getByText("Customer users")).toBeInTheDocument();
    expect(table.queryByText("GitHub")).not.toBeInTheDocument();

    // A provider with a connection opens it; a plain method has no page.
    expect(screen.getByRole("link", { name: "Google" })).toHaveAttribute(
      "href",
      expect.stringContaining("/authentication/idps/idp_google"),
    );
    expect(screen.queryByRole("link", { name: "Passkey" })).not.toBeInTheDocument();
  });

  it("dates a row by the newest schema revision behind it, or the connection's if later", async () => {
    const newer = "2026-09-15T12:00:00Z";
    serve({
      schemas: [
        CUSTOMERS,
        EMPLOYEES,
        schema("sch_staff", "Staff", { passkey: { enabled: true } }, newer),
      ],
    });
    await renderAt("/authentication");
    await screen.findByRole("table");

    expect(row("Passkey").getByText(formatDate(newer))).toBeInTheDocument();
    expect(row("Password").getByText(formatDate(CREATED_AT))).toBeInTheDocument();
    expect(row("Google").getByText(formatDate(UPDATED_AT))).toBeInTheDocument();
  });

  it("names the first two schemas and counts the rest", async () => {
    serve({
      schemas: [
        CUSTOMERS,
        schema("sch_a", "Alpha", { passkey: { enabled: true } }),
        schema("sch_b", "Beta", { passkey: { enabled: true } }),
        schema("sch_c", "Gamma", { passkey: { enabled: true } }),
      ],
    });
    await renderAt("/authentication");
    await screen.findByRole("table");
    // Each named schema opens itself; the count names the rest in its tooltip.
    expect(row("Passkey").getByRole("link", { name: "Alpha" })).toHaveAttribute(
      "href",
      expect.stringContaining("/schemas/sch_a"),
    );
    expect(row("Passkey").getByRole("link", { name: "Beta" })).toBeInTheDocument();
    expect(row("Passkey").queryByRole("link", { name: "Customer users" })).toBeNull();
    expect(row("Passkey").getByText("... +2")).toHaveAttribute("title", "Customer users, Gamma");
  });

  it("puts the selected tab in the URL", async () => {
    serve();
    const router = await renderAt("/authentication");
    await userEvent.click(await screen.findByRole("tab", { name: "Identity providers" }));
    await waitFor(() =>
      expect(router.state.resolvedLocation?.search).toMatchObject({ tab: "identity-providers" }),
    );
  });

  it("opens the tab a shared link names", async () => {
    serve();
    await renderAt("/authentication?tab=identity-providers");
    expect(await screen.findByRole("tab", { name: "Identity providers" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("without idp.read, hides the Identity providers tab and shows raw slugs", async () => {
    serve({ idps: 403 });
    const router = await renderAt("/authentication?tab=identity-providers");

    await screen.findByRole("table");
    expect(screen.queryByRole("tab", { name: "Identity providers" })).not.toBeInTheDocument();
    // The URL drops the tab it cannot show, and keeps the project.
    await waitFor(() => expect(router.state.resolvedLocation?.search).not.toHaveProperty("tab"));
    expect(router.state.resolvedLocation?.search).toMatchObject({ project: "proj_test" });
    expect(screen.getByText("google")).toBeInTheDocument();
    expect(screen.getByText("okta")).toBeInTheDocument();
    // Whether a slug has a connection is not something this caller can see.
    expect(screen.queryByText("No connection")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "google" })).not.toBeInTheDocument();
  });

  it("lists every connection newest first with its schemas", async () => {
    const bodies = serve();
    await renderAt("/authentication?tab=identity-providers");

    const table = within(await screen.findByRole("table"));
    for (const column of ["Provider", "User schema", "Last change"]) {
      expect(table.getByRole("columnheader", { name: column })).toBeInTheDocument();
    }
    expect(row("Google").getByText("Customer users")).toBeInTheDocument();
    expect(row("GitHub").getByText("Not used")).toBeInTheDocument();
    expect(table.getAllByText(formatDate(UPDATED_AT))).toHaveLength(2);

    // One read serves both tabs, newest first: the API sorts ascending by default.
    expect(bodies).toHaveLength(1);
    expect(bodies[0]?.sorting).toEqual({ field: "created_at", direction: "desc" });
  });

  it("points to the CLI when the project has no connections", async () => {
    serve({ idps: [] });
    await renderAt("/authentication?tab=identity-providers");
    expect(await screen.findByText(/This project has no identity providers/)).toBeInTheDocument();
    expect(screen.getByText("zitadel auth-method sso enable")).toBeInTheDocument();
  });
});

describe("identity provider detail", () => {
  it("shows the key values, what uses it, and the stored document, with no mutations", async () => {
    serve({
      idps: [
        connection("idp_google", "google", "Google", {
          oidc: {
            issuer: "https://accounts.example.com",
            client_id: "1234.apps.example.com",
            client_secret: "${{ SECRET }}",
            scopes: ["openid"],
          },
        }),
      ],
    });
    await renderAt("/authentication/idps/idp_google");

    expect(await screen.findByRole("heading", { name: "Google" })).toBeInTheDocument();
    expect(screen.getByText("idp_google")).toBeInTheDocument();
    expect(screen.getByText(formatDate(CREATED_AT))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy Connection ID" })).toBeInTheDocument();
    expect(screen.getByText("1234.apps.example.com")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy Client ID" })).toBeInTheDocument();

    expect(screen.getByRole("link", { name: "Customer users" })).toHaveAttribute(
      "href",
      expect.stringContaining("/schemas/sch_customers"),
    );
    expect(screen.getByRole("link", { name: "Default login" })).toHaveAttribute(
      "href",
      expect.stringContaining("/flow-definitions/flow_login"),
    );
    // The document viewer and its CLI hint, and nothing that writes.
    expect(screen.getByRole("tab", { name: "JSON" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /delete|edit|save/i })).not.toBeInTheDocument();
  });

  it("shows a client id reference as written", async () => {
    serve();
    await renderAt("/authentication/idps/idp_github");
    expect(await screen.findByRole("heading", { name: "GitHub" })).toBeInTheDocument();
    expect(screen.getAllByText("${{ CLIENT_ID }}").length).toBeGreaterThan(0);
  });

  it("says Not used when nothing references the slug", async () => {
    serve();
    await renderAt("/authentication/idps/idp_github");
    expect(await screen.findByRole("heading", { name: "GitHub" })).toBeInTheDocument();
    expect(screen.getAllByText("Not used")).toHaveLength(2);
  });
});
