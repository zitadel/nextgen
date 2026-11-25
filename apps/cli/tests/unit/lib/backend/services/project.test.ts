import { describe, expect, it, vi } from "vitest";

import { ProjectService } from "@/lib/backend/services/project";
import { fakeClient } from "@tests/helpers/fake-client";
import { PRIMARY_ORIGIN } from "@tests/helpers/records";

describe("ProjectService.get", () => {
  it("reads the project it was asked for", async () => {
    const getProject = vi.fn(async () => ({ id: "proj_1" }));
    const projectService = new ProjectService(fakeClient({ getProject }));

    await projectService.get("proj_1");

    expect(getProject).toHaveBeenCalledWith("proj_1");
  });

  it("answers the project with the origins it admits", async () => {
    const projectService = new ProjectService(
      fakeClient({
        getProject: async () => ({
          id: "proj_1",
          origins: [{ pattern: PRIMARY_ORIGIN, kind: "primary" }],
        }),
      }),
    );

    await expect(projectService.get("proj_1")).resolves.toMatchObject({
      origins: [{ pattern: PRIMARY_ORIGIN }],
    });
  });
});

describe("ProjectService.create", () => {
  it("sends the input as given, with no project in scope yet", async () => {
    const createProject = vi.fn(async () => ({ id: "proj_1" }));
    const projectService = new ProjectService(fakeClient({ createProject }));
    const input = { name: "acme-production", seed_defaults: false };

    await projectService.create(input);

    expect(createProject).toHaveBeenCalledWith(input);
  });

  it("answers the secrets the server shows only once", async () => {
    const projectService = new ProjectService(
      fakeClient({
        createProject: async () => ({
          id: "proj_1",
          project_secret: "sk_proj_1",
          preview_secret: "pk_proj_1",
        }),
      }),
    );

    await expect(projectService.create({ name: "acme" })).resolves.toMatchObject({
      project_secret: "sk_proj_1",
      preview_secret: "pk_proj_1",
    });
  });
});
