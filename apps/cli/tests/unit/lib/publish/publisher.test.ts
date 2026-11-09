import { describe, expect, it, vi } from "vitest";

import { ConflictError, ForbiddenError } from "@/lib/backend/errors";
import { ZitadelError } from "@/lib/errors";
import { type PreparedRelease, type PrepareRequest, Publisher } from "@/lib/publish/publisher";
import { shellCommand } from "@/lib/suggestion";
import { DiskStore, ZitadelConfig } from "@/lib/zitadel";
import { aConfig, aFile, anOidcConnection } from "@tests/helpers/config";
import { type ClientStubs, fakeClient } from "@tests/helpers/fake-client";
import { test } from "@tests/helpers/fixtures";
import { aDeployment, holdingVariables, PROJECT_ID, SECRET_VARIABLE } from "@tests/helpers/records";
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
  config: aConfig(),
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

/**
 * A connection whose subject is the user's email, a claim they can change.
 */
const EMAIL_SUBJECT = anOidcConnection({ subject_claim: "email" });

/**
 * The project's variables, holding the secret the connection names.
 */
const ACME_SECRET_HELD = holdingVariables({ ACME_CLIENT_SECRET: SECRET_VARIABLE });

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
    suggest: (args) => {
      return shellCommand(args);
    },
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
 * @param queryIdps - How the project's connections are listed.
 * @returns The publisher.
 */
function aPublisherListing(queryIdps: ClientStubs["queryIdps"]): Publisher {
  return new Publisher(fakeClient({ ...ACME_SECRET_HELD, queryIdps }), PROJECT_ID);
}

/**
 * A connection listing that answers a connection with each of `slugs`.
 *
 * @param slugs - The slugs of the connections the project has.
 * @returns The listing.
 */
function listing(...slugs: readonly string[]): ClientStubs["queryIdps"] {
  return {
    all: async () => {
      return slugs.map((slug) => {
        return { slug };
      });
    },
  };
}

/**
 * A connection listing the token may not read.
 */
const REFUSED_LISTING: ClientStubs["queryIdps"] = {
  all: async () => {
    throw new ForbiddenError("not allowed", { status: 403 });
  },
};

/**
 * A connection listing that fails with something that is not a server answer.
 */
const BROKEN_LISTING: ClientStubs["queryIdps"] = {
  all: async () => {
    throw new TypeError("unexpected response shape");
  },
};

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
      const outcome = await publisher.deploy({ prepared: PREPARED });

      expect(outcome.release).toMatchObject({ id: "rel_1" });
    });

    it("answers the deployment that made it live", async () => {
      const outcome = await publisher.deploy({ prepared: PREPARED });

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
      const outcome = await publisher.deploy({ prepared: PREPARED });

      expect(outcome.release).toMatchObject({ id: "rel_1" });
    });

    it("answers the race it lost", async () => {
      const outcome = await publisher.deploy({ prepared: PREPARED });

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
        return publisher.deploy({ prepared: PREPARED });
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
        return publisher.deploy({ prepared: PREPARED });
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

describe("Publisher.prepare", () => {
  describe("with a connection whose subject claim the user can change", () => {
    test("does not warn about a connection the project already has", async ({ dir }) => {
      await aProjectWithAnEmailSubject(dir);

      const prepared = await aPublisherListing(listing("acme")).prepare(aDryRunOf(dir));

      expect(prepared.warnings).not.toContainEqual(SUBJECT_WARNING);
    });

    test("reads the files once while learning which connections are deployed", async ({ dir }) => {
      await aProjectWithAnEmailSubject(dir);
      const loading = vi.spyOn(ZitadelConfig, "loadUnchecked");

      await aPublisherListing(listing("acme")).prepare(aDryRunOf(dir));

      expect(loading).toHaveBeenCalledTimes(1);
      loading.mockRestore();
    });

    test("still warns about a connection the project does not have yet", async ({ dir }) => {
      await aProjectWithAnEmailSubject(dir);

      const prepared = await aPublisherListing(listing("other")).prepare(aDryRunOf(dir));

      expect(prepared.warnings).toContainEqual(SUBJECT_WARNING);
    });

    test.for([
      { situation: "a listing the token may not read", queryIdps: REFUSED_LISTING },
      { situation: "a listing that fails for another reason", queryIdps: BROKEN_LISTING },
    ])("leaves the warning out for $situation", async (row, { dir }) => {
      await aProjectWithAnEmailSubject(dir);

      const prepared = await aPublisherListing(row.queryIdps).prepare(aDryRunOf(dir));

      expect(prepared.warnings).not.toContainEqual(SUBJECT_WARNING);
    });

    test("still refuses a local error when the listing fails for another reason", async ({
      dir,
    }) => {
      await aProjectWithAnEmailSubject(dir);
      await new DiskStore(dir).write(aFile("flows", "login.json", { name: "bad" }), "create");

      const error = await rejectionOf(() => {
        return aPublisherListing(BROKEN_LISTING).prepare(aDryRunOf(dir));
      });

      expect(error).toMatchObject({ code: "E_VALIDATION" });
    });

    test("stops when the person cancels while the listing is read", async ({ dir }) => {
      await aProjectWithAnEmailSubject(dir);
      const cancelled: ClientStubs["queryIdps"] = {
        all: async () => {
          throw new ZitadelError("E_CANCELLED", "cancelled");
        },
      };

      const error = await rejectionOf(() => {
        return aPublisherListing(cancelled).prepare(aDryRunOf(dir));
      });

      expect(error).toMatchObject({ code: "E_CANCELLED" });
    });

    describe("with no connection whose subject claim the user can change", () => {
      test.for([
        { situation: "a connection keyed on a stable claim", subject: "sub" },
        { situation: "a connection that names no subject claim", subject: undefined },
      ])("lists no connections for $situation", async (row, { dir }) => {
        const body = anOidcConnection(
          row.subject === undefined ? {} : { subject_claim: row.subject },
        );
        await new DiskStore(dir).write(aFile("connections", "acme.json", body), "create");
        const all = vi.fn(async () => {
          return [{ slug: "acme" }];
        });

        await aPublisherListing({ all }).prepare(aDryRunOf(dir));

        expect(all).not.toHaveBeenCalled();
      });
    });
  });
});
