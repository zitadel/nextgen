import type { ListDeployments200DeploymentsItem } from "@zitadel/api/generated/model";
import type { SetupServer } from "msw/node";
import { afterEach, describe, expect, vi } from "vitest";

import { createZitadelClient, type ZitadelClient } from "@/lib/backend";
import { ConflictError } from "@/lib/backend/errors";
import { Deployment } from "@/lib/backend/services/deployment";
import { ZitadelError } from "@/lib/errors";
import { type PreparedRelease, type PrepareRequest, Publisher } from "@/lib/publish/publisher";
import { Output } from "@/lib/ui";
import { DiskStore, ZitadelConfig } from "@/lib/zitadel";
import { aFile, anOidcConnection } from "@tests/helpers/config";
import {
  answering,
  answeringPages,
  type Reply,
  refusal,
  type Sent,
  TEST_SERVER,
  answeringVariables,
} from "@tests/helpers/api-answers";
import { it, test } from "@tests/fixtures";
import { aDeployment, PRIMARY_ORIGIN, PROJECT_ID, SECRET_VARIABLE } from "@tests/helpers/records";
import { rejectionOf } from "@tests/helpers/thrown-value";

/**
 * A bundle already built and checked, as `prepare` hands one over.
 */
const PREPARED: PreparedRelease = {
  bundle: { schemas: [], flow_definitions: [], idps: [] },
  resourceCount: 0,
  report: {},
  warnings: [],
  notices: [],
  lockouts: [],
  changedConfiguration: undefined,
  gitSha: "abc1234",
  gitDirty: false,
  referenced: [],
};

/**
 * The origin a preview deploys to.
 */
const PREVIEW_URL = "https://pr-7.preview.acme.com";

/**
 * Where every call of the publisher is scoped.
 */
const SCOPE = { project_id: PROJECT_ID };

/**
 * A connection whose subject is the user's email, a claim they can change.
 */
const EMAIL_SUBJECT = anOidcConnection({ subject_claim: "email" });

/**
 * The project's variables, holding the secret the connection names.
 */
const ACME_SECRET_HELD = { ACME_CLIENT_SECRET: SECRET_VARIABLE };

/**
 * The warning that a connection's subject claim is one the user can change.
 */
const SUBJECT_WARNING = expect.stringContaining("subject_claim is");

/**
 * What a dry-run deploy of the project at `cwd` asks of `prepare`, under
 * `--json`, without comparing against what is live.
 *
 * @param cwd - The project directory.
 * @returns The request.
 */
function aDryRunOf(cwd: string): PrepareRequest {
  return {
    cwd,
    env: {},
    mode: "deploy",
    dryRun: true,
    compare: false,
    json: true,
    color: false,
  };
}

/**
 * Write the connection whose subject is the user's email into the project at
 * `cwd`.
 *
 * @param cwd - The project directory.
 * @returns Nothing once the file is written.
 */
async function aProjectWithAnEmailSubject(cwd: string): Promise<void> {
  await new DiskStore(cwd).write(aFile("connections", "acme.json", EMAIL_SUBJECT), "create");
}

/**
 * A publisher whose project holds the connection's secret and answers the
 * connection listing with `queryIdps`.
 *
 * @param server - The test's MSW server.
 * @param queryIdps - How the project's connections are listed.
 * @param client - The client it sends through.
 * @returns The publisher.
 */
function aPublisherListing(
  server: SetupServer,
  queryIdps: Reply<"queryIdps">,
  client: ZitadelClient,
): Publisher {
  answeringVariables(server, ACME_SECRET_HELD);
  answering(server, "queryIdps", queryIdps);
  return new Publisher(client, PROJECT_ID);
}

/**
 * A connection listing that answers a connection with each of `slugs`.
 *
 * @param slugs - The slugs of the connections the project has.
 * @returns The listing.
 */
function listing(...slugs: readonly string[]) {
  return {
    idps: slugs.map((slug) => {
      return { slug };
    }),
  };
}

/**
 * A connection listing the token may not read.
 */
const REFUSED_LISTING = refusal(403, "idp.permission_denied");

/**
 * A connection listing that fails with something that is not a server answer:
 * a listing whose connection is no record at all.
 */
const BROKEN_LISTING = Response.json({ idps: [null] });

