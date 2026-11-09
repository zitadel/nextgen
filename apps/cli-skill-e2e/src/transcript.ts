import { existsSync, readFileSync } from "node:fs";

export interface CommandEntry {
  readonly role: "agent";
  readonly kind: "command";
  readonly cmd: string;
  readonly out: string;
  readonly err?: boolean;
  /** The exit status, or null when the agent's tool reported a failure without one. */
  readonly exit?: number | null;
  /** How long the agent turn that ended on this entry took. */
  readonly ms?: number | null;
  /** How long the command itself ran, from the agent issuing it to its output coming back. */
  readonly ran?: number | null;
  /** How long the model spent before issuing it. */
  readonly thought?: number | null;
}

/** The agent changing a file with its own editing tools, not through a shell command. */
export interface FileEntry {
  readonly role: "agent";
  readonly kind: "file";
  readonly tool: string;
  readonly path: string;
  readonly ms?: number | null;
  readonly ran?: number | null;
  readonly thought?: number | null;
}

export interface TextEntry {
  readonly role: "agent";
  readonly kind: "text";
  readonly text: string;
  readonly ms?: number | null;
}

export interface AnswerEntry {
  readonly role: "user";
  readonly kind: "answer";
  readonly text: string;
  readonly ms?: number | null;
}

export type TranscriptEntry = CommandEntry | FileEntry | TextEntry | AnswerEntry;

/** What the agent reports once per turn, summed over the turns of a stage. */
export interface StageResult {
  readonly is_error?: boolean;
  readonly num_turns?: number;
  readonly duration_ms?: number;
  readonly usage?: Readonly<Record<string, number>>;
}

/**
 * Where a stage's wall-clock time went. Commands are the time tools ran, which
 * the skill cannot shrink; the model is the agent thinking between them, which
 * fewer calls shrink; `startupMs` is the agent starting up and closing out a
 * turn; `waitMs` is the simulated developer answering. All are zero for a run
 * captured before the harness stamped its lines.
 */
export interface StageTiming {
  readonly measured: boolean;
  readonly commandMs: number;
  readonly modelMs: number;
  readonly startupMs: number;
  readonly waitMs: number;
}

/** What the agent did in a stage, counted so a question is not mistaken for a step. */
export interface StageCounts {
  /** Answers the developer gave: the agent asking, not acting. */
  readonly questions: number;
  readonly commands: number;
  /** Commands that came back as errors. */
  readonly failed: number;
}

export interface ParsedStage {
  /** Every command with its output, across all turns, for grading. */
  readonly pairs: ReadonlyArray<{ readonly cmd: string; readonly out: string }>;
  readonly transcript: ReadonlyArray<TranscriptEntry>;
  /** The agent's last text block: its closing answer. */
  readonly final: string;
  readonly result: StageResult;
  readonly timing: StageTiming;
  readonly counts: StageCounts;
}

interface ContentBlock {
  readonly type?: string;
  readonly id?: string;
  readonly name?: string;
  readonly text?: string;
  readonly input?: {
    readonly command?: string;
    readonly file_path?: string;
    readonly notebook_path?: string;
  };
  readonly tool_use_id?: string;
  readonly is_error?: boolean;
  readonly content?: string | ReadonlyArray<{ readonly text?: string }>;
}

interface StreamEvent {
  readonly type?: string;
  readonly text?: string;
  readonly message?: { readonly content?: ReadonlyArray<ContentBlock> | string };
  readonly is_error?: boolean;
  readonly num_turns?: number;
  readonly duration_ms?: number;
  readonly usage?: Readonly<Record<string, unknown>>;
  /** When the host saw this line, in epoch milliseconds. */
  readonly _t?: number;
  /** How long a simulated developer took to answer. */
  readonly _ms?: number;
}

function parseEvent(line: string): StreamEvent | undefined {
  try {
    return JSON.parse(line) as StreamEvent;
  } catch {
    return undefined;
  }
}

const blocksOf = (event: StreamEvent): ReadonlyArray<ContentBlock> => {
  const content = event.message?.content;
  return Array.isArray(content) ? content : [];
};

const textOf = (content: ContentBlock["content"]): string =>
  typeof content === "string" ? content : (content ?? []).map((part) => part.text ?? "").join("");

/**
 * Split into runs that each end at an item satisfying `closes`; a last run
 * that never closed is kept. Pure: the mutation stays inside.
 */
function splitAfter<T>(
  items: ReadonlyArray<T>,
  closes: (item: T) => boolean,
): ReadonlyArray<ReadonlyArray<T>> {
  const runs: T[][] = [[]];
  for (const item of items) {
    runs.at(-1)?.push(item);
    if (closes(item)) {
      runs.push([]);
    }
  }
  return runs.filter((run) => run.length > 0);
}

