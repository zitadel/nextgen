/** One agent turn, as the container's agent server reported it. */
export interface Turn {
  /** Every stream-json line the agent printed, in order. */
  lines: string[];
  sessionId: string | null;
  lastText: string;
  isError: boolean;
}

export interface ExecResult {
  status: number | null;
  signal: string | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
}

export interface CheckResult {
  name: string;
  passed: boolean;
  evidence: string;
}

/** Talks to the agent server inside the container; the host never reaches into it any other way. */
export class AgentClient {
  constructor(
    private readonly base: string,
    private readonly token: string,
  ) {}

  private async post(path: string, body: unknown): Promise<Response> {
    const response = await fetch(`${this.base}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-agent-token": this.token },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`${path} answered ${response.status}: ${await response.text()}`);
    }
    return response;
  }

  async isUp(): Promise<boolean> {
    try {
      const response = await fetch(`${this.base}/health`, { signal: AbortSignal.timeout(2_000) });
      return response.ok;
    } catch {
      return false;
    }
  }

  /** Run one agent turn, resuming `sessionId` when given. */
  async turn(request: {
    prompt: string;
    model: string;
    maxTurns: string;
    sessionId?: string | null;
  }): Promise<Turn> {
    const response = await this.post("/turn", request);
    const lines: string[] = [];
    let end: { sessionId: string | null; lastText: string; isError: boolean } | null = null;
    const decoder = new TextDecoder();
    let pending = "";
    const take = (line: string): void => {
      if (!line.trim()) {
        return;
      }
      const event = JSON.parse(line) as { type?: string };
      if (event.type === "heartbeat") {
        return;
      }
      if (event.type === "turn_end") {
        end = event as unknown as NonNullable<typeof end>;
        return;
      }
      lines.push(line);
    };
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      pending += decoder.decode(chunk, { stream: true });
      let newline = pending.indexOf("\n");
      while (newline !== -1) {
        take(pending.slice(0, newline));
        pending = pending.slice(newline + 1);
        newline = pending.indexOf("\n");
      }
    }
    take(pending);
    if (!end) {
      throw new Error("the agent server closed the turn without a turn_end");
    }
    const { sessionId, lastText, isError } = end;
    return { lines, sessionId, lastText, isError };
  }

  async simulatedUser(request: {
    persona: string;
    agentText: string;
    model: string;
  }): Promise<string> {
    const response = await this.post("/simulated-user", request);
    return ((await response.json()) as { text: string }).text;
  }

  async exec(request: {
    file: string;
    args?: string[];
    cwd?: string;
    timeoutMs?: number;
  }): Promise<ExecResult> {
    const response = await this.post("/exec", request);
    return (await response.json()) as ExecResult;
  }

  async checkApp(check: string, stageId: number): Promise<CheckResult[]> {
    const response = await this.post("/check/app", { check, stageId });
    return ((await response.json()) as { results: CheckResult[] }).results;
  }
}
