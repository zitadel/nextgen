import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useRequiredProjectScope } from "@/features/projects/project-scope";
import { _setRuntimeForTesting } from "@/runtime/runtime";
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

// The real preview starts a flow in the project it is given; this stand-in
// names that project, which is what the root has to get right.
vi.mock("@/features/branding/components/login-preview", () => ({
  LoginPreview: function Preview() {
    return <div data-testid="preview">{useRequiredProjectScope()}</div>;
  },
}));

const PLATFORM_URL = "http://localhost/api/v1/projects/proj_platform";
const LIST_URL = "http://localhost/api/v1/branding";
const FLOWS_URL = "http://localhost/api/v1/flow_definitions";

const FLOW = {
  id: "flow_1",
  flow_definition: {
    name: "default-login",
    status: "active",
    purposes: { login: "identifier" },
    steps: [],
  },
};

beforeEach(() => {
  _setRuntimeForTesting({
    mode: "standalone",
    console_project_id: "proj_platform",
    publishable_key: "pk",
    platform_project_id: "proj_platform",
  });
});

async function renderAt(path: string) {
  const router = createAppRouter({
    history: createMemoryHistory({ initialEntries: [scopedPath(path)] }),
  });
  render(<RouterProvider router={router} />);
  return router;
}

/**
 * Root Settings → Branding (D41): the console's own sign-in, the reserved
 * platform project's branding, drawn by the project screen's components while
 * the selected project stays selected.
 */
describe("root branding", () => {
  it("reads and previews the platform project, keeping the selection", async () => {
    const asked: (string | null)[] = [];
    server.use(
      http.get(PLATFORM_URL, () => HttpResponse.json({ id: "proj_platform", name: "Platform" })),
      http.get(FLOWS_URL, ({ request }) => {
        asked.push(new URL(request.url).searchParams.get("project_id"));
        return HttpResponse.json({ flow_definitions: [FLOW] });
      }),
      http.get(LIST_URL, ({ request }) => {
        asked.push(new URL(request.url).searchParams.get("project_id"));
        return HttpResponse.json([]);
      }),
    );
    const router = await renderAt("/settings/branding");

    expect(await screen.findByTestId("preview")).toHaveTextContent("proj_platform");
    expect(asked).toEqual(["proj_platform", "proj_platform"]);
    expect(router.state.resolvedLocation?.search).toMatchObject({ project: "proj_test" });
    expect(
      screen.getByRole("navigation", { name: "Settings" }).querySelector('[aria-current="page"]'),
    ).toHaveTextContent("Branding");
  });

  it("sends someone who may not act on the platform project to Settings", async () => {
    server.use(
      http.get(PLATFORM_URL, () =>
        HttpResponse.json({ code: "proj.not_found", message: "Not found" }, { status: 404 }),
      ),
    );
    const router = await renderAt("/settings/branding");

    await waitFor(() => expect(router.state.resolvedLocation?.pathname).toBe("/settings"));
    expect(await screen.findByText("Nothing here is yours to set.")).toBeInTheDocument();
  });
});
