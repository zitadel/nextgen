import type { ListDeployments200DeploymentsItem } from "@zitadel/api/generated/model";
import { HttpResponse, http } from "msw";
import { describe, expect, vi } from "vitest";

import { it } from "@tests/helpers/fixtures";

import { ConflictError, ForbiddenError } from "@/lib/backend/errors";
import { Deployment, DeploymentService } from "@/lib/backend/services/deployment";
import { createZitadelClient } from "@/lib/backend";
import { ZitadelError } from "@/lib/errors";
import { type ClientStubs, fakeClient, pagesOf } from "@tests/helpers/fake-client";

/** A server a cancelled run is pointed at. */
const CANCEL_SERVER = "http://localhost:8080";

/** A deployment record as the API answers one, with only what a test varies. */
function record(
  id: string,
  targets: readonly { origin: string; expires_at?: string }[],
  extra: { reason?: "deploy" | "rollback" } = {},
): ListDeployments200DeploymentsItem {
  return {
    id,
    project_id: "proj_1",
    release_id: "rel_1",
    kind: targets.every((target) => target.expires_at === undefined) ? "primary" : "preview",
    status: "live",
    deployed_at: "2026-01-01T00:00:00Z",
    targets,
    metadata: {
      reason: extra.reason ?? "deploy",
    },
  };
}

/** A deployment on a primary origin, whose target never expires. */
function primary(id: string, origin = "https://app.acme.com"): ListDeployments200DeploymentsItem {
  return record(id, [{ origin }]);
}

/** A deployment on a preview URL, whose target expires. */
function preview(
  id: string,
  origin = "https://pr-7.preview.acme.com",
): ListDeployments200DeploymentsItem {
  return record(id, [{ origin, expires_at: "2030-01-01T00:00:00Z" }]);
}

/** A service whose listing answers `deployments`, plus anything else a test stubs. */
function serviceListing(
  deployments: readonly ListDeployments200DeploymentsItem[],
  stubs: ClientStubs = {},
): DeploymentService {
  return new DeploymentService(
    fakeClient({
      listDeployments: {
        all: async () => deployments,
      },
      ...stubs,
    }),
    "proj_1",
  );
}

describe("Deployment.origins", () => {
  it("names one origin per target", () => {
    expect(
      Deployment.of(
        record("dep_1", [{ origin: "https://a.acme.com" }, { origin: "https://b.acme.com" }]),
      ).origins,
    ).toEqual(["https://a.acme.com", "https://b.acme.com"]);
  });
});

describe("Deployment.servesPrimary", () => {
  it("is true for a deployment with an unexpiring target", () => {
    expect(Deployment.of(primary("dep_1")).servesPrimary).toBe(true);
  });

  it("is false for a preview deployment", () => {
    expect(Deployment.of(preview("dep_1")).servesPrimary).toBe(false);
  });
});

describe("Deployment.reason", () => {
  it("answers the reason the API recorded", () => {
    expect(Deployment.of(record("dep_1", [], { reason: "rollback" })).reason).toBe("rollback");
  });

  it("answers the deploy that made an ordinary deployment", () => {
    expect(Deployment.of(primary("dep_1")).reason).toBe("deploy");
  });
});

describe("Deployment.toJSON", () => {
  it("carries the record the API sent", () => {
    const sent = primary("dep_1");

    expect(Deployment.of(sent).toJSON()).toEqual(sent);
  });
});

describe("DeploymentService.list", () => {
  it("lists the project it is bound to, narrowed by the query", async () => {
    const all = vi.fn(async () => []);
    const deploymentService = new DeploymentService(
      fakeClient({ listDeployments: { all } }),
      "proj_1",
    );

    await deploymentService.list({ live: true });

    expect(all).toHaveBeenCalledWith({ project_id: "proj_1", live: true });
  });
});