/**
 * Answers the release build with `rel_1`.
 *
 * @param server - The test's MSW server.
 * @param revokedAt - When that release was revoked, if it was.
 */
function buildingRelease(server: SetupServer, revokedAt?: string): void {
  answering(server, "buildRelease", { id: "rel_1", revoked_at: revokedAt });
}

/**
 * What each request sent, with the scope it was sent under.
 *
 * @param sent - The requests.
 * @returns The bodies and query scopes, oldest first.
 */
function bodiesAndScopes(sent: readonly Sent[]) {
  return sent.map(({ body, url }) => {
    return [body, Object.fromEntries(url.searchParams)];
  });
}

describe("Publisher.landing", () => {
  it("answers the project's primary origins", async ({ server, client }) => {
    answering(server, "getProject", {
      origins: [
        { pattern: PRIMARY_ORIGIN, kind: "primary" },
        { pattern: "https://*.preview.acme.com", kind: "preview" },
      ],
    });

    const origins = await new Publisher(client, PROJECT_ID).fetchLanding();

    expect(origins.primary).toEqual([PRIMARY_ORIGIN]);
  });
});

describe("Publisher.createRelease", () => {
  it("sends the bundle with the git provenance the build recorded", async ({ server, client }) => {
    const built = answering(server, "buildRelease", { id: "rel_1" });

    await new Publisher(client, PROJECT_ID).createRelease({
      prepared: PREPARED,
      message: "ship it",
    });

    expect(bodiesAndScopes(built)).toEqual([
      [
        { bundle: PREPARED.bundle, message: "ship it", git_sha: "abc1234", git_dirty: false },
        SCOPE,
      ],
    ]);
  });
});

describe("Publisher.deploy", () => {
  describe("when the deployment lands", () => {
    /**
     * A publisher whose deployment lands on a project with nothing live.
     *
     * @param server - The test's MSW server.
     * @param client - The client it sends through.
     * @returns The publisher.
     */
    const landing = (server: SetupServer, client: ZitadelClient): Publisher => {
      buildingRelease(server);
      answeringPages(server, "listDeployments", { deployments: [] });
      answering(server, "createDeployment", aDeployment());
      return new Publisher(client, PROJECT_ID);
    };

    it("tells which stage it enters, release creation then deployment", async ({
      server,
      client,
    }) => {
      const stages: string[] = [];

      await landing(server, client).deploy({ prepared: PREPARED }, (stage) => {
        stages.push(stage);
      });

      expect(stages).toEqual(["release_creation", "deployment"]);
    });

    it("answers the release it built", async ({ server, client }) => {
      const outcome = await landing(server, client).deploy({ prepared: PREPARED });

      expect(outcome.release).toEqual({ id: "rel_1" });
    });

    it("answers the deployment that made it live", async ({ server, client }) => {
      const outcome = await landing(server, client).deploy({ prepared: PREPARED });

      const deployed: ListDeployments200DeploymentsItem = {
        id: "dep_1",
        project_id: PROJECT_ID,
        release_id: "rel_1",
        kind: "primary",
        status: "live",
        deployed_at: "2026-01-01T00:00:00Z",
        targets: [{ origin: PRIMARY_ORIGIN }],
        metadata: { reason: "deploy" },
      };
      expect(outcome.publication).toEqual({
        outcome: "deployed",
        deployment: Deployment.of(deployed),
      });
    });
  });

  describe("when another deploy wins the race", () => {
    /**
     * A publisher whose deployment another deploy beats to the project.
     *
     * @param server - The test's MSW server.
     * @param client - The client it sends through.
     * @returns The publisher.
     */
    const racing = (server: SetupServer, client: ZitadelClient): Publisher => {
      buildingRelease(server);
      answeringPages(server, "listDeployments", { deployments: [] });
      answering(server, "createDeployment", refusal(409, "dep.conflict"));
      return new Publisher(client, PROJECT_ID);
    };

    it("answers the release it had built", async ({ server, client }) => {
      const outcome = await racing(server, client).deploy({ prepared: PREPARED });

      expect(outcome.release).toEqual({ id: "rel_1" });
    });

    it("answers the race it lost", async ({ server, client }) => {
      const outcome = await racing(server, client).deploy({ prepared: PREPARED });

      expect(outcome.publication).toEqual({ outcome: "raced", current: undefined });
    });
  });

  describe("when the content builds back to a revoked release", () => {
    it("refuses with a conflict", async ({ server, client }) => {
      buildingRelease(server, "2026-01-01T00:00:00Z");

      const error = await rejectionOf(() => {
        return new Publisher(client, PROJECT_ID).deploy({ prepared: PREPARED });
      });

      expect(error).toBeInstanceOf(ConflictError);
    });

    it("deploys nothing", async ({ server, client }) => {
      buildingRelease(server, "2026-01-01T00:00:00Z");
      const deployed = answering(server, "createDeployment", aDeployment());

      await rejectionOf(() => {
        return new Publisher(client, PROJECT_ID).deploy({ prepared: PREPARED });
      });

      expect(deployed).toEqual([]);
    });
  });
});

