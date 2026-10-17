import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";
import { formatDateTime } from "@/lib/date";
import { scopedPath } from "@/test/project-scope.fixture";
import { server } from "@/test/msw";

// The `_authed` layout guards every screen behind `GET /sessions/me`
// (Console ADR 0003); mock the auth module so routes render as signed in.
vi.mock("@/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/auth/session")>();
  const { makeTestSession } = await import("@/test/session.fixture");
  return { ...actual, fetchSession: vi.fn(async () => makeTestSession()) };
});

// Absolute base so requests parse under jsdom/undici and MSW can intercept.
const DEPLOYMENTS_URL = "http://localhost/api/deployments";

const DEPLOYED_AT = "2026-10-02T14:52:00Z";

/** One entry of `GET /deployments`: a primary deployment unless told otherwise. */
function deployment(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    project_id: "proj_test",
    release_id: "rel_1",
    targets: [{ origin: "https://app.acme.com" }, { origin: "https://www.acme.com" }],
    deployed_at: DEPLOYED_AT,
    metadata: { reason: "deploy", message: null, rollback_to: null, deployed_by: null },
    ...overrides,
  };
}

/** `GET /deployments`: the history, and the live view when `live=true`. */
function serveDeployments(history: unknown[] = [], live: unknown[] = []) {
  server.use(
    http.get(DEPLOYMENTS_URL, ({ request }) => {
      const url = new URL(request.url);
      return HttpResponse.json({
        deployments: url.searchParams.get("live") === "true" ? live : history,
      });
    }),
  );
}

async function renderAt(path: string) {
  const [{ RouterProvider, createMemoryHistory }, { createAppRouter }] = await Promise.all([
    import("@tanstack/react-router"),
    import("../../../router"),
  ]);
  const router = createAppRouter({
    history: createMemoryHistory({ initialEntries: [scopedPath(path)] }),
  });
  render(<RouterProvider router={router} />);
  return router;
}

describe("deployments list", () => {
  it("shows the empty state when the project has no deployments", async () => {
    serveDeployments();
    await renderAt("/deployments");

    expect(await screen.findByRole("heading", { name: "Deployments" })).toBeInTheDocument();
    expect(screen.getByText("This project has no deployments.")).toBeInTheDocument();
  });

  it("lists each deployment with its release, targets, state and time", async () => {
    const preview = deployment("dep_2", {
      release_id: "rel_2",
      targets: [{ origin: "https://acme-k3x9v2.vercel.app", expires_at: "2026-10-09T14:52:00Z" }],
      deployed_at: "2026-10-03T09:00:00Z",
    });
    // The live view holds only the preview, so the primary deployment has
    // since been replaced.
    serveDeployments([preview, deployment("dep_1")], [preview]);
    await renderAt("/deployments");

    const rows = await screen.findAllByRole("row");
    // The header row, then the two deployments, newest first.
    expect(rows).toHaveLength(3);
    const [, firstRow, secondRow] = rows as [HTMLElement, HTMLElement, HTMLElement];

    const first = within(firstRow);
    expect(first.getByRole("link", { name: "rel_2" })).toHaveAttribute(
      "href",
      scopedPath("/releases/rel_2"),
    );
    expect(first.getByRole("button", { name: "Copy release ID rel_2" })).toBeInTheDocument();
    // The origins are counted, and a preview target says so.
    expect(first.getByRole("button", { name: "1 origin" })).toBeInTheDocument();
    expect(first.getByText("Preview")).toBeInTheDocument();
    expect(first.getByText("active")).toBeInTheDocument();

    const second = within(secondRow);
    expect(second.getByRole("link", { name: "rel_1" })).toBeInTheDocument();
    expect(second.getByText("Primary")).toBeInTheDocument();
    expect(second.getByText("Superseded")).toBeInTheDocument();
    // Older than a day: the calendar date, not "ago".
    expect(second.getByText(formatDateTime(DEPLOYED_AT))).toBeInTheDocument();
  });

  it("counts the origins and lists them on demand, each opening and copying", async () => {
    serveDeployments([deployment("dep_1")]);
    await renderAt("/deployments");

    const trigger = await screen.findByRole("button", { name: "2 origins" });
    expect(screen.queryByText("https://www.acme.com")).not.toBeInTheDocument();
    await userEvent.click(trigger);
    const first = await screen.findByRole("link", { name: "https://app.acme.com" });
    expect(first).toHaveAttribute("href", "https://app.acme.com");
    expect(first).toHaveAttribute("target", "_blank");
    expect(screen.getByRole("link", { name: "https://www.acme.com" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy https://www.acme.com" })).toBeInTheDocument();
  });

  it("scopes both reads to the selected project", async () => {
    const seen: string[] = [];
    server.use(
      http.get(DEPLOYMENTS_URL, ({ request }) => {
        const url = new URL(request.url);
        seen.push(
          `deployments${url.searchParams.get("live") === "true" ? " live" : ""}:${url.searchParams.get("project_id")}`,
        );
        return HttpResponse.json({ deployments: [] });
      }),
    );
    await renderAt("/deployments");
    await screen.findByText("This project has no deployments.");
    expect(seen.sort()).toEqual(["deployments live:proj_test", "deployments:proj_test"]);
  });

  it("says so while the server does not list deployments", async () => {
    server.use(
      http.get(DEPLOYMENTS_URL, () =>
        HttpResponse.json({ code: "not_implemented", message: "" }, { status: 501 }),
      ),
    );
    await renderAt("/deployments");

    expect(await screen.findByRole("heading", { name: "Deployments" })).toBeInTheDocument();
    expect(screen.getByText("This server does not list deployments yet.")).toBeInTheDocument();
  });

  it("leaves a refused read to the route's error state", async () => {
    // The loader error is expected here; silence React's error-boundary dump
    // and the router's route-match warning so passing runs stay quiet.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      server.use(
        http.get(DEPLOYMENTS_URL, () =>
          HttpResponse.json({ code: "forbidden", message: "No access" }, { status: 403 }),
        ),
      );
      await renderAt("/deployments");

      expect(await screen.findByText("Not authorized")).toBeInTheDocument();
      expect(
        screen.queryByText("This server does not list deployments yet."),
      ).not.toBeInTheDocument();
    } finally {
      errorSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });
});
