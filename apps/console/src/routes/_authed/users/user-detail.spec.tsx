import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";
import { TEST_PROJECT_ID, scopedPath } from "@/test/project-scope.fixture";
import { server } from "@/test/msw";

// The `_authed` layout guards every screen behind `GET /sessions/me`
// (Console ADR 0003); mock the auth module so routes render as signed in.
vi.mock("@/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/auth/session")>();
  const { makeTestSession } = await import("@/test/session.fixture");
  return { ...actual, fetchSession: vi.fn(async () => makeTestSession()) };
});

const USERS_URL = "http://localhost/api/users";
const USERS_QUERY_URL = `${USERS_URL}/query`;
const SCHEMAS_URL = "http://localhost/api/schemas";
const IDPS_QUERY_URL = "http://localhost/api/idps/query";
const USER_ID = "user_1";

const BUSINESS = {
  title: "Business",
  required: ["email"],
  properties: {
    email: { type: "string", format: "email" },
    companyName: { type: "string", title: "Company name" },
  },
};

function stub({
  user = {
    id: USER_ID,
    schema: "sch_business",
    // The heading renders the envelope's resolved identity (ADR 058):
    // this schema designates email and no display properties.
    identifier: "maya@acme.com",
    identifier_property: "email",
    attributes: { email: "maya@acme.com", companyName: "Acme" },
    metadata: {
      status: "active",
      created_at: "2026-07-12T09:00:00Z",
      updated_at: "2026-07-12T09:00:00Z",
    },
  },
  passkeys = [{ id: "pk_1", name: "MacBook", created_at: "2026-07-01T00:00:00Z" }],
  passkeysStatus = 200,
  identityLinks = [],
  identityLinksStatus = 200,
}: {
  user?: Record<string, unknown>;
  passkeys?: unknown[];
  passkeysStatus?: number;
  identityLinks?: unknown[];
  identityLinksStatus?: number;
} = {}) {
  server.use(
    http.get(`${USERS_URL}/${USER_ID}`, () => HttpResponse.json(user)),
    http.get(`${SCHEMAS_URL}/sch_business`, () =>
      HttpResponse.json({
        id: "sch_business",
        schema: BUSINESS,
        metadata: { created_at: "2026-07-01T00:00:00Z" },
      }),
    ),
    http.get(`${USERS_URL}/${USER_ID}/passkeys`, () =>
      passkeysStatus === 200
        ? HttpResponse.json({ passkeys })
        : new HttpResponse(null, { status: passkeysStatus }),
    ),
    http.get(`${USERS_URL}/${USER_ID}/identity_links`, () =>
      identityLinksStatus === 200
        ? HttpResponse.json({ identity_links: identityLinks })
        : new HttpResponse(null, { status: identityLinksStatus }),
    ),
  );
}

async function renderDetail(project?: string) {
  const [{ RouterProvider, createMemoryHistory }, { createAppRouter }] = await Promise.all([
    import("@tanstack/react-router"),
    import("../../../router"),
  ]);
  const router = createAppRouter({
    history: createMemoryHistory({ initialEntries: [scopedPath(`/users/${USER_ID}`, project)] }),
  });
  render(<RouterProvider router={router} />);
  return router;
}

