import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { trackEvent } from "@/addon/analytics";
import { captureInvitationToken, readInvitationToken } from "@/features/invitations/token";
import { makeTestSession } from "@/test/session.fixture";
import { server } from "@/test/msw";
import { _setRuntimeForTesting } from "../../runtime/runtime";
import { createAppRouter } from "../../router";

/**
 * The invitation page (root ADR 086 §3, #2856): what a link opens. Same
 * module-boundary mocks as `claim.spec`: the auth module because the page
 * checks the session itself, the widget because `/login` mounts it.
 */
const fetchSession = vi.fn();

vi.mock("@/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/auth/session")>();
  return { ...actual, fetchSession: (...args: []) => fetchSession(...args) };
});

vi.mock("@zitadel/sdk-react", () => ({
  ZitadelLogin: (props: { postSignInUrl?: string }) => (
    <div data-testid="zitadel-login" data-post-sign-in-url={props.postSignInUrl} />
  ),
}));

vi.mock("@/addon/analytics", () => ({ trackEvent: vi.fn() }));

const API = "*/api/v1";
const TOKEN = "tok_secret";
const IN_TWO_DAYS = new Date(Date.now() + 49 * 60 * 60 * 1000).toISOString();

function lookup(overrides: Record<string, unknown> = {}) {
  return {
    project_id: "proj_acme",
    project_name: "acme-app",
    type: "project_member",
    project_member: { relation: "editor" },
    created_by: "user_admin",
    created_by_type: "human",
    expires_at: IN_TWO_DAYS,
    status: "pending",
    ...overrides,
  };
}

/** The invitation as accept and decline return it. */
function finished(status: "accepted" | "rejected") {
  return {
    id: "inv_1",
    project_id: "proj_acme",
    type: "project_member",
    project_member: { relation: "editor" },
    metadata: null,
    status,
    created_at: "2026-11-04T10:00:00Z",
    expires_at: IN_TWO_DAYS,
    journey_id: "journey_1",
  };
}

const NOT_FOUND = () =>
  HttpResponse.json(
    { code: "inv.not_found", message: "This invitation is no longer available." },
    { status: 404 },
  );

/** `POST /invitations/lookup`, recording each token it was asked about. */
function stubLookup(answer: () => Response = () => HttpResponse.json(lookup())) {
  const tokens: unknown[] = [];
  server.use(
    http.post(`${API}/invitations/lookup`, async ({ request }) => {
      tokens.push(((await request.json()) as { token?: unknown }).token);
      return answer();
    }),
  );
  return tokens;
}

/** `POST /invitations/{verb}`, recording each token it was sent. */
function stubVerb(verb: "accept" | "reject", answer: () => Response) {
  const tokens: unknown[] = [];
  server.use(
    http.post(`${API}/invitations/${verb}`, async ({ request }) => {
      tokens.push(((await request.json()) as { token?: unknown }).token);
      return answer();
    }),
  );
  return tokens;
}

/** Opens the page as the link does: the token was captured before the app booted. */
async function openLink(token: string | null = TOKEN) {
  if (token) {
    captureInvitationToken(
      { pathname: "/invitations/accept", search: "", hash: `#token=${token}` },
      { state: null, replaceState: () => undefined },
    );
  }
  const router = createAppRouter({
    history: createMemoryHistory({ initialEntries: ["/invitations/accept"] }),
  });
  render(<RouterProvider router={router} />);
  return router;
}

beforeEach(() => {
  window.sessionStorage.clear();
  fetchSession.mockReset();
  fetchSession.mockResolvedValue(makeTestSession());
  vi.mocked(trackEvent).mockClear();
  _setRuntimeForTesting({ mode: "standalone", console_project_id: "proj_platform" });
});

