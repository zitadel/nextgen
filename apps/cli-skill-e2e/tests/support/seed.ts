import { cpSync } from "node:fs";
import { join } from "node:path";

import type { StartingPoint } from "../../src/journey.ts";
import { packageRoot } from "../../src/paths.ts";
import type { AgentClient } from "./agent-client.ts";

const INSTALL_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Put the journey's starting app in the workspace: copy it in, commit it so
 * the tree is clean (setup refuses a dirty one), then install it, so it looks
 * like an app a team already runs.
 */
export async function seedWorkspace(
  agent: AgentClient,
  workspace: string,
  start: StartingPoint,
): Promise<void> {
  cpSync(join(packageRoot, "fixtures", start.fixture), workspace, {
    recursive: true,
    filter: (source) => !/(^|\/)(node_modules|\.next)(\/|$)/.test(source),
  });
  const seeded = await agent.exec({
    file: "bash",
    args: [
      "-lc",
      `git init -q -b main && git add -A && git -c user.name=Developer -c user.email=dev@example.com commit -q -m "initial commit" && ${start.install}`,
    ],
    timeoutMs: INSTALL_TIMEOUT_MS,
  });
  if (seeded.status !== 0) {
    throw new Error(`could not set up the starting app: ${seeded.stderr || seeded.stdout}`);
  }
}