describe("Publisher.preview", () => {
  it("deploys to the URLs the build registered, with their time to live", async ({
    server,
    client,
  }) => {
    buildingRelease(server);
    const deployed = answering(server, "createDeployment", aDeployment());

    await new Publisher(client, PROJECT_ID).preview({
      prepared: PREPARED,
      urls: [PREVIEW_URL],
      ttl: "PT2H",
      message: "pr 7",
    });

    expect(bodiesAndScopes(deployed)).toEqual([
      [{ release_id: "rel_1", targets: [PREVIEW_URL], message: "pr 7", ttl: "PT2H" }, SCOPE],
    ]);
  });

  it("sends no time to live when the run named none", async ({ server, client }) => {
    buildingRelease(server);
    const deployed = answering(server, "createDeployment", aDeployment());

    await new Publisher(client, PROJECT_ID).preview({ prepared: PREPARED, urls: [PREVIEW_URL] });

    expect(bodiesAndScopes(deployed)).toEqual([
      [{ release_id: "rel_1", targets: [PREVIEW_URL] }, SCOPE],
    ]);
  });
});

describe("Publisher.deployInitial", () => {
  it("deploys to every primary origin with no guard", async ({ server, client }) => {
    buildingRelease(server);
    const deployed = answering(server, "createDeployment", aDeployment());

    await new Publisher(client, PROJECT_ID).deployInitial({ prepared: PREPARED, message: "first" });

    expect(bodiesAndScopes(deployed)).toEqual([
      [{ release_id: "rel_1", targets: "primary", message: "first" }, SCOPE],
    ]);
  });

  it("answers the deployment it made", async ({ server, client }) => {
    buildingRelease(server);
    answering(server, "createDeployment", aDeployment());

    const outcome = await new Publisher(client, PROJECT_ID).deployInitial({
      prepared: PREPARED,
      message: "first",
    });

    expect(outcome.deployment.id).toBe("dep_1");
  });

  it("reads nothing before it writes, there being nothing to race", async ({ server, client }) => {
    buildingRelease(server);
    answering(server, "createDeployment", aDeployment());
    const read = answeringPages(server, "listDeployments", { deployments: [] });

    await new Publisher(client, PROJECT_ID).deployInitial({ prepared: PREPARED });

    expect(read).toEqual([]);
  });
});

