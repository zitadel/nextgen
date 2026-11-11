import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { _setRuntimeForTesting } from "@/runtime/runtime";
import { server } from "@/test/msw";
import { createAppRouter } from "../../../../router";

// The `_authed` layout guards every screen behind `GET /sessions/me`
// (Console ADR 0003); mock the auth module so routes render as signed in.
vi.mock("@/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/auth/session")>();
  const { makeTestSession } = await import("@/test/session.fixture");
  return { ...actual, fetchSession: vi.fn(async () => makeTestSession()) };
});

const PLATFORM = "proj_platform";
// Absolute base so requests parse under jsdom/undici and MSW can intercept.
const PLATFORM_URL = `http://localhost/api/v1/projects/${PLATFORM}`;
const FLOWS_URL = "http://localhost/api/v1/flow_definitions";
const FLOW_URL = "http://localhost/api/v1/flow_definitions/flow_1";
const SCHEMAS_URL = "http://localhost/api/v1/schemas";

const DEFINITION = {
  name: "default-login",
  status: "active",
  user_schema: "human-user",
  purposes: { login: "identifier" },
  steps: [{ name: "identifier", fields: ["email"], actions: [{ name: "submit", kind: "submit" }] }],
};

const SCHEMA_EMBED = {
  id: "sch_1",
  schema: { title: "Minimal", type: "object" },
  metadata: { created_at: "2026-01-01T00:00:00Z" },
};

const ENTRY = {
  id: "flow_1",
  project_id: PLATFORM,
  flow_definition: DEFINITION,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-02T00:00:00Z",
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

async function renderAt(path: string) {
  const router = createAppRouter({ history: createMemoryHistory({ initialEntries: [path] }) });
  render(<RouterProvider router={router} />);
  return router;
}

describe("root login flows", () => {
  it("lists the platform project's flows, and a row opens the root's detail", async () => {
    const lists: URLSearchParams[] = [];
    const schemaReads: URLSearchParams[] = [];
    server.use(
      // Someone who may act on the platform project: the read is the access.
      http.get(PLATFORM_URL, () => HttpResponse.json({ id: PLATFORM, name: "Platform" })),
      http.get(FLOWS_URL, ({ request }) => {
        lists.push(new URL(request.url).searchParams);
        return HttpResponse.json({ flow_definitions: [{ ...ENTRY, user_schema: SCHEMA_EMBED }] });
      }),
      http.get(FLOW_URL, () => HttpResponse.json(ENTRY)),
      http.get(SCHEMAS_URL, ({ request }) => {
        schemaReads.push(new URL(request.url).searchParams);
        return HttpResponse.json({ schemas: [SCHEMA_EMBED], next_page_token: null });
      }),
    );
    const router = await renderAt("/settings/login-flows");

    const row = await screen.findByRole("link", { name: "Default login" });
    // The platform project's, not the selection's, which stays as it is (D36).
    expect(lists.map((params) => params.get("project_id"))).toEqual([PLATFORM]);
    expect(row.getAttribute("href")).toMatch(/^\/settings\/login-flows\/flow_1(\?|$)/);
    expect(row.getAttribute("href")).not.toContain(PLATFORM);
    // The root shows no schemas, so the cell names it without linking it.
    expect(screen.getByText("Minimal")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Minimal" })).not.toBeInTheDocument();

    await userEvent.click(row);
    await waitFor(() =>
      expect(router.state.resolvedLocation?.pathname).toBe("/settings/login-flows/flow_1"),
    );
    expect(await screen.findByRole("heading", { name: "Default login" })).toBeInTheDocument();
    // The badge names the schema in the platform project, and links nowhere.
    expect(schemaReads.map((params) => params.get("project_id"))).toEqual([PLATFORM]);
    expect(screen.getByText("Minimal")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Minimal" })).not.toBeInTheDocument();
  });

  it.each(["/settings/login-flows", "/settings/login-flows/flow_1"])(
    "sends someone who may not act on the platform project from %s to Settings",
    async (path) => {
      server.use(
        http.get(PLATFORM_URL, () =>
          HttpResponse.json({ code: "proj.not_found", message: "not found" }, { status: 404 }),
        ),
      );
      const router = await renderAt(path);

      await waitFor(() => expect(router.state.resolvedLocation?.pathname).toBe("/settings"));
      // Settings, settled: with no page of the platform project's to list, and
      // no add-on, it has nothing to forward to.
      expect(await screen.findByRole("heading", { name: "Settings" })).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "Login flows" })).not.toBeInTheDocument();
    },
  );
});
