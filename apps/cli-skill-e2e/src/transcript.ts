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
}

/** The agent changing a file with its own editing tools, not through a shell command. */
export interface FileEntry {
  readonly role: "agent";
  readonly kind: "file";
  readonly tool: string;
  readonly path: string;
  readonly ms?: number | null;
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

export interface ParsedStage {
  /** Every command with its output, across all turns, for grading. */
  readonly pairs: ReadonlyArray<{ readonly cmd: string; readonly out: string }>;
  readonly transcript: ReadonlyArray<TranscriptEntry>;
  /** The agent's last text block: its closing answer. */
  readonly final: string;
  readonly result: StageResult;
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

const entriesOfBlock = (
  block: ContentBlock,
  results: ReadonlyMap<string, ContentBlock>,
): ReadonlyArray<TranscriptEntry> => {
  if (block.type === "tool_use" && block.name === "Bash" && block.id !== undefined) {
    return [
      {
        role: "agent",
        kind: "command",
        cmd: block.input?.command ?? "",
        ...outcomeOf(results.get(block.id)),
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
function entriesOfTurn(events: ReadonlyArray<StreamEvent>): ReadonlyArray<TranscriptEntry> {
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
      ? blocksOf(event).flatMap((block) => entriesOfBlock(block, results))
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
    return { pairs: [], transcript: [], final: "", result: {} };
  }
  const events = readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map(parseEvent)
    .filter((event): event is StreamEvent => event !== undefined);
  const transcript = splitAfter(events, isResult).flatMap(entriesOfTurn);
  return {
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
