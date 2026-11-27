import { describe, expect } from "vitest";

import { it } from "@tests/fixtures";

import { PublishedConfiguration } from "@/lib/publish/configuration";
import { answering, answeringPages } from "@tests/helpers/api-answers";
import { aDeployment, PROJECT_ID } from "@tests/helpers/records";

describe("PublishedConfiguration.fetchLiveReleaseId", () => {
  it("answers the release the newest primary deployment serves", async ({ server, client }) => {
    answeringPages(server, "listDeployments", {
      deployments: [aDeployment({ release_id: "rel_9" })],
    });

    const releaseId = await new PublishedConfiguration(client, PROJECT_ID).fetchLiveReleaseId();

    expect(releaseId).toBe("rel_9");
  });

  it("answers nothing when the project has nothing on a primary origin", async ({
    server,
    client,
  }) => {
    answeringPages(server, "listDeployments", { deployments: [] });

    const releaseId = await new PublishedConfiguration(client, PROJECT_ID).fetchLiveReleaseId();

    expect(releaseId).toBeUndefined();
  });
});

describe("PublishedConfiguration.fetchReleaseIdOfDeployment", () => {
  it("answers the release one deployment made live", async ({ server, client }) => {
    answering(server, "getDeployment", aDeployment({ release_id: "rel_3" }));
    answering(server, "listDeploymentVariables", {});

    const releaseId = await new PublishedConfiguration(
      client,
      PROJECT_ID,
    ).fetchReleaseIdOfDeployment("dep_1");

    expect(releaseId).toBe("rel_3");
  });
});

describe("PublishedConfiguration.fetchRelease", () => {
  /** A release `rel_1` that pins one schema revision. */
  const RELEASE = { id: "rel_1", pointers: [{ kind: "schema" as const, revision_id: "sch_1" }] };

  it("reads the release with the revisions it pins", async ({ server, client }) => {
    answering(server, "getRelease", RELEASE);

    const release = await new PublishedConfiguration(client, PROJECT_ID).fetchRelease("rel_1");

    expect(release).toEqual(RELEASE);
  });

  it("reads it from the project", async ({ server, client }) => {
    const read = answering(server, "getRelease", RELEASE);

    await new PublishedConfiguration(client, PROJECT_ID).fetchRelease("rel_1");

    expect(
      read.map(({ params, url }) => {
        return [params.release_id, url.searchParams.get("project_id")];
      }),
    ).toEqual([["rel_1", PROJECT_ID]]);
  });
});

describe("PublishedConfiguration.placeRevision", () => {
  it("answers a schema's document", async ({ server, client }) => {
    answering(server, "getSchema", { schema: { objectType: "human-user" } });

    const document = await new PublishedConfiguration(client, PROJECT_ID).fetchRevision(
      "schema",
      "sch_1",
    );

    expect(document).toEqual({ objectType: "human-user" });
  });

  it("answers a flow's definition", async ({ server, client }) => {
    answering(server, "getFlowDefinition", { flow_definition: { name: "default-login" } });

    const document = await new PublishedConfiguration(client, PROJECT_ID).fetchRevision(
      "flow_definition",
      "flowdef_1",
    );

    expect(document).toEqual({ name: "default-login" });
  });

  it.for(["branding", "idp", "policy"] as const)(
    "answers nothing for a %s, which has no file on disk yet",
    async (kind, { client }) => {
      const document = await new PublishedConfiguration(client, PROJECT_ID).fetchRevision(
        kind,
        "rev_1",
      );

      expect(document).toBeUndefined();
    },
  );
});
