import { describe, expect } from "vitest";

import { it } from "@tests/fixtures";

import { ProjectService } from "@/lib/backend/services/project";
import { answering, testClient } from "@tests/helpers/api-answers";
import { PRIMARY_ORIGIN } from "@tests/helpers/records";

/** A service on a test client. */
function service(): ProjectService {
  return new ProjectService(testClient());
}

describe("ProjectService.get", () => {
  it("reads the project it was asked for", async ({ server }) => {
    const read = answering(server, "getProject", { id: "proj_1" });

    await service().get("proj_1");

    expect(read.map(({ params }) => params.project_id)).toEqual(["proj_1"]);
  });

  it("answers the project with the origins it admits", async ({ server }) => {
    answering(server, "getProject", {
      id: "proj_1",
      origins: [{ pattern: PRIMARY_ORIGIN, kind: "primary" }],
    });

    await expect(service().get("proj_1")).resolves.toMatchObject({
      origins: [{ pattern: PRIMARY_ORIGIN }],
    });
  });
});

describe("ProjectService.create", () => {
  it("sends the input as given, with no project in scope yet", async ({ server }) => {
    const created = answering(server, "createProject", { id: "proj_1" });
    const input = { name: "acme-production", seed_defaults: false };

    await service().create(input);

    expect(created.map(({ url, body }) => [url.search, body])).toEqual([["", input]]);
  });

  it("answers the secrets the server shows only once", async ({ server }) => {
    answering(server, "createProject", {
      id: "proj_1",
      project_secret: "sk_proj_1",
      preview_secret: "pk_proj_1",
    });

    await expect(service().create({ name: "acme" })).resolves.toMatchObject({
      project_secret: "sk_proj_1",
      preview_secret: "pk_proj_1",
    });
  });
});
