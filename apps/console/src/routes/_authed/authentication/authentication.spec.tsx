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

function connection(id: string, slug: string, displayName: string, extra: object = {}) {
  return {
    id,
    revision_id: `${id}_rev`,
    slug,
    created_at: CREATED_AT,
    updated_at: CREATED_AT,
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
const GITHUB = connection("idp_github", "github", "GitHub");

/** Lists `google` and a slug no connection has. */
const CUSTOMERS = {
  id: "sch_customers",
  metadata: { created_at: CREATED_AT },
  schema: {
    title: "Customer users",
    "x-auth-methods": {
      passkey: { enabled: true },
      password: { enabled: false },
      sso: { enabled: true, providers: ["google", "okta"] },
    },
  },
};

/** No `sso` at all. */
const EMPLOYEES = {
  id: "sch_employees",
  metadata: { created_at: CREATED_AT },
  schema: {
    title: "Employees",
    "x-auth-methods": { passkey: { enabled: false }, password: { enabled: true } },
  },
};

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

const OTHER_FLOW = {
  ...LOGIN_FLOW,
  id: "flow_staff",
  flow_definition: {
    ...LOGIN_FLOW.flow_definition,
    name: "staff-login",
    user_schema: "sch_employees",
    steps: [{ name: "identifier" }],
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
  flows = [LOGIN_FLOW, OTHER_FLOW],
  nextPageToken,
}: {
  idps?: unknown[] | 403;
  schemas?: unknown[];
  flows?: unknown[];
  nextPageToken?: string;
} = {}) {
  const bodies: Array<Record<string, unknown>> = [];
  server.use(
    http.post(IDPS_QUERY, async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      bodies.push(body);
      if (idps === 403) {
        return HttpResponse.json({ code: "idp.permission_denied", message: "no" }, { status: 403 });
      }
      const sorting = body.sorting as { field: string } | undefined;
      // Only the list's newest-first query pages; the slug lookup reads all.
      const paged = sorting?.field === "created_at" && nextPageToken && !body.page_token;
      return HttpResponse.json({
        idps: body.page_token ? [connection("idp_older", "older", "Older")] : idps,
        ...(paged ? { next_page_token: nextPageToken } : {}),
      });
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

describe("authentication screen", () => {
  it("opens on the Sign-in tab, with a badge per enabled method and listed provider", async () => {
    serve();
    await renderAt("/authentication");

    expect(await screen.findByRole("heading", { name: "Authentication" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Sign-in" })).toHaveAttribute("aria-selected", "true");

    const customers = (await screen.findByRole("link", { name: "Customer users" })).closest("tr");
    expect(customers).not.toBeNull();
    const row = within(customers as HTMLElement);
    // The connection's name for a resolved slug, the raw slug for one without.
    expect(row.getByText("Passkey")).toBeInTheDocument();
    expect(row.getByText("Google")).toBeInTheDocument();
    expect(row.getByText("okta")).toBeInTheDocument();
    // Declared but off, and a connection the schema does not list.
    expect(row.queryByText("Password")).not.toBeInTheDocument();
    expect(row.queryByText("GitHub")).not.toBeInTheDocument();
  });

  it("keeps the selected tab in the URL", async () => {
    serve();
    const router = await renderAt("/authentication");
    await userEvent.click(await screen.findByRole("tab", { name: "Identity providers" }));
    await waitFor(() =>
      expect(router.state.location.search).toMatchObject({ tab: "identity-providers" }),
    );

    // A reload of that URL opens the same tab.
    serve();
    await renderAt("/authentication?tab=identity-providers");
    const tabs = await screen.findAllByRole("tab", { name: "Identity providers" });
    expect(tabs.at(-1)).toHaveAttribute("aria-selected", "true");
  });

  it("opens a schema's allowed sign-in methods", async () => {
    serve();
    await renderAt("/authentication");
    await userEvent.click(await screen.findByRole("link", { name: "Customer users" }));

    expect(await screen.findByText("Allowed sign-in methods")).toBeInTheDocument();
    const rows = screen.getAllByText(/^(Enabled|Disabled|No connection)$/);
    // Passkey, Password, google (listed), okta (listed, no connection),
    // github (unlisted).
    expect(rows.map((badge) => badge.textContent)).toEqual([
      "Enabled",
      "Disabled",
      "Enabled",
      "No connection",
      "Disabled",
    ]);
    expect(screen.getByRole("link", { name: "Google" })).toHaveAttribute(
      "href",
      expect.stringContaining("/authentication/idps/idp_google"),
    );
    expect(screen.getByRole("link", { name: "GitHub" })).toBeInTheDocument();
    expect(screen.getByText("okta")).toBeInTheDocument();

    // Only the flow that pins this schema.
    expect(screen.getByRole("link", { name: "Default login" })).toHaveAttribute(
      "href",
      expect.stringContaining("/flow-definitions/flow_login"),
    );
    expect(screen.queryByRole("link", { name: "Staff login" })).not.toBeInTheDocument();
  });

  it("without idp.read, hides the Identity providers tab and shows raw slugs", async () => {
    serve({ idps: 403 });
    await renderAt("/authentication?tab=identity-providers");

    const customers = (await screen.findByRole("link", { name: "Customer users" })).closest("tr");
    const row = within(customers as HTMLElement);
    expect(row.getByText("google")).toBeInTheDocument();
    expect(row.getByText("okta")).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Identity providers" })).not.toBeInTheDocument();
  });

  it("lists every connection newest first and pages with the same sorting", async () => {
    const bodies = serve({ nextPageToken: "tok_2" });
    await renderAt("/authentication?tab=identity-providers");

    const table = within(await screen.findByRole("table"));
    for (const column of ["Name", "Slug", "Template", "Protocol", "Created"]) {
      expect(table.getByRole("columnheader", { name: column })).toBeInTheDocument();
    }
    expect(table.getByRole("link", { name: "Google" })).toBeInTheDocument();
    expect(table.getAllByText("OIDC")).toHaveLength(2);
    expect(table.getAllByText(formatDate(CREATED_AT))).toHaveLength(2);

    await userEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(await table.findByRole("link", { name: "Older" })).toBeInTheDocument();

    const listQueries = bodies.filter(
      (body) => (body.sorting as { field: string } | undefined)?.field === "created_at",
    );
    expect(listQueries).toHaveLength(2);
    for (const body of listQueries) {
      expect(body.sorting).toEqual({ field: "created_at", direction: "desc" });
    }
    expect(listQueries[1]?.page_token).toBe("tok_2");
  });

  it("points to the CLI when the project has no connections", async () => {
    serve({ idps: [] });
    await renderAt("/authentication?tab=identity-providers");
    expect(await screen.findByText(/This project has no identity providers/)).toBeInTheDocument();
    expect(screen.getByText("zitadel sso enable")).toBeInTheDocument();
  });
});

describe("identity provider detail", () => {
  it("shows the key values, what uses it, and the stored document, with no mutations", async () => {
    serve({
      idps: [
        connection("idp_google", "google", "Google", {
          oidc: undefined,
          protocol: "oauth2",
          oauth2: { client_id: "1234.apps.example.com", client_secret: "${{ SECRET }}" },
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
