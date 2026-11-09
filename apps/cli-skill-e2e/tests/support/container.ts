import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { join } from "node:path";

import { packageRoot } from "../../src/paths.ts";
import { type AgentClient, createAgentClient } from "./agent-client.ts";
import { settings } from "./settings.ts";

const AGENT_PORT = 4000;
const READY_TIMEOUT_MS = 10 * 60 * 1000;

/** What the container needs from the host. */
export interface ContainerOptions {
  /**
   * Host directory mounted at `/ws`; the agent works in its `work` folder. The
   * folder sits one level down because the CLI stashes files beside a project
   * while it scaffolds, and a rename into the container's own filesystem
   * fails across a mount boundary.
   */
  readonly workDir: string;
  /** Host directory mounted as `/out`, where the container leaves its logs. */
  readonly outDir: string;
  /** Whether the agent has the zitadel-cli skill installed. */
  readonly skill: boolean;
}

export interface RunningAgent {
  readonly client: AgentClient;
  stop(): void;
}

const docker = (args: ReadonlyArray<string>) => {
  const result = spawnSync("docker", [...args], { encoding: "utf8" });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
};

function credentialArguments(): ReadonlyArray<string> {
  if (settings.envFile !== "") {
    return ["--env-file", settings.envFile];
  }
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN !== undefined) {
    return ["-e", "CLAUDE_CODE_OAUTH_TOKEN"];
  }
  if (process.env.ANTHROPIC_API_KEY !== undefined) {
    return ["-e", "ANTHROPIC_API_KEY"];
  }
  throw new Error(
    "No Claude credential. Set ENV_FILE=<file with ANTHROPIC_API_KEY=…> (or put it in " +
      ".secret.env), or export ANTHROPIC_API_KEY / CLAUDE_CODE_OAUTH_TOKEN " +
      "(mint one with `claude setup-token`).",
  );
}

/**
 * Install the zitadel-cli skill the way a user would. `--full-depth` is
 * required: the repo ships a shallow root skill (`skills/zitadel`, the router)
 * as well as the deeper `zitadel-cli` (`apps/cli/skills/zitadel-cli`), and
 * without it `skills add` stops at the shallowest skill it finds.
 */
function skillInstall(skill: boolean): string {
  if (!skill) {
    return "echo 'baseline: no skill'";
  }
  const source = settings.localSkill ? "/skill-src" : `${settings.repo}#${settings.branch}`;
  return `npx -y skills@latest add '${source}' --full-depth --skill zitadel-cli --agent claude-code -g -y --copy >/out/skill-install.log 2>&1`;
}

/**
 * Install the skill and Claude Code, then hand over to the agent server. The
 * machine gets a git identity, as a developer's has: without one every
 * `git commit` the agent runs fails.
 */
const bootstrap = (skill: boolean): string => `set -e
git config --global user.name "Developer" && git config --global user.email "dev@example.com"
git config --global --add safe.directory /ws/work
mkdir -p /ws/work && cd /ws/work
${skillInstall(skill)}
( ls -R /root/.claude/skills 2>/dev/null || echo "no global skills" ) > /out/skills-present.txt
TOK="\${ANTHROPIC_API_KEY:-}"; case "$TOK" in sk-ant-oat*) export CLAUDE_CODE_OAUTH_TOKEN="$TOK"; unset ANTHROPIC_API_KEY ;; esac
npm i -g @anthropic-ai/claude-code@latest >/out/claude-install.log 2>&1 || true
node "$(npm root -g)/@anthropic-ai/claude-code/install.cjs" >>/out/claude-install.log 2>&1 || true
exec node --disable-warning=ExperimentalWarning /harness/container/agent-server.ts`;

const environment = (token: string): ReadonlyArray<string> =>
  Object.entries({
    AGENT_TOKEN: token,
    PORT: String(AGENT_PORT),
    CALL_TIMEOUT_MS: String(settings.callTimeoutMs),
    WORK: "/ws/work",
    OUT: "/out",
    IS_SANDBOX: "1",
    ZITADEL_TELEMETRY: "0",
    DO_NOT_TRACK: "1",
    DISABLE_TELEMETRY: "1",
    DISABLE_AUTOUPDATER: "1",
    DISABLE_ERROR_REPORTING: "1",
  }).flatMap(([name, value]) => ["-e", `${name}=${value}`]);

const runArguments = (options: ContainerOptions, name: string, token: string) => [
  "run",
  "-d",
  "--name",
  name,
  "-p",
  `127.0.0.1::${AGENT_PORT}`,
  ...credentialArguments(),
  ...environment(token),
  "-v",
  `${options.workDir}:/ws`,
  "-v",
  `${options.outDir}:/out`,
  "-v",
  `${join(packageRoot, "container")}:/harness/container:ro`,
  ...(settings.localSkill ? ["-v", `${join(packageRoot, "../cli/skills")}:/skill-src:ro`] : []),
  settings.image,
  "bash",
  "-lc",
  bootstrap(options.skill),
];

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Wait until the agent server answers, failing with the container's own log if it dies first. */
async function untilReady(client: AgentClient, name: string, deadline: number): Promise<void> {
  if (await client.isUp()) {
    return;
  }
  if (docker(["inspect", "-f", "{{.State.Running}}", name]).stdout.trim() !== "true") {
    throw new Error(`the container exited before it was ready:\n${docker(["logs", name]).stdout}`);
  }
  if (Date.now() > deadline) {
    throw new Error(`the agent server was not ready after ${READY_TIMEOUT_MS / 1000}s`);
  }
  await sleep(2_000);
  return untilReady(client, name, deadline);
}

/**
 * Start the eval container and wait until its agent server answers. The agent
 * runs in a clean machine; its published port is bound to loopback only and
 * every call needs this run's token.
 */
export async function startAgent(options: ContainerOptions): Promise<RunningAgent> {
  const token = randomBytes(16).toString("hex");
  const name = `zitadel-skill-eval-${randomBytes(4).toString("hex")}`;
  const started = docker(runArguments(options, name, token));
  if (started.status !== 0) {
    throw new Error(`docker run failed: ${started.stderr.trim()}`);
  }
  const stop = (): void => {
    docker(["rm", "-f", name]);
  };
  try {
    const published = docker(["port", name, `${AGENT_PORT}/tcp`])
      .stdout.trim()
      .split("\n")[0];
    const hostPort = published?.split(":").pop();
    if (!hostPort) {
      throw new Error(`no published port for ${name}: ${published}`);
    }
    const client = createAgentClient(`http://127.0.0.1:${hostPort}`, token);
    await untilReady(client, name, Date.now() + READY_TIMEOUT_MS);
    return { client, stop };
  } catch (error) {
    stop();
    throw error;
  }
}
