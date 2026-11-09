import { describe, expect, it, vi } from "vitest";

import { ConflictError } from "@/lib/backend/errors";
import { type PreparedRelease, Publisher } from "@/lib/publish/publisher";
import { fakeClient } from "@tests/helpers/fake-client";
import { aDeployment, PROJECT_ID } from "@tests/helpers/records";
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
  gitSha: "abc1234",
  gitDirty: false,
};

/**
 * The origin a preview deploys to.
 */
const PREVIEW_URL = "https://pr-7.preview.acme.com";

/**
 * Where every call of the publisher is scoped.
 */
const SCOPE = { project_id: PROJECT_ID };

describe("Publisher.landing", () => {
  it("answers the project's primary origins", async () => {
    const publisher = new Publisher(
      fakeClient({
        getProject: async () => {
          return {
            origins: [
              { pattern: "https://app.acme.com", kind: "primary" },
              { pattern: "https://*.preview.acme.com", kind: "preview" },
            ],
          };
        },
      }),
      PROJECT_ID,
    );

    const origins = await publisher.fetchLanding();

    expect(origins.primary).toEqual(["https://app.acme.com"]);
  });
});

describe("Publisher.createRelease", () => {
  it("sends the bundle with the git provenance the build recorded", async () => {
    const buildRelease = vi.fn(async () => {
      return { id: "rel_1" };
    });
    const publisher = new Publisher(fakeClient({ buildRelease }), PROJECT_ID);

    await publisher.createRelease({ prepared: PREPARED, message: "ship it" });

    expect(buildRelease).toHaveBeenCalledWith(
      { bundle: PREPARED.bundle, message: "ship it", git_sha: "abc1234", git_dirty: false },
      SCOPE,
    );
  });
});

describe("Publisher.deploy", () => {
  describe("when the deployment lands", () => {
    const publisher = new Publisher(
      fakeClient({
        buildRelease: async () => {
          return { id: "rel_1" };
        },
        listDeployments: {
          all: async () => {
            return [];
          },
        },
        createDeployment: async () => {
          return aDeployment();
        },
      }),
      PROJECT_ID,
    );

    it("answers the release it built", async () => {
      const outcome = await publisher.deploy({ prepared: PREPARED, landing: [] });

      expect(outcome.release).toMatchObject({ id: "rel_1" });
    });

    it("answers the deployment that made it live", async () => {
      const outcome = await publisher.deploy({ prepared: PREPARED, landing: [] });

      expect(outcome.publication).toMatchObject({
        outcome: "deployed",
        deployment: { id: "dep_1" },
      });
    });
  });

  describe("when another deploy wins the race", () => {
    const publisher = new Publisher(
      fakeClient({
        buildRelease: async () => {
          return { id: "rel_1" };
        },
        listDeployments: {
          all: async () => {
            return [];
          },
        },
        createDeployment: async () => {
          throw new ConflictError("raced", { status: 409, body: { code: "dep.conflict" } });
        },
      }),
      PROJECT_ID,
    );

    it("answers the release it had built", async () => {
      const outcome = await publisher.deploy({ prepared: PREPARED, landing: [] });

      expect(outcome.release).toMatchObject({ id: "rel_1" });
    });

    it("answers the race it lost", async () => {
      const outcome = await publisher.deploy({ prepared: PREPARED, landing: [] });

      expect(outcome.publication).toMatchObject({ outcome: "raced" });
    });
  });

  describe("when the content builds back to a revoked release", () => {
    it("refuses with a conflict", async () => {
      const publisher = new Publisher(
        fakeClient({
          buildRelease: async () => {
            return { id: "rel_1", revoked_at: "2026-01-01T00:00:00Z" };
          },
        }),
        PROJECT_ID,
      );

      const error = await rejectionOf(() => {
        return publisher.deploy({ prepared: PREPARED, landing: [] });
      });

      expect(error).toBeInstanceOf(ConflictError);
    });

    it("deploys nothing", async () => {
      const createDeployment = vi.fn(async () => {
        return aDeployment();
      });
      const publisher = new Publisher(
        fakeClient({
          buildRelease: async () => {
            return { id: "rel_1", revoked_at: "2026-01-01T00:00:00Z" };
          },
          createDeployment,
        }),
        PROJECT_ID,
      );

      await rejectionOf(() => {
        return publisher.deploy({ prepared: PREPARED, landing: [] });
      });

      expect(createDeployment).not.toHaveBeenCalled();
    });
  });
});

describe("Publisher.preview", () => {
  it("deploys to the URLs the build registered, with their time to live", async () => {
    const createDeployment = vi.fn(async () => {
      return aDeployment();
    });
    const publisher = new Publisher(
      fakeClient({
        buildRelease: async () => {
          return { id: "rel_1" };
        },
        createDeployment,
      }),
      PROJECT_ID,
    );

    await publisher.preview({
      prepared: PREPARED,
      urls: [PREVIEW_URL],
      ttl: "PT2H",
      message: "pr 7",
    });

    expect(createDeployment).toHaveBeenCalledWith(
      { release_id: "rel_1", targets: [PREVIEW_URL], message: "pr 7", ttl: "PT2H" },
      SCOPE,
    );
  });

  it("sends no time to live when the run named none", async () => {
    const createDeployment = vi.fn(async () => {
      return aDeployment();
    });
    const publisher = new Publisher(
      fakeClient({
        buildRelease: async () => {
          return { id: "rel_1" };
        },
        createDeployment,
      }),
      PROJECT_ID,
    );

    await publisher.preview({ prepared: PREPARED, urls: [PREVIEW_URL] });

    expect(createDeployment).toHaveBeenCalledWith(
      expect.not.objectContaining({ ttl: expect.anything() }),
      SCOPE,
    );
  });
});

describe("Publisher.deployInitial", () => {
  it("deploys to every primary origin with no guard", async () => {
    const createDeployment = vi.fn(async () => {
      return aDeployment();
    });
    const publisher = new Publisher(
      fakeClient({
        buildRelease: async () => {
          return { id: "rel_1" };
        },
        createDeployment,
      }),
      PROJECT_ID,
    );

    await publisher.deployInitial({ prepared: PREPARED, message: "first" });

    expect(createDeployment).toHaveBeenCalledWith(
      { release_id: "rel_1", targets: "primary", message: "first" },
      SCOPE,
    );
  });

  it("answers the deployment it made", async () => {
    const publisher = new Publisher(
      fakeClient({
        buildRelease: async () => {
          return { id: "rel_1" };
        },
        createDeployment: async () => {
          return aDeployment();
        },
      }),
      PROJECT_ID,
    );

    const outcome = await publisher.deployInitial({ prepared: PREPARED, message: "first" });

    expect(outcome.deployment.id).toBe("dep_1");
  });

  it("reads nothing before it writes, there being nothing to race", async () => {
    const all = vi.fn(async () => {
      return [];
    });
    const publisher = new Publisher(
      fakeClient({
        buildRelease: async () => {
          return { id: "rel_1" };
        },
        createDeployment: async () => {
          return aDeployment();
        },
        listDeployments: { all },
      }),
      PROJECT_ID,
    );

    await publisher.deployInitial({ prepared: PREPARED });

    expect(all).not.toHaveBeenCalled();
  });
});
