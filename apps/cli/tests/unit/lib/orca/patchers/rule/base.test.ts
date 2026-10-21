import { posix } from "node:path";

import Ajv2020 from "ajv/dist/2020";
import { describe, expect, it } from "vitest";

import type {
  FileOp,
  ScaffoldPlan,
} from "../../../../../../src/lib/orca/patchers/rule/file-writer/types";
import { ReactPatcher } from "../../../../../../src/lib/orca/patchers/rule/react";
import type { PatchContext } from "../../../../../../src/lib/orca/patchers/types";

function ctx(overrides: Partial<PatchContext> = {}): PatchContext {
  return {
    framework: { id: "react", appDir: "src", devPort: 3000, url: "http://localhost:3000" },
    rendererId: "react",
    project: {
      id: "proj-1",
      project_secret: "sk_full",
      preview_secret: "sk_preview",
      origins: [{ kind: "preview", pattern: "https://*.example.vercel.app" }],
      created_at: "2026-01-01T00:00:00.000Z",
    },
    issuer: "http://localhost:3000",
    server: "http://localhost:8080",
    cliVersion: "0.1.0-alpha.0",
    ...overrides,
  };
}

function written(plan: ScaffoldPlan, path: string): Record<string, unknown> {
  const op = plan.ops.find(
    (candidate): candidate is Extract<FileOp, { kind: "write" }> =>
      candidate.kind === "write" && candidate.path === path,
  );
  expect(op, `${path} is written`).toBeDefined();
  return JSON.parse(op?.contents ?? "") as Record<string, unknown>;
}

// The base ops are shared by every rule patcher; React stands in for them.
describe("zitadel.json", () => {
  it("points $schema at a copy setup writes, which accepts the file", () => {
    const plan = new ReactPatcher().plan(ctx({ preset: "passkey-first", useCase: "consumer" }));
    const config = written(plan, "zitadel.json");

    const ref = config.$schema as string;
    expect(ref).not.toMatch(/^https?:/);
    const schema = written(plan, posix.normalize(ref));

    const validate = new Ajv2020({ strict: false, validateFormats: false }).compile(schema);
    expect(validate(config), JSON.stringify(validate.errors)).toBe(true);
  });
});
