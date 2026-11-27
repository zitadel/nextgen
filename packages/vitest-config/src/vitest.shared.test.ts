import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { edgeProject } from "./vitest.shared.mjs";

describe("edgeProject", () => {
  it("finds the edge specs under root, whatever the working directory", () => {
    const root = mkdtempSync(join(tmpdir(), "edge-project-"));
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "src", "jwt.edge.test.ts"), "");

    expect(edgeProject({ root }).test.name).toBe("edge");
  });

  it("refuses a root with no spec to run", () => {
    const root = mkdtempSync(join(tmpdir(), "edge-project-"));

    expect(() => edgeProject({ root })).toThrow(`edgeProject: no spec matches`);
  });
});
