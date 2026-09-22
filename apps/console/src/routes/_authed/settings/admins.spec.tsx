import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// Safe as a static import where `@/auth/session` is not: the fixture's only
// dependency on it is a type, which the transform erases.
import { makeTestSession } from "@/auth/session.fixture";

// The `_authed` layout guards every screen behind `GET /sessions/me`
// (Console ADR 0003); mock the auth module so routes render as signed in.
vi.mock("@/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/auth/session")>();
  const { makeTestSession } = await import("@/auth/session.fixture");
  return { ...actual, fetchSession: vi.fn(async () => makeTestSession()) };
});

vi.stubEnv("VITE_CONSOLE_API_BASE", "http://localhost/api");

// Loaded after the env stub, for the same reason `renderAdmins` imports the
// router dynamically: the API client reads its base once, at module load, and a
// static import would run before the stub and send every request to port 3000.
const { NEUTRAL_MESSAGE, SELF_MESSAGE } = await import("@/components/add-admin-dialog");

/** The signed-in address, read from the fixture rather than restated here. */
const SELF = makeTestSession().user?.identifier ?? "";
const GRANTS_URL = "http://localhost/api/grants";
const GRANTS_QUERY_URL = `${GRANTS_URL}/query`;
const USERS_QUERY_URL = "http://localhost/api/users/query";
const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
afterEach(() => server.resetHandlers());
afterAll(() => {
  server.close();
  vi.unstubAllEnvs();
});

async function renderAdmins() {
  const [{ RouterProvider, createMemoryHistory }, { createAppRouter }] = await Promise.all([
    import("@tanstack/react-router"),
    import("../../../router"),
  ]);
  const router = createAppRouter({
    history: createMemoryHistory({ initialEntries: ["/settings/admins"] }),
  });
  render(<RouterProvider router={router} />);
  return router;
}

function grant(overrides: Record<string, unknown> = {}) {
  return {
    id: "asgn_1",
    project_id: "proj_1",
    object_type: "project",
    relation: "admin",
    created_at: "2026-09-01T10:00:00Z",
    user: { user_id: "user_1" },
    ...overrides,
  };
}

/**
 * A user as `expand: ["principal"]` inlines it: extras live on the same
 * `user` object as the ref (`user_id`, never `id`).
 */
function grantUser(identity: Record<string, unknown>) {
  return {
    user_id: "user_1",
    schema: "sch_1",
    attributes: {},
    metadata: {
      created_at: "2026-09-01T10:00:00Z",
      updated_at: "2026-09-01T10:00:00Z",
      status: "active",
    },
    ...identity,
  };
}

/** Records every `POST /grants/query` body, so the expansion sent can be asserted. */
function stubGrants(...grants: Record<string, unknown>[]) {
  const bodies: Record<string, unknown>[] = [];
  server.use(
    http.post(GRANTS_QUERY_URL, async ({ request }) => {
      bodies.push((await request.json()) as Record<string, unknown>);
      return HttpResponse.json({ grants });
    }),
  );
  return bodies;
}

/**
 * `POST /grants` by identifier: 202 with no body, whoever the address belongs
 * to (#1229). The returned array is every body the console sent.
 */
function stubCreateGrant() {
  const bodies: unknown[] = [];
  server.use(
    http.post(GRANTS_URL, async ({ request }) => {
      bodies.push(await request.json());
      return new HttpResponse(null, { status: 202 });
    }),
  );
  return bodies;
}

async function openAddAdmin() {
  await userEvent.click(await screen.findByRole("button", { name: "Add admin" }));
  const dialog = within(await screen.findByRole("dialog"));
  return {
    dialog,
    input: dialog.getByRole("textbox", { name: "Email address" }),
    // The dialog's own submit, not the trigger that shares its label.
    submit: dialog.getByRole("button", { name: "Add admin" }),
  };
}