describe("user detail", () => {
  it("builds the profile from the user's own schema", async () => {
    stub();
    await renderDetail();

    expect(await screen.findByRole("heading", { name: "maya@acme.com" })).toBeInTheDocument();
    // Labels come from the schema, not from a fixed list.
    expect(screen.getByText("Business")).toBeInTheDocument();
    expect(screen.getByLabelText("Company name")).toHaveValue("Acme");
    expect(screen.getByLabelText("Email")).toHaveValue("maya@acme.com");
  });

  it("links the user's schema revision to its schema page", async () => {
    stub();
    await renderDetail();

    const panel = within(await screen.findByRole("tabpanel"));
    const link = await panel.findByRole("link", { name: "Business sch_business" });
    // The `_authed` layout retains the selected project across navigation.
    expect(link).toHaveAttribute("href", scopedPath("/schemas/sch_business"));
  });

  it("shows a URI schema id verbatim and links to it encoded", async () => {
    // The seeded default schema's id is its `$id` URL, not an `sch_*` id.
    const uri = "https://server.test/schemas/user.json";
    stub({
      user: {
        id: USER_ID,
        schema: uri,
        identifier: "maya@acme.com",
        identifier_property: "email",
        attributes: { email: "maya@acme.com" },
      },
    });
    server.use(
      http.get(`${SCHEMAS_URL}/:schemaId`, () =>
        HttpResponse.json({ id: uri, schema: { ...BUSINESS, title: "Default" } }),
      ),
    );
    await renderDetail();

    const panel = within(await screen.findByRole("tabpanel"));
    const link = await panel.findByRole("link", { name: `Default ${uri}` });
    expect(link).toHaveAttribute("href", scopedPath(`/schemas/${encodeURIComponent(uri)}`));
  });

  it("names an untitled schema by its id in the revision link", async () => {
    stub();
    server.use(
      http.get(`${SCHEMAS_URL}/sch_business`, () =>
        HttpResponse.json({ id: "sch_business", schema: { ...BUSINESS, title: undefined } }),
      ),
    );
    await renderDetail();

    const panel = within(await screen.findByRole("tabpanel"));
    expect(await panel.findByRole("link", { name: "sch_business sch_business" })).toBeVisible();
  });

  it("renders no revision link when the schema cannot be read", async () => {
    stub();
    server.use(
      http.get(`${SCHEMAS_URL}/sch_business`, () => new HttpResponse(null, { status: 403 })),
    );
    await renderDetail();

    const panel = within(await screen.findByRole("tabpanel"));
    expect(await panel.findByText(/This user’s schema could not be read/)).toBeInTheDocument();
    expect(panel.queryByRole("link")).not.toBeInTheDocument();
  });

  it("does not rank the revision as latest or outdated", async () => {
    // A user's revision is shown as a fact; no marker says how it compares.
    stub();
    await renderDetail();
    const panel = await screen.findByRole("tabpanel");
    await within(panel).findByRole("link", { name: "Business sch_business" });

    expect(panel).not.toHaveTextContent(/latest|outdated/i);
  });

  it("reads the user's schema in the selected project", async () => {
    // Schema ids are unique per project only, and the server resolves an
    // ambiguous one in the caller's own project unless `project_id` names it.
    stub();
    const projects: (string | null)[] = [];
    server.use(
      http.get("*/api/projects/proj_other", () =>
        HttpResponse.json({ id: "proj_other", name: "Other project" }),
      ),
      http.get(`${SCHEMAS_URL}/sch_business`, ({ request }) => {
        projects.push(new URL(request.url).searchParams.get("project_id"));
        return HttpResponse.json({ id: "sch_business", schema: BUSINESS });
      }),
    );
    await renderDetail("proj_other");

    expect(await screen.findByLabelText("Company name")).toHaveValue("Acme");
    expect(projects).toEqual(["proj_other"]);
  });

  it("renders numeric and boolean attributes rather than leaving them blank", async () => {
    // `schemaFields` surfaces `number`/`integer` properties, and a schema may
    // define a boolean, so reading them as strings would render a real value as
    // an empty field.
    server.use(
      http.get(`${USERS_URL}/${USER_ID}`, () =>
        HttpResponse.json({
          id: USER_ID,
          schema: "sch_business",
          identifier: "maya@acme.com",
          identifier_property: "email",
          attributes: { email: "maya@acme.com", headcount: 42, verified: false },
        }),
      ),
      http.get(`${SCHEMAS_URL}/sch_business`, () =>
        HttpResponse.json({
          id: "sch_business",
          schema: {
            title: "Business",
            properties: {
              email: { type: "string", format: "email" },
              headcount: { type: "integer", title: "Headcount" },
              verified: { type: "boolean", title: "Verified" },
            },
          },
          metadata: { created_at: "2026-07-01T00:00:00Z" },
        }),
      ),
      http.get(`${USERS_URL}/${USER_ID}/passkeys`, () => HttpResponse.json({ passkeys: [] })),
      http.get(`${USERS_URL}/${USER_ID}/identity_links`, () =>
        HttpResponse.json({ identity_links: [] }),
      ),
    );
    await renderDetail();

    expect(await screen.findByLabelText("Headcount")).toHaveValue("42");
    // `false` is a value, not an absence — it must not render as empty.
    expect(screen.getByLabelText("Verified")).toHaveValue("false");
  });

  it("renders the profile read-only", async () => {
    // There is no update endpoint (#693). An editable field with no Save would
    // promise an edit the console cannot make, so the fields are inert and the
    // design's Save is absent rather than disabled.
    stub();
    await renderDetail();

    expect(await screen.findByLabelText("Company name")).toHaveAttribute("readonly");
    expect(screen.getByLabelText("Email")).toHaveAttribute("readonly");
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
  });

  it("shows the status and created date the server stamped", async () => {
    stub();
    await renderDetail();
    await screen.findByRole("heading", { name: "maya@acme.com" });

    expect(screen.getByText("active")).toBeInTheDocument();
    expect(screen.getByText("Created")).toBeInTheDocument();
    // Derived rather than hardcoded: the screen renders the viewer's locale, so
    // asserting one locale's output would pass only on machines set to it.
    const expected = new Date("2026-07-12T09:00:00Z").toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  it("leads with the display and subtitles the identifier when both resolve", async () => {
    stub({
      user: {
        id: USER_ID,
        schema: "sch_business",
        identifier: "maya@acme.com",
        identifier_property: "email",
        display: "Maya Patel",
        attributes: { email: "maya@acme.com" },
      },
    });
    await renderDetail();
    expect(await screen.findByRole("heading", { name: "Maya Patel" })).toBeInTheDocument();
    expect(screen.getAllByText("maya@acme.com").length).toBeGreaterThanOrEqual(1);
  });

  it("omits status and created on a record the server has not stamped", async () => {
    // `metadata` sits on an otherwise open record, so a user written before it
    // existed simply has none. Nothing is invented for it.
    stub({
      user: {
        id: USER_ID,
        schema: "sch_business",
        identifier: "maya@acme.com",
        identifier_property: "email",
        attributes: { email: "maya@acme.com" },
      },
    });
    await renderDetail();
    await screen.findByRole("heading", { name: "maya@acme.com" });

    expect(screen.queryByText("Created")).not.toBeInTheDocument();
    expect(screen.queryByText("active")).not.toBeInTheDocument();
  });

  it("does not show a last sign-in — no field carries it", async () => {
    stub();
    await renderDetail();
    await screen.findByRole("heading", { name: "maya@acme.com" });

    expect(screen.queryByText(/Last sign-in/i)).not.toBeInTheDocument();
  });

  it("reports the real passkey count on the Authentication tab", async () => {
    stub({
      passkeys: [
        { id: "pk_1", name: "MacBook", created_at: "2026-07-01T00:00:00Z" },
        { id: "pk_2", name: "iPhone", created_at: "2026-07-02T00:00:00Z" },
      ],
    });
    await renderDetail();

    await userEvent.click(await screen.findByRole("tab", { name: "Authentication" }));
    const panel = within(screen.getByRole("tabpanel"));
    expect(panel.getByText("2 registered")).toBeInTheDocument();
    expect(panel.getByText("Enabled")).toBeInTheDocument();
  });

  it("still renders the screen when the passkey list fails", async () => {
    // The passkey call is chrome for the record, not the record — a failure
    // must cost the row, not the page.
    stub({ passkeysStatus: 500 });
    await renderDetail();

    await userEvent.click(await screen.findByRole("tab", { name: "Authentication" }));
    expect(
      within(screen.getByRole("tabpanel")).getByText("Could not be loaded"),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "maya@acme.com" })).toBeInTheDocument();
  });

  it("lists the linked identity providers by name on the Authentication tab", async () => {
    stub({
      identityLinks: [
        { id: "idplink_1", connection_id: "idp_google", created_at: "2026-07-03T00:00:00Z" },
      ],
    });
    const projects: (string | null)[] = [];
    server.use(
      http.post(IDPS_QUERY_URL, ({ request }) => {
        projects.push(new URL(request.url).searchParams.get("project_id"));
        return HttpResponse.json({
          idps: [{ id: "idp_google", slug: "google", definition: { display_name: "Google" } }],
        });
      }),
    );
    await renderDetail();

    await userEvent.click(await screen.findByRole("tab", { name: "Authentication" }));
    const panel = within(screen.getByRole("tabpanel"));
    // Passkeys stay their own row; the provider is not folded into them.
    expect(panel.getByText("Passkey")).toBeInTheDocument();
    expect(panel.getByRole("link", { name: "Google" })).toBeInTheDocument();
    expect(panel.getByText(/^Linked .*2026/)).toBeInTheDocument();
    expect(projects).toEqual([TEST_PROJECT_ID]);
  });

  it("names a linked connection by id when the connections cannot be read", async () => {
    // `idp.read` is a separate grant: a refusal costs the name, not the row.
    stub({
      identityLinks: [
        { id: "idplink_1", connection_id: "idp_google", created_at: "2026-07-03T00:00:00Z" },
      ],
    });
    server.use(http.post(IDPS_QUERY_URL, () => new HttpResponse(null, { status: 403 })));
    await renderDetail();

    await userEvent.click(await screen.findByRole("tab", { name: "Authentication" }));
    const panel = within(screen.getByRole("tabpanel"));
    expect(panel.getByText("idp_google")).toBeInTheDocument();
    expect(panel.queryByRole("link")).not.toBeInTheDocument();
  });

  it("says when no identity provider is linked, without reading the connections", async () => {
    // No `/idps/query` handler: the unhandled request would fail the test.
    stub();
    await renderDetail();

    await userEvent.click(await screen.findByRole("tab", { name: "Authentication" }));
    expect(
      within(screen.getByRole("tabpanel")).getByText(
        "No identity provider is linked to this user.",
      ),
    ).toBeInTheDocument();
  });

  it("still renders the screen when the identity link list fails", async () => {
    stub({ identityLinksStatus: 500 });
    await renderDetail();

    await userEvent.click(await screen.findByRole("tab", { name: "Authentication" }));
    const panel = within(screen.getByRole("tabpanel"));
    expect(panel.getByText("Could not be loaded")).toBeInTheDocument();
    // The passkey row is unaffected.
    expect(panel.getByText("1 registered")).toBeInTheDocument();
  });

  it("offers delete, and returns to the list once it succeeds", async () => {
    stub();
    let deleted = false;
    server.use(
      http.delete(`${USERS_URL}/${USER_ID}`, () => {
        deleted = true;
        return new HttpResponse(null, { status: 204 });
      }),
      // The shape `query-users-response.yaml` requires — `users` is a required
      // property, not an optional one. A bare array sent the list loader into
      // the error boundary on the redirect below, which the assertions could
      // not see because the boundary swallowed it.
      http.post(USERS_QUERY_URL, () => HttpResponse.json({ users: [] })),
    );
    const router = await renderDetail();

    await userEvent.click(await screen.findByRole("button", { name: "Delete user" }));
    await userEvent.type(screen.getByLabelText("Type DELETE to confirm"), "DELETE");
    await userEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete user" }),
    );

    await waitFor(() => expect(deleted).toBe(true));
    // The record the screen is about is gone, so staying on it would 404.
    await waitFor(() => expect(router.state.resolvedLocation?.pathname).toBe("/users"));
  });
});
