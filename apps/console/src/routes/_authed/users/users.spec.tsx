import { act, render, screen, waitFor, within } from "@testing-library/react";
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

const USERS_URL = "http://localhost/api/users";
const SCHEMAS_URL = "http://localhost/api/schemas";
const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
afterEach(() => server.resetHandlers());
afterAll(() => {
  server.close();
  vi.unstubAllEnvs();
});

async function renderUsers() {
  const [{ RouterProvider, createMemoryHistory }, { createAppRouter }] = await Promise.all([
    import("@tanstack/react-router"),
    import("../../../router"),
  ]);
  const router = createAppRouter({
    history: createMemoryHistory({ initialEntries: ["/users"] }),
  });
  render(<RouterProvider router={router} />);
  return router;
}

describe("users screen", () => {
  it("renders the page heading and a user row", async () => {
    server.use(
      http.get(USERS_URL, () =>
        HttpResponse.json({
          users: [
            // The shipped `consumer`/`business` presets spell the name parts
            // camelCase; `listUsers` returns the schema's attribute tree verbatim.
            {
              id: "user_1",
              schema: "sch_business",
              attributes: {
                givenName: "Maya",
                familyName: "Patel",
                email: "maya.patel@acme.com",
              },
            },
          ],
        }),
      ),
    );
    await renderUsers();
    expect(await screen.findByRole("heading", { name: "Users" })).toBeInTheDocument();
    // Columns are the schema's properties (design `277:288291`, decisions log
    // D4), so there is no combined "Name" column — the first property carries
    // the link to the detail screen.
    expect(await screen.findByRole("link", { name: "maya.patel@acme.com" })).toBeInTheDocument();
    expect(screen.getByText("Maya")).toBeInTheDocument();
    expect(screen.getByText("Patel")).toBeInTheDocument();
  });

  it("builds the columns from the schema the users reference", async () => {
    server.use(
      http.get(USERS_URL, () =>
        HttpResponse.json({
          users: [
            {
              id: "user_1",
              schema: "sch_business",
              attributes: { email: "maya@acme.com", companyName: "Acme" },
            },
          ],
        }),
      ),
      http.get(`${SCHEMAS_URL}/sch_business`, () =>
        HttpResponse.json({
          id: "sch_business",
          schema: {
            title: "Business",
            required: ["email"],
            properties: {
              email: { type: "string", format: "email" },
              companyName: { type: "string", title: "Company name" },
            },
          },
          metadata: { created_at: "2026-07-01T00:00:00Z" },
        }),
      ),
    );
    await renderUsers();

    // The header comes from the schema's own `title`, not from the record keys.
    expect(await screen.findByText("Company name")).toBeInTheDocument();
    // Scoped to the table: the app shell's organisation switcher also renders an
    // "Acme" label.
    const table = within(screen.getByRole("table"));
    expect(table.getByText("Acme")).toBeInTheDocument();
    expect(table.getByText("maya@acme.com")).toBeInTheDocument();
  });

  it("renders a placeholder where a user's schema does not define a column", async () => {
    // Columns union across schemas (D4), so a minimal user sits in a table that
    // also has business columns. The cell must read as empty, not as missing.
    server.use(
      http.get(USERS_URL, () =>
        HttpResponse.json({
          users: [
            {
              id: "user_1",
              schema: "sch_business",
              attributes: { email: "maya@acme.com", companyName: "Acme" },
            },
            { id: "user_2", schema: "sch_business", attributes: { email: "min@acme.com" } },
          ],
        }),
      ),
      http.get(`${SCHEMAS_URL}/sch_business`, () =>
        HttpResponse.json({
          id: "sch_business",
          schema: {
            properties: {
              email: { type: "string", format: "email" },
              companyName: { type: "string", title: "Company name" },
            },
          },
          metadata: { created_at: "2026-07-01T00:00:00Z" },
        }),
      ),
    );
    await renderUsers();

    // `schemaFields` orders properties by key, so `companyName` is the first
    // column and therefore the linked one. The user without a company falls back
    // to its id rather than rendering an empty link.
    expect(await screen.findByRole("link", { name: "Acme" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "user_2" })).toBeInTheDocument();
    expect(within(screen.getByRole("table")).getByText("min@acme.com")).toBeInTheDocument();
  });

  it("derives the display name the way the platform does", async () => {
    // Mirrors `User.DisplayName` (internal/domain/user.go): explicit `name`
    // wins, else the given/family parts joined, with snake_case accepted for
    // schemas authored that way. A partial name must not render a stray space.
    server.use(
      http.get(USERS_URL, () =>
        HttpResponse.json({
          users: [
            {
              id: "user_1",
              attributes: {
                name: "Ada L.",
                givenName: "Ada",
                familyName: "Lovelace",
                email: "a@x.com",
              },
            },
            {
              id: "user_2",
              attributes: { given_name: "Grace", family_name: "Hopper", email: "g@x.com" },
            },
            { id: "user_3", attributes: { givenName: "Radia", email: "r@x.com" } },
          ],
        }),
      ),
    );
    await renderUsers();
    // The derived name is no longer a column; it names the row's actions and
    // titles the delete dialog, which is where a wrong derivation would show.
    expect(await screen.findByRole("button", { name: "Actions for Ada L." })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Actions for Grace Hopper" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Actions for Radia" })).toBeInTheDocument();
  });

  it("ignores non-identity attributes when deriving the name", async () => {
    // Regression: the screen used to read a `username` property that no shipped
    // schema defines, so every row silently fell back to the email. Reading an
    // unrelated attribute as the name is worse than having none.
    server.use(
      http.get(USERS_URL, () =>
        HttpResponse.json({
          users: [{ id: "user_1", attributes: { username: "nope", email: "kenji@acme.com" } }],
        }),
      ),
    );
    await renderUsers();
    expect(
      await screen.findByRole("button", { name: "Actions for kenji@acme.com" }),
    ).toBeInTheDocument();
  });

  it("shows the user id alongside the schema's own attributes", async () => {
    server.use(
      http.get(USERS_URL, () =>
        HttpResponse.json({
          users: [{ id: "user_1", attributes: { email: "kenji@acme.com", status: "Blocked" } }],
        }),
      ),
    );
    await renderUsers();
    expect(await screen.findByRole("link", { name: "kenji@acme.com" })).toBeInTheDocument();
    expect(screen.getByText("user_1")).toBeInTheDocument();
    // `status` renders because this record carries it — the table shows what the
    // data has (D4). What is still absent is a *base-model* status the console
    // could count on for every user (#553); nothing is invented for records
    // without one.
    expect(screen.getByText("Blocked")).toBeInTheDocument();
  });

  it("renders the not-authorized state on a 401 with a live session (no redirect loop)", async () => {
    // A 401 data call while `GET /sessions/me` still answers with a session
    // means the operator-plane credential is missing (e.g. no dev-proxy
    // secret) — the boundary must render copy, not bounce to /login. The
    // loader error is expected; silence the boundary/router noise.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      server.use(
        http.get(USERS_URL, () =>
          HttpResponse.json(
            {
              code: "auth.unauthorized",
              message: "The request lacks valid authentication credentials.",
            },
            { status: 401 },
          ),
        ),
      );
      const router = await renderUsers();

      expect(await screen.findByText("Console API not authorized")).toBeInTheDocument();
      expect(router.state.location.pathname).toBe("/users");
    } finally {
      errorSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });

  it("filters live users across every rendered column, and by id", async () => {
    server.use(
      http.get(USERS_URL, () =>
        HttpResponse.json({
          users: [
            {
              id: "user_1",
              attributes: { givenName: "Maya", familyName: "Patel", email: "maya@acme.com" },
            },
            {
              id: "user_2",
              attributes: { givenName: "Sasha", familyName: "Kim", email: "sasha@acme.com" },
            },
          ],
        }),
      ),
    );
    await renderUsers();
    const table = () => within(screen.getByRole("table"));
    expect(await screen.findByText("Maya")).toBeInTheDocument();

    // By id — not a column an operator reads off, but the one they paste.
    await userEvent.type(screen.getByRole("searchbox", { name: "Search users" }), "user_2");
    expect(await screen.findByText("Sasha")).toBeInTheDocument();
    expect(table().queryByText("Maya")).not.toBeInTheDocument();

    // By a schema property that is not the first column: search covers whatever
    // the schema defines rather than a fixed name/email pair.
    await userEvent.clear(screen.getByRole("searchbox", { name: "Search users" }));
    await userEvent.type(screen.getByRole("searchbox", { name: "Search users" }), "Patel");
    expect(await screen.findByText("Maya")).toBeInTheDocument();
    expect(table().queryByText("Sasha")).not.toBeInTheDocument();
  });

  it("shows the status the server stamped, and an em dash without one", async () => {
    server.use(
      http.get(USERS_URL, () =>
        HttpResponse.json({
          users: [
            { id: "user_1", metadata: { status: "active" }, attributes: { email: "a@x.com" } },
            {
              id: "user_2",
              metadata: { status: "pending_purge" },
              attributes: { email: "b@x.com" },
            },
            // Written before `metadata` existed: nothing is invented for it.
            { id: "user_3", attributes: { email: "c@x.com" } },
          ],
        }),
      ),
    );
    await renderUsers();
    const table = within(await screen.findByRole("table"));

    expect(table.getByText("active")).toBeInTheDocument();
    // Underscores read as words; the value is not otherwise reinterpreted.
    expect(table.getByText("pending purge")).toBeInTheDocument();
    expect(table.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("keeps `metadata` out of the schema-driven columns", async () => {
    // `metadata` is the server's own key. Without excluding it the fallback
    // column set would render it as an attribute of the user's schema.
    server.use(
      http.get(USERS_URL, () =>
        HttpResponse.json({
          users: [
            { id: "user_1", metadata: { status: "active" }, attributes: { email: "a@x.com" } },
          ],
        }),
      ),
    );
    await renderUsers();
    const table = within(await screen.findByRole("table"));

    expect(table.getByText("Status")).toBeInTheDocument();
    expect(table.queryByText("metadata")).not.toBeInTheDocument();
  });

  it("loads the next page on demand and stops offering when there is none", async () => {
    let asked: string | null = null;
    server.use(
      http.get(USERS_URL, ({ request }) => {
        const token = new URL(request.url).searchParams.get("page_token");
        asked = token;
        return token
          ? HttpResponse.json({ users: [{ id: "user_2", attributes: { email: "second@x.com" } }] })
          : HttpResponse.json({
              users: [{ id: "user_1", attributes: { email: "first@x.com" } }],
              next_page_token: "tok_2",
            });
      }),
    );
    await renderUsers();

    expect(await screen.findByText("first@x.com")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Load more" }));

    // The second page is appended, not swapped in.
    expect(await screen.findByText("second@x.com")).toBeInTheDocument();
    expect(screen.getByText("first@x.com")).toBeInTheDocument();
    expect(asked).toBe("tok_2");
    // No token came back, so there is nothing left to offer.
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
  });

  it("drops a page that lands after the list was invalidated underneath it", async () => {
    // Deleting or creating invalidates the route, which resets to a fresh first
    // page. A `Load more` still in flight is answering a question about the list
    // that has just been replaced — appending it would re-add rows the server no
    // longer returns, including the one just deleted.
    let releaseSecondPage!: () => void;
    const secondPageSent = new Promise<void>((resolve) => {
      releaseSecondPage = resolve;
    });
    let firstPageCalls = 0;

    server.use(
      http.get(USERS_URL, async ({ request }) => {
        const token = new URL(request.url).searchParams.get("page_token");
        if (token) {
          await secondPageSent;
          return HttpResponse.json({
            users: [{ id: "user_stale", attributes: { email: "stale@x.com" } }],
          });
        }
        firstPageCalls += 1;
        return HttpResponse.json({
          users: [{ id: "user_1", attributes: { email: `page1-${firstPageCalls}@x.com` } }],
          next_page_token: "tok_2",
        });
      }),
    );

    const router = await renderUsers();
    expect(await screen.findByText("page1-1@x.com")).toBeInTheDocument();

    // Start the fetch, then invalidate before letting it answer.
    await userEvent.click(screen.getByRole("button", { name: "Load more" }));
    // `act` so the router's own state settles inside the test rather than
    // warning about an unwrapped update.
    await act(async () => {
      await router.invalidate();
    });
    await screen.findByText("page1-2@x.com");

    releaseSecondPage();

    // Wait for a positive signal that the in-flight page was handled — the
    // button re-enables in `loadMore`'s `finally`. Asserting the stale row is
    // absent without this passes before the response has even landed, which
    // makes the test green with the guard removed.
    await waitFor(() => expect(screen.getByRole("button", { name: "Load more" })).toBeEnabled());

    // The in-flight page is discarded rather than appended to the new list.
    expect(screen.queryByText("stale@x.com")).not.toBeInTheDocument();
    expect(screen.getByText("page1-2@x.com")).toBeInTheDocument();
  });
});

/**
 * The Team column (design `716:14786`): `GET /users` carries no team names, so
 * the screen fetches each row's roster (`GET /users/{id}/teams`) — one call
 * per user, best-effort.
 */
describe("team column", () => {
  const TWO_USERS = {
    users: [
      { id: "user_1", schema: "sch_business", attributes: { email: "maya@acme.com" } },
      { id: "user_2", schema: "sch_business", attributes: { email: "oscar@acme.com" } },
    ],
  };

  function stubTeams(
    rosters: Record<string, { teams: { id: string; name: string }[]; next_page_token?: string }>,
  ) {
    const calls: Record<string, number> = {};
    for (const [userId, roster] of Object.entries(rosters)) {
      server.use(
        http.get(`${USERS_URL}/${userId}/teams`, () => {
          calls[userId] = (calls[userId] ?? 0) + 1;
          return HttpResponse.json(roster);
        }),
      );
    }
    return calls;
  }

  it("renders each user's team as a chip, one roster call per row", async () => {
    server.use(http.get(USERS_URL, () => HttpResponse.json(TWO_USERS)));
    const calls = stubTeams({
      user_1: { teams: [{ id: "team_1", name: "Quantum UX" }] },
      user_2: { teams: [{ id: "team_2", name: "Cedar Logic" }] },
    });

    await renderUsers();

    expect(await screen.findByText("Quantum UX")).toBeInTheDocument();
    expect(screen.getByText("Cedar Logic")).toBeInTheDocument();
    // One roster request per row — the page size bounds the fan-out.
    expect(calls).toEqual({ user_1: 1, user_2: 1 });
  });

  it("compresses extra memberships to a +n suffix on a single chip", async () => {
    // D1: a user can belong to multiple teams, but the design draws one chip.
    server.use(http.get(USERS_URL, () => HttpResponse.json(TWO_USERS)));
    stubTeams({
      user_1: {
        teams: [
          { id: "team_1", name: "Quantum UX" },
          { id: "team_2", name: "Vortex AI" },
        ],
      },
      user_2: { teams: [{ id: "team_3", name: "Cedar Logic" }] },
    });

    await renderUsers();

    expect(await screen.findByText("Quantum UX")).toBeInTheDocument();
    expect(screen.getByText("+1")).toBeInTheDocument();
    // The second team rides the chip's title, not a second chip.
    expect(screen.queryByText("Vortex AI")).not.toBeInTheDocument();
  });

  it("costs the cell, not the screen, when a roster cannot be read", async () => {
    server.use(
      http.get(USERS_URL, () => HttpResponse.json(TWO_USERS)),
      http.get(`${USERS_URL}/user_1/teams`, () => new HttpResponse(null, { status: 500 })),
    );
    stubTeams({ user_2: { teams: [{ id: "team_3", name: "Cedar Logic" }] } });

    await renderUsers();

    // The failed row still renders; its team cell is an em dash.
    expect(await screen.findByText("maya@acme.com")).toBeInTheDocument();
    expect(screen.getByText("Cedar Logic")).toBeInTheDocument();
    expect(screen.getAllByText("\u2014").length).toBeGreaterThan(0);
  });

  it("search matches the team column like every other rendered column", async () => {
    server.use(http.get(USERS_URL, () => HttpResponse.json(TWO_USERS)));
    stubTeams({
      user_1: { teams: [{ id: "team_1", name: "Quantum UX" }] },
      user_2: { teams: [{ id: "team_3", name: "Cedar Logic" }] },
    });

    await renderUsers();
    await screen.findByText("Quantum UX");

    await userEvent.type(screen.getByRole("searchbox", { name: "Search users" }), "cedar");

    expect(screen.queryByText("maya@acme.com")).not.toBeInTheDocument();
    expect(screen.getByText("oscar@acme.com")).toBeInTheDocument();
  });
});
