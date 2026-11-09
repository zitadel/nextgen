import { describe, expect, it, vi } from "vitest";

import { ConflictError } from "@/lib/backend/errors";
import { type PreparedRelease, Publisher } from "@/lib/publish/publisher";
import { type ClientStubs, fakeClient } from "@tests/helpers/fake-client";

/** A bundle already built and checked, as `prepare` hands one over. */
const PREPARED: PreparedRelease = {
  bundle: { schemas: [], flow_definitions: [], idps: [] },
  resourceCount: 0,
  report: {},
  warnings: [],
  notices: [],
  gitSha: "abc1234",
  gitDirty: false,
};

/** A publisher answering `stubs`, bound to one project. */
function publisher(stubs: ClientStubs): Publisher {
  return new Publisher(fakeClient(stubs), "proj_1");
}

/** A deployment record as the API answers one. */
function deployment(id: string) {
  return {
    id,
    project_id: "proj_1",
    release_id: "rel_1",
    kind: "primary" as const,
    status: "live" as const,
    deployed_at: "2026-01-01T00:00:00Z",
    targets: [{ origin: "https://app.acme.com" }],
    metadata: { reason: "deploy" as const },
  };
}

describe("Publisher.landing", () => {
  it("answers the project's origins, so a command asks them what it needs", async () => {
    const live = publisher({
      getProject: async () => ({
        origins: [
          { pattern: "https://app.acme.com", kind: "primary" },
          { pattern: "https://*.preview.acme.com", kind: "preview" },
        ],
      }),
    });

    const origins = await live.landing();

    expect(origins.primary).toEqual(["https://app.acme.com"]);
  });
});

describe("Publisher.createRelease", () => {
  it("sends the bundle with the git provenance the build recorded", async () => {
    const buildRelease = vi.fn(async () => ({ id: "rel_1" }));

    await publisher({ buildRelease }).createRelease({
      prepared: PREPARED,
      message: "ship it",
    });

    expect(buildRelease).toHaveBeenCalledWith(
      {
        bundle: PREPARED.bundle,
        message: "ship it",
        git_sha: "abc1234",
        git_dirty: false,
      },
      { project_id: "proj_1" },
    );
  });
});

describe("Publisher.deploy", () => {
  it("answers the release it built and the deployment that made it live", async () => {
    const live = publisher({
      buildRelease: async () => ({ id: "rel_1" }),
      listDeployments: { all: async () => [] },
      createDeployment: async () => deployment("dep_1"),
    });

    const outcome = await live.deploy({ prepared: PREPARED });

    expect(outcome.release).toMatchObject({ id: "rel_1" });
    expect(outcome.publication).toMatchObject({
      outcome: "deployed",
      deployment: { id: "dep_1" },
    });
  });

  it("answers the race it lost, with the release it had built", async () => {
    const live = publisher({
      buildRelease: async () => ({ id: "rel_1" }),
      listDeployments: { all: async () => [] },
      createDeployment: async () => {
        throw new ConflictError("raced", { status: 409, body: { code: "dep.conflict" } });
      },
    });

    const outcome = await live.deploy({ prepared: PREPARED });

    expect(outcome.release).toMatchObject({ id: "rel_1" });
    expect(outcome.publication).toMatchObject({ outcome: "raced" });
  });

  it("refuses content that builds back to a revoked release, before any deploy", async () => {
    const createDeployment = vi.fn(async () => deployment("dep_1"));
    const live = publisher({
      buildRelease: async () => ({ id: "rel_1", revoked_at: "2026-01-01T00:00:00Z" }),
      createDeployment,
    });

    await expect(live.deploy({ prepared: PREPARED })).rejects.toMatchObject({
      name: "ConflictError",
    });
    expect(createDeployment).not.toHaveBeenCalled();
  });
});

describe("Publisher.preview", () => {
  it("deploys to the URLs the build registered, with their time to live", async () => {
    const createDeployment = vi.fn(async () => deployment("dep_1"));

    await publisher({
      buildRelease: async () => ({ id: "rel_1" }),
      createDeployment,
    }).preview({
      prepared: PREPARED,
      urls: ["https://pr-7.preview.acme.com"],
      ttl: "PT2H",
      message: "pr 7",
    });

    expect(createDeployment).toHaveBeenCalledWith(
      {
        release_id: "rel_1",
        targets: ["https://pr-7.preview.acme.com"],
        message: "pr 7",
        ttl: "PT2H",
      },
      { project_id: "proj_1" },
    );
  });

  it("sends no time to live when the run named none", async () => {
    const createDeployment = vi.fn(async () => deployment("dep_1"));

    await publisher({
      buildRelease: async () => ({ id: "rel_1" }),
      createDeployment,
    }).preview({ prepared: PREPARED, urls: ["https://pr-7.preview.acme.com"] });

    expect(createDeployment).toHaveBeenCalledWith(
      expect.not.objectContaining({ ttl: expect.anything() }),
      { project_id: "proj_1" },
    );
  });
});

describe("Publisher.deployInitial", () => {
  it("deploys to every primary origin with no guard, there being nothing to race", async () => {
    const createDeployment = vi.fn(async () => deployment("dep_1"));

    const outcome = await publisher({
      buildRelease: async () => ({ id: "rel_1" }),
      createDeployment,
    }).deployInitial({ prepared: PREPARED, message: "first" });

    expect(createDeployment).toHaveBeenCalledWith(
      { release_id: "rel_1", targets: "primary", message: "first" },
      { project_id: "proj_1" },
    );
    expect(outcome.deployment.id).toBe("dep_1");
  });

  it("reads nothing before it writes, unlike a guarded deploy", async () => {
    const all = vi.fn(async () => []);

    await publisher({
      buildRelease: async () => ({ id: "rel_1" }),
      createDeployment: async () => deployment("dep_1"),
      listDeployments: { all },
    }).deployInitial({ prepared: PREPARED });

    expect(all).not.toHaveBeenCalled();
  });
});
