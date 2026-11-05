import { describe, expect, it, vi } from "vitest";

import { PublishedConfiguration } from "../../../../src/lib/publish/configuration";
import { type ClientStubs, fakeClient } from "../../../helpers/fake-client";

/** A configuration answering `stubs`, bound to one project. */
function configuration(stubs: ClientStubs): PublishedConfiguration {
  return new PublishedConfiguration(fakeClient(stubs), "proj_1");
}

/** A live deployment of `releaseId`, whose target never expires. */
function liveOn(releaseId: string) {
  return {
    id: "dep_1",
    project_id: "proj_1",
    release_id: releaseId,
    kind: "primary" as const,
    status: "live" as const,
    deployed_at: "2026-01-01T00:00:00Z",
    targets: [{ origin: "https://app.acme.com" }],
    metadata: { reason: "deploy" as const },
  };
}

describe("PublishedConfiguration.liveReleaseId", () => {
  it("answers the release the newest primary deployment serves", async () => {
    const live = configuration({
      listDeployments: { all: async () => [liveOn("rel_9")] },
    });

    await expect(live.liveReleaseId()).resolves.toBe("rel_9");
  });

  it("answers nothing when the project has nothing on a primary origin", async () => {
    const live = configuration({ listDeployments: { all: async () => [] } });

    await expect(live.liveReleaseId()).resolves.toBeUndefined();
  });
});

describe("PublishedConfiguration.releaseIdOfDeployment", () => {
  it("answers the release one deployment made live", async () => {
    const live = configuration({
      getDeploymentById: async () => liveOn("rel_3"),
      getDeploymentVariables: async () => ({}),
    });

    await expect(live.releaseIdOfDeployment("dep_1")).resolves.toBe("rel_3");
  });
});

describe("PublishedConfiguration.release", () => {
  it("reads the release with the revisions it pins", async () => {
    const getReleaseById = vi.fn(async () => ({
      id: "rel_1",
      pointers: [{ kind: "schema" as const, revision_id: "sch_1" }],
    }));

    await expect(configuration({ getReleaseById }).release("rel_1")).resolves.toMatchObject({
      pointers: [{ kind: "schema" }],
    });
    expect(getReleaseById).toHaveBeenCalledWith("rel_1", { project_id: "proj_1" });
  });
});

describe("PublishedConfiguration.revision", () => {
  it("answers a schema's document", async () => {
    const live = configuration({
      getSchemaById: async () => ({ schema: { objectType: "human-user" } }),
    });

    await expect(live.revision("schema", "sch_1")).resolves.toEqual({
      objectType: "human-user",
    });
  });

  it("answers a flow's definition", async () => {
    const live = configuration({
      getFlowDefinition: async () => ({ flow_definition: { name: "default-login" } }),
    });

    await expect(live.revision("flow_definition", "flowdef_1")).resolves.toEqual({
      name: "default-login",
    });
  });

  it.each(["branding", "idp", "policy"] as const)(
    "answers nothing for a %s, which has no file on disk yet",
    async (kind) => {
      await expect(configuration({}).revision(kind, "rev_1")).resolves.toBeUndefined();
    },
  );
});
