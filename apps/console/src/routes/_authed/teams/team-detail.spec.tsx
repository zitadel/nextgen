import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { scopedPath } from "@/test/project-scope.fixture";
import { server } from "@/test/msw";
import { createAppRouter } from "../../../router";

// The `_authed` layout guards every screen behind `GET /sessions/me`
// (Console ADR 0003); mock the auth module so routes render as signed in.
vi.mock("@/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/auth/session")>();
  const { makeTestSession } = await import("@/test/session.fixture");
  return { ...actual, fetchSession: vi.fn(async () => makeTestSession()) };
});

const TEAM_ID = "team_1";
const TEAM_URL = `http://localhost/api/v1/teams/${TEAM_ID}`;
const USERS_QUERY_URL = "*/api/v1/users/query";
const USERS_URL = "http://localhost/api/v1/users";
const SCHEMAS_URL = "http://localhost/api/v1/schemas";

/** Which relation a `POST /users/query` body asks for, by its one filter field. */
function relationOf(body: Record<string, unknown>): "members" | "owned" {
  const [filter] = body.filter as { field: string }[];
  return filter?.field === "lifecycle_owner_team_id" ? "owned" : "members";
}

/** Records every `POST /users/query` body, answering each with `respond`. */
function recordQueries(respond: (body: Record<string, unknown>) => Response) {
  const bodies: Record<string, unknown>[] = [];
  server.use(
    http.post(USERS_QUERY_URL, async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      bodies.push(body);
      return respond(body);
    }),
  );
  return bodies;
}

function user(id: string, email: string, metadata: Record<string, unknown> = {}) {
  return {
    id,
    identifier: email,
    identifier_property: "email",
    attributes: { email },
    metadata: { status: "active", lifecycle_owner_team_id: null, ...metadata },
  };
}

/** Opens the Users tab, and the filter's `relation` within it. */
async function openUsers(relation: "Members" | "Owned" = "Members") {
  await userEvent.click(await screen.findByRole("tab", { name: "Users" }));
  if (relation === "Owned")
    await userEvent.click(await screen.findByRole("tab", { name: "Owned" }));
}

/** The cell under `column` in the row of the user whose link reads `name`. */
function cellOf(name: string, column: string): HTMLElement {
  const row = screen.getByRole("link", { name }).closest("tr") as HTMLElement;
  const table = row.closest("table") as HTMLElement;
  const headers = within(table).getAllByRole("columnheader");
  const index = headers.findIndex((header) => header.textContent === column);
  return within(row).getAllByRole("cell")[index] as HTMLElement;
}

function team(overrides: Record<string, unknown> = {}) {
  return {
    id: TEAM_ID,
    name: "Acme Web",
    status: "active",
    created_at: "2026-07-08T09:00:00Z",
    updated_at: "2026-07-08T09:00:00Z",
    ...overrides,
  };
}

async function renderDetail() {
  const router = createAppRouter({
    history: createMemoryHistory({ initialEntries: [scopedPath(`/teams/${TEAM_ID}`)] }),
  });
  render(<RouterProvider router={router} />);
  return router;
}

