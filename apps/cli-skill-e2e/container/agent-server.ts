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
import { mkdirSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createInterface } from "node:readline";

import { runAppCheck } from "./app-checks.ts";

const PORT = Number(process.env.PORT ?? 4000);
const TOKEN = process.env.AGENT_TOKEN ?? "";
const WORK = process.env.WORK ?? "/work";
const CALL_TIMEOUT_MS = Number(process.env.CALL_TIMEOUT_MS ?? 7 * 60 * 1000);
const HEARTBEAT_MS = 15_000;
const SIMULATED_USER_TIMEOUT_MS = 2 * 60 * 1000;
const EXEC_TIMEOUT_MS = 2 * 60 * 1000;
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

/** Yields everything `source` yields, telling `observe` about each item on the way. */
async function* tap<T>(source: AsyncIterable<T>, observe: (item: T) => void): AsyncGenerator<T> {
  for await (const item of source) {
    observe(item);
    yield item;
  }
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
): { readonly child: ChildProcess; readonly done: Promise<ProcessResult> } {
  const child = spawn(file, [...args], {
    cwd: options.cwd,
    env: options.env ?? process.env,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: options.timeoutMs,
    killSignal: "SIGKILL",
  });
  const stdout = Array.fromAsync(
    tap(createInterface({ input: child.stdout as NodeJS.ReadableStream }), (line) => {
      if (line.trim() !== "") {
        options.onLine?.(line);
      }
    }),
  );
  const stderr = Array.fromAsync(child.stderr as AsyncIterable<Buffer>, (chunk) =>
    chunk.toString("utf8"),
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
    ([lines, errors, { status, signal, failure }]): ProcessResult => ({
      status,
      signal,
      timedOut: signal === "SIGKILL",
      stdout: lines.join("\n"),
      stderr: `${errors.join("")}${failure}`,
    }),
  );
  return { child, done };
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

  const { child, done } = start(
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
      child.kill("SIGKILL");
    }
  });

  const result = await done;
  clearInterval(heartbeat);
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
  sendJson(response, 200, { text: (parsed?.result ?? stdout).trim() });
};

interface ExecRequest {
  readonly file: string;
  readonly args?: ReadonlyArray<string>;
  readonly cwd?: string;
  readonly timeoutMs?: number;
}

const exec: Handler = async (request, response) => {
  const body = await readJson<ExecRequest>(request);
  const result = await run(body.file, body.args ?? [], {
    cwd: body.cwd ?? WORK,
    timeoutMs: body.timeoutMs ?? EXEC_TIMEOUT_MS,
  });
  sendJson(response, 200, result);
};

const checkApp: Handler = async (request, response) => {
  const { check, stageId } = await readJson<{ readonly check: string; readonly stageId: number }>(
    request,
  );
  sendJson(response, 200, { results: await runAppCheck(check, stageId) });
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
    if (response.headersSent) {
      response.end();
    } else {
      sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
    }
  }
}).listen(PORT, "0.0.0.0", () => {
  console.log(`agent server listening on ${PORT}`);
});
