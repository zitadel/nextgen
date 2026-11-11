import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { _setRuntimeForTesting } from "@/runtime/runtime";
import { server } from "@/test/msw";
import { TEST_PROJECT_ID, scopedPath } from "@/test/project-scope.fixture";
import { createAppRouter } from "../../../../router";

// The `_authed` layout guards every screen behind `GET /sessions/me`
// (Console ADR 0003); mock the auth module so routes render as signed in.
vi.mock("@/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/auth/session")>();
  const { makeTestSession } = await import("@/test/session.fixture");
  return { ...actual, fetchSession: vi.fn(async () => makeTestSession()) };
});

const PLATFORM = "proj_platform";
const PLATFORM_PROJECT = `*/api/v1/projects/${PLATFORM}`;
const IDPS_QUERY = "*/api/v1/idps/query";
const IDP_BY_ID = "*/api/v1/idps/:id";
const SCHEMAS = "*/api/v1/schemas";
const FLOWS = "*/api/v1/flow_definitions";

const CREATED_AT = "2026-07-12T16:59:04Z";

function connection(id: string, slug: string, displayName: string) {
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
    },
  };
}

const GOOGLE = connection("idp_google", "google", "Google");
const GITHUB = connection("idp_github", "github", "GitHub");

/** The console's accounts: they sign in with a passkey or Google. */
const OPERATORS = {
  id: "sch_operators",
  metadata: { created_at: CREATED_AT },
  schema: {
    title: "Operators",
    "x-auth-methods": {
      passkey: { enabled: true },
      sso: { enabled: true, providers: ["google"] },
    },
  },
};

const LOGIN_FLOW = {
  id: "flow_login",
  project_id: PLATFORM,
  created_at: CREATED_AT,
  updated_at: CREATED_AT,
  flow_definition: {
    name: "default-login",
    status: "active",
    user_schema: "sch_operators",
    purposes: { login: "identifier" },
    steps: [{ name: "identifier", sso_providers: ["google"] }],
  },
};

// The console signs in to the project bootstrap provisioned, which the server
// marks as the platform project: the root draws it (D41).
beforeEach(() => {
  _setRuntimeForTesting({
    mode: "standalone",
    console_project_id: PLATFORM,
    publishable_key: "pk",
    platform_project_id: PLATFORM,
  });
});

/**
 * Someone who may act on the platform project (its read is the access), and
 * the screens' reads of it. Returns the project each read named.
 */
function serve() {
  const reads: Array<{ read: string; project: string | null }> = [];
  const record = (read: string, request: Request) =>
    reads.push({ read, project: new URL(request.url).searchParams.get("project_id") });
  server.use(
    http.get(PLATFORM_PROJECT, () => HttpResponse.json({ id: PLATFORM, name: "Platform" })),
    http.post(IDPS_QUERY, ({ request }) => {
      record("idps", request);
      return HttpResponse.json({ idps: [GOOGLE, GITHUB] });
    }),
    http.get(IDP_BY_ID, ({ request, params }) => {
      record("idp", request);
      const found = [GOOGLE, GITHUB].find((idp) => idp.id === params.id);
      return found
        ? HttpResponse.json(found)
        : HttpResponse.json({ code: "idp.not_found", message: "not found" }, { status: 404 });
    }),
    http.get(SCHEMAS, ({ request }) => {
      record("schemas", request);
      return HttpResponse.json({ schemas: [OPERATORS] });
    }),
    http.get(FLOWS, ({ request }) => {
      record("flows", request);
      return HttpResponse.json({ flow_definitions: [LOGIN_FLOW] });
    }),
  );
  return reads;
}

/** Opens `path` with a customer project selected, which the root leaves as it is (D36). */
async function renderAt(path: string) {
  const router = createAppRouter({
    history: createMemoryHistory({ initialEntries: [scopedPath(path)] }),
  });
  render(<RouterProvider router={router} />);
  return router;
}

describe("root authentication", () => {
  it("reads the platform project's sign-in methods, and a provider opens the root's page", async () => {
    const reads = serve();
    const router = await renderAt("/settings/authentication");

    const google = await screen.findByRole("link", { name: "Google" });
    // The platform project's, not the selection's.
    expect(reads).toEqual(
      expect.arrayContaining([
        { read: "schemas", project: PLATFORM },
        { read: "idps", project: PLATFORM },
      ]),
    );
    expect(reads.every((entry) => entry.project === PLATFORM)).toBe(true);
    expect(google.getAttribute("href")).toMatch(
      /^\/settings\/authentication\/idps\/idp_google(\?|$)/,
    );
    expect(google.getAttribute("href")).not.toContain(PLATFORM);

    await userEvent.click(google);
    await waitFor(() =>
      expect(router.state.resolvedLocation?.pathname).toBe(
        "/settings/authentication/idps/idp_google",
      ),
    );
    // The selection is kept, never replaced by the platform project.
    expect(router.state.resolvedLocation?.search).toMatchObject({ project: TEST_PROJECT_ID });
    expect(await screen.findByRole("heading", { name: "Google" })).toBeInTheDocument();
    expect(reads).toContainEqual({ read: "idp", project: PLATFORM });
    expect(reads.every((entry) => entry.project === PLATFORM)).toBe(true);

    // The root shows no schemas, so "Used by" names them without a link; its
    // login flows open the root's Login flows.
    expect(screen.getByText("Operators")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Operators" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Default login" }).getAttribute("href")).toMatch(
      /^\/settings\/login-flows\/flow_login(\?|$)/,
    );
  });

  it("keeps the open tab in the URL, and a connection opens the root's page", async () => {
    serve();
    const router = await renderAt("/settings/authentication");

    await userEvent.click(await screen.findByRole("tab", { name: "Identity providers" }));
    await waitFor(() =>
      expect(router.state.resolvedLocation?.search).toMatchObject({
        tab: "identity-providers",
        project: TEST_PROJECT_ID,
      }),
    );
    expect(router.state.resolvedLocation?.pathname).toBe("/settings/authentication");
    expect((await screen.findByRole("link", { name: "GitHub" })).getAttribute("href")).toMatch(
      /^\/settings\/authentication\/idps\/idp_github(\?|$)/,
    );
  });

  it.each(["/settings/authentication", "/settings/authentication/idps/idp_google"])(
    "sends someone who may not act on the platform project from %s to Settings",
    async (path) => {
      server.use(
        http.get(PLATFORM_PROJECT, () =>
          HttpResponse.json({ code: "proj.not_found", message: "not found" }, { status: 404 }),
        ),
      );
      const router = await renderAt(path);

      await waitFor(() => expect(router.state.resolvedLocation?.pathname).toBe("/settings"));
      // Settings, settled: with no page of the platform project's to list, and
      // no add-on, it has nothing to forward to.
      expect(await screen.findByRole("heading", { name: "Settings" })).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "Authentication" })).not.toBeInTheDocument();
    },
  );
});
