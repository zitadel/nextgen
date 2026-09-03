import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

vi.stubEnv("VITE_CONSOLE_API_BASE", "http://localhost/api");

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
    principal_type: "user",
    principal_id: "user_1",
    relation: "admin",
    created_at: "2026-09-01T10:00:00Z",
    ...overrides,
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

describe("admins screen", () => {
  it("asks for the principal and labels each grant with it", async () => {
    // One request, not a read per row: the principal rides along on the list
    // (ADR 059), and ADR 058's resolved identity is what the row shows.
    const bodies = stubGrants(
      grant({ principal: { id: "user_1", display: "Maya Patel", identifier: "maya@acme.com" } }),
      grant({ id: "asgn_2", principal_id: "user_2", principal: { identifier: "sol@acme.com" } }),
    );
    await renderAdmins();

    const table = within(await screen.findByRole("table"));
    expect(bodies.at(-1)).toMatchObject({ expand: ["principal"] });
    expect(table.getByText("Maya Patel")).toBeInTheDocument();
    // No display designated, so the identifier is the label rather than the id.
    expect(table.getByText("sol@acme.com")).toBeInTheDocument();
  });

  it("falls back to the principal id when the principal cannot be loaded", async () => {
    // `principal: null` is what a deleted user's surviving grant looks like.
    stubGrants(grant({ principal: null }));
    await renderAdmins();

    const table = within(await screen.findByRole("table"));
    expect(table.getByText("user_1")).toBeInTheDocument();
  });

  it("renders whatever relation a grant carries, not just admin", async () => {
    // The screen only creates `admin`, but the catalog has three relations and
    // a grant made elsewhere must not be mislabelled.
    stubGrants(grant({ relation: "viewer", principal: { identifier: "vi@acme.com" } }));
    await renderAdmins();

    const table = within(await screen.findByRole("table"));
    expect(table.getByText("Viewer")).toBeInTheDocument();
  });

  it("says so when nobody has been granted access", async () => {
    stubGrants();
    await renderAdmins();

    expect(await screen.findByText("No admins yet.")).toBeInTheDocument();
  });

  it("adds an existing person as an admin", async () => {
    stubGrants();
    server.use(
      http.post(USERS_QUERY_URL, () =>
        HttpResponse.json({
          users: [
            {
              id: "user_9",
              identifier: "colleague@acme.com",
              identifier_property: "email",
              display: "Colleague",
              attributes: { email: "colleague@acme.com" },
            },
          ],
        }),
      ),
    );
    let created: Record<string, unknown> | undefined;
    server.use(
      http.post(GRANTS_URL, async ({ request }) => {
        created = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ id: "asgn_new" }, { status: 201 });
      }),
    );
    await renderAdmins();

    await userEvent.click(await screen.findByRole("button", { name: "Add admin" }));
    await userEvent.click(await screen.findByRole("combobox", { name: "Person" }));
    await userEvent.click(await screen.findByRole("option", { name: /Colleague/ }));
    // The dialog's own submit, not the trigger that shares its label.
    await userEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Add admin" }),
    );

    // Bound to the person, at the only level this journey grants (#769).
    await waitFor(() =>
      expect(created).toEqual({
        principal_type: "user",
        principal_id: "user_9",
        relation: "admin",
      }),
    );
  });

  it("surfaces the API's own message when the grant is refused", async () => {
    // ADR 030 makes the payload's `message` the human-facing string, so a
    // duplicate binding explains itself rather than getting console-authored copy.
    stubGrants();
    server.use(
      http.post(USERS_QUERY_URL, () =>
        HttpResponse.json({ users: [{ id: "user_9", identifier: "dupe@acme.com" }] }),
      ),
      http.post(GRANTS_URL, () =>
        HttpResponse.json(
          { code: "grant.already_exists", message: "This principal already has that access." },
          { status: 409 },
        ),
      ),
    );
    await renderAdmins();

    await userEvent.click(await screen.findByRole("button", { name: "Add admin" }));
    await userEvent.click(await screen.findByRole("combobox", { name: "Person" }));
    await userEvent.click(await screen.findByRole("option", { name: /dupe@acme.com/ }));
    await userEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Add admin" }),
    );

    expect(
      await screen.findByText("This principal already has that access."),
    ).toBeInTheDocument();
  });

  it("removes an admin after confirming", async () => {
    stubGrants(grant({ principal: { display: "Maya Patel" } }));
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
    stubGrants(grant({ principal: { display: "Maya Patel" } }));
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
