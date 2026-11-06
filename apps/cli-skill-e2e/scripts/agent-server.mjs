// Runs inside the eval container: the only thing the host talks to. The test on
// the host drives the whole journey over HTTP, so the agent, the Zitadel server
// and the app it scaffolds stay in the container while the test, its temp dir
// and its grading stay on the host.
//
//   GET  /health          readiness probe, no token
//   POST /turn            one agent turn (`claude -p`); streams NDJSON — every
//                         stream-json line the agent prints, a heartbeat while
//                         it is quiet, then one `turn_end` line
//   POST /simulated-user  a cheap, skill-less Claude answering as the developer
//   POST /exec            run a command in the workspace, return its output
//   POST /check/app       drive the scaffolded app in a browser (verify-app.mjs)
//
// Every call except /health carries the run's token in `x-agent-token`.
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync } from "node:fs";

import { runAppCheck } from "./verify-app.mjs";

const PORT = Number(process.env.PORT || 4000);
const TOKEN = process.env.AGENT_TOKEN || "";
const WORK = process.env.WORK || "/work";
const CALL_TIMEOUT_MS = Number(process.env.CALL_TIMEOUT_MS || 7 * 60 * 1000);
const HEARTBEAT_MS = 15_000;
const MAX_OUTPUT = 32 * 1024 * 1024;
const DONE = "DONE";

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => {
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

/**
 * Start a process, handing each stdout line to `onLine` as it arrives. `done`
 * settles when it exits; a call that outlives `timeoutMs` is killed and
 * reported as timed out, so one wedged call cannot hold the whole journey.
 */
function start(file, args, { cwd, env, timeoutMs, onLine }) {
  const child = spawn(file, args, {
    cwd,
    env: env ?? process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const done = new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let pending = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      if (stdout.length < MAX_OUTPUT) {
        stdout += text;
      }
      if (onLine) {
        pending += text;
        let newline = pending.indexOf("\n");
        while (newline !== -1) {
          const line = pending.slice(0, newline);
          pending = pending.slice(newline + 1);
          if (line.trim()) {
            onLine(line);
          }
          newline = pending.indexOf("\n");
        }
      }
    });
    child.stderr.on("data", (chunk) => {
      if (stderr.length < MAX_OUTPUT) {
        stderr += chunk.toString("utf8");
      }
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({
        status: null,
        signal: null,
        timedOut,
        stdout,
        stderr: `${stderr}${error.message}`,
      });
    });
    child.on("close", (status, signal) => {
      clearTimeout(timer);
      if (onLine && pending.trim()) {
        onLine(pending);
      }
      resolve({ status, signal, timedOut, stdout, stderr });
    });
  });
  return { child, done };
}

function run(file, args, options) {
  return start(file, args, options).done;
}

/** One agent turn, streamed. Mirrors `claude -p --output-format stream-json`. */
async function turn(req, res) {
  const { prompt, sessionId, model, maxTurns } = await readJson(req);
  res.writeHead(200, { "content-type": "application/x-ndjson", "cache-control": "no-store" });
  res.flushHeaders();
  const heartbeat = setInterval(() => {
    res.write(`${JSON.stringify({ type: "heartbeat" })}\n`);
  }, HEARTBEAT_MS);

  const args = [
    "-p",
    prompt,
    "--model",
    model,
    "--output-format",
    "stream-json",
    "--verbose",
    "--dangerously-skip-permissions",
    "--max-turns",
    String(maxTurns),
  ];
  if (sessionId) {
    args.push("--resume", sessionId);
  }

  let sid = sessionId ?? null;
  let lastText = "";
  let isError = false;
  const { child, done } = start("claude", args, {
    cwd: WORK,
    timeoutMs: CALL_TIMEOUT_MS,
    onLine(line) {
      res.write(`${line}\n`);
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        return;
      }
      if (event.type === "system" && event.subtype === "init" && event.session_id) {
        sid = event.session_id;
      } else if (event.type === "assistant") {
        for (const block of event.message?.content ?? []) {
          if (block?.type === "text" && (block.text ?? "").trim()) {
            lastText = block.text;
          }
        }
      } else if (event.type === "result") {
        isError = event.is_error ?? isError;
      }
    },
  });
  res.on("close", () => {
    if (!res.writableEnded) {
      child.kill("SIGKILL");
    }
  });
  const { status, timedOut } = await done;
  clearInterval(heartbeat);
  const failed = isError || timedOut || status !== 0;
  res.write(
    `${JSON.stringify({ type: "turn_end", sessionId: sid, lastText, isError: failed, timedOut })}\n`,
  );
  res.end();
}

/** The simulated developer's reply to the agent's latest message, or DONE. */
async function simulatedUser(req, res) {
  const { persona, agentText, model } = await readJson(req);
  const prompt = `You are the developer using an AI coding agent to add authentication to your app. Stay in character as the user — you do NOT run commands or write code, you only answer the agent.

Your preferences:
${persona}

The agent just said to you:
"""
${agentText}
"""

If the agent is asking you something, reply briefly and concretely from your preferences above — nothing more. Do not volunteer requirements it didn't ask about. If the agent has finished the task and is not asking you anything, reply with exactly: ${DONE}`;
  // A throwaway config dir keeps the globally installed skill out of the
  // simulated user's context: it must answer as a human, not drive the CLI.
  const home = "/tmp/sim-home";
  mkdirSync(home, { recursive: true });
  const { stdout } = await run(
    "claude",
    [
      "-p",
      prompt,
      "--model",
      model,
      "--output-format",
      "json",
      "--max-turns",
      "1",
      "--dangerously-skip-permissions",
    ],
    {
      cwd: "/tmp",
      env: { ...process.env, CLAUDE_CONFIG_DIR: home },
      timeoutMs: Math.min(CALL_TIMEOUT_MS, 2 * 60 * 1000),
    },
  );
  let text;
  try {
    text = (JSON.parse(stdout || "{}").result || "").trim();
  } catch {
    text = stdout.trim();
  }
  sendJson(res, 200, { text });
}

async function exec(req, res) {
  const { file, args = [], cwd, timeoutMs } = await readJson(req);
  const { status, signal, timedOut, stdout, stderr } = await run(file, args, {
    cwd: cwd ?? WORK,
    timeoutMs: timeoutMs ?? 2 * 60 * 1000,
  });
  sendJson(res, 200, { status, signal, timedOut, stdout, stderr });
}

async function checkApp(req, res) {
  const { check, stageId } = await readJson(req);
  sendJson(res, 200, { results: await runAppCheck(check, stageId) });
}

const ROUTES = {
  "POST /turn": turn,
  "POST /simulated-user": simulatedUser,
  "POST /exec": exec,
  "POST /check/app": checkApp,
};

createServer(async (req, res) => {
  const route = `${req.method} ${(req.url ?? "").split("?")[0]}`;
  if (route === "GET /health") {
    sendJson(res, 200, { ok: true });
    return;
  }
  if (!TOKEN || req.headers["x-agent-token"] !== TOKEN) {
    sendJson(res, 401, { error: "missing or wrong x-agent-token" });
    return;
  }
  const handler = ROUTES[route];
  if (!handler) {
    sendJson(res, 404, { error: `no route ${route}` });
    return;
  }
  try {
    await handler(req, res);
  } catch (error) {
    if (res.headersSent) {
      res.end();
    } else {
      sendJson(res, 500, { error: String(error?.message ?? error) });
    }
  }
}).listen(PORT, "0.0.0.0", () => {
  console.log(`agent server listening on ${PORT}`);
});
