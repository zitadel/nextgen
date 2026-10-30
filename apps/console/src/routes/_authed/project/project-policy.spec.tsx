import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { render, screen, within } from "@testing-library/react";
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

const PROJECT_ID = "proj_1";

// The project, its grants and its variables, which the page reads beside the policy. The
// person can act on the project, so the switcher names it from their list.
beforeEach(() =>
  server.use(
    http.get(`http://localhost/api/projects/${PROJECT_ID}`, () =>
      HttpResponse.json({
        id: PROJECT_ID,
        name: "River",
        origins: [],
        created_at: "2026-07-08T09:00:00Z",
        updated_at: "2026-07-08T09:00:00Z",
      }),
    ),
    http.post("http://localhost/api/grants/query", () => HttpResponse.json({ grants: [] })),
    http.get("http://localhost/api/projects/:id/admins", () => HttpResponse.json({ admins: [] })),
    http.get("http://localhost/api/variables", () => HttpResponse.json({})),
    http.get("http://localhost/api/users/me/projects", () =>
      HttpResponse.json({ projects: [{ id: PROJECT_ID, name: "River" }] }),
    ),
  ),
);

/**
 * `GET /policies` answering with the password policy at `config`, or with no
 * policy at all, and recording the query it was asked.
 */
function stubPolicies(config: Record<string, unknown> | undefined) {
  const queries: URLSearchParams[] = [];
  server.use(
    http.get("http://localhost/api/policies", ({ request }) => {
      queries.push(new URL(request.url).searchParams);
      const policies =
        config === undefined
          ? []
          : [
              {
                id: "pol_1",
                revision_id: "polrev_1",
                project_id: PROJECT_ID,
                operation: "auth.factor.password.set",
                config,
                created_at: "2026-10-20T09:00:00Z",
                updated_at: "2026-10-20T10:30:00Z",
              },
            ];
      return HttpResponse.json({ policies, next_page_token: null });
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
  it("states the password rules in force, read for the selected project", async () => {
    const queries = stubPolicies({ min_length: 15, history_depth: 4 });
    const policies = await renderPolicies();

    expect(policies.getByText("Password policy")).toBeInTheDocument();
    expect(policies.getByText("15 characters")).toBeInTheDocument();
    expect(policies.getByText("Prevent reuse of the last 4 passwords")).toBeInTheDocument();
    expect(policies.queryByText("Warning")).not.toBeInTheDocument();
    expect(queries[0]?.get("project_id")).toBe(PROJECT_ID);
    expect(queries[0]?.get("operation")).toBe("auth.factor.password.set");
  });

  it("warns on a minimum under fifteen, and says why on the value", async () => {
    stubPolicies({ min_length: 12, history_depth: 4 });
    const policies = await renderPolicies();

    expect(policies.getByText("12 characters")).toBeInTheDocument();
    expect(policies.getByText("Warning")).toBeInTheDocument();
    await userEvent.click(policies.getByRole("button", { name: "Below recommended minimum" }));
    const note = await screen.findByRole("dialog");
    expect(note).toHaveTextContent("below the recommended 15 characters");
    expect(
      within(note).getByRole("link", { name: "Learn more about the recommended minimum" }),
    ).toHaveAttribute("href", expect.stringContaining("nist.gov"));
  });

  it("reads a project without a policy as enforcing nothing, and says no minimum is set", async () => {
    stubPolicies(undefined);
    const policies = await renderPolicies();

    expect(policies.getByText("No minimum")).toBeInTheDocument();
    expect(policies.getByText("Reuse allowed")).toBeInTheDocument();
    expect(policies.getByText("Warning")).toBeInTheDocument();
    await userEvent.click(policies.getByRole("button", { name: "No minimum set" }));
    const note = await screen.findByRole("dialog");
    expect(note).toHaveTextContent("No minimum password length is set");
    expect(note).not.toHaveTextContent("configured minimum");
  });

  it("keeps the page when the policy cannot be read, and shows the refusal in the card", async () => {
    server.use(
      http.get("http://localhost/api/policies", () =>
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