describe("invitation page", () => {
  it("sends a signed-out visitor to sign in, with the path and never the token", async () => {
    fetchSession.mockResolvedValue(null);
    const router = await openLink();

    const widget = await screen.findByTestId("zitadel-login");
    expect(router.state.resolvedLocation?.pathname).toBe("/login");
    expect(router.state.resolvedLocation?.search).toEqual({ next: "/invitations/accept" });
    expect(widget.dataset.postSignInUrl).toBe("/invitations/accept");
    expect(router.state.resolvedLocation?.href).not.toContain(TOKEN);
    // Kept for the page the sign-in comes back to.
    expect(readInvitationToken()).toBe(TOKEN);
  });

  it("shows what the invitation is for", async () => {
    const tokens = stubLookup();
    await openLink();

    expect(
      await screen.findByRole("heading", { name: "You're invited to join acme-app" }),
    ).toBeInTheDocument();
    expect(screen.getByText("You'll join as an editor. Expires in 2 days.")).toBeInTheDocument();
    expect(tokens).toEqual([TOKEN]);
  });

  it("names the inviter the lookup resolved, without reading anyone by id", async () => {
    // MSW fails the test if the page asks for a user: no such read is stubbed.
    stubLookup(() =>
      HttpResponse.json(
        lookup({
          inviter: {
            user_id: "user_admin",
            identifier: "alex@example.com",
            display: "Alex Morgan",
          },
        }),
      ),
    );
    await openLink();
    expect(await screen.findByText("Invited by Alex Morgan")).toBeInTheDocument();
  });

  it("falls back to the inviter's identifier, then their id", async () => {
    stubLookup(() =>
      HttpResponse.json(
        lookup({ inviter: { user_id: "user_admin", identifier: "alex@example.com" } }),
      ),
    );
    await openLink();
    expect(await screen.findByText("Invited by alex@example.com")).toBeInTheDocument();
  });

  it("leaves the inviter out for an invitation a project secret created", async () => {
    stubLookup(() => HttpResponse.json(lookup({ created_by: null, inviter: null })));
    await openLink();
    await screen.findByRole("heading", { name: "You're invited to join acme-app" });
    expect(screen.queryByText(/Invited by/)).not.toBeInTheDocument();
  });

  it("joins the project, clears the token and lands on Projects", async () => {
    stubLookup();
    const accepted = stubVerb("accept", () => HttpResponse.json(finished("accepted")));
    server.use(
      http.post(`${API}/projects/query`, () =>
        HttpResponse.json({ projects: [], next_page_token: null }),
      ),
    );
    const router = await openLink();

    await userEvent.click(await screen.findByRole("button", { name: "Join project" }));

    expect(await screen.findByText("You joined acme-app")).toBeInTheDocument();
    await waitFor(() => expect(router.state.resolvedLocation?.pathname).toBe("/projects"));
    expect(accepted).toEqual([TOKEN]);
    expect(readInvitationToken()).toBeUndefined();
    expect(trackEvent).toHaveBeenCalledExactlyOnceWith("invitation_accepted", {
      role: "project_editor",
      invitation_journey_id: "journey_1",
    });
  });

  it("declines, clears the token and says so", async () => {
    stubLookup();
    const rejected = stubVerb("reject", () => HttpResponse.json(finished("rejected")));
    await openLink();

    await userEvent.click(await screen.findByRole("button", { name: "Decline invitation" }));

    expect(await screen.findByRole("heading", { name: "Invitation declined" })).toBeInTheDocument();
    expect(screen.getByText("You haven't joined acme-app.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to projects" })).toBeInTheDocument();
    expect(rejected).toEqual([TOKEN]);
    expect(readInvitationToken()).toBeUndefined();
    expect(trackEvent).toHaveBeenCalledExactlyOnceWith("invitation_rejected", {
      role: "project_editor",
      invitation_journey_id: "journey_1",
    });
  });

  it("has one message for a token the server does not know, and forgets it", async () => {
    stubLookup(NOT_FOUND);
    await openLink();

    expect(
      await screen.findByRole("heading", { name: "Invitation unavailable" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Join project" })).not.toBeInTheDocument();
    expect(readInvitationToken()).toBeUndefined();
  });

  it("says the same for an invitation that is finished", async () => {
    stubLookup(() => HttpResponse.json(lookup({ status: "accepted" })));
    await openLink();

    expect(
      await screen.findByRole("heading", { name: "Invitation unavailable" }),
    ).toBeInTheDocument();
    expect(readInvitationToken()).toBeUndefined();
  });

  it("says the same without asking when there is no token", async () => {
    // MSW fails the test if a lookup goes out: none is stubbed.
    await openLink(null);
    expect(
      await screen.findByRole("heading", { name: "Invitation unavailable" }),
    ).toBeInTheDocument();
  });

  it("keeps the token when the lookup fails for another reason", async () => {
    stubLookup(() =>
      HttpResponse.json(
        { code: "not_implemented", message: "This operation is not implemented yet." },
        { status: 501 },
      ),
    );
    await openLink();

    expect(await screen.findByText("This operation is not implemented yet.")).toBeInTheDocument();
    // Reopening the link, or reloading, tries again.
    expect(readInvitationToken()).toBe(TOKEN);
  });

  it("shows why an accept was refused and keeps the invitation open", async () => {
    stubLookup();
    stubVerb("accept", () =>
      HttpResponse.json(
        { code: "inv.self_accept", message: "You can't accept your own invitation." },
        { status: 409 },
      ),
    );
    await openLink();

    await userEvent.click(await screen.findByRole("button", { name: "Join project" }));

    expect(await screen.findByText("You can't accept your own invitation.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Join project" })).toBeEnabled();
    expect(readInvitationToken()).toBe(TOKEN);
    expect(trackEvent).not.toHaveBeenCalled();
  });

  it("turns unavailable when the invitation finished while the page was open", async () => {
    stubLookup();
    stubVerb("accept", NOT_FOUND);
    await openLink();

    await userEvent.click(await screen.findByRole("button", { name: "Join project" }));

    expect(
      await screen.findByRole("heading", { name: "Invitation unavailable" }),
    ).toBeInTheDocument();
    expect(readInvitationToken()).toBeUndefined();
  });
});
