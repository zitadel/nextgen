import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

type PublishPlan = {
  shouldPublish: boolean;
  dryRun: boolean;
  reason: string;
  version: string;
  tag: string;
  prerelease: boolean;
  recoverVersion: string;
};

type ReleasePlanModule = {
  publishPlanPath: (repoRoot: string) => string;
  writePublishPlan: (repoRoot: string, plan: Partial<PublishPlan>) => Promise<PublishPlan>;
  readPublishPlan: (repoRoot: string) => Promise<PublishPlan>;
  readPublishPlanIfExists: (repoRoot: string) => Promise<PublishPlan | null>;
  normalizePublishPlan: (plan: unknown) => PublishPlan;
  planSkipMessage: (surface: string, plan: { reason?: string }) => string;
};

const tempDirs: string[] = [];

async function loadModule(): Promise<ReleasePlanModule> {
  return (await import(
    new URL("../../../../../scripts/release-plan.mjs", import.meta.url).href
  )) as ReleasePlanModule;
}

async function tempRepoRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "zitadel-release-plan-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

describe("release publish plan", () => {
  it("round-trips a normalized plan through the plan file", async () => {
    const { writePublishPlan, readPublishPlan } = await loadModule();
    const repoRoot = await tempRepoRoot();

    const written = await writePublishPlan(repoRoot, {
      shouldPublish: true,
      dryRun: true,
      reason: "version commit detected",
      version: "0.1.0-alpha.14",
      prerelease: true,
    });

    expect(written.tag).toBe("v0.1.0-alpha.14");
    expect(written.recoverVersion).toBe("");
    await expect(readPublishPlan(repoRoot)).resolves.toEqual(written);
  });

  it("fails with gate guidance when the plan file is missing", async () => {
    const { readPublishPlan, readPublishPlanIfExists } = await loadModule();
    const repoRoot = await tempRepoRoot();

    await expect(readPublishPlan(repoRoot)).rejects.toThrow("run the release gate first");
    await expect(readPublishPlanIfExists(repoRoot)).resolves.toBeNull();
  });

  it("rejects plans without a boolean decision or version", async () => {
    const { normalizePublishPlan } = await loadModule();

    expect(() => normalizePublishPlan({ version: "1.0.0" })).toThrow("shouldPublish");
    expect(() => normalizePublishPlan({ shouldPublish: true })).toThrow("version");
    expect(() => normalizePublishPlan(null)).toThrow("expected an object");
  });

  it("renders skip messages with the gate reason", async () => {
    const { planSkipMessage } = await loadModule();

    expect(planSkipMessage("publish-npm", { reason: "not a version commit" })).toBe(
      "release publish-npm: skip - not a version commit",
    );
    expect(planSkipMessage("publish-npm", {})).toBe(
      "release publish-npm: skip - publish gate declined",
    );
  });
});
