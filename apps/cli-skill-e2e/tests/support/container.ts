import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { join } from "node:path";

import { AgentClient } from "./agent-client";
import { packageRoot, settings } from "./settings";

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
  workDir: string;
  /** Host directory mounted as `/out`, where the container leaves its logs. */
  outDir: string;
  /** Whether the agent has the zitadel-cli skill installed. */
  skill: boolean;
}

export interface RunningAgent {
  client: AgentClient;
  stop(): void;
}

function docker(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync("docker", args, { encoding: "utf8" });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function credentialArgs(): string[] {
  if (settings.envFile) {
    return ["--env-file", settings.envFile];
  }
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    return ["-e", "CLAUDE_CODE_OAUTH_TOKEN"];
  }
  if (process.env.ANTHROPIC_API_KEY) {
    return ["-e", "ANTHROPIC_API_KEY"];
  }
  throw new Error(
    "No Claude credential. Set ENV_FILE=<file with ANTHROPIC_API_KEY=…> (or put it in " +
      ".secret.env), or export ANTHROPIC_API_KEY / CLAUDE_CODE_OAUTH_TOKEN " +
      "(mint one with `claude setup-token`).",
  );
}

function skillInstall(skill: boolean): string {
  if (!skill) {
    return "echo 'baseline: no skill'";
  }
  // `--full-depth` is required: the repo ships a shallow root skill
  // (`skills/zitadel`, the router) as well as the deeper `zitadel-cli`
  // (`apps/cli/skills/zitadel-cli`). Without it, `skills add` stops at the
  // shallowest skill it finds and never discovers `zitadel-cli`.
  const source = settings.localSkill ? "/skill-src" : `${settings.repo}#${settings.branch}`;
  return `npx -y skills@latest add '${source}' --full-depth --skill zitadel-cli --agent claude-code -g -y --copy >/out/skill-install.log 2>&1`;
}

/** Install the skill and Claude Code, then hand over to the agent server. */
function bootstrap(skill: boolean): string {
  return `set -e
mkdir -p /ws/work && cd /ws/work
${skillInstall(skill)}
( ls -R /root/.claude/skills 2>/dev/null || echo "no global skills" ) > /out/skills-present.txt
TOK="\${ANTHROPIC_API_KEY:-}"; case "$TOK" in sk-ant-oat*) export CLAUDE_CODE_OAUTH_TOKEN="$TOK"; unset ANTHROPIC_API_KEY ;; esac
npm i -g @anthropic-ai/claude-code@latest >/out/claude-install.log 2>&1 || true
node "$(npm root -g)/@anthropic-ai/claude-code/install.cjs" >>/out/claude-install.log 2>&1 || true
exec node /harness/scripts/agent-server.mjs`;
}

/**
 * Start the eval container and wait until its agent server answers. The agent
 * runs in a clean machine; its published port is bound to loopback only and
 * every call needs this run's token.
 */
export async function startAgent(options: ContainerOptions): Promise<RunningAgent> {
  const token = randomBytes(16).toString("hex");
  const name = `zitadel-skill-eval-${randomBytes(4).toString("hex")}`;
  const args = [
    "run",
    "-d",
    "--name",
    name,
    "-p",
    `127.0.0.1::${AGENT_PORT}`,
    ...credentialArgs(),
    "-e",
    `AGENT_TOKEN=${token}`,
    "-e",
    `PORT=${AGENT_PORT}`,
    "-e",
    `CALL_TIMEOUT_MS=${settings.callTimeoutMs}`,
    "-e",
    "WORK=/ws/work",
    "-e",
    "OUT=/out",
    "-e",
    "IS_SANDBOX=1",
    "-e",
    "ZITADEL_TELEMETRY=0",
    "-e",
    "DO_NOT_TRACK=1",
    "-e",
    "DISABLE_TELEMETRY=1",
    "-e",
    "DISABLE_AUTOUPDATER=1",
    "-e",
    "DISABLE_ERROR_REPORTING=1",
    "-v",
    `${options.workDir}:/ws`,
    "-v",
    `${options.outDir}:/out`,
    "-v",
    `${join(packageRoot, "scripts")}:/harness/scripts:ro`,
  ];
  if (settings.localSkill) {
    args.push("-v", `${join(packageRoot, "../cli/skills")}:/skill-src:ro`);
  }
  args.push(settings.image, "bash", "-lc", bootstrap(options.skill));

  const started = docker(args);
  if (started.status !== 0) {
    throw new Error(`docker run failed: ${started.stderr.trim()}`);
  }
  const stop = (): void => {
    docker(["rm", "-f", name]);
  };

  try {
    const mapping = docker(["port", name, `${AGENT_PORT}/tcp`])
      .stdout.trim()
      .split("\n")[0];
    const hostPort = mapping?.split(":").pop();
    if (!hostPort) {
      throw new Error(`no published port for ${name}: ${mapping}`);
    }
    const client = new AgentClient(`http://127.0.0.1:${hostPort}`, token);
    const deadline = Date.now() + READY_TIMEOUT_MS;
    while (!(await client.isUp())) {
      const running = docker(["inspect", "-f", "{{.State.Running}}", name]).stdout.trim();
      if (running !== "true") {
        throw new Error(
          `the container exited before it was ready:\n${docker(["logs", name]).stdout}`,
        );
      }
      if (Date.now() > deadline) {
        throw new Error(`the agent server was not ready after ${READY_TIMEOUT_MS / 1000}s`);
      }
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
    return { client, stop };
  } catch (error) {
    stop();
    throw error;
  }
}
