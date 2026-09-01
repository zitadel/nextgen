import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { makeTestSession } from "../../auth/session.fixture";
import { createAppRouter } from "../../router";

/**
 * The claim page (#615): `claim/init` hands the CLI a URL of the form
 * `<console>/claim?challenge_id=…&project_id=…`; the browser leg signs the
 * developer in against the platform project and spends the challenge via
 * `claim/complete`, cookie-authenticated.
 *
 * Same module-boundary mocks as `auth-guard.spec`: the auth module because the
 * screen branches on the session, the widget because `<zitadel-login>` drives
 * real flow requests on mount, which a jsdom spec neither needs nor supports.
 */
const fetchSession = vi.fn();

vi.mock("@/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/auth/session")>();
  return {
    ...actual,
    fetchSession: (...args: []) => fetchSession(...args),
  };
});

vi.mock("@zitadel/sdk-react", () => ({
  ZitadelLogin: (props: {
    postSignInUrl?: string;
    theme?: string;
    project?: { projectId?: string };
  }) => (
    <div
      data-testid="zitadel-login"
      data-post-sign-in-url={props.postSignInUrl}
      data-project-id={props.project?.projectId}
    />
  ),
}));

const PROJECT_ID = "proj_claimme";
const CHALLENGE_ID = "chal_1";
const CLAIM_PATH = `/claim?challenge_id=${CHALLENGE_ID}&project_id=${PROJECT_ID}`;

// A path pattern rather than an absolute URL: this spec imports the router
// statically, so `api/zitadel.ts` binds its base before any `stubEnv`.
const COMPLETE_PATTERN = `*/api/projects/${PROJECT_ID}/claim/complete`;

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
afterAll(() => server.close());

beforeEach(() => {
  fetchSession.mockReset();
  // The widget renders only when a project id resolves (ADR 0004 §§2–3);
  // pin the dev override so the unauthenticated branch exercises it.
  vi.stubEnv("VITE_CONSOLE_PROJECT_ID", "proj_platform");
});

afterEach(() => {
  vi.unstubAllEnvs();
  server.resetHandlers();
});

async function renderAt(path: string) {
  const router = createAppRouter({ history: createMemoryHistory({ initialEntries: [path] }) });
  render(<RouterProvider router={router} />);
  return router;
}

/** Records completion calls and answers them with `respond`. */
function stubComplete(respond: () => Response) {
  const bodies: unknown[] = [];
  server.use(
    http.post(COMPLETE_PATTERN, async ({ request }) => {
      bodies.push(await request.json());
      return respond();
    }),
  );
  return bodies;
}

