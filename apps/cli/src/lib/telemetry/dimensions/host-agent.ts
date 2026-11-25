import { detectAgent } from "agent-cli-detector";

import type { Property } from "@/lib/telemetry/property";

/**
 * The coding agent or host driving the process: the agent `agent-cli-detector`
 * recognises, by its id with underscores (`claude_code`), else `vscode` inside
 * VS Code's terminal, else `unknown`.
 */
class HostAgent implements Property<NodeJS.ProcessEnv, string> {
  public value(env: NodeJS.ProcessEnv): string {
    const found = detectAgent({ env });
    if (found.detected && found.agent) {
      return found.agent.id.replaceAll("-", "_");
    }

    return env.TERM_PROGRAM === "vscode" ? "vscode" : "unknown";
  }
}

export const hostAgent = new HostAgent();
