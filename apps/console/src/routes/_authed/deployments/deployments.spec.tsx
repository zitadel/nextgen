import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";
import { ALREADY_LIVE_MESSAGE } from "@/components/deploy-sheet";
import { formatDateTime } from "@/lib/date";
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

// Absolute base so requests parse under jsdom/undici and MSW can intercept.
const API = "http://localhost/api/v1";
const DEPLOYMENTS_URL = `${API}/deployments`;
const RELEASES_URL = `${API}/releases`;
const PROJECT_URL = `${API}/projects/proj_test`;

const DEPLOYED_AT = "2026-10-02T14:52:00Z";

/** One entry of `GET /deployments`: a live primary deployment unless told otherwise. */
function deployment(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    project_id: "proj_test",
    release_id: "rel_1",
    kind: "primary",
    targets: [{ origin: "https://app.acme.com" }, { origin: "https://www.acme.com" }],
    status: "live",
    deployed_at: DEPLOYED_AT,
    metadata: { reason: "deploy", message: null, rollback_to: null, deployed_by: null },
    ...overrides,
  };
}

/** `GET /deployments`: the project's history, newest first. */
function serveDeployments(history: unknown[] = []) {
  server.use(
    http.get(DEPLOYMENTS_URL, ({ request }) => HttpResponse.json(liveOrAll(request, history))),
  );
}

/** `GET /deployments?live=true` answers the live deployments only, as the server does. */
function liveOrAll(request: Request, history: unknown[]) {
  const live = new URL(request.url).searchParams.get("live") === "true";
  return {
    deployments: live
      ? history.filter((entry) => (entry as { status: string }).status === "live")
      : history,
  };
}

/** One entry of `GET /releases`. */
function releaseSummary(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    project_id: "proj_test",
    content_hash: `sha256:${"0".repeat(64)}`,
    metadata: {
      message: "Add phone_number to human-user",
      git_sha: null,
      git_dirty: false,
      created_at: DEPLOYED_AT,
      created_by: null,
      created_by_type: "service",
    },
    revoked_at: null,
    ...overrides,
  };
}

/** `GET /projects/{id}`, with the origins the drawer lists. */
function serveProject(origins: { pattern: string; kind: string }[]) {
  server.use(
    http.get(PROJECT_URL, () =>
      HttpResponse.json({
        id: "proj_test",
        name: "Test project",
        origins,
        created_at: DEPLOYED_AT,
        updated_at: DEPLOYED_AT,
      }),
    ),
  );
}

async function renderAt(path: string) {
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
      kind: "preview",
      targets: [{ origin: "https://acme-k3x9v2.vercel.app", expires_at: "2026-10-09T14:52:00Z" }],
      deployed_at: "2026-10-03T09:00:00Z",
    });
    serveDeployments([preview, deployment("dep_1", { status: "inactive" })]);
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
    // The origins are counted, with the kind under the count.
    expect(first.getByRole("button", { name: "1 origin" })).toBeInTheDocument();
    expect(first.getByText("Preview")).toBeInTheDocument();
    expect(first.getByText("live")).toBeInTheDocument();

    const second = within(secondRow);
    expect(second.getByRole("link", { name: "rel_1" })).toBeInTheDocument();
    expect(second.getByText("Primary")).toBeInTheDocument();
    expect(second.getByText("inactive")).toBeInTheDocument();
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

  it("scopes the read to the selected project", async () => {
    const seen: string[] = [];
    server.use(
      http.get(DEPLOYMENTS_URL, ({ request }) => {
        seen.push(new URL(request.url).searchParams.get("project_id") ?? "");
        return HttpResponse.json({ deployments: [] });
      }),
    );
    await renderAt("/deployments");
    await screen.findByText("This project has no deployments.");
    expect(seen).not.toHaveLength(0);
    expect(new Set(seen)).toEqual(new Set(["proj_test"]));
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

      expect(await screen.findByRole("heading", { name: "No access" })).toBeInTheDocument();
      expect(screen.queryByText("This project has no deployments.")).not.toBeInTheDocument();
    } finally {
      errorSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });
});

