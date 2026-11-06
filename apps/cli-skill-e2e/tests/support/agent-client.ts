import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import type { ReadableStream } from "node:stream/web";

import type { CheckResult } from "../../src/grading.ts";
import type { AppCheckSpec } from "../../src/journey.ts";

/** One agent turn, as the container's agent server reported it. */
export interface Turn {
  /** Every stream-json line the agent printed, in order. */
  readonly lines: ReadonlyArray<string>;
  readonly sessionId: string | null;
  readonly lastText: string;
  readonly isError: boolean;
}

export interface TurnRequest {
  readonly prompt: string;
  readonly model: string;
  readonly maxTurns: string;
  readonly sessionId?: string | null;
}

export interface ExecRequest {
  readonly file: string;
  readonly args?: ReadonlyArray<string>;
  readonly cwd?: string;
  readonly timeoutMs?: number;
}

export interface ExecResult {
  readonly status: number | null;
  readonly signal: string | null;
  readonly timedOut: boolean;
  readonly stdout: string;
  readonly stderr: string;
}

/** The only way the host reaches into the container: calls to the agent server. */
export interface AgentClient {
  isUp(): Promise<boolean>;
  turn(request: TurnRequest): Promise<Turn>;
  simulatedUser(request: {
    readonly persona: string;
    readonly agentText: string;
    readonly model: string;
  }): Promise<string>;
  exec(request: ExecRequest): Promise<ExecResult>;
  checkApp(check: string | AppCheckSpec, stageId: number): Promise<ReadonlyArray<CheckResult>>;
}

interface TurnEnd {
  readonly type: "turn_end";
  readonly sessionId: string | null;
  readonly lastText: string;
  readonly isError: boolean;
}

/** One line of a streamed answer, and its `type` when it is JSON that has one. */
interface Line {
  readonly line: string;
  readonly type: string | undefined;
}

const classify = (line: string): Line => {
  try {
    return { line, type: (JSON.parse(line) as { readonly type?: string }).type };
  } catch {
    // Not every line the agent prints is JSON; it is kept, and read as untyped.
    return { line, type: undefined };
  }
};

/** Every non-empty line of a streamed answer. */
async function lines(response: Response): Promise<ReadonlyArray<Line>> {
  const body = Readable.fromWeb(response.body as unknown as ReadableStream);
  return (await Array.fromAsync(createInterface({ input: body })))
    .filter((line) => line.trim() !== "")
    .map(classify);
}

export function createAgentClient(base: string, token: string): AgentClient {
  const post = async (path: string, body: unknown): Promise<Response> => {
    const response = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-agent-token": token },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`${path} answered ${response.status}: ${await response.text()}`);
    }
    return response;
  };

  /**
   * A call whose answer comes once the work is done. The server streams
   * heartbeats while it works, so a long call is not cut off by the client's
   * own timeout for a silent response.
   */
  const streamed = async <T>(path: string, body: unknown): Promise<T> => {
    const outcome = (await lines(await post(path, body))).find(
      (candidate) => candidate.type === "result" || candidate.type === "error",
    );
    if (outcome === undefined) {
      throw new Error(`${path} ended without an answer`);
    }
    const answer = JSON.parse(outcome.line) as {
      readonly type: string;
      readonly value?: T;
      readonly message?: string;
    };
    if (answer.type === "error") {
      throw new Error(`${path} failed: ${answer.message ?? "unknown error"}`);
    }
    return answer.value as T;
  };

  return {
    async isUp() {
      try {
        return (await fetch(`${base}/health`, { signal: AbortSignal.timeout(2_000) })).ok;
      } catch {
        return false;
      }
    },

    async turn(request) {
      const events = await lines(await post("/turn", request));
      const end = events.find((event) => event.type === "turn_end");
      if (end === undefined) {
        throw new Error("the agent server closed the turn without a turn_end");
      }
      const { sessionId, lastText, isError } = JSON.parse(end.line) as TurnEnd;
      return {
        lines: events
          .filter((event) => event.type !== "heartbeat" && event.type !== "turn_end")
          .map((event) => event.line),
        sessionId,
        lastText,
        isError,
      };
    },

    async simulatedUser(request) {
      return (await streamed<{ readonly text: string }>("/simulated-user", request)).text;
    },

    exec(request) {
      return streamed<ExecResult>("/exec", request);
    },

    async checkApp(check, stageId) {
      const answer = await streamed<{ readonly results: ReadonlyArray<CheckResult> }>(
        "/check/app",
        { check, stageId },
      );
      return answer.results;
    },
  };
}