describe("team detail", () => {
  // The top bar's team switcher lists the project's teams beside the open one,
  // and the Members tab's first page loads with the team.
  beforeEach(() =>
    server.use(
      http.post("*/api/v1/teams/query", () => HttpResponse.json({ teams: [team()] })),
      http.post(USERS_QUERY_URL, () => HttpResponse.json({ users: [] })),
    ),
  );

  it("renders the name, the id and the created date", async () => {
    server.use(http.get(TEAM_URL, () => HttpResponse.json(team())));
    await renderDetail();

    expect(await screen.findByRole("heading", { name: "Acme Web" })).toBeInTheDocument();
    expect(screen.getByText(TEAM_ID)).toBeInTheDocument();
    expect(screen.getByText("Team ID")).toBeInTheDocument();
    expect(screen.getByText("Created")).toBeInTheDocument();
  });

  it("shows the team's status beside its name", async () => {
    server.use(http.get(TEAM_URL, () => HttpResponse.json(team({ status: "deactivated" }))));
    await renderDetail();

    // The status sits on the detail as well as the list, so a deactivated team
    // reads as deactivated on its own screen.
    await screen.findByRole("heading", { name: "Acme Web" });
    expect(screen.getByText("deactivated")).toBeInTheDocument();
  });

  it("leaves out the primary domain the API does not carry", async () => {
    server.use(http.get(TEAM_URL, () => HttpResponse.json(team())));
    await renderDetail();
    await screen.findByRole("heading", { name: "Acme Web" });

    // The design draws a `PRIMARY DOMAIN` cell, but no domain field exists on
    // `team-response`. An empty labelled cell would read as "this team has no
    // domain" rather than "the API cannot say".
    expect(screen.queryByText(/primary domain/i)).not.toBeInTheDocument();
  });

  it("keeps Save disabled until the name changes", async () => {
    server.use(http.get(TEAM_URL, () => HttpResponse.json(team())));
    await renderDetail();

    const field = await screen.findByLabelText("Tenant name");
    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();

    await userEvent.type(field, " Ltd");
    expect(save).toBeEnabled();
  });

  it("saves the new name through PATCH", async () => {
    const patched: unknown[] = [];
    server.use(
      http.get(TEAM_URL, () => HttpResponse.json(team())),
      http.patch(TEAM_URL, async ({ request }) => {
        patched.push(await request.json());
        return HttpResponse.json(team({ name: "Acme Group" }));
      }),
    );
    await renderDetail();

    const field = await screen.findByLabelText("Tenant name");
    await userEvent.clear(field);
    await userEvent.type(field, "Acme Group");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    // `name` is the only property `PATCH /teams/{team_id}` accepts.
    expect(patched).toEqual([{ name: "Acme Group" }]);
  });

  it("renames the team in the top bar's switcher too", async () => {
    let name = "Acme Web";
    server.use(
      http.get(TEAM_URL, () => HttpResponse.json(team({ name }))),
      http.post("*/api/v1/teams/query", () => HttpResponse.json({ teams: [team({ name })] })),
      http.patch(TEAM_URL, async ({ request }) => {
        name = ((await request.json()) as { name: string }).name;
        return HttpResponse.json(team({ name }));
      }),
    );
    await renderDetail();

    const switcher = await screen.findByRole("button", { name: "Switch team" });
    await waitFor(() => expect(switcher).toHaveTextContent("Acme Web"));

    const field = await screen.findByLabelText("Tenant name");
    await userEvent.clear(field);
    await userEvent.type(field, "Acme Group");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(switcher).toHaveTextContent("Acme Group"));
  });

  it("lists the team's members on the Users tab", async () => {
    server.use(http.get(TEAM_URL, () => HttpResponse.json(team())));
    const bodies = recordQueries((body) =>
      HttpResponse.json({
        users:
          relationOf(body) === "members"
            ? [
                {
                  id: "user_1",
                  display: "Ada Lovelace",
                  identifier: "ada@example.com",
                  metadata: { status: "active" },
                },
              ]
            : [],
      }),
    );
    await renderDetail();

    await openUsers();
    expect(await screen.findByRole("link", { name: "Ada Lovelace" })).toHaveAttribute(
      "href",
      scopedPath("/users/user_1"),
    );
    expect(screen.getByText("ada@example.com")).toBeInTheDocument();
    // Membership is the `team_id` filter, not a per-user roster read, and the
    // owner comes embedded so a member owned elsewhere says so per row.
    expect(bodies.filter((body) => relationOf(body) === "members")).toEqual([
      expect.objectContaining({
        filter: [{ field: "team_id", operation: "equals", value: TEAM_ID }],
        expand: ["lifecycle_owner_team"],
      }),
    ]);
  });

  it("keeps the team's page when its members may not be read", async () => {
    server.use(
      http.get(TEAM_URL, () => HttpResponse.json(team())),
      http.post(USERS_QUERY_URL, () =>
        HttpResponse.json({ code: "user.permission_denied" }, { status: 403 }),
      ),
    );
    await renderDetail();

    await openUsers();
    expect(
      await screen.findByText("Your access does not include this team's members."),
    ).toBeInTheDocument();
  });

  it("shows each member's lifecycle owner", async () => {
    server.use(http.get(TEAM_URL, () => HttpResponse.json(team())));
    recordQueries((body) =>
      HttpResponse.json({
        users:
          relationOf(body) === "members"
            ? [
                user("user_self", "self@acme.com"),
                user("user_owned", "owned@acme.com", { lifecycle_owner_team_id: TEAM_ID }),
                user("user_other", "other@acme.com", {
                  lifecycle_owner_team_id: "team_2",
                  lifecycle_owner_team: { id: "team_2", name: "Globex" },
                }),
              ]
            : [],
      }),
    );
    await renderDetail();

    await openUsers();
    await screen.findByRole("link", { name: "self@acme.com" });
    expect(cellOf("self@acme.com", "Lifecycle owner")).toHaveTextContent("Self-owned");
    expect(cellOf("owned@acme.com", "Lifecycle owner")).toHaveTextContent("This team");
    expect(
      within(cellOf("other@acme.com", "Lifecycle owner")).getByRole("link", { name: "Globex" }),
    ).toHaveAttribute("href", scopedPath("/teams/team_2"));
  });

  it("names another owner by id when the credential may not read teams", async () => {
    server.use(http.get(TEAM_URL, () => HttpResponse.json(team())));
    const bodies = recordQueries((body) => {
      if (relationOf(body) === "owned") return HttpResponse.json({ users: [] });
      if (body.expand) {
        return HttpResponse.json({ code: "user.permission_denied" }, { status: 403 });
      }
      return HttpResponse.json(
        body.page_token
          ? { users: [] }
          : {
              users: [user("user_other", "other@acme.com", { lifecycle_owner_team_id: "team_2" })],
              next_page_token: "tok_2",
            },
      );
    });
    await renderDetail();

    await openUsers();
    // `lifecycle_owner_team_id` is on every user, so the refused expansion
    // costs the owner's name, not the column.
    expect(await screen.findByRole("link", { name: "team_2" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Load more" }));
    // A refusal does not turn into a pass by paging, so Load more does not ask
    // to be refused again.
    await waitFor(() =>
      expect(bodies.filter((body) => body.page_token)).toEqual([
        expect.not.objectContaining({ expand: expect.anything() }),
      ]),
    );
  });

  it("keeps the members Load more fetched across a switch to Owned and back", async () => {
    server.use(http.get(TEAM_URL, () => HttpResponse.json(team())));
    const bodies = recordQueries((body) => {
      if (relationOf(body) === "owned") return HttpResponse.json({ users: [] });
      return HttpResponse.json(
        body.page_token
          ? { users: [user("user_2", "second@acme.com")] }
          : { users: [user("user_1", "first@acme.com")], next_page_token: "tok_2" },
      );
    });
    await renderDetail();

    await openUsers();
    await userEvent.click(await screen.findByRole("button", { name: "Load more" }));
    await screen.findByRole("link", { name: "second@acme.com" });
    await userEvent.click(screen.getByRole("tab", { name: "Owned" }));
    expect(await screen.findByText("This team owns no users.")).toBeVisible();
    await userEvent.click(screen.getByRole("tab", { name: "Members" }));

    // Each relation pages on its own, so coming back neither drops the second
    // page nor fetches it again.
    expect(screen.getByRole("link", { name: "first@acme.com" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "second@acme.com" })).toBeInTheDocument();
    expect(bodies.filter((body) => body.page_token)).toHaveLength(1);
  });

  it("filters the Users tab to the users the team owns, as its own query", async () => {
    server.use(http.get(TEAM_URL, () => HttpResponse.json(team())));
    const bodies = recordQueries((body) =>
      HttpResponse.json({
        users:
          relationOf(body) === "owned"
            ? [user("user_owned", "owned@acme.com", { lifecycle_owner_team_id: TEAM_ID })]
            : [],
      }),
    );
    await renderDetail();

    await openUsers("Owned");
    expect(await screen.findByRole("link", { name: "owned@acme.com" })).toBeInTheDocument();
    // Ownership is a query of its own, not the members list narrowed, and every
    // row's owner is this team, so there is nothing to expand.
    expect(bodies.filter((body) => relationOf(body) === "owned")).toEqual([
      {
        limit: 25,
        filter: [{ field: "lifecycle_owner_team_id", operation: "equals", value: TEAM_ID }],
      },
    ]);
    // The columns stay put when the filter changes.
    expect(cellOf("owned@acme.com", "Lifecycle owner")).toHaveTextContent("This team");
  });

  it("says so when the team owns no users", async () => {
    server.use(http.get(TEAM_URL, () => HttpResponse.json(team())));
    await renderDetail();

    await openUsers("Owned");
    expect(await screen.findByText("This team owns no users.")).toBeInTheDocument();
  });

  it("adds a new user to the team, and shows the members they joined", async () => {
    const created: { teamId: string | null; body: unknown }[] = [];
    server.use(
      http.get(TEAM_URL, () => HttpResponse.json(team())),
      http.get(SCHEMAS_URL, () =>
        HttpResponse.json({
          schemas: [
            {
              id: "sch_minimal",
              schema: {
                title: "Minimal",
                type: "object",
                required: ["email"],
                properties: { email: { type: "string", format: "email" } },
              },
              metadata: { created_at: "2026-07-01T00:00:00Z" },
            },
          ],
        }),
      ),
      http.post(USERS_URL, async ({ request }) => {
        created.push({
          teamId: new URL(request.url).searchParams.get("team_id"),
          body: await request.json(),
        });
        return HttpResponse.json(user("user_new", "maya@acme.com"), { status: 201 });
      }),
    );
    await renderDetail();

    // Added from the owned view, the user lands where they appear: members.
    await openUsers("Owned");
    await userEvent.click(await screen.findByRole("button", { name: "Add user" }));
    // The team is the drawer's context, preselected and not editable.
    expect(await screen.findByLabelText("Team")).toHaveValue("Acme Web");
    expect(screen.getByLabelText("Team")).toBeDisabled();
    await userEvent.type(await screen.findByLabelText("Email"), "maya@acme.com");
    await userEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Add user" }),
    );

    // `team_id` makes the user a member; nothing here sets an owner.
    await waitFor(() =>
      expect(created).toEqual([
        {
          teamId: TEAM_ID,
          body: { schema: "sch_minimal", attributes: { email: "maya@acme.com" } },
        },
      ]),
    );
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "Members" })).toHaveAttribute("aria-selected", "true"),
    );
  });
});