describe("Publisher.prepare", () => {
  describe("with a connection whose subject claim the user can change", () => {
    test("does not warn about a connection the project already has", async ({
      server,
      client,
      dir,
    }) => {
      await aProjectWithAnEmailSubject(dir);

      const prepared = await aPublisherListing(server, listing("acme"), client).prepare(
        aDryRunOf(dir),
      );

      expect(prepared.warnings).not.toContainEqual(SUBJECT_WARNING);
    });

    test("reads the files once while learning which connections are deployed", async ({
      server,
      client,
      dir,
    }) => {
      await aProjectWithAnEmailSubject(dir);
      const loading = vi.spyOn(ZitadelConfig, "loadUnchecked");

      await aPublisherListing(server, listing("acme"), client).prepare(aDryRunOf(dir));

      expect(loading).toHaveBeenCalledTimes(1);
      loading.mockRestore();
    });

    test("still warns about a connection the project does not have yet", async ({
      server,
      client,
      dir,
    }) => {
      await aProjectWithAnEmailSubject(dir);

      const prepared = await aPublisherListing(server, listing("other"), client).prepare(
        aDryRunOf(dir),
      );

      expect(prepared.warnings).toContainEqual(SUBJECT_WARNING);
    });

    test.for([
      { situation: "a listing the token may not read", queryIdps: REFUSED_LISTING },
      { situation: "a listing that fails for another reason", queryIdps: BROKEN_LISTING },
    ])("leaves the warning out for $situation", async (row, { dir, server, client }) => {
      await aProjectWithAnEmailSubject(dir);

      const prepared = await aPublisherListing(server, row.queryIdps, client).prepare(
        aDryRunOf(dir),
      );

      expect(prepared.warnings).not.toContainEqual(SUBJECT_WARNING);
    });

    test("still refuses a local error when the listing fails for another reason", async ({
      server,
      client,
      dir,
    }) => {
      await aProjectWithAnEmailSubject(dir);
      await new DiskStore(dir).write(aFile("flows", "login.json", { name: "bad" }), "create");

      const error = await rejectionOf(() => {
        return aPublisherListing(server, BROKEN_LISTING, client).prepare(aDryRunOf(dir));
      });

      expect(error).toMatchObject({ code: "E_VALIDATION" });
    });

    test("stops when the person cancels while the listing is read", async ({ server, dir }) => {
      await aProjectWithAnEmailSubject(dir);
      const run = new AbortController();
      const client = createZitadelClient({ baseUrl: TEST_SERVER, signal: run.signal });
      const cancelled = () => {
        run.abort(new ZitadelError("E_CANCELLED", "cancelled"));
        return listing("acme");
      };

      const error = await rejectionOf(() => {
        return aPublisherListing(server, cancelled, client).prepare(aDryRunOf(dir));
      });

      expect(error).toMatchObject({ code: "E_CANCELLED" });
    });

    describe("with no connection whose subject claim the user can change", () => {
      test.for([
        { situation: "a connection keyed on a stable claim", subject: "sub" },
        { situation: "a connection that names no subject claim", subject: undefined },
      ])("lists no connections for $situation", async (row, { dir, server, client }) => {
        const body = anOidcConnection(
          row.subject === undefined ? {} : { subject_claim: row.subject },
        );
        await new DiskStore(dir).write(aFile("connections", "acme.json", body), "create");
        answeringVariables(server, ACME_SECRET_HELD);
        const listed = answering(server, "queryIdps", listing("acme"));

        await new Publisher(client, PROJECT_ID).prepare(aDryRunOf(dir));

        expect(listed).toEqual([]);
      });
    });
  });
});

describe("Publisher.prepare with the json option left out", () => {
  afterEach(() => {
    Output.settle({ json: false, color: false });
  });

  /**
   * What a comparing deploy of a project nothing is deployed to asks of `prepare`, naming neither
   * `json` nor `color`.
   *
   * @param cwd - The project directory.
   * @returns The request.
   */
  function aComparisonOf(cwd: string): PrepareRequest {
    return {
      cwd,
      env: {},
      mode: "deploy",
      dryRun: true,
      compare: true,
    };
  }

  /**
   * A publisher whose project holds the connection's secret and no users, and has nothing
   * deployed.
   *
   * @param server - The test's MSW server.
   * @param client - The client it sends through.
   * @returns The publisher.
   */
  function aPublisherWithNothingDeployed(server: SetupServer, client: ZitadelClient): Publisher {
    answeringPages(server, "listDeployments", { deployments: [] });
    answeringPages(server, "queryUsers", { users: [] });
    return aPublisherListing(server, listing("acme"), client);
  }

  test("reports the diff as data when the run answers in JSON", async ({ server, client, dir }) => {
    Output.settle({ json: true, color: false });
    await aProjectWithAnEmailSubject(dir);

    const prepared = await aPublisherWithNothingDeployed(server, client).prepare(
      aComparisonOf(dir),
    );

    expect(prepared.report).toHaveProperty("diff");
  });

  test("prints the diff's note when the run does not answer in JSON", async ({
    server,
    client,
    dir,
  }) => {
    Output.settle({ json: false, color: false });
    await aProjectWithAnEmailSubject(dir);

    const prepared = await aPublisherWithNothingDeployed(server, client).prepare(
      aComparisonOf(dir),
    );

    expect(prepared.notices.join("")).toContain("No diff available");
  });
});
