/**
 * Generic environment detection for telemetry — derives coarse, non-PII facts
 * about the runtime (CI, agent harness, package manager) from environment
 * variables. Pure functions with no application or CLI coupling.
 */

/** Whether this looks like an automated CI environment. */
export function isCi(env: NodeJS.ProcessEnv): boolean {
  return Boolean(env.CI) || Boolean(env.GITHUB_ACTIONS) || Boolean(env.GITLAB_CI);
}

/** Best-effort, coarse CI provider name. Returns `undefined` outside CI. */
export function ciProvider(env: NodeJS.ProcessEnv): string | undefined {
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

/**
 * Coarse identity of the agent/host driving the process, as a fixed enum (never
 * a free-form value). Useful for telling automated harnesses apart from humans.
 */
export function hostAgent(env: NodeJS.ProcessEnv): string {
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

/**
 * How the process was invoked, derived from the package manager's user-agent.
 * Tells `npx`/`pnpm dlx` one-shot runs apart from a resolved install, leaking no
 * path. The UA leads with the package-manager token, e.g.
 * "pnpm/10 npm/? node/v24" — check the more specific names first since "pnpm"
 * contains the substring "npm".
 */
export function invocationChannel(env: NodeJS.ProcessEnv): string {
  const ua = env.npm_config_user_agent ?? "";
  if (ua.startsWith("pnpm")) {
    return "pnpm";
  }
  if (ua.startsWith("yarn")) {
    return "yarn";
  }
  if (ua.startsWith("bun")) {
    return "bun";
  }
  if (ua.startsWith("npm")) {
    return "npm";
  }
  return "unknown";
}
