// Runs inside the eval container: the only thing the host talks to. The test on
// the host drives the whole journey over HTTP, so the agent, the Zitadel server
// and the app it scaffolds stay in the container while the test, its temp dir
// and its grading stay on the host. Node runs this file as it is, by stripping
// its types; it therefore uses only syntax that can be erased.
//
//   GET  /health          readiness probe, no token
//   POST /turn            one agent turn (`claude -p`); streams NDJSON — every
//                         stream-json line the agent prints, a heartbeat while
//                         it is quiet, then one `turn_end` line
//   POST /simulated-user  a cheap, skill-less Claude answering as the developer
//   POST /exec            run a command in the workspace, return its output
//   POST /check/app       drive the scaffolded app in a browser (app-checks.ts)
//
// Every call except /health carries the run's token in `x-agent-token`.
import { type ChildProcess, spawn } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { join } from "node:path";

import { type AppCheckSpec, runAppCheck } from "./app-checks.ts";

const PORT = Number(process.env.PORT ?? 4000);
// All interfaces inside the container, whose published port is bound to loopback
// by the host; run anywhere else, set AGENT_HOST=127.0.0.1.
const HOST = process.env.AGENT_HOST ?? "0.0.0.0";
const TOKEN = process.env.AGENT_TOKEN ?? "";
const WORK = process.env.WORK ?? "/work";
const OUT = process.env.OUT ?? "/out";
const CALL_TIMEOUT_MS = Number(process.env.CALL_TIMEOUT_MS ?? 7 * 60 * 1000);
const HEARTBEAT_MS = 15_000;
const SIMULATED_USER_TIMEOUT_MS = 2 * 60 * 1000;
const EXEC_TIMEOUT_MS = 2 * 60 * 1000;
const CLEANUP_GRACE_MS = 5_000;
const DONE = "DONE";

type Handler = (request: IncomingMessage, response: ServerResponse) => Promise<void>;

interface ProcessResult {
  readonly status: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly timedOut: boolean;
  readonly stdout: string;
  readonly stderr: string;
}

interface StartOptions {
  readonly cwd: string;
  readonly timeoutMs: number;
  readonly env?: NodeJS.ProcessEnv;
  readonly onLine?: (line: string) => void;
}

const ndjson = (value: unknown): string => `${JSON.stringify(value)}\n`;

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

async function readJson<T>(request: IncomingMessage): Promise<T> {
  const body = Buffer.concat((await Array.fromAsync(request)) as Buffer[]).toString("utf8");
  return JSON.parse(body === "" ? "{}" : body) as T;
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

/**
 * Everything `source` yields. A pipe destroyed after a kill ends the collection
 * with what arrived instead of failing the call.
 */
async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];
  try {
    for await (const item of source) {
      items.push(item);
    }
  } catch {
    // Destroyed while a descendant still held it: what arrived is what there is.
  }
  return items;
}

