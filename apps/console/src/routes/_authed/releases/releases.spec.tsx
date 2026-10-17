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
const API = "http://localhost/api";
const RELEASES_URL = `${API}/releases`;
const DEPLOYMENTS_URL = `${API}/deployments`;

const CREATED_AT = "2026-07-12T16:59:04Z";

const METADATA = {
  message: "Add phone_number to human-user",
  git_sha: "4a5b268343c0ffee0123456789abcdef01234567",
  git_dirty: false,
  created_at: CREATED_AT,
  created_by: "user_dev",
  created_by_type: "human",
};

/** The list entry: a release without its pointers. */
function summary(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    project_id: "proj_test",
    content_hash: `sha256:${"0".repeat(64)}`,
    metadata: METADATA,
    revoked_at: null,
    ...overrides,
  };
}

const SCHEMA = { title: "Customer", objectType: "human-user", type: "object" };
const FLOW = { name: "default-login", status: "active", user_schema: "human-user", steps: [] };
const BRANDING = { theme: { primary: "#ff0000" } };

/** `GET /releases/{id}`: the summary plus the pinned set. */
function release(overrides: Record<string, unknown> = {}) {
  return summary("rel_1", {
    pointers: [
      { kind: "flow_definition", handle: "default-login", revision_id: "flow_1" },
      { kind: "schema", handle: "human-user", revision_id: "sch_1" },
      { kind: "branding", handle: "default", revision_id: "br_1" },
    ],
    ...overrides,
  });
}

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

/**
 * `GET /deployments` for the project: the history, and the live view when
 * `live=true`. The default is a project nothing has deployed.
 */
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

