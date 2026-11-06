import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { packageRoot } from "../../src/paths.ts";
import type { AgentClient } from "./agent-client.ts";
import { settings } from "./settings.ts";

/**
 * Which skill a run had: from this checkout, a short hash of its text, so two
 * runs of different edits are told apart; from GitHub, the branch.
 */
export function skillVersion(): string {
  if (!settings.localSkill) {
    return `${settings.repo}#${settings.branch}`;
  }
  const text = readFileSync(join(packageRoot, "../cli/skills/zitadel-cli/SKILL.md"));
  return `local:${createHash("sha256").update(text).digest("hex").slice(0, 12)}`;
}

/** The CLI release the run's checks (and the agent) resolved, asked of the container. */
export async function cliVersion(agent: AgentClient, cliSpec: string): Promise<string> {
  const run = await agent.exec({
    file: "npx",
    args: ["-y", cliSpec, "--version"],
  });
  return run.stdout.trim().split(/\s+/)[0] ?? "unknown";
}
