#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

// The publish gate (`release:gate`) records its decision here; every
// publish-side task (`release:verify-artifacts`, `release:publish-*`) reads it
// before acting. Moon deps cannot pass a runtime decision between tasks, so
// the plan file is the cross-task contract that keeps the graph in Moon while
// letting a "skip" gate turn the whole publish chain into a green no-op.
export const PUBLISH_PLAN_FILE = join("dist", "release", "publish-plan.json");

export function publishPlanPath(repoRoot) {
  return join(repoRoot, PUBLISH_PLAN_FILE);
}

export async function writePublishPlan(repoRoot, plan) {
  const normalized = normalizePublishPlan(plan);
  const path = publishPlanPath(repoRoot);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(normalized, null, 2)}\n`);
  return normalized;
}

export async function readPublishPlan(repoRoot) {
  const path = publishPlanPath(repoRoot);
  let source;
  try {
    source = await readFile(path, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(
        `missing publish plan at ${path}; run the release gate first ` +
          "(moon run release:publish evaluates it, or moon run release:gate directly)",
      );
    }
    throw error;
  }
  return normalizePublishPlan(JSON.parse(source));
}

export async function readPublishPlanIfExists(repoRoot) {
  try {
    return await readPublishPlan(repoRoot);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("missing publish plan")) {
      return null;
    }
    throw error;
  }
}

export function normalizePublishPlan(plan) {
  if (!plan || typeof plan !== "object") {
    throw new Error("invalid publish plan: expected an object");
  }
  if (typeof plan.shouldPublish !== "boolean") {
    throw new Error("invalid publish plan: shouldPublish must be a boolean");
  }
  if (typeof plan.version !== "string" || plan.version.length === 0) {
    throw new Error("invalid publish plan: version is required");
  }
  return {
    shouldPublish: plan.shouldPublish,
    dryRun: Boolean(plan.dryRun),
    reason: typeof plan.reason === "string" ? plan.reason : "",
    version: plan.version,
    tag: typeof plan.tag === "string" ? plan.tag : `v${plan.version}`,
    prerelease: Boolean(plan.prerelease),
    recoverVersion: typeof plan.recoverVersion === "string" ? plan.recoverVersion : "",
  };
}

export function planSkipMessage(surface, plan) {
  return `release ${surface}: skip - ${plan.reason || "publish gate declined"}`;
}
