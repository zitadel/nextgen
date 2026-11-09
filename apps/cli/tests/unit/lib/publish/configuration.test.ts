import { describe, expect, it, vi } from "vitest";

import { PublishedConfiguration } from "@/lib/publish/configuration";
import { fakeClient } from "@tests/helpers/fake-client";
import { aDeployment, PROJECT_ID } from "@tests/helpers/records";

describe("PublishedConfiguration.liveReleaseId", () => {
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

    const releaseId = await configuration.liveReleaseId();

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

    const releaseId = await configuration.liveReleaseId();

    expect(releaseId).toBeUndefined();
  });
});

describe("PublishedConfiguration.releaseIdOfDeployment", () => {
  it("answers the release one deployment made live", async () => {
    const configuration = new PublishedConfiguration(
      fakeClient({
        getDeploymentById: async () => {
          return aDeployment({ release_id: "rel_3" });
        },
        getDeploymentVariables: async () => {
          return {};
        },
      }),
      PROJECT_ID,
    );

    const releaseId = await configuration.releaseIdOfDeployment("dep_1");

    expect(releaseId).toBe("rel_3");
  });
});

describe("PublishedConfiguration.release", () => {
  const getReleaseById = vi.fn(async () => {
    return { id: "rel_1", pointers: [{ kind: "schema" as const, revision_id: "sch_1" }] };
  });
  const configuration = new PublishedConfiguration(fakeClient({ getReleaseById }), PROJECT_ID);

  it("reads the release with the revisions it pins", async () => {
    const release = await configuration.release("rel_1");

    expect(release).toMatchObject({ pointers: [{ kind: "schema" }] });
  });

  it("reads it from the project", async () => {
    await configuration.release("rel_1");

    expect(getReleaseById).toHaveBeenCalledWith("rel_1", { project_id: PROJECT_ID });
  });
});

describe("PublishedConfiguration.revision", () => {
  it("answers a schema's document", async () => {
    const configuration = new PublishedConfiguration(
      fakeClient({
        getSchemaById: async () => {
          return { schema: { objectType: "human-user" } };
        },
      }),
      PROJECT_ID,
    );

    const document = await configuration.revision("schema", "sch_1");

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

    const document = await configuration.revision("flow_definition", "flowdef_1");

    expect(document).toEqual({ name: "default-login" });
  });

  it.each(["branding", "idp", "policy"] as const)(
    "answers nothing for a %s, which has no file on disk yet",
    async (kind) => {
      const configuration = new PublishedConfiguration(fakeClient({}), PROJECT_ID);

      const document = await configuration.revision(kind, "rev_1");

      expect(document).toBeUndefined();
    },
  );
});