describe("new deployment", () => {
  const ORIGINS = [
    { pattern: "https://app.acme.com", kind: "primary" },
    { pattern: "https://*.preview.acme.com", kind: "preview" },
  ];

  it("deploys a picked release to the primary origins and lists the record", async () => {
    // `rel_3` is live on the primary origins; it can be picked again.
    const history: unknown[] = [deployment("dep_live", { release_id: "rel_3" })];
    let posted: { projectId: string | null; body: unknown } | undefined;
    serveDeployments(history);
    serveProject(ORIGINS);
    server.use(
      http.get(RELEASES_URL, () =>
        HttpResponse.json({
          releases: [
            releaseSummary("rel_3"),
            releaseSummary("rel_2"),
            releaseSummary("rel_1", { revoked_at: "2026-10-01T00:00:00Z" }),
          ],
        }),
      ),
      http.post(DEPLOYMENTS_URL, async ({ request }) => {
        posted = {
          projectId: new URL(request.url).searchParams.get("project_id"),
          body: await request.json(),
        };
        history.unshift(deployment("dep_new", { release_id: "rel_2" }));
        return HttpResponse.json(deployment("dep_new", { release_id: "rel_2" }), { status: 201 });
      }),
    );
    await renderAt("/deployments");

    await userEvent.click(await screen.findByRole("button", { name: "New deployment" }));
    const drawer = await screen.findByRole("dialog", { name: "Deploy release" });
    const inDrawer = within(drawer);
    // The card lists the primary origins only: that is what `primary` resolves to.
    expect(await inDrawer.findByRole("link", { name: "https://app.acme.com" })).toHaveAttribute(
      "href",
      "https://app.acme.com",
    );
    expect(inDrawer.queryByText("https://*.preview.acme.com")).not.toBeInTheDocument();
    expect(inDrawer.getByRole("radio", { name: /Primary/ })).toBeChecked();

    const submit = inDrawer.getByRole("button", { name: "Deploy release" });
    expect(submit).toBeDisabled();

    // The picker hides the revoked release and keeps the one the origins serve.
    await userEvent.click(inDrawer.getByRole("combobox", { name: "Release" }));
    const listbox = await screen.findByRole("listbox");
    expect(within(listbox).queryByRole("option", { name: "rel_1" })).not.toBeInTheDocument();
    expect(within(listbox).getByRole("option", { name: "rel_3" })).toBeInTheDocument();
    await userEvent.click(within(listbox).getByRole("option", { name: "rel_2" }));
    await userEvent.type(inDrawer.getByLabelText("Message"), "Ship it");
    await userEvent.click(submit);

    expect(await screen.findByText("Release deployed")).toBeInTheDocument();
    expect(posted).toEqual({
      projectId: "proj_test",
      body: {
        release_id: "rel_2",
        targets: "primary",
        message: "Ship it",
        expected_deployment_id: "dep_live",
      },
    });
    // The drawer closes and the list reads again, so the record is a row.
    expect(screen.queryByRole("dialog", { name: "Deploy release" })).not.toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "rel_2" })).toBeInTheDocument();
  });

  it("says so when the picked release was already live and nothing was written", async () => {
    const live = deployment("dep_live", { release_id: "rel_2" });
    serveDeployments([live]);
    serveProject(ORIGINS);
    let posted: unknown;
    server.use(
      http.get(RELEASES_URL, () => HttpResponse.json({ releases: [releaseSummary("rel_2")] })),
      http.post(DEPLOYMENTS_URL, async ({ request }) => {
        posted = await request.json();
        // The origins serve it with the same values: the server writes nothing.
        return HttpResponse.json(live, { status: 200 });
      }),
    );
    await renderAt("/deployments");

    await userEvent.click(await screen.findByRole("button", { name: "New deployment" }));
    const drawer = await screen.findByRole("dialog", { name: "Deploy release" });
    const inDrawer = within(drawer);
    await userEvent.click(await inDrawer.findByRole("combobox", { name: "Release" }));
    await userEvent.click(
      within(await screen.findByRole("listbox")).getByRole("option", { name: "rel_2" }),
    );
    await userEvent.click(inDrawer.getByRole("button", { name: "Deploy release" }));

    expect(await screen.findByText(ALREADY_LIVE_MESSAGE)).toBeInTheDocument();
    expect(screen.queryByText("Release deployed")).not.toBeInTheDocument();
    expect(posted).toEqual({
      release_id: "rel_2",
      targets: "primary",
      expected_deployment_id: "dep_live",
    });
    expect(screen.queryByRole("dialog", { name: "Deploy release" })).not.toBeInTheDocument();
  });

  it("says so when the project has no release", async () => {
    serveDeployments();
    serveProject(ORIGINS);
    server.use(http.get(RELEASES_URL, () => HttpResponse.json({ releases: [] })));
    await renderAt("/deployments");

    await userEvent.click(await screen.findByRole("button", { name: "New deployment" }));
    const drawer = await screen.findByRole("dialog", { name: "Deploy release" });
    expect(
      await within(drawer).findByText("This project has no release to deploy."),
    ).toBeInTheDocument();
    expect(within(drawer).getByRole("combobox", { name: "Release" })).toBeDisabled();
    expect(within(drawer).getByRole("button", { name: "Deploy release" })).toBeDisabled();
  });

  it("will not deploy to a project with no primary origin", async () => {
    serveDeployments();
    serveProject([{ pattern: "https://*.preview.acme.com", kind: "preview" }]);
    server.use(
      http.get(RELEASES_URL, () => HttpResponse.json({ releases: [releaseSummary("rel_2")] })),
    );
    await renderAt("/deployments");

    await userEvent.click(await screen.findByRole("button", { name: "New deployment" }));
    const drawer = await screen.findByRole("dialog", { name: "Deploy release" });
    expect(
      await within(drawer).findByText("This project has no primary origin."),
    ).toBeInTheDocument();
    await userEvent.click(within(drawer).getByRole("combobox", { name: "Release" }));
    await userEvent.click(
      within(await screen.findByRole("listbox")).getByRole("option", { name: "rel_2" }),
    );
    expect(within(drawer).getByRole("button", { name: "Deploy release" })).toBeDisabled();
  });

  it("shows the server's refusal in the drawer", async () => {
    serveDeployments();
    serveProject(ORIGINS);
    server.use(
      http.get(RELEASES_URL, () => HttpResponse.json({ releases: [releaseSummary("rel_2")] })),
      http.post(DEPLOYMENTS_URL, () =>
        HttpResponse.json(
          { code: "dep.variables_missing", message: "Variable API_URL has no primary value." },
          { status: 400 },
        ),
      ),
    );
    await renderAt("/deployments");

    await userEvent.click(await screen.findByRole("button", { name: "New deployment" }));
    const drawer = await screen.findByRole("dialog", { name: "Deploy release" });
    await within(drawer).findByRole("link", { name: "https://app.acme.com" });
    await userEvent.click(within(drawer).getByRole("combobox", { name: "Release" }));
    await userEvent.click(
      within(await screen.findByRole("listbox")).getByRole("option", { name: "rel_2" }),
    );
    await userEvent.click(within(drawer).getByRole("button", { name: "Deploy release" }));

    expect(
      await within(drawer).findByText("Variable API_URL has no primary value."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Release deployed")).not.toBeInTheDocument();
  });
});

