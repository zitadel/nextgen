import type { Property } from "../property";

/** Package manager that launched the process, read from its user-agent. */
class InvocationChannel implements Property<NodeJS.ProcessEnv, string> {
  public value(env: NodeJS.ProcessEnv): string {
    const userAgent = env.npm_config_user_agent ?? "";
    if (userAgent.startsWith("pnpm")) {
      return "pnpm";
    }
    if (userAgent.startsWith("yarn")) {
      return "yarn";
    }
    if (userAgent.startsWith("bun")) {
      return "bun";
    }
    if (userAgent.startsWith("npm")) {
      return "npm";
    }
    return "unknown";
  }
}

export const invocationChannel = new InvocationChannel();