const isResult = (event: StreamEvent): boolean => event.type === "result";

/** How a Bash call ended. A failed call comes back with `is_error`, and Claude Code puts the status in the output text ("Exit code N"). */
function outcomeOf(result: ContentBlock | undefined): Pick<CommandEntry, "out" | "err" | "exit"> {
  if (result === undefined) {
    return { out: "" };
  }
  const out = textOf(result.content);
  const named = /Exit code (\d+)/i.exec(out);
  const failed = Boolean(result.is_error);
  return { out, err: failed, exit: named ? Number(named[1]) : failed ? null : 0 };
}

const FILE_TOOLS: ReadonlySet<string> = new Set(["Edit", "MultiEdit", "Write", "NotebookEdit"]);

/** What one tool call cost: the model's time before it, and the call's own run time. */
interface CallTiming {
  readonly thought: number | null;
  readonly ran: number | null;
}

const entriesOfBlock = (
  block: ContentBlock,
  results: ReadonlyMap<string, ContentBlock>,
  timings: ReadonlyMap<string, CallTiming>,
): ReadonlyArray<TranscriptEntry> => {
  const timed = timings.get(block.id ?? "") ?? { thought: null, ran: null };
  if (block.type === "tool_use" && block.name === "Bash" && block.id !== undefined) {
    return [
      {
        role: "agent",
        kind: "command",
        cmd: block.input?.command ?? "",
        ...outcomeOf(results.get(block.id)),
        ...timed,
      },
    ];
  }
  if (block.type === "tool_use" && FILE_TOOLS.has(block.name ?? "")) {
    return [
      {
        role: "agent",
        kind: "file",
        tool: block.name ?? "",
        path: block.input?.file_path ?? block.input?.notebook_path ?? "",
        ...timed,
      },
    ];
  }
  if (block.type === "text" && (block.text ?? "").trim() !== "") {
    return [{ role: "agent", kind: "text", text: block.text ?? "" }];
  }
  return [];
};

/**
 * One agent turn, with the answer that opened it if there was one. Its
 * duration is attributed to the turn's last entry, so the report can show how
 * long each step took.
 */
function entriesOfTurn(
  events: ReadonlyArray<StreamEvent>,
  timings: ReadonlyMap<string, CallTiming>,
): ReadonlyArray<TranscriptEntry> {
  const results = new Map(
    events
      .filter((event) => event.type === "user")
      .flatMap(blocksOf)
      .filter((block) => block.type === "tool_result" && block.tool_use_id !== undefined)
      .map((block) => [block.tool_use_id as string, block] as const),
  );
  const entries = events.flatMap((event): ReadonlyArray<TranscriptEntry> => {
    if (event.type === "sim_user") {
      return [{ role: "user", kind: "answer", text: event.text ?? "" }];
    }
    return event.type === "assistant"
      ? blocksOf(event).flatMap((block) => entriesOfBlock(block, results, timings))
      : [];
  });
  const closing = events.find(isResult);
  return entries.map((entry, index) =>
    closing !== undefined && index === entries.length - 1 && entry.ms == null
      ? { ...entry, ms: closing.duration_ms ?? null }
      : entry,
  );
}

const sum = (values: ReadonlyArray<number>): number => values.reduce((a, b) => a + b, 0);

interface TurnTiming {
  readonly calls: ReadonlyMap<string, CallTiming>;
  readonly commandMs: number;
  readonly modelMs: number;
  readonly startupMs: number;
}

const NO_TIMING: TurnTiming = { calls: new Map(), commandMs: 0, modelMs: 0, startupMs: 0 };

/**
 * Walk one turn's stamped lines in order. The time from one line to the next
 * belongs to whoever produced the later one: an assistant message ends a model
 * step, and a tool result ends a tool call. The turn's own start and its final
 * result are the agent starting up and closing out, kept apart so they are not
 * blamed on either. A turn with no stamps has no timing.
 */
