import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { trackEvent } from "@/addon/analytics";
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

vi.mock("@/addon/analytics", () => ({ trackEvent: vi.fn() }));

/**
 * The Invitations tab of the project page (root ADR 086, #2855): the table of
 * a project's invitations, and creating, replacing and cancelling one. Every
 * request names the route's project.
 */
const PROJECT_ID = "proj_1";
const API = "http://localhost/api/v1";
const INVITATIONS_URL = `${API}/invitations`;
const LINK = "https://console.example/invitations/accept#token=tok_secret";

/** Far enough ahead that a pending row stays pending whenever the suite runs. */
const IN_TWO_DAYS = new Date(Date.now() + 49 * 60 * 60 * 1000).toISOString();

function invitation(overrides: Record<string, unknown> = {}) {
  return {
    id: "inv_1",
    project_id: PROJECT_ID,
    type: "project_member",
    project_member: { relation: "editor" },
    metadata: { name: "Lena Becker" },
    status: "pending",
    created_by: "user_test",
    created_by_type: "human",
    created_at: "2026-11-04T10:00:00Z",
    expires_at: IN_TWO_DAYS,
    journey_id: "journey_1",
    accepted_by: null,
    accepted_at: null,
    ...overrides,
  };
}

/** One `GET /invitations` as the tab sends it. */
interface ListRead {
  projectId: string | null;
  pageToken: string | null;
}

/** The project page's reads, with `list` answering the invitations one. */
function stubPage(
  list: (read: ListRead) => Response = () =>
    HttpResponse.json({ invitations: [], next_page_token: null }),
) {
  const reads: ListRead[] = [];
  server.use(
    http.get(`${API}/projects/:id`, () =>
      HttpResponse.json({
        id: PROJECT_ID,
        name: "acme-app",
        origins: [],
        created_at: "2026-07-08T09:00:00Z",
        updated_at: "2026-07-08T09:00:00Z",
      }),
    ),
    http.get(`${API}/variables`, () => HttpResponse.json({})),
    http.get(`${API}/deployments`, () =>
      HttpResponse.json({ deployments: [], next_page_token: null }),
    ),
    http.get(`${API}/projects/:id/admins`, () => HttpResponse.json({ admins: [] })),
    http.post(`${API}/grants/query`, () => HttpResponse.json({ grants: [] })),
    http.get(INVITATIONS_URL, ({ request }) => {
      const params = new URL(request.url).searchParams;
      const read = { projectId: params.get("project_id"), pageToken: params.get("page_token") };
      reads.push(read);
      return list(read);
    }),
  );
  return reads;
}

function listing(...invitations: Record<string, unknown>[]) {
  return () => HttpResponse.json({ invitations, next_page_token: null });
}

/** Every `POST /invitations`, answered with the created invitation and its link. */
function stubCreate() {
  const created: { projectId: string | null; body: Record<string, unknown> }[] = [];
  server.use(
    http.post(INVITATIONS_URL, async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      created.push({ projectId: new URL(request.url).searchParams.get("project_id"), body });
      return HttpResponse.json(
        invitation({ id: "inv_new", ...body, journey_id: "journey_new", link: LINK }),
        { status: 201 },
      );
    }),
  );
  return created;
}

async function openInvitations() {
  const router = createAppRouter({
    history: createMemoryHistory({ initialEntries: [scopedPath("/project", PROJECT_ID)] }),
  });
  render(<RouterProvider router={router} />);
  await userEvent.click(await screen.findByRole("tab", { name: "Invitations" }));
  return within(await screen.findByRole("region", { name: "Invitations" }));
}

function row(name: string) {
  return within(screen.getByRole("row", { name: new RegExp(name) }));
}

/** The tab row's button; an empty table draws a second one under it. */
function inviteButton(): HTMLElement {
  const [button] = screen.getAllByRole("button", { name: "Invite member" });
  if (!button) throw new Error("No Invite member button on screen.");
  return button;
}

async function openMenu(name: string) {
  await userEvent.click(screen.getByRole("button", { name: `Actions for ${name}` }));
}

beforeEach(() => {
  vi.mocked(trackEvent).mockClear();
});