/** What went wrong goes in the log the results folder keeps, never in a response. */
function logError(route: string, error: unknown): void {
  appendFileSync(
    join(OUT, "agent-server.log"),
    `${new Date().toISOString()} ${route}: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
}

/**
 * Answer with NDJSON: a heartbeat while `work` runs, then one `result` line (or
 * an `error` line). A client gives up on a response that stays silent for five
 * minutes, and some of this work takes longer.
 */
async function streamed(
  response: ServerResponse,
  route: string,
  work: () => Promise<unknown>,
): Promise<void> {
  response.writeHead(200, { "content-type": "application/x-ndjson", "cache-control": "no-store" });
  response.flushHeaders();
  const heartbeat = setInterval(() => response.write(ndjson({ type: "heartbeat" })), HEARTBEAT_MS);
  try {
    response.write(ndjson({ type: "result", value: await work() }));
  } catch (error) {
    logError(route, error);
    response.write(ndjson({ type: "error", message: "internal error" }));
  } finally {
    clearInterval(heartbeat);
    response.end();
  }
}

/**
 * The lines a stream prints, each handed to `onLine` as it completes. It reads
 * the stream itself rather than through `readline`, whose iterator never ends
 * when its input is destroyed: a pipe destroyed after a kill ends the
 * collection with what arrived. The partial line is the only state kept.
 */
async function collectLines(
  stream: NodeJS.ReadableStream,
  onLine?: (line: string) => void,
): Promise<string[]> {
  stream.setEncoding("utf8");
  const lines: string[] = [];
  const emit = (line: string): void => {
    lines.push(line);
    if (line.trim() !== "") {
      onLine?.(line);
    }
  };
  let pending = "";
  try {
    for await (const chunk of stream as AsyncIterable<string>) {
      const parts = `${pending}${chunk}`.split("\n");
      pending = parts.pop() ?? "";
      parts.forEach(emit);
    }
  } catch {
    // Destroyed while a descendant still held it: what arrived is what there is.
  }
  if (pending !== "") {
    emit(pending);
  }
  return lines;
}

/**
 * Start a process. `onLine` hears each stdout line as it arrives; `done`
 * settles when the process exits. A call that outlives `timeoutMs` is killed
 * and reported as timed out, so one wedged call cannot hold the whole journey.
 */
function start(
  file: string,
  args: ReadonlyArray<string>,
  options: StartOptions,
): {
  readonly child: ChildProcess;
  readonly done: Promise<ProcessResult>;
  readonly kill: () => void;
} {
  // Its own process group, so a timeout or a disconnect takes down the commands
  // it started too: a descendant holding the pipes open would otherwise keep
  // the call waiting. Processes that deliberately detach (a dev server) are
  // in a group of their own and survive.
  const child = spawn(file, [...args], {
    cwd: options.cwd,
    env: options.env ?? process.env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  const kill = (): void => {
    try {
      process.kill(-(child.pid as number), "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
    // Whatever still holds a pipe does not get to keep the call open.
    setTimeout(() => {
      child.stdout?.destroy();
      child.stderr?.destroy();
    }, CLEANUP_GRACE_MS).unref();
  };
  const timer = setTimeout(kill, options.timeoutMs);
  const stdout = collectLines(child.stdout as NodeJS.ReadableStream, options.onLine);
  const stderr = collect(child.stderr as AsyncIterable<Buffer>).then((chunks) =>
    chunks.map((chunk) => chunk.toString("utf8")),
  );
  const outcome = new Promise<{
    readonly status: number | null;
    readonly signal: NodeJS.Signals | null;
    readonly failure: string;
  }>((resolve) => {
    child.once("error", (error) => resolve({ status: null, signal: null, failure: error.message }));
    child.once("close", (status, signal) => resolve({ status, signal, failure: "" }));
  });
  const done = Promise.all([stdout, stderr, outcome]).then(
    ([lines, errors, { status, signal, failure }]): ProcessResult => {
      clearTimeout(timer);
      return {
        status,
        signal,
        timedOut: signal === "SIGKILL",
        stdout: lines.join("\n"),
        stderr: `${errors.join("")}${failure}`,
      };
    },
  );
  return { child, done, kill };
}

const run = (file: string, args: ReadonlyArray<string>, options: StartOptions) =>
  start(file, args, options).done;

interface TurnSummary {
  readonly sessionId: string | null;
  readonly lastText: string;
  readonly isError: boolean;
}

interface StreamEvent {
  readonly type?: string;
  readonly subtype?: string;
  readonly session_id?: string;
  readonly is_error?: boolean;
  readonly message?: {
    readonly content?: ReadonlyArray<{ readonly type?: string; readonly text?: string }>;
  };
}

/** What a finished turn amounts to: its session, the agent's last words, and whether it ended in error. */
function summarizeTurn(lines: ReadonlyArray<string>, sessionId: string | null): TurnSummary {
  const events = lines
    .map((line) => parseJson(line) as StreamEvent | undefined)
    .filter((event): event is StreamEvent => event !== undefined);
  const spoken = events
    .filter((event) => event.type === "assistant")
    .flatMap((event) => event.message?.content ?? [])
    .filter((block) => block.type === "text" && (block.text ?? "").trim() !== "");
  return {
    sessionId:
      events.findLast(
        (event) => event.type === "system" && event.subtype === "init" && event.session_id,
      )?.session_id ?? sessionId,
    lastText: spoken.at(-1)?.text ?? "",
    isError:
      events.findLast((event) => event.type === "result" && event.is_error !== undefined)
        ?.is_error ?? false,
  };
}

interface TurnRequest {
  readonly prompt: string;
  readonly model: string;
  readonly maxTurns: string | number;
  readonly sessionId?: string | null;
}

/** One agent turn, streamed. Mirrors `claude -p --output-format stream-json`. */
const turn: Handler = async (request, response) => {
  const body = await readJson<TurnRequest>(request);
  response.writeHead(200, { "content-type": "application/x-ndjson", "cache-control": "no-store" });
  response.flushHeaders();
  const heartbeat = setInterval(() => response.write(ndjson({ type: "heartbeat" })), HEARTBEAT_MS);

  const { done, kill } = start(
    "claude",
    [
      "-p",
      body.prompt,
      "--model",
      body.model,
      "--output-format",
      "stream-json",
      "--verbose",
      "--dangerously-skip-permissions",
      "--max-turns",
      String(body.maxTurns),
      ...(body.sessionId ? ["--resume", body.sessionId] : []),
    ],
    { cwd: WORK, timeoutMs: CALL_TIMEOUT_MS, onLine: (line) => response.write(`${line}\n`) },
  );
  response.on("close", () => {
    if (!response.writableEnded) {
      kill();
    }
  });

  const result = await done.finally(() => clearInterval(heartbeat));
  const summary = summarizeTurn(result.stdout.split("\n"), body.sessionId ?? null);
  response.write(
    ndjson({
      type: "turn_end",
      ...summary,
      isError: summary.isError || result.timedOut || result.status !== 0,
      timedOut: result.timedOut,
    }),
  );
  response.end();
};

interface SimulatedUserRequest {
  readonly persona: string;
  readonly agentText: string;
  readonly model: string;
}

const developerPrompt = ({ persona, agentText }: SimulatedUserRequest): string =>
  `You are the developer using an AI coding agent to add authentication to your app. Stay in character as the user — you do NOT run commands or write code, you only answer the agent.

Your preferences:
${persona}

The agent just said to you:
"""
${agentText}
"""

If the agent is asking you something, reply briefly and concretely from your preferences above — nothing more. Do not volunteer requirements it didn't ask about. If the agent has finished the task and is not asking you anything, reply with exactly: ${DONE}`;

/** The simulated developer's reply to the agent's latest message, or DONE. */
const simulatedUser: Handler = async (request, response) => {
  const body = await readJson<SimulatedUserRequest>(request);
  await streamed(response, "POST /simulated-user", () => answerAsDeveloper(body));
};

async function answerAsDeveloper(body: SimulatedUserRequest): Promise<{ readonly text: string }> {
  // A throwaway config dir keeps the globally installed skill out of the
  // simulated user's context: it must answer as a human, not drive the CLI.
  const home = "/tmp/sim-home";
  mkdirSync(home, { recursive: true });
  const { stdout } = await run(
    "claude",
    [
      "-p",
      developerPrompt(body),
      "--model",
      body.model,
      "--output-format",
      "json",
      "--max-turns",
      "1",
      "--dangerously-skip-permissions",
    ],
    {
      cwd: "/tmp",
      env: { ...process.env, CLAUDE_CONFIG_DIR: home },
      timeoutMs: Math.min(CALL_TIMEOUT_MS, SIMULATED_USER_TIMEOUT_MS),
    },
  );
  const parsed = parseJson(stdout) as { readonly result?: string } | undefined;
  return { text: (parsed?.result ?? stdout).trim() };
}

interface ExecRequest {
  readonly file: string;
  readonly args?: ReadonlyArray<string>;
  readonly cwd?: string;
  readonly timeoutMs?: number;
}

const exec: Handler = async (request, response) => {
  const body = await readJson<ExecRequest>(request);
  await streamed(response, "POST /exec", () =>
    run(body.file, body.args ?? [], {
      cwd: body.cwd ?? WORK,
      timeoutMs: body.timeoutMs ?? EXEC_TIMEOUT_MS,
    }),
  );
};

const checkApp: Handler = async (request, response) => {
  const { check, stageId } = await readJson<{
    readonly check: string | AppCheckSpec;
    readonly stageId: number;
  }>(request);
  await streamed(response, "POST /check/app", async () => ({
    results: await runAppCheck(check, stageId),
  }));
};

const ROUTES: Readonly<Record<string, Handler>> = {
  "POST /turn": turn,
  "POST /simulated-user": simulatedUser,
  "POST /exec": exec,
  "POST /check/app": checkApp,
};

createServer(async (request, response) => {
  const route = `${request.method} ${(request.url ?? "").split("?")[0]}`;
  if (route === "GET /health") {
    sendJson(response, 200, { ok: true });
    return;
  }
  if (TOKEN === "" || request.headers["x-agent-token"] !== TOKEN) {
    sendJson(response, 401, { error: "missing or wrong x-agent-token" });
    return;
  }
  const handler = ROUTES[route];
  if (handler === undefined) {
    sendJson(response, 404, { error: `no route ${route}` });
    return;
  }
  try {
    await handler(request, response);
  } catch (error) {
    logError(route, error);
    if (response.headersSent) {
      response.end();
    } else {
      sendJson(response, 500, { error: "internal error" });
    }
  }
}).listen(PORT, HOST, () => {
  console.log(`agent server listening on ${HOST}:${PORT}`);
});
