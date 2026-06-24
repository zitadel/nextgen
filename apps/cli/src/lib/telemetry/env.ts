import type { Property } from "./property";

/** Whether the process is running inside an automated CI environment. */
class CiFlag implements Property<NodeJS.ProcessEnv, boolean> {
  public value(env: NodeJS.ProcessEnv): boolean {
    return Boolean(env.CI) || Boolean(env.GITHUB_ACTIONS) || Boolean(env.GITLAB_CI);
  }
}

/** Coarse CI provider name, or `undefined` when not running in CI. */
class CiProvider implements Property<NodeJS.ProcessEnv, string | undefined> {
  public value(env: NodeJS.ProcessEnv): string | undefined {
    if (env.GITHUB_ACTIONS) {
      return "github_actions";
    }
    if (env.GITLAB_CI) {
      return "gitlab_ci";
    }
    if (env.CIRCLECI) {
      return "circleci";
    }
    if (env.BUILDKITE) {
      return "buildkite";
    }
    if (env.JENKINS_URL) {
      return "jenkins";
    }
    return env.CI ? "unknown" : undefined;
  }
}

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

export const ciFlag = new CiFlag();
export const ciProvider = new CiProvider();
export const hostAgent = new HostAgent();
export const invocationChannel = new InvocationChannel();