describe("DeploymentService.page", () => {
  it("reads one page and the cursor to the next", async () => {
    const deploymentService = new DeploymentService(
      fakeClient({
        listDeployments: {
          pages: () =>
            pagesOf(
              { deployments: [primary("dep_2")], next_page_token: "t2" },
              { deployments: [primary("dep_1")], next_page_token: null },
            ),
        },
      }),
      "proj_1",
    );

    const page = await deploymentService.page();

    expect(page.items.map((deployment) => deployment.id)).toEqual(["dep_2"]);
    expect(page.next).toBe("t2");
  });

  it("drains every page when asked for all of them", async () => {
    const deploymentService = new DeploymentService(
      fakeClient({
        listDeployments: {
          pages: () =>
            pagesOf(
              { deployments: [primary("dep_2")], next_page_token: "t2" },
              { deployments: [primary("dep_1")], next_page_token: null },
            ),
        },
      }),
      "proj_1",
    );

    const page = await deploymentService.page({}, { all: true });

    expect(page.items.map((deployment) => deployment.id)).toEqual(["dep_2", "dep_1"]);
    expect(page.next).toBeNull();
  });

  it("sends the query without the paging option the server does not take", async () => {
    const pages = vi.fn(() => pagesOf({ deployments: [], next_page_token: null }));
    const deploymentService = new DeploymentService(
      fakeClient({ listDeployments: { pages } }),
      "proj_1",
    );

    await deploymentService.page({ limit: 5 }, { all: true });

    expect(pages).toHaveBeenCalledWith({ project_id: "proj_1", limit: 5 });
  });
});

describe("DeploymentService.get", () => {
  it("answers the deployment the project holds", async () => {
    const deploymentService = new DeploymentService(
      fakeClient({
        getDeployment: async () => primary("dep_1"),
      }),
      "proj_1",
    );

    await expect(deploymentService.get("dep_1")).resolves.toMatchObject({ id: "dep_1" });
  });

  it("reads it for the project it is bound to", async () => {
    const getDeployment = vi.fn(async () => primary("dep_1"));
    const deploymentService = new DeploymentService(fakeClient({ getDeployment }), "proj_1");

    await deploymentService.get("dep_1");

    expect(getDeployment).toHaveBeenCalledWith("dep_1", { project_id: "proj_1" });
  });

  it("reads no variables, so it takes no permission to read them", async () => {
    const listDeploymentVariables = vi.fn(async () => ({}));
    const deploymentService = new DeploymentService(
      fakeClient({
        getDeployment: async () => primary("dep_1"),
        listDeploymentVariables,
      }),
      "proj_1",
    );

    await deploymentService.get("dep_1");

    expect(listDeploymentVariables).not.toHaveBeenCalled();
  });
});

describe("DeploymentService.variables", () => {
  it("answers a secret as held, without its value", async () => {
    const deploymentService = new DeploymentService(
      fakeClient({
        listDeploymentVariables: async () => ({ TOKEN: { secret: true } }),
      }),
      "proj_1",
    );

    const [variable] = await deploymentService.variables("dep_1");

    expect(variable?.secret).toBe(true);
    expect(variable?.value).toBeUndefined();
  });
});

describe("DeploymentService.primary", () => {
  it("leaves out a live preview, which never serves a primary origin", async () => {
    const deploymentService = serviceListing([preview("dep_2"), primary("dep_1")]);

    const deployments = await deploymentService.primary();

    expect(deployments.map((deployment) => deployment.id)).toEqual(["dep_1"]);
  });

  it("reads the live ones, which is not a filter a caller can disagree with", async () => {
    const asked: unknown[] = [];
    const deploymentService = new DeploymentService(
      fakeClient({
        listDeployments: {
          all: async (params: unknown) => {
            asked.push(params);
            return [];
          },
        },
      }),
      "proj_1",
    );

    await deploymentService.primary({ origin: "https://app.test" });

    expect(asked).toEqual([
      {
        project_id: "proj_1",
        origin: "https://app.test",
        live: true,
      },
    ]);
  });
});

describe("DeploymentService.newestPrimary", () => {
  it("answers the first primary deployment the server listed", async () => {
    const deploymentService = serviceListing([
      preview("dep_3"),
      primary("dep_2"),
      primary("dep_1"),
    ]);

    await expect(deploymentService.newestPrimary()).resolves.toMatchObject({ id: "dep_2" });
  });

  it("answers nothing when only a preview is live", async () => {
    const deploymentService = serviceListing([preview("dep_1")]);

    await expect(deploymentService.newestPrimary()).resolves.toBeUndefined();
  });
});

