import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import type { ReadableStream } from "node:stream/web";

import type { CheckResult } from "../../src/grading.ts";

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
  checkApp(check: string, stageId: number): Promise<ReadonlyArray<CheckResult>>;
}

interface TurnEnd {
  readonly type: "turn_end";
  readonly sessionId: string | null;
  readonly lastText: string;
  readonly isError: boolean;
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

  return {
    async isUp() {
      try {
        return (await fetch(`${base}/health`, { signal: AbortSignal.timeout(2_000) })).ok;
      } catch {
        return false;
      }
    },

    async turn(request) {
      const response = await post("/turn", request);
      const body = Readable.fromWeb(response.body as unknown as ReadableStream);
      const events = (await Array.fromAsync(createInterface({ input: body })))
        .filter((line) => line.trim() !== "")
        .map((line) => ({ line, type: (JSON.parse(line) as { readonly type?: string }).type }));
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
      const response = await post("/simulated-user", request);
      return ((await response.json()) as { readonly text: string }).text;
    },

    async exec(request) {
      return (await (await post("/exec", request)).json()) as ExecResult;
    },

    async checkApp(check, stageId) {
      const response = await post("/check/app", { check, stageId });
      return ((await response.json()) as { readonly results: ReadonlyArray<CheckResult> }).results;
    },
  };
}