describe("admins screen", () => {
  it("asks for the principal and labels each grant with it", async () => {
    // One request, not a read per row: the principal rides along on the list
    // (ADR 059), and ADR 058's resolved identity is what the row shows.
    const bodies = stubGrants(
      grant({ user: grantUser({ display: "Maya Patel", identifier: "maya@acme.com" }) }),
      grant({
        id: "asgn_2",
        user: grantUser({ user_id: "user_2", identifier: "sol@acme.com" }),
      }),
    );
    await renderAdmins();

    const table = within(await screen.findByRole("table"));
    expect(bodies.at(-1)).toMatchObject({ expand: ["principal"] });
    expect(table.getByText("Maya Patel")).toBeInTheDocument();
    // No display designated, so the identifier is the label rather than the id.
    expect(table.getByText("sol@acme.com")).toBeInTheDocument();
  });

  it("falls back to the principal id when the principal cannot be loaded", async () => {
    // A deleted user's surviving grant is a degraded ref: `user_id` only.
    stubGrants(grant({ user: { user_id: "user_1" } }));
    await renderAdmins();

    const table = within(await screen.findByRole("table"));
    expect(table.getByText("user_1")).toBeInTheDocument();
  });

  it("renders whatever relation a grant carries, not just admin", async () => {
    // The screen only creates `admin`, but the catalog has three relations and
    // a grant made elsewhere must not be mislabelled.
    stubGrants(grant({ relation: "viewer", user: grantUser({ identifier: "vi@acme.com" }) }));
    await renderAdmins();

    const table = within(await screen.findByRole("table"));
    expect(table.getByText("Viewer")).toBeInTheDocument();
  });

  it("labels a team principal by its name", async () => {
    // A team grant carries `team` and omits `user`. `name` is already on the ref.
    stubGrants(
      grant({
        user: undefined,
        team: {
          team_id: "team_1",
          name: "Platform",
          status: "active",
          created_at: "2026-09-01T10:00:00Z",
          updated_at: "2026-09-01T10:00:00Z",
        },
      }),
    );
    await renderAdmins();

    const table = within(await screen.findByRole("table"));
    expect(table.getByText("Platform")).toBeInTheDocument();
  });

  it("says so when nobody has been granted access", async () => {
    stubGrants();
    await renderAdmins();

    expect(await screen.findByText("No admins yet.")).toBeInTheDocument();
  });

  it("grants by the address that was typed", async () => {
    stubGrants();
    const created = stubCreateGrant();
    await renderAdmins();

    const { input, submit } = await openAddAdmin();
    await userEvent.type(input, "colleague@acme.com");
    await userEvent.click(submit);

    // The identifier locator, at the only level this journey grants (#769).
    await waitFor(() =>
      expect(created.at(-1)).toEqual({
        user: { identifier: "colleague@acme.com" },
        relation: "admin",
      }),
    );
    expect(await screen.findByText(NEUTRAL_MESSAGE)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("says the same thing for an address that belongs to nobody", async () => {
    // The 202 carries no body, so the console has nothing to branch on and the
    // operator learns nothing about who is registered.
    stubGrants();
    stubCreateGrant();
    let userQueries = 0;
    server.use(
      http.post(USERS_QUERY_URL, () => {
        userQueries += 1;
        return HttpResponse.json({ users: [] });
      }),
    );
    await renderAdmins();

    const { input, submit } = await openAddAdmin();
    await userEvent.type(input, "nobody@acme.com");
    await userEvent.click(submit);

    expect(await screen.findByText(NEUTRAL_MESSAGE)).toBeInTheDocument();
    // No directory read: the old picker listed everyone to whoever opened it.
    expect(userQueries).toBe(0);
  });

  it("refuses the operator's own address without sending it", async () => {
    // Different case and surrounding spaces: the comparison is on the trimmed
    // value, case-insensitively, because the address is the same address.
    stubGrants();
    const created = stubCreateGrant();
    await renderAdmins();

    const { dialog, input, submit } = await openAddAdmin();
    await userEvent.type(input, "  Test.User@example.com  ");
    await userEvent.click(submit);

    expect(await dialog.findByRole("alert")).toHaveTextContent(SELF_MESSAGE);
    expect(input).toBeInvalid();
    expect(created).toHaveLength(0);
  });

  it("leaves a malformed address to the browser", async () => {
    // `type="email"` refuses it before the handler runs, so there is no
    // console-authored format message to keep in step with the server's.
    stubGrants();
    const created = stubCreateGrant();
    await renderAdmins();

    const { input, submit } = await openAddAdmin();
    await userEvent.type(input, "not-an-email");
    await userEvent.click(submit);

    expect(input).toBeInvalid();
    expect(created).toHaveLength(0);
  });

  it("surfaces the API's own message when the grant is refused", async () => {
    // ADR 030 makes the payload's `message` the human-facing string. Signed in
    // without an identifier, the console cannot run its own self check, so
    // self-granting comes back as the API's `grant.invalid` instead. One
    // resolved value is enough: the guard reads the session once per render,
    // and this submit fails, so nothing invalidates the route and reads it again.
    const { fetchSession } = await import("@/auth/session");
    // A schema that designates no identifier leaves the field off the session
    // user entirely, rather than carrying it as undefined.
    const { user, ...session } = makeTestSession();
    vi.mocked(fetchSession).mockResolvedValueOnce({
      ...session,
      user: user && { user_id: user.user_id, display: user.display },
    });
    stubGrants();
    server.use(
      http.post(GRANTS_URL, () =>
        HttpResponse.json(
          { code: "grant.invalid", message: "you cannot grant access to yourself" },
          { status: 400 },
        ),
      ),
    );
    await renderAdmins();

    const { dialog, input, submit } = await openAddAdmin();
    await userEvent.type(input, SELF);
    await userEvent.click(submit);

    expect(await dialog.findByRole("alert")).toHaveTextContent(
      "you cannot grant access to yourself",
    );
  });

  it("names the relation the row holds, not always admin", async () => {
    // The screen only creates `admin`, but the list shows whatever a grant
    // carries, and "Remove admin" over a `viewer` row would misdescribe the
    // click.
    stubGrants(
      grant({ relation: "viewer", user: grantUser({ display: "Sasha Kim" }) }),
    );
    await renderAdmins();

    await userEvent.click(await screen.findByRole("button", { name: "Actions for Sasha Kim" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Remove viewer" }));
    const dialog = within(await screen.findByRole("alertdialog"));
    expect(dialog.getByText("Remove viewer?")).toBeInTheDocument();
  });

  it("does not carry a failed removal into the next opening", async () => {
    // The dialog content is mounted per opening, so the error from one attempt
    // is not sitting there when the operator opens it again.
    stubGrants(grant({ user: grantUser({ display: "Maya Patel" }) }));
    server.use(
      http.delete(`${GRANTS_URL}/:id`, () =>
        HttpResponse.json({ code: "grant.not_found", message: "no such grant" }, { status: 404 }),
      ),
    );
    await renderAdmins();

    await userEvent.click(await screen.findByRole("button", { name: "Actions for Maya Patel" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Remove admin" }));
    await userEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Remove admin" }),
    );
    expect(await screen.findByText("no such grant")).toBeInTheDocument();

    await userEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Cancel" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Actions for Maya Patel" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Remove admin" }));

    await screen.findByRole("alertdialog");
    expect(screen.queryByText("no such grant")).not.toBeInTheDocument();
  });

  it("removes an admin after confirming", async () => {
    stubGrants(grant({ user: grantUser({ display: "Maya Patel" }) }));
    let deleted: string | undefined;
    server.use(
      http.delete(`${GRANTS_URL}/:id`, ({ params }) => {
        deleted = params.id as string;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await renderAdmins();

    await userEvent.click(await screen.findByRole("button", { name: "Actions for Maya Patel" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Remove admin" }));
    const dialog = within(await screen.findByRole("alertdialog"));
    expect(dialog.getByText("Remove admin?")).toBeInTheDocument();
    await userEvent.click(dialog.getByRole("button", { name: "Remove admin" }));

    await waitFor(() => expect(deleted).toBe("asgn_1"));
  });

  it("keeps the row when the removal is cancelled", async () => {
    stubGrants(grant({ user: grantUser({ display: "Maya Patel" }) }));
    let deleteCalls = 0;
    server.use(
      http.delete(`${GRANTS_URL}/:id`, () => {
        deleteCalls += 1;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await renderAdmins();

    await userEvent.click(await screen.findByRole("button", { name: "Actions for Maya Patel" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Remove admin" }));
    await userEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Cancel" }),
    );

    expect(deleteCalls).toBe(0);
    expect(screen.getByText("Maya Patel")).toBeInTheDocument();
  });
});

describe("settings nav", () => {
  it("lists Admins under WORKSPACE", async () => {
    stubGrants();
    await renderAdmins();

    const workspace = await screen.findByRole("navigation", { name: "WORKSPACE" });
    expect(within(workspace).getByRole("link", { name: /Admins/ })).toHaveAttribute(
      "href",
      "/settings/admins",
    );
    // `ACCOUNT` has no built screen yet, so its heading is not drawn: a heading
    // over nothing advertises a section that is not there.
    expect(screen.queryByRole("navigation", { name: "ACCOUNT" })).not.toBeInTheDocument();
  });

  it("keeps Admins out of the portal sidebar", async () => {
    // Rendered on a portal URL, where the primary list is the one on screen —
    // asserting this from a settings URL would pass whether or not the two
    // views are actually separated.
    const [{ RouterProvider, createMemoryHistory }, { createAppRouter }] = await Promise.all([
      import("@tanstack/react-router"),
      import("../../../router"),
    ]);
    server.use(http.post("http://localhost/api/projects/query", () =>
      HttpResponse.json({ projects: [] }),
    ));
    render(
      <RouterProvider
        router={createAppRouter({ history: createMemoryHistory({ initialEntries: ["/teams"] }) })}
      />,
    );

    const primary = await screen.findByRole("navigation", { name: "Primary" });
    expect(within(primary).queryByRole("link", { name: /Admins/ })).not.toBeInTheDocument();
  });
});