describe("claim page", () => {
  it("prompts an unauthenticated visitor to sign in, returning to the claim URL", async () => {
    fetchSession.mockResolvedValue(null);
    await renderAt(CLAIM_PATH);

    const widget = await screen.findByTestId("zitadel-login");
    // The widget's terminal step is a full-document navigation; pointing it
    // back at the claim URL (params included) is what resumes the claim with
    // the cookie in place.
    expect(widget.dataset.postSignInUrl).toContain("/claim");
    expect(widget.dataset.postSignInUrl).toContain(`challenge_id=${CHALLENGE_ID}`);
    expect(widget.dataset.postSignInUrl).toContain(`project_id=${PROJECT_ID}`);
    // Identity lives in the console's platform project, not the project being
    // claimed (ADR 0004).
    expect(widget.dataset.projectId).toBe("proj_platform");
  });

  it("completes the claim exactly once for a signed-in visit and shows success", async () => {
    fetchSession.mockResolvedValue(makeTestSession());
    const bodies = stubComplete(() =>
      HttpResponse.json({
        project_id: PROJECT_ID,
        team_id: "team_personal",
        claimed_at: "2026-08-24T10:00:00Z",
      }),
    );
    await renderAt(CLAIM_PATH);

    expect(await screen.findByRole("heading", { name: "Project claimed" })).toBeInTheDocument();
    // The challenge is single-use (first-claim-wins): one visit must spend it
    // exactly once, whatever React re-renders happen around the effect.
    expect(bodies).toEqual([{ challenge_id: CHALLENGE_ID }]);
    // The CLI is polling `claim/status`; the page says so instead of
    // pretending the browser is the end of the story.
    expect(screen.getByText(/terminal/i)).toBeInTheDocument();
  });

  it("shows the owning team's dashboard when the project is already claimed", async () => {
    fetchSession.mockResolvedValue(makeTestSession());
    stubComplete(() =>
      HttpResponse.json(
        {
          code: "proj-already_claimed",
          message: "The project is already claimed by a team.",
          details: {
            team_id: "team_other",
            dashboard_url: "https://console.example/teams/team_other",
          },
        },
        { status: 409 },
      ),
    );
    await renderAt(CLAIM_PATH);

    expect(await screen.findByRole("heading", { name: "Already claimed" })).toBeInTheDocument();
    // ADR 030: the API owns the error copy; it is rendered verbatim.
    expect(screen.getByText("The project is already claimed by a team.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /dashboard/i })).toHaveAttribute(
      "href",
      "https://console.example/teams/team_other",
    );
  });

  it("prompts a restart when the challenge has expired", async () => {
    fetchSession.mockResolvedValue(makeTestSession());
    stubComplete(() =>
      HttpResponse.json(
        { code: "proj-claim_expired", message: "The claim challenge has expired." },
        { status: 410 },
      ),
    );
    await renderAt(CLAIM_PATH);

    expect(await screen.findByRole("heading", { name: "Claim link expired" })).toBeInTheDocument();
    expect(screen.getByText("The claim challenge has expired.")).toBeInTheDocument();
    // The fix is a fresh challenge from `claim/init`, which only the CLI can
    // mint — the page says where to go rather than offering a dead retry.
    expect(screen.getByText(/terminal/i)).toBeInTheDocument();
  });

  it("offers a retry on claim.no_personal_team — the contract says it self-clears", async () => {
    // `claim.no_personal_team` means no membership at all, and the 403's own
    // contract text says the next sign-in provisions one. Dead-ending here
    // would tell a developer to give up on the recoverable case.
    fetchSession.mockResolvedValue(makeTestSession());
    stubComplete(() =>
      HttpResponse.json(
        {
          code: "claim.no_personal_team",
          message: "The session user has no active personal team in the platform project.",
        },
        { status: 403 },
      ),
    );
    await renderAt(CLAIM_PATH);

    expect(
      await screen.findByRole("heading", { name: "Your account has no team yet" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("The session user has no active personal team in the platform project."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("dead-ends claim.personal_team_not_active and names the remedy", async () => {
    // The mirror case: the membership exists but is not active, which
    // provisioning will not fix. `membership_status` decides the copy —
    // `removed` is about the user's access, not the team's.
    fetchSession.mockResolvedValue(makeTestSession());
    stubComplete(() =>
      HttpResponse.json(
        {
          code: "claim.personal_team_not_active",
          message: "The user's personal team in the platform project is not active.",
          details: { membership_status: "removed" },
        },
        { status: 403 },
      ),
    );
    await renderAt(CLAIM_PATH);

    expect(
      await screen.findByRole("heading", { name: "This account cannot claim projects" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Restoring this account's access/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });

  it("drops a dashboard link that is not http(s)", async () => {
    fetchSession.mockResolvedValue(makeTestSession());
    stubComplete(() =>
      HttpResponse.json(
        {
          code: "proj-already_claimed",
          message: "The project is already claimed by a team.",
          details: { team_id: "team_other", dashboard_url: "javascript:alert(1)" },
        },
        { status: 409 },
      ),
    );
    await renderAt(CLAIM_PATH);

    expect(await screen.findByRole("heading", { name: "Already claimed" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /dashboard/i })).not.toBeInTheDocument();
  });

  it("dead-ends a 401 instead of re-running sign-in", async () => {
    // The loader just confirmed an active session, so a 401 from
    // `claim/complete` is the server's opaque wrong-plane verdict (no platform
    // project, or a foreign-project session — `verifyClaimSession` collapses
    // both into public `auth.unauthorized`). Re-embedding the widget mints the
    // same session again and loops forever — the local dev backend boots
    // without a platform project, which is exactly how the loop was found.
    fetchSession.mockResolvedValue(makeTestSession());
    stubComplete(() =>
      HttpResponse.json(
        { code: "auth.unauthorized", message: "Missing or invalid session token." },
        { status: 401 },
      ),
    );
    await renderAt(CLAIM_PATH);

    expect(
      await screen.findByRole("heading", { name: "Your session can't complete this claim" }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("zitadel-login")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("offers a retry on an unexpected failure, spending one call per attempt", async () => {
    fetchSession.mockResolvedValue(makeTestSession());
    let calls = 0;
    server.use(
      http.post(COMPLETE_PATTERN, () => {
        calls += 1;
        return calls === 1
          ? HttpResponse.json({ code: "internal", message: "Something broke." }, { status: 500 })
          : HttpResponse.json({
              project_id: PROJECT_ID,
              team_id: "team_personal",
              claimed_at: "2026-08-24T10:00:00Z",
            });
      }),
    );
    await renderAt(CLAIM_PATH);

    expect(
      await screen.findByRole("heading", { name: "The claim did not complete" }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { name: "Project claimed" })).toBeInTheDocument();
    expect(calls).toBe(2);
  });

  it("rejects a claim URL with missing parameters without spending anything", async () => {
    fetchSession.mockResolvedValue(makeTestSession());
    const bodies = stubComplete(() => HttpResponse.json({}));
    await renderAt("/claim?project_id=proj_only");

    expect(
      await screen.findByRole("heading", { name: "This claim link is not valid" }),
    ).toBeInTheDocument();
    expect(bodies).toHaveLength(0);
  });
});