describe("rollback from a row", () => {
  /** Opens the row's menu and picks `item`. */
  async function pick(rowId: string, item: string) {
    await userEvent.click(await screen.findByRole("button", { name: `Actions for ${rowId}` }));
    await userEvent.click(await screen.findByRole("menuitem", { name: item }));
  }

  it("knows the live release when its row is not on the page", async () => {
    // The page holds a superseded primary row of the live release and no live
    // primary row: previews newer than it fill the page.
    const page = [
      deployment("dep_preview", { kind: "preview", release_id: "rel_1" }),
      deployment("dep_same", { release_id: "rel_2", status: "inactive" }),
    ];
    server.use(
      http.get(DEPLOYMENTS_URL, ({ request }) =>
        HttpResponse.json(
          new URL(request.url).searchParams.get("live") === "true"
            ? { deployments: [deployment("dep_live", { release_id: "rel_2" })] }
            : { deployments: page },
        ),
      ),
    );
    await renderAt("/deployments");

    await userEvent.click(await screen.findByRole("button", { name: "Actions for dep_same" }));
    expect(await screen.findByRole("menuitem", { name: "View release" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Rollback" })).not.toBeInTheDocument();
  });

  it("rolls back to a superseded deployment, naming the live one", async () => {
    serveProject([{ pattern: "https://app.acme.com", kind: "primary" }]);
    const history = [
      deployment("dep_live", { release_id: "rel_2" }),
      deployment("dep_old", { status: "inactive" }),
      // Of the live release: rolling back to it changes nothing, so it is no choice.
      deployment("dep_same", { release_id: "rel_2", status: "inactive" }),
    ];
    let posted: { deploymentId: string; body: unknown } | undefined;
    server.use(
      http.get(DEPLOYMENTS_URL, ({ request }) => {
        const params = new URL(request.url).searchParams;
        // The page carries each release; the live read needs only the ids.
        if (params.get("live") !== "true") expect(params.getAll("expand")).toEqual(["release"]);
        return HttpResponse.json(liveOrAll(request, history));
      }),
      http.post(DEPLOYMENTS_URL.replace(/$/, "/:id/rollback"), async ({ request, params }) => {
        posted = { deploymentId: String(params.id), body: await request.json() };
        history.unshift(
          deployment("dep_new", { metadata: { reason: "rollback", rollback_to: "dep_old" } }),
        );
        history[1] = deployment("dep_live", { release_id: "rel_2", status: "inactive" });
        return HttpResponse.json(history[0], { status: 201 });
      }),
    );
    await renderAt("/deployments");

    // The live release's own earlier deployment offers no rollback.
    await userEvent.click(await screen.findByRole("button", { name: "Actions for dep_same" }));
    expect(await screen.findByRole("menuitem", { name: "View release" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Rollback" })).not.toBeInTheDocument();
    await userEvent.keyboard("{Escape}");

    await pick("dep_old", "Rollback");
    const drawer = await screen.findByRole("dialog", { name: "Rollback deployment" });
    const inDrawer = within(drawer);
    expect(
      await inDrawer.findByRole("radio", {
        name: `rel_1, deployed ${formatDateTime(DEPLOYED_AT)}`,
      }),
    ).toBeChecked();
    expect(inDrawer.queryByRole("radio", { name: /rel_2/ })).not.toBeInTheDocument();
    await userEvent.click(inDrawer.getByRole("button", { name: "Rollback deployment" }));

    expect(await screen.findByText("Deployment rolled back")).toBeInTheDocument();
    expect(posted).toEqual({
      deploymentId: "dep_old",
      body: { expected_deployment_id: "dep_live" },
    });
    // The list reads again: the rollback is the newest row.
    const rows = await screen.findAllByRole("row");
    expect(rows[1]).toHaveTextContent("rel_1");
  });

  it("names a listed origin the restored deployment leaves out", async () => {
    serveProject([
      { pattern: "https://app.acme.com", kind: "primary" },
      { pattern: "https://new.acme.com", kind: "primary" },
    ]);
    serveDeployments([
      deployment("dep_live", {
        release_id: "rel_2",
        targets: [{ origin: "https://app.acme.com" }, { origin: "https://new.acme.com" }],
      }),
      deployment("dep_old", { status: "inactive" }),
    ]);
    await renderAt("/deployments");

    await pick("dep_old", "Rollback");
    const drawer = await screen.findByRole("dialog", { name: "Rollback deployment" });

    expect(
      await within(drawer).findByText(
        "https://new.acme.com will refuse sign-in until the next deploy.",
      ),
    ).toBeInTheDocument();
  });

  it("opens the choice of what to go back to from the live row", async () => {
    serveProject([{ pattern: "https://app.acme.com", kind: "primary" }]);
    serveDeployments([
      deployment("dep_live", { release_id: "rel_2" }),
      deployment("dep_old", { status: "inactive" }),
    ]);
    await renderAt("/deployments");

    await pick("dep_live", "Rollback");
    const drawer = await screen.findByRole("dialog", { name: "Rollback deployment" });
    const inDrawer = within(drawer);
    expect(
      await inDrawer.findByRole("radio", {
        name: `rel_1, deployed ${formatDateTime(DEPLOYED_AT)}`,
      }),
    ).not.toBeChecked();
    expect(inDrawer.getByRole("button", { name: "Rollback deployment" })).toBeDisabled();
  });

  it("offers no rollback on a preview or on a revoked release", async () => {
    serveDeployments([
      deployment("dep_preview", { kind: "preview", status: "inactive" }),
      deployment("dep_revoked", {
        status: "inactive",
        release: releaseSummary("rel_1", { revoked_at: "2026-10-01T00:00:00Z", pointers: [] }),
      }),
    ]);
    await renderAt("/deployments");

    for (const id of ["dep_preview", "dep_revoked"]) {
      await userEvent.click(await screen.findByRole("button", { name: `Actions for ${id}` }));
      expect(await screen.findByRole("menuitem", { name: "View release" })).toBeInTheDocument();
      expect(screen.queryByRole("menuitem", { name: "Rollback" })).not.toBeInTheDocument();
      await userEvent.keyboard("{Escape}");
    }
  });
});

describe("redeploy from a row", () => {
  it("redeploys the row's release to the primary origins", async () => {
    serveDeployments([deployment("dep_old", { status: "inactive" })]);
    serveProject([{ pattern: "https://app.acme.com", kind: "primary" }]);
    let posted: unknown;
    server.use(
      http.post(DEPLOYMENTS_URL, async ({ request }) => {
        posted = await request.json();
        return HttpResponse.json(deployment("dep_new"), { status: 201 });
      }),
    );
    await renderAt("/deployments");

    await userEvent.click(await screen.findByRole("button", { name: "Actions for dep_old" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Redeploy" }));
    const drawer = await screen.findByRole("dialog", { name: "Redeploy release" });
    const inDrawer = within(drawer);
    expect(inDrawer.getByRole("combobox", { name: "Release" })).toHaveTextContent("rel_1");
    await inDrawer.findByRole("link", { name: "https://app.acme.com" });
    await userEvent.type(inDrawer.getByLabelText("Message"), "Again");
    await userEvent.click(inDrawer.getByRole("button", { name: "Redeploy release" }));

    expect(await screen.findByText("Release redeployed")).toBeInTheDocument();
    expect(posted).toEqual({ release_id: "rel_1", targets: "primary", message: "Again" });
  });

  it("offers no redeploy on a preview row", async () => {
    serveDeployments([deployment("dep_preview", { kind: "preview" })]);
    await renderAt("/deployments");

    await userEvent.click(await screen.findByRole("button", { name: "Actions for dep_preview" }));
    expect(await screen.findByRole("menuitem", { name: "View release" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Redeploy" })).not.toBeInTheDocument();
  });
});