describe("DeploymentService.liveOn", () => {
  it("answers the deployment live on the origin it was given", async () => {
    const deploymentService = serviceListing([primary("dep_1")]);

    await expect(deploymentService.liveOn("https://app.acme.com")).resolves.toMatchObject({
      outcome: "live",
      deployment: { id: "dep_1" },
    });
  });

  it("answers the project's one live deployment when no origin was named", async () => {
    const deploymentService = serviceListing([primary("dep_1")]);

    await expect(deploymentService.liveOn()).resolves.toMatchObject({
      outcome: "live",
      deployment: { id: "dep_1" },
    });
  });

  it("names the live origins to choose from when more than one is live", async () => {
    const deploymentService = serviceListing([
      primary("dep_2", "https://b.acme.com"),
      primary("dep_1", "https://a.acme.com"),
    ]);

    await expect(deploymentService.liveOn()).resolves.toEqual({
      outcome: "ambiguous",
      origins: ["https://a.acme.com", "https://b.acme.com"],
    });
  });

  it("says nothing is deployed when the project has nothing live", async () => {
    const deploymentService = serviceListing([]);

    await expect(deploymentService.liveOn()).resolves.toEqual({
      outcome: "nothing-deployed",
      reason: "none",
    });
  });

  it("blames the deploy when the named origin is a primary origin with nothing on it", async () => {
    const deploymentService = serviceListing([], {
      getProject: async () => ({
        origins: [{ pattern: "https://app.acme.com", kind: "primary" }],
      }),
    });

    await expect(deploymentService.liveOn("https://app.acme.com")).resolves.toEqual({
      outcome: "nothing-deployed",
      reason: "primary",
    });
  });

  it("blames the pull-request build when the named origin is a preview pattern", async () => {
    const deploymentService = serviceListing([], {
      getProject: async () => ({
        origins: [{ pattern: "https://*.preview.acme.com", kind: "preview" }],
      }),
    });

    await expect(deploymentService.liveOn("https://pr-7.preview.acme.com")).resolves.toEqual({
      outcome: "nothing-deployed",
      reason: "preview",
    });
  });

  it("says the origin is not the project's when no pattern covers it", async () => {
    const deploymentService = serviceListing([], {
      getProject: async () => ({
        origins: [{ pattern: "https://app.acme.com", kind: "primary" }],
      }),
    });

    await expect(deploymentService.liveOn("https://typo.acme.com")).resolves.toEqual({
      outcome: "nothing-deployed",
      reason: "unknown-origin",
    });
  });
});

describe("DeploymentService.create", () => {
  it("sends the input as given for the project it is bound to", async () => {
    const createDeployment = vi.fn(async () => primary("dep_1"));
    const deploymentService = new DeploymentService(fakeClient({ createDeployment }), "proj_1");
    const input = { release_id: "rel_1", targets: ["primary" as const] };

    await deploymentService.create(input);

    expect(createDeployment).toHaveBeenCalledWith(input, { project_id: "proj_1" });
  });
});

describe("DeploymentService.rollback", () => {
  it("sends the options as given, with the project as the scope", async () => {
    const rollbackDeployment = vi.fn(async () => primary("dep_2"));
    const deploymentService = new DeploymentService(fakeClient({ rollbackDeployment }), "proj_1");

    await deploymentService.rollback("dep_1", { message: "undo" });

    expect(rollbackDeployment).toHaveBeenCalledWith(
      "dep_1",
      { project_id: "proj_1" },
      { message: "undo" },
    );
  });

  it("sends an empty body when it carries nothing", async () => {
    const rollbackDeployment = vi.fn(async () => primary("dep_2"));
    const deploymentService = new DeploymentService(fakeClient({ rollbackDeployment }), "proj_1");

    await deploymentService.rollback("dep_1");

    expect(rollbackDeployment).toHaveBeenCalledWith("dep_1", { project_id: "proj_1" }, {});
  });
});

