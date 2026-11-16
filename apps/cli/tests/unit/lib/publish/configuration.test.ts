import { describe, expect, it, vi } from "vitest";

import { PublishedConfiguration } from "@/lib/publish/configuration";
import { fakeClient } from "@tests/helpers/fake-client";
import { aDeployment, PROJECT_ID } from "@tests/helpers/records";

describe("PublishedConfiguration.fetchLiveReleaseId", () => {
  it("answers the release the newest primary deployment serves", async () => {
    const configuration = new PublishedConfiguration(
      fakeClient({
        listDeployments: {
          all: async () => {
            return [aDeployment({ release_id: "rel_9" })];
          },
        },
      }),
      PROJECT_ID,
    );

    const releaseId = await configuration.fetchLiveReleaseId();

    expect(releaseId).toBe("rel_9");
  });

  it("answers nothing when the project has nothing on a primary origin", async () => {
    const configuration = new PublishedConfiguration(
      fakeClient({
        listDeployments: {
          all: async () => {
            return [];
          },
        },
      }),
      PROJECT_ID,
    );

    const releaseId = await configuration.fetchLiveReleaseId();

    expect(releaseId).toBeUndefined();
  });
});

describe("PublishedConfiguration.fetchReleaseIdOfDeployment", () => {
  it("answers the release one deployment made live", async () => {
    const configuration = new PublishedConfiguration(
      fakeClient({
        getDeployment: async () => {
          return aDeployment({ release_id: "rel_3" });
        },
        listDeploymentVariables: async () => {
          return {};
        },
      }),
      PROJECT_ID,
    );

    const releaseId = await configuration.fetchReleaseIdOfDeployment("dep_1");

    expect(releaseId).toBe("rel_3");
  });
});

describe("PublishedConfiguration.fetchRelease", () => {
  const getRelease = vi.fn(async () => {
    return { id: "rel_1", pointers: [{ kind: "schema" as const, revision_id: "sch_1" }] };
  });
  const configuration = new PublishedConfiguration(fakeClient({ getRelease }), PROJECT_ID);

  it("reads the release with the revisions it pins", async () => {
    const release = await configuration.fetchRelease("rel_1");

    expect(release).toMatchObject({ pointers: [{ kind: "schema" }] });
  });

  it("reads it from the project", async () => {
    await configuration.fetchRelease("rel_1");

    expect(getRelease).toHaveBeenCalledWith("rel_1", { project_id: PROJECT_ID });
  });
});

describe("PublishedConfiguration.placeRevision", () => {
  it("answers a schema's document", async () => {
    const configuration = new PublishedConfiguration(
      fakeClient({
        getSchema: async () => {
          return { schema: { objectType: "human-user" } };
        },
      }),
      PROJECT_ID,
    );

    const document = await configuration.fetchRevision("schema", "sch_1");

    expect(document).toEqual({ objectType: "human-user" });
  });

  it("answers a flow's definition", async () => {
    const configuration = new PublishedConfiguration(
      fakeClient({
        getFlowDefinition: async () => {
          return { flow_definition: { name: "default-login" } };
        },
      }),
      PROJECT_ID,
    );

    const document = await configuration.fetchRevision("flow_definition", "flowdef_1");

    expect(document).toEqual({ name: "default-login" });
  });

  it.each(["branding", "idp", "policy"] as const)(
    "answers nothing for a %s, which has no file on disk yet",
    async (kind) => {
      const configuration = new PublishedConfiguration(fakeClient({}), PROJECT_ID);

      const document = await configuration.fetchRevision(kind, "rev_1");

      expect(document).toBeUndefined();
    },
  );
});
