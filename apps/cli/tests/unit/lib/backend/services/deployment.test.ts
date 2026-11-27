import type { ListDeployments200DeploymentsItem } from "@zitadel/api/generated/model";
import { HttpResponse, http } from "msw";
import type { SetupServer } from "msw/node";
import { describe, expect } from "vitest";

import { it } from "@tests/fixtures";
import { rejectionOf } from "@tests/helpers/thrown-value";

import { ForbiddenError } from "@/lib/backend/errors";
import { Deployment, DeploymentService } from "@/lib/backend/services/deployment";
import { allowDestructive, createZitadelClient } from "@/lib/backend";
import { ZitadelError } from "@/lib/errors";
import { answering, answeringPages, refusal, testClient } from "@tests/helpers/api-answers";
import { PRIMARY_ORIGIN } from "@tests/helpers/records";

/** A server a cancelled run is pointed at. */
const CANCEL_SERVER = "http://localhost:8080";

/** A deployment record as the API answers one, with only what a test varies. */
function record(
  id: string,
  targets: readonly { origin: string }[],
  extra: {
    reason?: "deploy" | "rollback";
    kind?: "primary" | "preview";
    status?: "live" | "inactive";
  } = {},
): ListDeployments200DeploymentsItem {
  return {
    id,
    project_id: "proj_1",
    release_id: "rel_1",
    kind: extra.kind ?? "primary",
    status: extra.status ?? "live",
    deployed_at: "2026-01-01T00:00:00Z",
    targets,
    metadata: {
      reason: extra.reason ?? "deploy",
    },
  };
}

/** A deployment on a primary origin. */
function primary(id: string, origin = PRIMARY_ORIGIN): ListDeployments200DeploymentsItem {
  return record(id, [{ origin }]);
}

/** A deployment on a preview URL. */
function preview(
  id: string,
  origin = "https://pr-7.preview.acme.com",
): ListDeployments200DeploymentsItem {
  return record(id, [{ origin }], { kind: "preview" });
}

/** A service on a test client bound to `proj_1`. */
function service(): DeploymentService {
  return new DeploymentService(testClient(), "proj_1");
}

/** A service whose listing answers `deployments` on one page. */
function serviceListing(
  server: SetupServer,
  deployments: readonly ListDeployments200DeploymentsItem[],
): DeploymentService {
  answeringPages(server, "listDeployments", { deployments });
  return service();
}

