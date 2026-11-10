import { existsSync } from "node:fs";
import { join } from "node:path";

import { DEFAULT_SIM_MODEL } from "../../src/defaults.ts";
import { packageRoot } from "../../src/paths.ts";

const env = process.env;

const secretFile = join(packageRoot, ".env");

/**
 * Everything a run can be tuned with, read once from the environment. The
 * defaults are the ones a developer wants for a normal run.
 */
export const settings = Object.freeze({
  image: env.IMAGE ?? "node:24",
  repo: env.REPO ?? "zitadel/nextgen",
  /** The skill's git branch; ignored when `localSkill` is set. */
  branch: env.BRANCH ?? "main",
  /** Install the skill from this checkout instead of GitHub, to try an edit before pushing it. */
  localSkill: env.LOCAL_SKILL === "1",
  envFile: env.ENV_FILE ?? (existsSync(secretFile) ? secretFile : ""),
  simModel: env.SIM_MODEL ?? DEFAULT_SIM_MODEL,
  maxTurns: env.MAX_TURNS ?? "40",
  baselineMaxTurns: env.BASELINE_MAX_TURNS ?? "5",
  maxQa: Number(env.MAX_QA ?? "6"),
  callTimeoutMs: Number(env.CALL_TIMEOUT_MS ?? 7 * 60 * 1000),
  /** `STAGES=1,4,5` runs just those stages; include 1, the journey is stateful. */
  stages: env.STAGES ? new Set(env.STAGES.split(",").map((id) => Number(id.trim()))) : undefined,
  outDir: env.OUT ?? join(packageRoot, "out"),
});
