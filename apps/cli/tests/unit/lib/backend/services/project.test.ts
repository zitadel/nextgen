import { describe, expect } from "vitest";

import { it } from "@tests/fixtures";

import { ProjectService } from "@/lib/backend/services/project";
import { answering } from "@tests/helpers/api-answers";
import { PRIMARY_ORIGIN } from "@tests/helpers/records";

describe("ProjectService.get", () => {
  it("reads the project it was asked for", async ({ server, client }) => {
    const read = answering(server, "getProject", { id: "proj_1" });

    await new ProjectService(client).get("proj_1");

    expect(read.map(({ params }) => params.project_id)).toEqual(["proj_1"]);
  });

  it("answers the project with the origins it admits", async ({ server, client }) => {
    answering(server, "getProject", {
      id: "proj_1",
      origins: [{ pattern: PRIMARY_ORIGIN, kind: "primary" }],
    });

    await expect(new ProjectService(client).get("proj_1")).resolves.toEqual({
      id: "proj_1",
      origins: [{ pattern: PRIMARY_ORIGIN, kind: "primary" }],
    });
  });
});

describe("ProjectService.create", () => {
  it("sends the input as given, with no project in scope yet", async ({ server, client }) => {
    const created = answering(server, "createProject", { id: "proj_1" });
    const input = { name: "acme-production", seed_defaults: false };

    await new ProjectService(client).create(input);

    expect(created.map(({ url, body }) => [url.search, body])).toEqual([["", input]]);
  });

  it("answers the secrets the server shows only once", async ({ server, client }) => {
    answering(server, "createProject", {
      id: "proj_1",
      project_secret: "sk_proj_1",
      preview_secret: "pk_proj_1",
    });

    await expect(new ProjectService(client).create({ name: "acme" })).resolves.toEqual({
      id: "proj_1",
      project_secret: "sk_proj_1",
      preview_secret: "pk_proj_1",
    });
  });
});