/** The query a request was sent with, as plain fields. */
function queryOf({ url }: { url: URL }): Readonly<Record<string, string>> {
  return Object.fromEntries(url.searchParams);
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

describe("Deployment.kind", () => {
  it.each(["primary", "preview"] as const)("answers the %s kind the API recorded", (kind) => {
    expect(Deployment.of(record("dep_1", [], { kind })).kind).toBe(kind);
  });
});

describe("Deployment.servesLivePreview", () => {
  it.each([
    ["a live preview deployment", "preview", "live", true],
    ["a preview deployment a later one replaced", "preview", "inactive", false],
    ["a primary deployment", "primary", "live", false],
  ] as const)("is %s: %s", (_name, kind, status, expected) => {
    expect(Deployment.of(record("dep_1", [], { kind, status })).servesLivePreview).toBe(expected);
  });
});

describe("Deployment.expiryAmong", () => {
  const FIRST = "https://pr-7.preview.acme.com";
  const SECOND = "https://pr-7-abc.preview.acme.com";
  const SOON = "2026-02-01T00:00:00Z";
  const LATER = "2026-02-08T00:00:00Z";

  it("answers the expiry of the preview a live deployment made", () => {
    const deployment = Deployment.of(preview("dep_1", FIRST));

    expect(deployment.expiryAmong(new Map([[FIRST, SOON]]))).toBe(SOON);
  });

  it("answers nothing for a primary deployment whose origin is also a live preview", () => {
    const deployment = Deployment.of(primary("dep_1", FIRST));

    expect(deployment.expiryAmong(new Map([[FIRST, SOON]]))).toBe("");
  });

  it("answers nothing for a preview deployment a later one replaced", () => {
    const deployment = Deployment.of(
      record("dep_1", [{ origin: FIRST }], { kind: "preview", status: "inactive" }),
    );

    expect(deployment.expiryAmong(new Map([[FIRST, SOON]]))).toBe("");
  });

  it("answers nothing when its preview is gone", () => {
    const deployment = Deployment.of(preview("dep_1", FIRST));

    expect(deployment.expiryAmong(new Map())).toBe("");
  });

  it("answers the earliest expiry when it made several previews", () => {
    const deployment = Deployment.of(
      record("dep_1", [{ origin: FIRST }, { origin: SECOND }], { kind: "preview" }),
    );

    expect(
      deployment.expiryAmong(
        new Map([
          [FIRST, LATER],
          [SECOND, SOON],
        ]),
      ),
    ).toBe(SOON);
  });

  it("skips an origin whose preview is gone when it made several", () => {
    const deployment = Deployment.of(
      record("dep_1", [{ origin: FIRST }, { origin: SECOND }], { kind: "preview" }),
    );

    expect(deployment.expiryAmong(new Map([[SECOND, LATER]]))).toBe(LATER);
  });
});

describe("DeploymentService.servingLivePreviews", () => {
  const FIRST = "https://pr-7.preview.acme.com";
  const SECOND = "https://pr-8.preview.acme.com";

  it("narrows a live preview deployment to the origins the live view still serves", async ({
    server,
  }) => {
    const page = [
      Deployment.of(record("dep_1", [{ origin: FIRST }, { origin: SECOND }], { kind: "preview" })),
    ];
    const deploymentService = serviceListing(server, [
      record("dep_2", [{ origin: SECOND }], { kind: "preview" }),
      record("dep_1", [{ origin: FIRST }], { kind: "preview" }),
    ]);

    const serving = await deploymentService.servingLivePreviews(page, false);

    expect(serving.get("dep_1")?.origins).toEqual([FIRST]);
  });

  it("leaves out a deployment the live view no longer lists", async ({ server }) => {
    const page = [Deployment.of(preview("dep_1", FIRST))];
    const deploymentService = serviceListing(server, []);

    const serving = await deploymentService.servingLivePreviews(page, false);

    expect([...serving.keys()]).toEqual([]);
  });

  it("answers only the page's live preview deployments", async ({ server }) => {
    const page = [
      Deployment.of(primary("dep_3")),
      Deployment.of(record("dep_2", [{ origin: SECOND }], { kind: "preview", status: "inactive" })),
      Deployment.of(preview("dep_1", FIRST)),
    ];
    const deploymentService = serviceListing(server, [
      primary("dep_3"),
      record("dep_2", [{ origin: SECOND }], { kind: "preview", status: "inactive" }),
      preview("dep_1", FIRST),
    ]);

    const serving = await deploymentService.servingLivePreviews(page, false);

    expect([...serving.keys()]).toEqual(["dep_1"]);
  });

  it("finds a deployment on a later page of the live view", async ({ server }) => {
    const page = [Deployment.of(preview("dep_1", FIRST))];
    answeringPages(
      server,
      "listDeployments",
      { deployments: [preview("dep_2", SECOND)] },
      { deployments: [preview("dep_1", FIRST)] },
    );

    const serving = await service().servingLivePreviews(page, false);

    expect([...serving.keys()]).toEqual(["dep_1"]);
  });

  it("stops reading once every deployment it was asked for is found", async ({ server }) => {
    const page = [Deployment.of(preview("dep_1", FIRST))];
    const reads = answeringPages(
      server,
      "listDeployments",
      { deployments: [preview("dep_1", FIRST)] },
      { deployments: [preview("dep_2", SECOND)] },
    );

    await service().servingLivePreviews(page, false);

    expect(reads).toHaveLength(1);
  });

  it("asks for the live view at the largest page the API gives", async ({ server }) => {
    const page = [Deployment.of(preview("dep_1", FIRST))];
    const reads = answeringPages(server, "listDeployments", { deployments: [] });

    await service().servingLivePreviews(page, false);

    expect(reads.map(queryOf)).toEqual([{ project_id: "proj_1", live: "true", limit: "100" }]);
  });

  it("reads nothing for a page with no live preview deployment", async () => {
    const page = [Deployment.of(primary("dep_1"))];

    const serving = await service().servingLivePreviews(page, false);

    expect([...serving.keys()]).toEqual([]);
  });

  it("reads nothing when the page is the live view", async () => {
    const page = [Deployment.of(preview("dep_1", FIRST))];

    const serving = await service().servingLivePreviews(page, true);

    expect(serving.get("dep_1")?.origins).toEqual([FIRST]);
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
  it("lists the project it is bound to, narrowed by the query", async ({ server }) => {
    const reads = answeringPages(server, "listDeployments", { deployments: [] });

    await service().list({ live: true });

    expect(reads.map(queryOf)).toEqual([{ project_id: "proj_1", live: "true" }]);
  });
});

describe("DeploymentService.page", () => {
  it("reads one page and the cursor to the next", async ({ server }) => {
    answeringPages(
      server,
      "listDeployments",
      { deployments: [primary("dep_2")] },
      { deployments: [primary("dep_1")] },
    );

    const page = await service().page();

    expect(page.items.map((deployment) => deployment.id)).toEqual(["dep_2"]);
    expect(page.next).toBe("page-1");
  });

  it("drains every page when asked for all of them", async ({ server }) => {
    answeringPages(
      server,
      "listDeployments",
      { deployments: [primary("dep_2")] },
      { deployments: [primary("dep_1")] },
    );

    const page = await service().page({}, { all: true });

    expect(page.items.map((deployment) => deployment.id)).toEqual(["dep_2", "dep_1"]);
    expect(page.next).toBeNull();
  });

  it("sends the query without the paging option the server does not take", async ({ server }) => {
    const reads = answeringPages(server, "listDeployments", { deployments: [] });

    await service().page({ limit: 5 }, { all: true });

    expect(reads.map(queryOf)).toEqual([{ project_id: "proj_1", limit: "5" }]);
  });
});

describe("DeploymentService.get", () => {
  it("answers the deployment the project holds", async ({ server }) => {
    answering(server, "getDeployment", primary("dep_1"));

    await expect(service().get("dep_1")).resolves.toMatchObject({ id: "dep_1" });
  });

  it("reads it for the project it is bound to", async ({ server }) => {
    const reads = answering(server, "getDeployment", primary("dep_1"));

    await service().get("dep_1");

    expect(reads.map((sent) => [sent.params.deployment_id, queryOf(sent)])).toEqual([
      ["dep_1", { project_id: "proj_1" }],
    ]);
  });

  it("reads no variables, so it takes no permission to read them", async ({ server }) => {
    answering(server, "getDeployment", primary("dep_1"));
    const variableReads = answering(server, "listDeploymentVariables", {});

    await service().get("dep_1");

    expect(variableReads).toEqual([]);
  });
});

describe("DeploymentService.variables", () => {
  it("answers a secret as held, without its value", async ({ server }) => {
    answering(server, "listDeploymentVariables", { TOKEN: { secret: true } });

    const [variable] = await service().variables("dep_1");

    expect(variable?.secret).toBe(true);
    expect(variable?.value).toBeUndefined();
  });
});

describe("DeploymentService.primary", () => {
  it("leaves out a live preview, which never serves a primary origin", async ({ server }) => {
    const deploymentService = serviceListing(server, [preview("dep_2"), primary("dep_1")]);

    const deployments = await deploymentService.primary();

    expect(deployments.map((deployment) => deployment.id)).toEqual(["dep_1"]);
  });

  it("reads the live ones, which is not a filter a caller can disagree with", async ({
    server,
  }) => {
    const reads = answeringPages(server, "listDeployments", { deployments: [] });

    await service().primary({ origin: "https://app.test" });

    expect(reads.map(queryOf)).toEqual([
      {
        project_id: "proj_1",
        origin: "https://app.test",
        live: "true",
      },
    ]);
  });
});

describe("DeploymentService.newestPrimary", () => {
  it("answers the first primary deployment the server listed", async ({ server }) => {
    const deploymentService = serviceListing(server, [
      preview("dep_3"),
      primary("dep_2"),
      primary("dep_1"),
    ]);

    await expect(deploymentService.newestPrimary()).resolves.toMatchObject({ id: "dep_2" });
  });

  it("answers nothing when only a preview is live", async ({ server }) => {
    const deploymentService = serviceListing(server, [preview("dep_1")]);

    await expect(deploymentService.newestPrimary()).resolves.toBeUndefined();
  });
});

describe("DeploymentService.liveOn", () => {
  it("answers the deployment live on the origin it was given", async ({ server }) => {
    const deploymentService = serviceListing(server, [primary("dep_1")]);

    await expect(deploymentService.liveOn(PRIMARY_ORIGIN)).resolves.toMatchObject({
      outcome: "live",
      deployment: { id: "dep_1" },
    });
  });

  it("answers the project's one live deployment when no origin was named", async ({ server }) => {
    const deploymentService = serviceListing(server, [primary("dep_1")]);

    await expect(deploymentService.liveOn()).resolves.toMatchObject({
      outcome: "live",
      deployment: { id: "dep_1" },
    });
  });

  it("names the live origins to choose from when more than one is live", async ({ server }) => {
    const deploymentService = serviceListing(server, [
      primary("dep_2", "https://b.acme.com"),
      primary("dep_1", "https://a.acme.com"),
    ]);

    await expect(deploymentService.liveOn()).resolves.toEqual({
      outcome: "ambiguous",
      origins: ["https://a.acme.com", "https://b.acme.com"],
    });
  });

  it("says nothing is deployed when the project has nothing live", async ({ server }) => {
    const deploymentService = serviceListing(server, []);

    await expect(deploymentService.liveOn()).resolves.toEqual({
      outcome: "nothing-deployed",
      reason: "none",
    });
  });

  it("blames the deploy when the named origin is a primary origin with nothing on it", async ({
    server,
  }) => {
    answering(server, "getProject", {
      origins: [{ pattern: PRIMARY_ORIGIN, kind: "primary" }],
    });
    const deploymentService = serviceListing(server, []);

    await expect(deploymentService.liveOn(PRIMARY_ORIGIN)).resolves.toEqual({
      outcome: "nothing-deployed",
      reason: "primary",
    });
  });

  it("blames the pull-request build when the named origin is a preview pattern", async ({
    server,
  }) => {
    answering(server, "getProject", {
      origins: [{ pattern: "https://*.preview.acme.com", kind: "preview" }],
    });
    const deploymentService = serviceListing(server, []);

    await expect(deploymentService.liveOn("https://pr-7.preview.acme.com")).resolves.toEqual({
      outcome: "nothing-deployed",
      reason: "preview",
    });
  });

  it("says the origin is not the project's when no pattern covers it", async ({ server }) => {
    answering(server, "getProject", {
      origins: [{ pattern: PRIMARY_ORIGIN, kind: "primary" }],
    });
    const deploymentService = serviceListing(server, []);

    await expect(deploymentService.liveOn("https://typo.acme.com")).resolves.toEqual({
      outcome: "nothing-deployed",
      reason: "unknown-origin",
    });
  });
});

describe("DeploymentService.create", () => {
  it("sends the input as given for the project it is bound to", async ({ server }) => {
    const writes = answering(server, "createDeployment", primary("dep_1"));
    const input = { release_id: "rel_1", targets: ["primary" as const] };

    await service().create(input);

    expect(writes.map((sent) => [sent.body, queryOf(sent)])).toEqual([
      [input, { project_id: "proj_1" }],
    ]);
  });
});

describe("DeploymentService.rollback", () => {
  /** A service on a test client that may roll back, bound to `proj_1`. */
  function rollingBack(): DeploymentService {
    return new DeploymentService(allowDestructive(testClient()), "proj_1");
  }

  it("sends the options as given, with the project as the scope", async ({ server }) => {
    const writes = answering(server, "rollbackDeployment", primary("dep_2"));

    await rollingBack().rollback("dep_1", { message: "undo" });

    expect(writes.map((sent) => [sent.params.deployment_id, queryOf(sent), sent.body])).toEqual([
      ["dep_1", { project_id: "proj_1" }, { message: "undo" }],
    ]);
  });

  it("sends an empty body when it carries nothing", async ({ server }) => {
    const writes = answering(server, "rollbackDeployment", primary("dep_2"));

    await rollingBack().rollback("dep_1");

    expect(writes.map((sent) => [sent.params.deployment_id, queryOf(sent), sent.body])).toEqual([
      ["dep_1", { project_id: "proj_1" }, {}],
    ]);
  });
});

describe("DeploymentService.deployToPrimary", () => {
  it("guards on the newest primary deployment, as the server compares", async ({ server }) => {
    answeringPages(server, "listDeployments", { deployments: [primary("dep_1")] });
    const writes = answering(server, "createDeployment", primary("dep_2"));

    await service().deployToPrimary({
      releaseId: "rel_2",
      message: "ship",
    });

    expect(writes.map((sent) => [sent.body, queryOf(sent)])).toEqual([
      [
        {
          release_id: "rel_2",
          targets: "primary",
          message: "ship",
          expected_deployment_id: "dep_1",
        },
        { project_id: "proj_1" },
      ],
    ]);
  });

  it("sends no guard on a project's first deploy, where nothing is live", async ({ server }) => {
    answeringPages(server, "listDeployments", { deployments: [] });
    const writes = answering(server, "createDeployment", primary("dep_1"));

    await service().deployToPrimary({
      releaseId: "rel_1",
    });

    expect(writes.map((sent) => [sent.body, queryOf(sent)])).toEqual([
      [{ release_id: "rel_1", targets: "primary" }, { project_id: "proj_1" }],
    ]);
  });

  it("never guards on a live preview, which lands on no primary origin", async ({ server }) => {
    answeringPages(server, "listDeployments", { deployments: [preview("dep_1")] });
    const writes = answering(server, "createDeployment", primary("dep_2"));

    await service().deployToPrimary({
      releaseId: "rel_2",
    });

    expect(writes.map((sent) => [sent.body, queryOf(sent)])).toEqual([
      [{ release_id: "rel_2", targets: "primary" }, { project_id: "proj_1" }],
    ]);
  });

  it("answers the deployment it wrote", async ({ server }) => {
    answeringPages(server, "listDeployments", { deployments: [] });
    answering(server, "createDeployment", primary("dep_1"));

    await expect(service().deployToPrimary({ releaseId: "rel_1" })).resolves.toMatchObject({
      outcome: "deployed",
      deployment: { id: "dep_1" },
    });
  });

  it("reports a revoked release, which trying again would fail the same way", async ({
    server,
  }) => {
    answeringPages(server, "listDeployments", { deployments: [] });
    answering(server, "createDeployment", refusal(409, "rel.revoked"));

    await expect(service().deployToPrimary({ releaseId: "rel_1" })).resolves.toEqual({
      outcome: "revoked",
    });
  });

  it("reports a race, with the deployment that landed first", async ({ server }) => {
    answeringPages(server, "listDeployments", { deployments: [primary("dep_9")] });
    answering(server, "createDeployment", refusal(409, "dep.conflict"));

    await expect(service().deployToPrimary({ releaseId: "rel_1" })).resolves.toMatchObject({
      outcome: "raced",
      current: { id: "dep_9" },
    });
  });

  it("reports a race with nothing current when the guard's deployment is gone", async ({
    server,
  }) => {
    answeringPages(server, "listDeployments", { deployments: [] });
    answering(server, "createDeployment", refusal(409, "dep.conflict"));

    await expect(service().deployToPrimary({ releaseId: "rel_1" })).resolves.toEqual({
      outcome: "raced",
      current: undefined,
    });
  });

  it("still reports the race when the deployment that won it cannot be read", async ({
    server,
  }) => {
    const reads = { count: 0 };
    answering(server, "listDeployments", () => {
      reads.count += 1;
      return reads.count === 1
        ? { deployments: [] }
        : refusal(403, "dep.permission_denied", "the token may not list deployments");
    });
    answering(server, "createDeployment", refusal(409, "dep.conflict"));

    await expect(service().deployToPrimary({ releaseId: "rel_1" })).resolves.toEqual({
      outcome: "raced",
      current: undefined,
    });
  });

  it("raises any failure that is neither of those outcomes", async ({ server }) => {
    answeringPages(server, "listDeployments", { deployments: [] });
    answering(server, "createDeployment", refusal(403, "dep.permission_denied"));

    expect(
      await rejectionOf(() => service().deployToPrimary({ releaseId: "rel_1" })),
    ).toBeInstanceOf(ForbiddenError);
  });
});

describe("DeploymentService.extendPrimary", () => {
  it("deploys the newest primary release again, guarded on that deployment", async ({ server }) => {
    answeringPages(server, "listDeployments", {
      deployments: [primary("dep_1", "http://localhost:3000")],
    });
    const writes = answering(server, "createDeployment", primary("dep_2", "http://localhost:3101"));

    await service().extendPrimary("http://localhost:3101", "moved");

    expect(writes.map((sent) => [sent.body, queryOf(sent)])).toEqual([
      [
        {
          release_id: "rel_1",
          targets: "primary",
          message: "moved",
          expected_deployment_id: "dep_1",
        },
        { project_id: "proj_1" },
      ],
    ]);
  });

  it("answers the deployment it wrote", async ({ server }) => {
    answeringPages(server, "listDeployments", {
      deployments: [primary("dep_1", "http://localhost:3000")],
    });
    answering(server, "createDeployment", primary("dep_2", "http://localhost:3101"));

    await expect(service().extendPrimary("http://localhost:3101", "moved")).resolves.toMatchObject({
      outcome: "deployed",
      deployment: { id: "dep_2" },
    });
  });

  it("deploys nothing when the newest primary deployment already names the origin", async ({
    server,
  }) => {
    answeringPages(server, "listDeployments", {
      deployments: [primary("dep_1", "http://localhost:3101")],
    });
    const writes = answering(server, "createDeployment", primary("dep_2"));

    const extended = await service().extendPrimary("http://localhost:3101", "moved");

    expect(extended).toEqual({ outcome: "unchanged" });
    expect(writes).toEqual([]);
  });

  it("deploys nothing when the project has no primary deployment", async ({ server }) => {
    answeringPages(server, "listDeployments", { deployments: [preview("dep_1")] });
    const writes = answering(server, "createDeployment", primary("dep_1"));

    const extended = await service().extendPrimary("http://localhost:3101", "moved");

    expect(extended).toEqual({ outcome: "none" });
    expect(writes).toEqual([]);
  });
});

describe("DeploymentService.planRollback", () => {
  it("takes a named deployment as given, with no guard, and reads nothing", async () => {
    await expect(service().planRollback("dep_1")).resolves.toEqual({
      outcome: "target",
      target: { id: "dep_1", expectedDeploymentId: undefined },
    });
  });

  it("re-applies the primary deployment before the latest, guarding on the latest", async ({
    server,
  }) => {
    const deploymentService = serviceListing(server, [
      preview("dep_3"),
      primary("dep_2"),
      primary("dep_1"),
    ]);

    await expect(deploymentService.planRollback()).resolves.toEqual({
      outcome: "target",
      target: { id: "dep_1", expectedDeploymentId: "dep_2" },
    });
  });

  it("says nothing is deployed when no primary deployment exists", async ({ server }) => {
    await expect(serviceListing(server, []).planRollback()).resolves.toEqual({
      outcome: "nothing-deployed",
    });
  });

  it("says nothing is earlier when only one primary deployment exists", async ({ server }) => {
    await expect(serviceListing(server, [primary("dep_1")]).planRollback()).resolves.toEqual({
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

    expect(
      await rejectionOf(() =>
        deploymentService.deployToPrimary({
          releaseId: "rel_1",
        }),
      ),
    ).toBeDefined();
  });
});