describe("DeploymentService.deployToPrimary", () => {
  /** A deploy whose write answers `writing`, against `live` already serving. */
  function deployWith(
    live: readonly ListDeployments200DeploymentsItem[],
    writing: () => Promise<ListDeployments200DeploymentsItem>,
  ): DeploymentService {
    return new DeploymentService(
      fakeClient({
        listDeployments: { all: async () => live },
        createDeployment: writing,
      }),
      "proj_1",
    );
  }

  it("guards on the newest primary deployment, as the server compares", async () => {
    const createDeployment = vi.fn(async () => primary("dep_2"));
    const deploymentService = new DeploymentService(
      fakeClient({
        listDeployments: { all: async () => [primary("dep_1")] },
        createDeployment,
      }),
      "proj_1",
    );

    await deploymentService.deployToPrimary({
      releaseId: "rel_2",
      message: "ship",
    });

    expect(createDeployment).toHaveBeenCalledWith(
      {
        release_id: "rel_2",
        targets: "primary",
        message: "ship",
        expected_deployment_id: "dep_1",
      },
      { project_id: "proj_1" },
    );
  });

  it("sends no guard on a project's first deploy, where nothing is live", async () => {
    const createDeployment = vi.fn(async () => primary("dep_1"));
    const deploymentService = new DeploymentService(
      fakeClient({ listDeployments: { all: async () => [] }, createDeployment }),
      "proj_1",
    );

    await deploymentService.deployToPrimary({
      releaseId: "rel_1",
    });

    expect(createDeployment).toHaveBeenCalledWith(
      expect.objectContaining({ expected_deployment_id: undefined }),
      { project_id: "proj_1" },
    );
  });

  it("never guards on a live preview, which lands on no primary origin", async () => {
    const createDeployment = vi.fn(async () => primary("dep_2"));
    const deploymentService = new DeploymentService(
      fakeClient({
        listDeployments: { all: async () => [preview("dep_1")] },
        createDeployment,
      }),
      "proj_1",
    );

    await deploymentService.deployToPrimary({
      releaseId: "rel_2",
    });

    expect(createDeployment).toHaveBeenCalledWith(
      expect.objectContaining({ expected_deployment_id: undefined }),
      { project_id: "proj_1" },
    );
  });

  it("answers the deployment it wrote", async () => {
    const deploymentService = deployWith([], async () => primary("dep_1"));

    await expect(deploymentService.deployToPrimary({ releaseId: "rel_1" })).resolves.toMatchObject({
      outcome: "deployed",
      deployment: { id: "dep_1" },
    });
  });

  it("reports a revoked release, which trying again would fail the same way", async () => {
    const deploymentService = deployWith([], async () => {
      throw new ConflictError("revoked", { status: 409, body: { code: "rel.revoked" } });
    });

    await expect(deploymentService.deployToPrimary({ releaseId: "rel_1" })).resolves.toEqual({
      outcome: "revoked",
    });
  });

  it("reports a race, with the deployment that landed first", async () => {
    const deploymentService = new DeploymentService(
      fakeClient({
        listDeployments: { all: async () => [primary("dep_9")] },
        createDeployment: async () => {
          throw new ConflictError("raced", { status: 409, body: { code: "dep.conflict" } });
        },
      }),
      "proj_1",
    );

    await expect(deploymentService.deployToPrimary({ releaseId: "rel_1" })).resolves.toMatchObject({
      outcome: "raced",
      current: { id: "dep_9" },
    });
  });

  it("reports a race with nothing current when the guard's deployment is gone", async () => {
    const deploymentService = deployWith([], async () => {
      throw new ConflictError("raced", { status: 409, body: { code: "dep.conflict" } });
    });

    await expect(deploymentService.deployToPrimary({ releaseId: "rel_1" })).resolves.toEqual({
      outcome: "raced",
      current: undefined,
    });
  });

  it("still reports the race when the deployment that won it cannot be read", async () => {
    // The guard's own read succeeds; only the one that names the winner, made
    // after the conflict, fails.
    const reads = vi
      .fn<() => Promise<readonly ListDeployments200DeploymentsItem[]>>()
      .mockResolvedValueOnce([])
      .mockRejectedValue(new ForbiddenError("the token may not list deployments", { status: 403 }));
    const deploymentService = new DeploymentService(
      fakeClient({
        listDeployments: { all: reads },
        createDeployment: async () => {
          throw new ConflictError("raced", { status: 409, body: { code: "dep.conflict" } });
        },
      }),
      "proj_1",
    );

    // The conflict is what the caller acts on; the winner's id is only the
    // report, so losing it must not replace the outcome with an error.
    await expect(deploymentService.deployToPrimary({ releaseId: "rel_1" })).resolves.toEqual({
      outcome: "raced",
      current: undefined,
    });
  });

  it("raises any failure that is neither of those outcomes", async () => {
    const deploymentService = deployWith([], async () => {
      throw new Error("boom");
    });

    await expect(deploymentService.deployToPrimary({ releaseId: "rel_1" })).rejects.toThrow("boom");
  });
});

