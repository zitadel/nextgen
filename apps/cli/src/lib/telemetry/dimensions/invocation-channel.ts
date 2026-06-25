import type { Property } from "../property";

/** Package manager that launched the process, read from its user-agent. */
class InvocationChannel implements Property<NodeJS.ProcessEnv, string> {
  /** Ordered so a more specific name wins — `pnpm` is matched before the `npm` prefix. */
  private static readonly managers = ["pnpm", "yarn", "bun", "npm"] as const;

  public value(env: NodeJS.ProcessEnv): string {
    const userAgent = env.npm_config_user_agent ?? "";
    return InvocationChannel.managers.find((manager) => userAgent.startsWith(manager)) ?? "unknown";
  }
}

export const invocationChannel = new InvocationChannel();