function timingOfTurn(events: ReadonlyArray<StreamEvent>): TurnTiming {
  const start = events.find((event) => event.type === "turn_start")?._t;
  const stamped = events.filter(
    (event) => event._t !== undefined && (event.type === "assistant" || event.type === "user"),
  );
  if (start === undefined || stamped.length === 0) {
    return NO_TIMING;
  }
  const issued = new Map<string, number>();
  const thought = new Map<string, number>();
  const ran = new Map<string, number>();
  let previous = start;
  let modelMs = 0;
  let commandMs = 0;
  for (const event of stamped) {
    const at = event._t as number;
    const gap = Math.max(0, at - previous);
    if (event.type === "assistant") {
      modelMs += gap;
      const calls = blocksOf(event).filter(
        (block) => block.type === "tool_use" && block.id !== undefined,
      );
      calls.forEach((block, index) => {
        issued.set(block.id as string, at);
        thought.set(block.id as string, index === 0 ? gap : 0);
      });
    } else {
      const results = blocksOf(event).filter((block) => block.type === "tool_result");
      if (results.length > 0) {
        commandMs += gap;
      } else {
        modelMs += gap;
      }
      for (const block of results) {
        const sent = issued.get(block.tool_use_id ?? "");
        if (sent !== undefined) {
          ran.set(block.tool_use_id as string, Math.max(0, at - sent));
        }
      }
    }
    previous = at;
  }
  const end = events.findLast(isResult)?._t ?? previous;
  return {
    calls: new Map(
      [...issued.keys()].map((id) => [
        id,
        { thought: thought.get(id) ?? null, ran: ran.get(id) ?? null },
      ]),
    ),
    commandMs,
    modelMs,
    startupMs: Math.max(0, start === undefined ? 0 : end - start - commandMs - modelMs),
  };
}

const sumUsage = (results: ReadonlyArray<StreamEvent>): Readonly<Record<string, number>> => {
  const usages = results.map((result) => result.usage ?? {});
  const keys = [...new Set(usages.flatMap((usage) => Object.keys(usage)))];
  return Object.fromEntries(
    keys.map((key) => [
      key,
      sum(usages.map((usage) => (typeof usage[key] === "number" ? (usage[key] as number) : 0))),
    ]),
  );
};

/** Collapse each turn's `result` into one: the last turn's error, summed turns, usage and time. */
function aggregate(results: ReadonlyArray<StreamEvent>): StageResult {
  const last = results.at(-1);
  if (last === undefined) {
    return {};
  }
  const turns = sum(results.map((result) => result.num_turns ?? 0));
  return {
    is_error: last.is_error ?? false,
    num_turns: turns || last.num_turns,
    duration_ms: sum(results.map((result) => result.duration_ms ?? 0)),
    usage: sumUsage(results),
  };
}

/**
 * Parse one stage's stream-json file into a conversation.
 *
 * A stage may be several agent turns: the agent's stream, then a
 * `{"type":"sim_user","text":…}` line for the simulated developer's answer,
 * then the resumed agent's stream, and so on. Each turn ends at its `result`
 * event, so the file splits into turns, and the turns give the transcript
 * (agent text and commands with their output, and the answers), the
 * command/output pairs for grading, the agent's closing answer, and one
 * aggregate result for the whole conversation.
 */
export function parseStage(file: string): ParsedStage {
  if (!existsSync(file)) {
    return {
      pairs: [],
      transcript: [],
      final: "",
      result: {},
      timing: { measured: false, commandMs: 0, modelMs: 0, startupMs: 0, waitMs: 0 },
      counts: { questions: 0, commands: 0, failed: 0 },
    };
  }
  const events = readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map(parseEvent)
    .filter((event): event is StreamEvent => event !== undefined);
  const turns = splitAfter(events, isResult);
  const timings = turns.map(timingOfTurn);
  const transcript = turns.flatMap((turn, index) =>
    entriesOfTurn(turn, (timings[index] as TurnTiming).calls),
  );
  const commands = transcript.filter((entry) => entry.kind === "command");
  return {
    timing: {
      measured: timings.some((timing) => timing !== NO_TIMING),
      commandMs: sum(timings.map((timing) => timing.commandMs)),
      modelMs: sum(timings.map((timing) => timing.modelMs)),
      startupMs: sum(timings.map((timing) => timing.startupMs)),
      waitMs: sum(events.map((event) => event._ms ?? 0)),
    },
    counts: {
      questions: transcript.filter((entry) => entry.kind === "answer").length,
      commands: commands.length,
      failed: commands.filter((entry) => entry.err).length,
    },
    pairs: transcript.flatMap((entry) =>
      entry.kind === "command" ? [{ cmd: entry.cmd, out: entry.out }] : [],
    ),
    transcript,
    final: transcript.findLast((entry) => entry.kind === "text")?.text ?? "",
    result: aggregate(events.filter(isResult)),
  };
}

const count = (value: number | undefined): number => value ?? 0;

/** Every token an agent used in a stage: input, output and cache. */
export function tokens(result: StageResult): number {
  const usage = result.usage ?? {};
  return (
    count(usage.input_tokens) +
    count(usage.output_tokens) +
    count(usage.cache_read_input_tokens) +
    count(usage.cache_creation_input_tokens)
  );
}