describe("DeploymentService.extendPrimary", () => {
  it("deploys the newest primary release again, guarded on that deployment", async () => {
    const createDeployment = vi.fn(async () => primary("dep_2", "http://localhost:3101"));
    const deploymentService = new DeploymentService(
      fakeClient({
        listDeployments: { all: async () => [primary("dep_1", "http://localhost:3000")] },
        createDeployment,
      }),
      "proj_1",
    );

    await deploymentService.extendPrimary("http://localhost:3101", "moved");

    expect(createDeployment).toHaveBeenCalledWith(
      {
        release_id: "rel_1",
        targets: "primary",
        message: "moved",
        expected_deployment_id: "dep_1",
      },
      { project_id: "proj_1" },
    );
  });

  it("answers the deployment it wrote", async () => {
    const deploymentService = new DeploymentService(
      fakeClient({
        listDeployments: { all: async () => [primary("dep_1", "http://localhost:3000")] },
        createDeployment: async () => primary("dep_2", "http://localhost:3101"),
      }),
      "proj_1",
    );

    await expect(
      deploymentService.extendPrimary("http://localhost:3101", "moved"),
    ).resolves.toMatchObject({ outcome: "deployed", deployment: { id: "dep_2" } });
  });

  it("deploys nothing when the newest primary deployment already names the origin", async () => {
    const createDeployment = vi.fn(async () => primary("dep_2"));
    const deploymentService = new DeploymentService(
      fakeClient({
        listDeployments: { all: async () => [primary("dep_1", "http://localhost:3101")] },
        createDeployment,
      }),
      "proj_1",
    );

    const extended = await deploymentService.extendPrimary("http://localhost:3101", "moved");

    expect(extended).toEqual({ outcome: "unchanged" });
    expect(createDeployment).not.toHaveBeenCalled();
  });

  it("deploys nothing when the project has no primary deployment", async () => {
    const createDeployment = vi.fn(async () => primary("dep_1"));
    const deploymentService = new DeploymentService(
      fakeClient({ listDeployments: { all: async () => [preview("dep_1")] }, createDeployment }),
      "proj_1",
    );

    const extended = await deploymentService.extendPrimary("http://localhost:3101", "moved");

    expect(extended).toEqual({ outcome: "none" });
    expect(createDeployment).not.toHaveBeenCalled();
  });
});

describe("DeploymentService.planRollback", () => {
  it("takes a named deployment as given, with no guard, and reads nothing", async () => {
    await expect(serviceListing([]).planRollback("dep_1")).resolves.toEqual({
      outcome: "target",
      target: { id: "dep_1", expectedDeploymentId: undefined },
    });
  });

  it("re-applies the primary deployment before the latest, guarding on the latest", async () => {
    const deploymentService = serviceListing([
      preview("dep_3"),
      primary("dep_2"),
      primary("dep_1"),
    ]);

    await expect(deploymentService.planRollback()).resolves.toEqual({
      outcome: "target",
      target: { id: "dep_1", expectedDeploymentId: "dep_2" },
    });
  });

  it("says nothing is deployed when no primary deployment exists", async () => {
    await expect(serviceListing([]).planRollback()).resolves.toEqual({
      outcome: "nothing-deployed",
    });
  });

  it("says nothing is earlier when only one primary deployment exists", async () => {
    await expect(serviceListing([primary("dep_1")]).planRollback()).resolves.toEqual({
      outcome: "nothing-earlier",
    });
  });
});

describe("DeploymentService.deployToPrimary when the run is cancelled", () => {
  it("throws the cancellation instead of answering a race it cannot name", async ({ server }) => {
    // The deploy lost a race, and the read that names the winner is cut off by
    // Ctrl-C. Nothing was deployed, so there is no outcome worth reporting.
    const controller = new AbortController();
    const cancelled = new ZitadelError("E_CANCELLED", "Cancelled.");
    const reads = { count: 0 };
    server.use(
      // The first read is the guard this deploy sends; the second names the
      // deployment that won the race, and is the one Ctrl-C cuts off.
      http.get(`${CANCEL_SERVER}/api/v1/deployments`, () => {
        reads.count += 1;
        if (reads.count === 1) {
          return HttpResponse.json({ deployments: [] });
        }
        controller.abort(cancelled);
        return HttpResponse.error();
      }),
      http.post(`${CANCEL_SERVER}/api/v1/deployments`, () => {
        return HttpResponse.json({ code: "dep.conflict", message: "raced" }, { status: 409 });
      }),
    );
    const deploymentService = new DeploymentService(
      createZitadelClient({
        baseUrl: CANCEL_SERVER,
        signal: controller.signal,
      }),
      "proj_1",
    );

    await expect(
      deploymentService.deployToPrimary({
        releaseId: "rel_1",
      }),
    ).rejects.toBeDefined();
  });
});
