import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { type ChildProcess, spawn } from "node:child_process";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AgentClient } from "../support/agent-client";
import { packageRoot } from "../support/settings";

const TOKEN = "unit-test-token";

/** A stand-in for `claude`: prints the stream-json a real turn would, or a simulated user's JSON. */
const FAKE_CLAUDE = `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args.includes("json")) {
  console.log(JSON.stringify({ result: "DONE" }));
} else {
  console.log(JSON.stringify({ type: "system", subtype: "init", session_id: "sess-1" }));
  console.log(JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "hello developer" }] } }));
  console.log(JSON.stringify({ type: "result", is_error: false, num_turns: 1 }));
}
`;

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const server = createServer();
    server.listen(0, () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
  });
}

describe("the agent server and its client", () => {
  let dir: string;
  let server: ChildProcess;
  let client: AgentClient;
  let base: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "zitadel-skill-eval-server-"));
    writeFileSync(join(dir, "claude"), FAKE_CLAUDE);
    chmodSync(join(dir, "claude"), 0o755);
    const port = await freePort();
    base = `http://127.0.0.1:${port}`;
    server = spawn(process.execPath, [join(packageRoot, "scripts/agent-server.mjs")], {
      env: {
        ...process.env,
        PORT: String(port),
        AGENT_TOKEN: TOKEN,
        WORK: dir,
        PATH: `${dir}:${process.env.PATH}`,
      },
      stdio: "ignore",
    });
    client = new AgentClient(base, TOKEN);
    for (let attempt = 0; attempt < 50 && !(await client.isUp()); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  });

  afterAll(() => {
    server.kill();
    rmSync(dir, { recursive: true, force: true });
  });

  it("answers the health probe without a token", async () => {
    expect((await fetch(`${base}/health`)).status).toBe(200);
  });

  it("refuses a call without the run's token", async () => {
    const response = await fetch(`${base}/exec`, { method: "POST", body: "{}" });

    expect(response.status).toBe(401);
  });

  it("streams an agent turn and reports its session and last words", async () => {
    const turn = await client.turn({ prompt: "hi", model: "sonnet", maxTurns: "5" });

    expect({ sessionId: turn.sessionId, lastText: turn.lastText, isError: turn.isError }).toEqual({
      sessionId: "sess-1",
      lastText: "hello developer",
      isError: false,
    });
    expect(turn.lines).toHaveLength(3);
  });

  it("returns the simulated user's reply", async () => {
    const text = await client.simulatedUser({ persona: "p", agentText: "done?", model: "haiku" });

    expect(text).toBe("DONE");
  });

  it("runs a command in the workspace and returns its output", async () => {
    const result = await client.exec({ file: "node", args: ["-e", "console.log(process.cwd())"] });

    expect(result.stdout.trim()).toContain("zitadel-skill-eval-server-");
  });
});
