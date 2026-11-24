import { describe, expect, it } from "vitest";

import { projectHash } from "@/lib/telemetry/dimensions/project-hash";

describe("projectHash", () => {
  it("is the SHA-256 of the project's id in lowercase hex, which the server hashes the same way", () => {
    expect(projectHash.value("proj_123")).toBe(
      "d3d3b2ee81d586bb329803825fa5e8760d50fa6fe3092bf91f1f95355060eb8b",
    );
  });

  it("names the same project the same way every time, and two projects differently", () => {
    expect(projectHash.value("proj_1")).toBe(projectHash.value("proj_1"));
    expect(projectHash.value("proj_1")).not.toBe(projectHash.value("proj_2"));
  });

  it("says nothing for a run with no project", () => {
    expect(projectHash.value(undefined)).toBeUndefined();
  });
});