describe("project invitations", () => {
  it("lists the route's project's invitations with role and status", async () => {
    const reads = stubPage(
      listing(
        invitation(),
        invitation({
          id: "inv_2",
          metadata: null,
          project_member: { relation: "viewer" },
          status: "expired",
          expires_at: "2026-11-01T10:00:00Z",
        }),
      ),
    );
    await openInvitations();

    expect(reads).toEqual([{ projectId: PROJECT_ID, pageToken: null }]);
    const pending = row("Lena Becker");
    expect(pending.getByText("Editor")).toBeInTheDocument();
    expect(pending.getByText("Pending")).toBeInTheDocument();
    expect(pending.getByText("Expires in 2 days")).toBeInTheDocument();
    // No name was given: the row says so rather than showing an id.
    const expired = row("Unnamed invitation");
    expect(expired.getByText("Viewer")).toBeInTheDocument();
    expect(expired.getByText("Expired")).toBeInTheDocument();
    expect(expired.queryByText(/Expires in/)).not.toBeInTheDocument();
  });

  it("shows a pending row past its expiry as expired", async () => {
    stubPage(listing(invitation({ expires_at: "2026-11-01T10:00:00Z" })));
    await openInvitations();
    expect(row("Lena Becker").getByText("Expired")).toBeInTheDocument();
  });

  it("gives a finished invitation its status and no menu", async () => {
    stubPage(
      listing(
        invitation({ id: "inv_a", metadata: null, status: "accepted", accepted_by: "user_9" }),
        invitation({ id: "inv_r", metadata: null, status: "rejected" }),
      ),
    );
    const section = await openInvitations();
    expect(section.getByText("Accepted")).toBeInTheDocument();
    // `rejected` in the API; the invitation page calls it declining.
    expect(section.getByText("Declined")).toBeInTheDocument();
    expect(section.queryByRole("button", { name: /Actions for/ })).not.toBeInTheDocument();
  });

  it("offers to invite from the empty state", async () => {
    stubPage();
    const section = await openInvitations();
    expect(section.getByText("No invitations yet")).toBeInTheDocument();
    await userEvent.click(section.getByRole("button", { name: "Invite member" }));
    expect(await screen.findByRole("dialog", { name: "Invite member" })).toBeInTheDocument();
  });

  it("keeps the rest of the page when the invitations cannot be read", async () => {
    stubPage(() =>
      HttpResponse.json(
        { code: "not_implemented", message: "This operation is not implemented yet." },
        { status: 501 },
      ),
    );
    const section = await openInvitations();
    expect(section.getByText("This operation is not implemented yet.")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "General" })).toBeInTheDocument();
  });

  it("loads the next page with the token it was given", async () => {
    const reads = stubPage(({ pageToken }) =>
      pageToken
        ? HttpResponse.json({
            invitations: [invitation({ id: "inv_2", metadata: { name: "Maya Patel" } })],
            next_page_token: null,
          })
        : HttpResponse.json({ invitations: [invitation()], next_page_token: "page_2" }),
    );
    await openInvitations();
    await userEvent.click(screen.getByRole("button", { name: "Load more" }));

    expect(await screen.findByRole("row", { name: /Maya Patel/ })).toBeInTheDocument();
    expect(screen.getByRole("row", { name: /Lena Becker/ })).toBeInTheDocument();
    expect(reads.at(-1)).toEqual({ projectId: PROJECT_ID, pageToken: "page_2" });
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
  });
});

describe("inviting a member", () => {
  it("creates the invitation on the route's project and shows the link once", async () => {
    const user = userEvent.setup();
    const reads = stubPage();
    const created = stubCreate();
    await openInvitations();

    await user.click(inviteButton());
    const dialog = within(await screen.findByRole("dialog", { name: "Invite member" }));
    await user.type(dialog.getByRole("textbox", { name: /Invitee name/ }), "  Jane Doe ");
    await user.click(dialog.getByRole("radio", { name: "Editor" }));
    await user.click(dialog.getByRole("button", { name: "Create invitation" }));

    const done = within(await screen.findByRole("dialog", { name: "Invitation created" }));
    expect(created).toEqual([
      {
        projectId: PROJECT_ID,
        body: {
          type: "project_member",
          project_member: { relation: "editor" },
          metadata: { name: "Jane Doe" },
        },
      },
    ]);
    const message = done.getByRole("textbox", { name: "Invitation message" });
    expect(message).toHaveValue(
      [
        "You're invited to join acme-app on Zitadel as an editor.",
        "",
        "Accept the invitation:",
        LINK,
        "",
        "This link expires in 72 hours.",
      ].join("\n"),
    );
    expect(done.getByText("Whoever opens the link gets this role.")).toBeInTheDocument();

    await user.click(done.getByRole("button", { name: "Copy invitation message" }));
    expect(await screen.findByText("Invitation message copied")).toBeInTheDocument();
    expect(await navigator.clipboard.readText()).toContain(LINK);

    // Closing reloads the table behind the dialog, where the new row is.
    const before = reads.length;
    await user.click(done.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(reads.length).toBeGreaterThan(before));
  });

  it("defaults to admin and sends no metadata without a name", async () => {
    stubPage();
    const created = stubCreate();
    await openInvitations();

    await userEvent.click(inviteButton());
    const dialog = within(await screen.findByRole("dialog", { name: "Invite member" }));
    expect(dialog.getByRole("radio", { name: "Admin" })).toBeChecked();
    await userEvent.click(dialog.getByRole("button", { name: "Create invitation" }));

    await screen.findByRole("dialog", { name: "Invitation created" });
    expect(created[0]?.body).toEqual({
      type: "project_member",
      project_member: { relation: "admin" },
    });
  });

  it("reports the role and the journey, and nothing that identifies the invitation", async () => {
    stubPage();
    stubCreate();
    await openInvitations();

    await userEvent.click(inviteButton());
    const dialog = within(await screen.findByRole("dialog", { name: "Invite member" }));
    await userEvent.type(dialog.getByRole("textbox", { name: /Invitee name/ }), "Jane Doe");
    await userEvent.click(dialog.getByRole("button", { name: "Create invitation" }));
    await screen.findByRole("dialog", { name: "Invitation created" });

    expect(trackEvent).toHaveBeenCalledExactlyOnceWith("invitation_created", {
      role: "project_admin",
      invitation_journey_id: "journey_new",
    });
  });

  it("surfaces the API's own message when the invitation is refused", async () => {
    stubPage();
    server.use(
      http.post(INVITATIONS_URL, () =>
        HttpResponse.json(
          {
            code: "inv.pending_limit",
            message: "This project has too many pending invitations.",
          },
          { status: 409 },
        ),
      ),
    );
    await openInvitations();

    await userEvent.click(inviteButton());
    const dialog = within(await screen.findByRole("dialog", { name: "Invite member" }));
    await userEvent.click(dialog.getByRole("button", { name: "Create invitation" }));

    expect(
      await dialog.findByText("This project has too many pending invitations."),
    ).toBeInTheDocument();
    expect(trackEvent).not.toHaveBeenCalled();
  });
});

