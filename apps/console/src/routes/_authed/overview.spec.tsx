import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { render, screen, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";

import { scopedPath } from "@/test/project-scope.fixture";
import { server } from "@/test/msw";
import { createAppRouter } from "@/router";

// The `_authed` layout guards every screen behind `GET /sessions/me`
// (Console ADR 0003); mock the auth module so routes render as signed in.
vi.mock("@/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/auth/session")>();
  const { makeTestSession } = await import("@/test/session.fixture");
  return { ...actual, fetchSession: vi.fn(async () => makeTestSession()) };
});

const API = "http://localhost/api/v1";
const PROJECT_URL = `${API}/projects/proj_test`;
const DEPLOYMENTS_URL = `${API}/deployments`;
const EVENTS_URL = `${API}/events`;
const AT = "2026-10-02T14:52:00Z";

function serveProject() {
  server.use(
    http.get(PROJECT_URL, () =>
      HttpResponse.json({
        id: "proj_test",
        name: "Acme",
        origins: [{ pattern: "https://app.acme.com", kind: "primary" }],
        created_at: AT,
        updated_at: AT,
        owning_team_id: "team_1",
      }),
    ),
  );
}

/** `GET /deployments?live=true`: what is live now. */
function serveLive(deployments: unknown[]) {
  server.use(http.get(DEPLOYMENTS_URL, () => HttpResponse.json({ deployments })));
}

/** `GET /events`, recording what the card asked for. */
function serveEvents(data: unknown[]): URLSearchParams[] {
  const queries: URLSearchParams[] = [];
  server.use(
    http.get(EVENTS_URL, ({ request }) => {
      queries.push(new URL(request.url).searchParams);
      return HttpResponse.json({ data });
    }),
  );
  return queries;
}

function deployment(overrides: Record<string, unknown> = {}) {
  return {
    id: "dep_1",
    project_id: "proj_test",
    release_id: "rel_1",
    kind: "primary",
    targets: [{ origin: "https://app.acme.com" }, { origin: "https://www.acme.com" }],
    status: "live",
    deployed_at: AT,
    metadata: { reason: "deploy", message: "Add phone_number", deployed_by: null },
    ...overrides,
  };
}

function event(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    project_id: "proj_test",
    team_id: null,
    event_type: "user.deleted",
    category: "entity",
    occurred_at: AT,
    created_at: AT,
    actor_id: "user_admin",
    actor_type: "human",
    entity_type: "user",
    entity_id: "user_gone",
    client_id: "",
    request_id: "req_1",
    session_id: null,
    flow_id: null,
    payload: {},
    metadata: {},
    ...overrides,
  };
}

function renderOverview() {
  const router = createAppRouter({
    history: createMemoryHistory({ initialEntries: [scopedPath("/")] }),
  });
  render(<RouterProvider router={router} />);
  return router;
}

/**
 * Overview is a project's landing and the first row of its sidebar (D35): what
 * the project is, what its primary origins serve, and what happened lately,
 * each handing over to the screen it summarizes.
 */
describe("project overview", () => {
  it("heads the project's sidebar and is where the project lands", async () => {
    serveProject();
    serveLive([deployment()]);
    serveEvents([]);
    renderOverview();

    expect(await screen.findByRole("heading", { name: "Acme", level: 1 })).toBeInTheDocument();
    // The site it signs people into, as Projects names it.
    expect(screen.getByText("app.acme.com")).toBeInTheDocument();
    const nav = within(screen.getByRole("navigation", { name: "Primary" }));
    const first = nav.getAllByRole("link")[0];
    expect(first).toHaveTextContent("Overview");
    expect(first).toHaveAttribute("data-active", "true");
  });

  it("shows what the primary origins serve, and hands over to Deployments", async () => {
    serveProject();
    serveLive([deployment()]);
    serveEvents([]);
    renderOverview();

    const card = within(await screen.findByRole("region", { name: "Production" }));
    expect(card.getByRole("link", { name: /rel_1/ })).toHaveAttribute(
      "href",
      scopedPath("/releases/rel_1"),
    );
    expect(card.getByText("Live")).toBeInTheDocument();
    expect(card.getByText("Add phone_number")).toBeInTheDocument();
    expect(card.getByRole("link", { name: "https://app.acme.com" })).toHaveAttribute(
      "href",
      "https://app.acme.com",
    );
    expect(card.getByRole("link", { name: "https://www.acme.com" })).toBeInTheDocument();
    expect(card.getByRole("link", { name: "Deployments" })).toHaveAttribute(
      "href",
      scopedPath("/deployments"),
    );
  });

  it("lists the newest audit events, each opening, and hands over to Logs", async () => {
    serveProject();
    serveLive([]);
    const queries = serveEvents([
      event("evt_2", { event_type: "user.created", entity_id: "user_new" }),
      event("evt_1"),
    ]);
    renderOverview();

    const card = within(await screen.findByRole("region", { name: "Recent activity" }));
    expect(card.getAllByRole("listitem")).toHaveLength(2);
    expect(card.getByRole("link", { name: "user.created" })).toHaveAttribute(
      "href",
      // Opened over the audit view, which the card heads.
      scopedPath("/events/evt_2?view=audit"),
    );
    expect(card.getByText("user_new")).toBeInTheDocument();
    // Logs' default view, the audit events, and only a handful of them.
    expect(queries).toHaveLength(1);
    expect(queries[0]?.get("limit")).toBe("5");
    expect(queries[0]?.getAll("category")).not.toContain("request");
    expect(card.getByRole("link", { name: "Logs" }).getAttribute("href")).toMatch(/^\/events\?/);
  });

  it("says when nothing is live and nothing has happened", async () => {
    serveProject();
    serveLive([]);
    serveEvents([]);
    renderOverview();

    const production = within(await screen.findByRole("region", { name: "Production" }));
    expect(
      production.getByText(/Nothing is live on this project.s primary origins yet\./),
    ).toBeInTheDocument();
    const activity = within(screen.getByRole("region", { name: "Recent activity" }));
    expect(activity.getByText("This project has no audit events.")).toBeInTheDocument();
  });

  it("keeps the page when one card's read is refused", async () => {
    serveProject();
    server.use(
      http.get(DEPLOYMENTS_URL, () =>
        HttpResponse.json(
          {
            code: "user.permission_denied",
            message: "You may not read this project's deployments.",
          },
          { status: 403 },
        ),
      ),
    );
    serveEvents([event("evt_1")]);
    renderOverview();

    const production = within(await screen.findByRole("region", { name: "Production" }));
    expect(
      production.getByText("You may not read this project's deployments."),
    ).toBeInTheDocument();
    const activity = within(screen.getByRole("region", { name: "Recent activity" }));
    expect(activity.getByRole("link", { name: "user.deleted" })).toBeInTheDocument();
  });
});
