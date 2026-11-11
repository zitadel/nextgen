import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { render, screen, within } from "@testing-library/react";
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

const PROJECT_ID = "proj_1";

// The project, its grants and its variables, which the page reads beside the policy. The
// person can act on the project, so the switcher names it from their list.
beforeEach(() =>
  server.use(
    http.get(`http://localhost/api/v1/projects/${PROJECT_ID}`, () =>
      HttpResponse.json({
        id: PROJECT_ID,
        name: "River",
        origins: [],
        created_at: "2026-07-08T09:00:00Z",
        updated_at: "2026-07-08T09:00:00Z",
      }),
    ),
    http.post("http://localhost/api/v1/grants/query", () => HttpResponse.json({ grants: [] })),
    http.get("http://localhost/api/v1/projects/:id/admins", () =>
      HttpResponse.json({ admins: [] }),
    ),
    http.get("http://localhost/api/v1/variables", () => HttpResponse.json({})),
    http.get("http://localhost/api/v1/users/me/projects", () =>
      HttpResponse.json({ projects: [{ id: PROJECT_ID, name: "River" }] }),
    ),
  ),
);

const API = "http://localhost/api/v1";

/** A primary deployment of `rel_1`, as `GET /deployments?live=true` lists it. */
const PRIMARY_DEPLOYMENT = {
  id: "dep_1",
  project_id: PROJECT_ID,
  release_id: "rel_1",
  kind: "primary",
  targets: [{ origin: "https://app.acme.com" }],
  status: "live",
  deployed_at: "2026-10-20T10:30:00Z",
  metadata: { reason: "deploy", message: null, rollback_to: null, deployed_by: null },
};

/**
 * The primary origins serving `rel_1`, which pins the password policy at
 * `config` or none at all, and the queries its policy revision was read with.
 */
function stubDeployedPolicy(config: Record<string, unknown> | undefined) {
  const queries: URLSearchParams[] = [];
  server.use(
    http.get(`${API}/deployments`, () =>
      HttpResponse.json({ deployments: [PRIMARY_DEPLOYMENT], next_page_token: null }),
    ),
    http.get(`${API}/releases/rel_1`, () =>
      HttpResponse.json({
        id: "rel_1",
        project_id: PROJECT_ID,
        content_hash: `sha256:${"0".repeat(64)}`,
        metadata: { created_at: "2026-10-20T10:00:00Z" },
        revoked_at: null,
        pointers:
          config === undefined
            ? []
            : [{ kind: "policy", handle: "auth.factor.password.set", revision_id: "polrev_1" }],
      }),
    ),
    http.get(`${API}/policies/revisions/polrev_1`, ({ request }) => {
      queries.push(new URL(request.url).searchParams);
      return HttpResponse.json({
        id: "pol_1",
        revision_id: "polrev_1",
        project_id: PROJECT_ID,
        operation: "auth.factor.password.set",
        config,
        created_at: "2026-10-20T09:00:00Z",
        updated_at: "2026-10-20T10:30:00Z",
      });
    }),
  );
  return queries;
}

async function renderPolicies() {
  const router = createAppRouter({
    history: createMemoryHistory({ initialEntries: [scopedPath("/project", PROJECT_ID)] }),
  });
  render(<RouterProvider router={router} />);
  return within(await screen.findByRole("region", { name: "Policies" }));
}

describe("project policies", () => {
  it("states the password rules the primary origins' release pins, read for the selected project", async () => {
    const queries = stubDeployedPolicy({ min_length: 15, history_depth: 4 });
    const policies = await renderPolicies();

    expect(policies.getByText("Password policy")).toBeInTheDocument();
    expect(policies.getByText("15 characters")).toBeInTheDocument();
    expect(policies.getByText("Prevent reuse of the last 4 passwords")).toBeInTheDocument();
    expect(policies.queryByText("Warning")).not.toBeInTheDocument();
    expect(queries[0]?.get("project_id")).toBe(PROJECT_ID);
  });

  it("shows the deployed policy, not a revision published since", async () => {
    stubDeployedPolicy({ min_length: 15, history_depth: 4 });
    server.use(
      http.get(`${API}/policies`, () =>
        HttpResponse.json({
          policies: [
            {
              id: "pol_1",
              revision_id: "polrev_2",
              project_id: PROJECT_ID,
              operation: "auth.factor.password.set",
              config: { min_length: 8 },
              created_at: "2026-10-20T09:00:00Z",
              updated_at: "2026-10-21T09:00:00Z",
            },
          ],
          next_page_token: null,
        }),
      ),
    );
    const policies = await renderPolicies();

    expect(policies.getByText("15 characters")).toBeInTheDocument();
    expect(policies.queryByText("8 characters")).not.toBeInTheDocument();
  });

  it("states a short minimum as configured, without grading it (ADR 066)", async () => {
    stubDeployedPolicy({ min_length: 8, history_depth: 4 });
    const policies = await renderPolicies();

    expect(policies.getByText("8 characters")).toBeInTheDocument();
    expect(policies.queryByText("Warning")).not.toBeInTheDocument();
    expect(policies.queryByRole("button")).not.toBeInTheDocument();
  });

  it("reads a project without a policy as enforcing nothing, without grading it", async () => {
    stubDeployedPolicy(undefined);
    const policies = await renderPolicies();

    expect(policies.getByText("No minimum")).toBeInTheDocument();
    expect(policies.getByText("Reuse allowed")).toBeInTheDocument();
    expect(policies.queryByText("Warning")).not.toBeInTheDocument();
    expect(policies.queryByRole("button")).not.toBeInTheDocument();
  });

  it("says nothing is deployed when the primary origins serve nothing", async () => {
    server.use(
      http.get(`${API}/deployments`, () =>
        HttpResponse.json({ deployments: [], next_page_token: null }),
      ),
    );
    const policies = await renderPolicies();

    expect(
      policies.getByText(/^Nothing is deployed to the primary origins yet\./),
    ).toBeInTheDocument();
    expect(policies.queryByText("Warning")).not.toBeInTheDocument();
  });

  it("keeps the page when the policy cannot be read, and shows the refusal in the card", async () => {
    stubDeployedPolicy({ min_length: 15 });
    server.use(
      http.get(`${API}/policies/revisions/polrev_1`, () =>
        HttpResponse.json(
          { code: "internal", message: "policy store unavailable" },
          { status: 500 },
        ),
      ),
    );
    const policies = await renderPolicies();

    expect(screen.getByRole("heading", { name: "River" })).toBeInTheDocument();
    expect(policies.getByText("Password policy")).toBeInTheDocument();
    expect(policies.getByText("policy store unavailable")).toBeInTheDocument();
    expect(policies.queryByText("Warning")).not.toBeInTheDocument();
  });
});
