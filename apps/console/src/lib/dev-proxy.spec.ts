import { describe, expect, it } from "vitest";

import { targetsOtherProject } from "./dev-proxy";

const SEEDED = "proj_seeded";

describe("targetsOtherProject", () => {
  it.each([
    ["a project_id query for the secret's project", "/grants/query?project_id=proj_seeded", false],
    ["a project_id query for another project", "/grants/query?project_id=proj_other", true],
    ["the secret's own project by path", "/projects/proj_seeded", false],
    ["another project by path", "/projects/proj_other", true],
    ["a path under another project", "/projects/proj_other/keys", true],
    ["the project list", "/projects/query", false],
    ["the caller's own projects", "/users/me/projects", false],
    ["a call that names no project", "/users/query", false],
  ])("%s", (_, path, expected) => {
    expect(targetsOtherProject(path, SEEDED)).toBe(expected);
  });

  it("scopes nothing elsewhere when the secret's project is unknown", () => {
    expect(targetsOtherProject("/grants/query?project_id=proj_other", "")).toBe(false);
    expect(targetsOtherProject("/projects/proj_other", "")).toBe(false);
  });
});
