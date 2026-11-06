import type { AgentClient } from "./agent-client.ts";
import { settings } from "./settings.ts";

/**
 * Which skill a run had: where it came from and a short hash of every file
 * actually installed in the container, reference files included, so two runs of
 * different skill text are told apart whatever branch or checkout they came from.
 */
export async function skillVersion(agent: AgentClient): Promise<string> {
  const source = settings.localSkill ? "local" : `${settings.repo}#${settings.branch}`;
  const hashed = await agent.exec({
    file: "bash",
    args: [
      "-lc",
      "cd ~/.agents/skills/zitadel-cli && find . -type f -print0 | sort -z | xargs -0 sha256sum | sha256sum | cut -c1-12",
    ],
  });
  return `${source}@${hashed.stdout.trim() || "unknown"}`;
}

/** The CLI release the run's checks (and the agent) resolved, asked of the container. */
export async function cliVersion(agent: AgentClient, cliSpec: string): Promise<string> {
  const run = await agent.exec({ file: "npx", args: ["-y", cliSpec, "--version"] });
  return run.stdout.trim().split(/\s+/)[0] ?? "unknown";
}