/** The reads behind each pointer of {@link release}, and no deployments. */
function servePointers() {
  serveDeployments();
  server.use(
    http.get(`${API}/schemas/sch_1`, () =>
      HttpResponse.json({ id: "sch_1", schema: SCHEMA, metadata: { created_at: CREATED_AT } }),
    ),
    http.get(`${API}/flow_definitions/flow_1`, () =>
      HttpResponse.json({
        id: "flow_1",
        project_id: "proj_test",
        flow_definition: FLOW,
        created_at: CREATED_AT,
        updated_at: CREATED_AT,
      }),
    ),
    http.get(`${API}/branding/br_1`, () =>
      HttpResponse.json({ id: "br_1", created_at: CREATED_AT, branding: BRANDING }),
    ),
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

describe("release detail", () => {
  it("shows the header, the pinned revisions by kind, and the metadata", async () => {
    server.use(http.get(`${RELEASES_URL}/rel_1`, () => HttpResponse.json(release())));
    servePointers();
    await renderAt("/releases/rel_1");

    expect(await screen.findByRole("heading", { name: "rel_1" })).toBeInTheDocument();
    expect(screen.getByText("active")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy Release ID" })).toBeInTheDocument();

    // One group per kind the release pins, in the design's order, each pointer
    // named by its document rather than its handle.
    const groups = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(groups).toEqual(["Release content", "User schemas", "Login flows", "Branding"]);
    expect(screen.getByRole("button", { name: /^Customer sch_1$/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Default login flow_1$/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Default br_1$/ })).toBeInTheDocument();

    // The metadata card: the message, the abbreviated commit, the author.
    expect(screen.getByText("Add phone_number to human-user")).toBeInTheDocument();
    expect(screen.getByText("4a5b268343")).toBeInTheDocument();
    expect(screen.getByText("user_dev")).toBeInTheDocument();
  });

  it("opens a pointer to show its document", async () => {
    server.use(http.get(`${RELEASES_URL}/rel_1`, () => HttpResponse.json(release())));
    servePointers();
    await renderAt("/releases/rel_1");

    const trigger = await screen.findByRole("button", { name: /^Default login flow_1$/ });
    // Collapsed: the document is not in the tree.
    expect(document.querySelector("pre")).toBeNull();

    await userEvent.click(trigger);

    const region = await screen.findByRole("region", { name: /^Default login flow_1$/ });
    // The viewer tokenises the document into spans, so read the block's text.
    expect(region.querySelector("pre")?.textContent).toContain('"name": "default-login"');
    expect(within(region).getByRole("tab", { name: "YAML" })).toBeInTheDocument();
    expect(within(region).getByText(/Edit the definition locally/)).toBeInTheDocument();
  });

  it("keeps the screen when a pinned revision cannot be read", async () => {
    serveDeployments();
    server.use(
      http.get(`${RELEASES_URL}/rel_1`, () =>
        HttpResponse.json(
          release({
            pointers: [{ kind: "schema", handle: "human-user", revision_id: "sch_gone" }],
          }),
        ),
      ),
      http.get(`${API}/schemas/sch_gone`, () =>
        HttpResponse.json(
          { code: "schema.not_found", message: "Schema not found" },
          { status: 404 },
        ),
      ),
    );
    await renderAt("/releases/rel_1");

    // The handle stands in for the name the document would have given.
    const trigger = await screen.findByRole("button", { name: /^Human user sch_gone$/ });
    await userEvent.click(trigger);
    expect(
      await screen.findByText("This revision could not be read, so its document cannot be shown."),
    ).toBeInTheDocument();
  });

  it("marks a revoked release", async () => {
    server.use(
      http.get(`${RELEASES_URL}/rel_1`, () =>
        HttpResponse.json(release({ revoked_at: "2026-08-01T00:00:00Z" })),
      ),
    );
    servePointers();
    await renderAt("/releases/rel_1");

    await screen.findByRole("heading", { name: "rel_1" });
    expect(screen.getByText("Revoked")).toBeInTheDocument();
    expect(screen.queryByText("active")).not.toBeInTheDocument();
  });

  it("lists where the release went, marking what is still served", async () => {
    server.use(http.get(`${RELEASES_URL}/rel_1`, () => HttpResponse.json(release())));
    servePointers();
    const preview = deployment("dep_2", {
      targets: [{ origin: "https://acme-k3x9v2.vercel.app", expires_at: "2026-10-09T14:52:00Z" }],
      deployed_at: "2026-10-03T09:00:00Z",
    });
    // The history holds both and another release's deployment, which the
    // card leaves out; the live view holds only the preview, so the primary
    // deployment has since been replaced.
    const other = deployment("dep_9", { release_id: "rel_2" });
    serveDeployments([preview, deployment("dep_1"), other], [preview, other]);
    await renderAt("/releases/rel_1");

    const card = (await screen.findByText("Deployment of this release")).closest(
      "[data-slot=card]",
    ) as HTMLElement;
    const rows = within(card).getAllByRole("list");
    expect(rows).toHaveLength(2);

    // Newest first: the preview, still served.
    expect(within(card).getByText("Preview")).toBeInTheDocument();
    expect(within(card).getByText("active")).toBeInTheDocument();
    expect(
      within(card).getByRole("link", { name: "https://acme-k3x9v2.vercel.app" }),
    ).toHaveAttribute("href", "https://acme-k3x9v2.vercel.app");
    // Then the primary deployment, superseded, with each origin it named.
    expect(within(card).getByText("Primary")).toBeInTheDocument();
    expect(within(card).getByText("Superseded")).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: "https://app.acme.com" })).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: "https://www.acme.com" })).toBeInTheDocument();
    expect(within(card).getByText(formatDateTime(DEPLOYED_AT))).toBeInTheDocument();
  });

  it("says when the release has not been deployed", async () => {
    server.use(http.get(`${RELEASES_URL}/rel_1`, () => HttpResponse.json(release())));
    servePointers();
    await renderAt("/releases/rel_1");

    expect(await screen.findByText("This release has not been deployed.")).toBeInTheDocument();
  });

  it("keeps the release while the server does not list deployments", async () => {
    server.use(http.get(`${RELEASES_URL}/rel_1`, () => HttpResponse.json(release())));
    servePointers();
    server.use(
      http.get(DEPLOYMENTS_URL, () =>
        HttpResponse.json({ code: "not_implemented", message: "" }, { status: 501 }),
      ),
    );
    await renderAt("/releases/rel_1");

    await screen.findByRole("heading", { name: "rel_1" });
    expect(screen.getByText("This server does not list deployments yet.")).toBeInTheDocument();
    expect(screen.queryByText("This release has not been deployed.")).not.toBeInTheDocument();
  });

  it("reads every page of the history for the release's own deployments", async () => {
    server.use(http.get(`${RELEASES_URL}/rel_1`, () => HttpResponse.json(release())));
    servePointers();
    // The release's second deployment sits on the second page of the
    // project's history, behind one of another release.
    server.use(
      http.get(DEPLOYMENTS_URL, ({ request }) => {
        const url = new URL(request.url);
        if (url.searchParams.get("live") === "true") return HttpResponse.json({ deployments: [] });
        return url.searchParams.get("page_token") === "next"
          ? HttpResponse.json({ deployments: [deployment("dep_2")] })
          : HttpResponse.json({
              deployments: [deployment("dep_9", { release_id: "rel_2" })],
              next_page_token: "next",
            });
      }),
    );
    await renderAt("/releases/rel_1");

    const card = (await screen.findByText("Deployment of this release")).closest(
      "[data-slot=card]",
    ) as HTMLElement;
    expect(within(card).getAllByRole("list")).toHaveLength(1);
    expect(within(card).getByRole("link", { name: "https://app.acme.com" })).toBeInTheDocument();
  });

  it("names the selected project on every read", async () => {
    const seen: string[] = [];
    server.use(
      http.get(DEPLOYMENTS_URL, ({ request }) => {
        const url = new URL(request.url);
        seen.push(
          `deployments${url.searchParams.get("live") === "true" ? " live" : ""}:${url.searchParams.get("project_id")}`,
        );
        return HttpResponse.json({ deployments: [] });
      }),
      http.get(`${RELEASES_URL}/rel_1`, ({ request }) => {
        seen.push(`release:${new URL(request.url).searchParams.get("project_id")}`);
        return HttpResponse.json(
          release({
            pointers: [{ kind: "schema", handle: "human-user", revision_id: "sch_1" }],
          }),
        );
      }),
      http.get(`${API}/schemas/sch_1`, ({ request }) => {
        seen.push(`schema:${new URL(request.url).searchParams.get("project_id")}`);
        return HttpResponse.json({
          id: "sch_1",
          schema: SCHEMA,
          metadata: { created_at: CREATED_AT },
        });
      }),
    );
    await renderAt("/releases/rel_1");
    await screen.findByRole("heading", { name: "rel_1" });
    expect(seen.sort()).toEqual([
      "deployments live:proj_test",
      "deployments:proj_test",
      "release:proj_test",
      "schema:proj_test",
    ]);
  });
});