describe("managing an invitation", () => {
  it("cancels a pending invitation after confirming", async () => {
    const reads = stubPage(listing(invitation()));
    const cancelled: { id: string; projectId: string | null }[] = [];
    server.use(
      http.delete(`${INVITATIONS_URL}/:id`, ({ params, request }) => {
        cancelled.push({
          id: params.id as string,
          projectId: new URL(request.url).searchParams.get("project_id"),
        });
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await openInvitations();

    await openMenu("Lena Becker");
    await userEvent.click(await screen.findByRole("menuitem", { name: "Cancel invitation" }));
    const confirm = within(await screen.findByRole("alertdialog"));
    expect(confirm.getByText("This invitation link will stop working.")).toBeInTheDocument();
    const before = reads.length;
    await userEvent.click(confirm.getByRole("button", { name: "Cancel invitation" }));

    expect(await screen.findByText("Invitation cancelled")).toBeInTheDocument();
    expect(cancelled).toEqual([{ id: "inv_1", projectId: PROJECT_ID }]);
    await waitFor(() => expect(reads.length).toBeGreaterThan(before));
  });

  it("keeps the invitation when the confirmation is dismissed", async () => {
    stubPage(listing(invitation()));
    await openInvitations();

    await openMenu("Lena Becker");
    await userEvent.click(await screen.findByRole("menuitem", { name: "Cancel invitation" }));
    const confirm = within(await screen.findByRole("alertdialog"));
    // MSW fails the test if a DELETE goes out: none is stubbed.
    await userEvent.click(confirm.getByRole("button", { name: "Keep invitation" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(screen.getByRole("row", { name: /Lena Becker/ })).toBeInTheDocument();
  });

  it("replaces an invitation with the same role and name, and shows the new link", async () => {
    stubPage(listing(invitation()));
    const created = stubCreate();
    await openInvitations();

    await openMenu("Lena Becker");
    await userEvent.click(await screen.findByRole("menuitem", { name: "Regenerate link" }));
    const confirm = within(await screen.findByRole("alertdialog"));
    await userEvent.click(confirm.getByRole("button", { name: "Regenerate link" }));

    const done = within(await screen.findByRole("dialog", { name: "Invitation created" }));
    expect(created).toEqual([
      {
        projectId: PROJECT_ID,
        body: {
          type: "project_member",
          project_member: { relation: "editor" },
          metadata: { name: "Lena Becker" },
          replaces_invitation_id: "inv_1",
        },
      },
    ]);
    expect(
      done.getByRole<HTMLTextAreaElement>("textbox", { name: "Invitation message" }).value,
    ).toContain(LINK);
    // A replacement keeps its journey; the event carries whatever the API said.
    expect(trackEvent).toHaveBeenCalledExactlyOnceWith("invitation_created", {
      role: "project_editor",
      invitation_journey_id: "journey_new",
    });
  });

  it("offers an expired invitation a new link but no cancel", async () => {
    stubPage(listing(invitation({ status: "expired", expires_at: "2026-11-01T10:00:00Z" })));
    await openInvitations();

    await openMenu("Lena Becker");
    expect(await screen.findByRole("menuitem", { name: "Regenerate link" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Cancel invitation" })).not.toBeInTheDocument();
  });
});
