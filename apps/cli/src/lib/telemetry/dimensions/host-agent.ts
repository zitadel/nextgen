import type { Property } from "../property";

/** Fixed-enum identity of the agent or host driving the process. */
class HostAgent implements Property<NodeJS.ProcessEnv, string> {
  /** Predicate → reported name, in match order. */
  private static readonly agents: ReadonlyArray<
    readonly [(env: NodeJS.ProcessEnv) => boolean, string]
  > = [
    [(env) => Boolean(env.CLAUDECODE || env.CLAUDE_CODE_ENTRYPOINT), "claude_code"],
    [(env) => Boolean(env.CURSOR_TRACE_ID || env.CURSOR_AGENT), "cursor"],
    [(env) => env.TERM_PROGRAM === "vscode", "vscode"],
  ];

  public value(env: NodeJS.ProcessEnv): string {
    return HostAgent.agents.find(([matches]) => matches(env))?.[1] ?? "unknown";
  }
}

export const hostAgent = new HostAgent();
