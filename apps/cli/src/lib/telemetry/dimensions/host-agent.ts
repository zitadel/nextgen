import type { Property } from "../property";

/** Fixed-enum identity of the agent or host driving the process. */
class HostAgent implements Property<NodeJS.ProcessEnv, string> {
  public value(env: NodeJS.ProcessEnv): string {
    if (env.CLAUDECODE || env.CLAUDE_CODE_ENTRYPOINT) {
      return "claude_code";
    }
    if (env.CURSOR_TRACE_ID || env.CURSOR_AGENT) {
      return "cursor";
    }
    if (env.TERM_PROGRAM === "vscode") {
      return "vscode";
    }
    return "unknown";
  }
}

export const hostAgent = new HostAgent();
