import { basename } from "node:path";

import { type Run, systemRun } from "./ports";

import { errorMessage } from "@/lib/errors";
import { isFile } from "@/lib/fs";

export type ManagedRuntimeProcess = Readonly<{
  command: string;
  data_dir?: string;
  kind: "server-binary" | "server-wrapper";
  pid: number;
  ppid?: number;
}>;

type ManagedRuntimeDiscovery = Readonly<{
  error?: string;
  processes: ReadonlyArray<ManagedRuntimeProcess>;
  supported: boolean;
}>;

type ProcessRow = Readonly<{
  command: string;
  /** The command as reported: its arguments alone, never the environment it ran with. */
  shown?: string;
  pid: number;
  ppid?: number;
}>;

/**
 * Which CLI-managed local Zitadel servers are running on the machine, whichever
 * directory started them. Everything that asks goes through this, so a test can
 * answer for the machine instead of reading it.
 */
export interface LocalServers {
  current(): Promise<ManagedRuntimeDiscovery>;
}

/** The real answer: the machine's processes, read with `ps`. */
export class PsLocalServers implements LocalServers {
  private readonly run: Run;

  /**
   * @param run - How `ps` is run; this machine's own by default.
   */
  constructor(run: Run = systemRun) {
    this.run = run;
  }

  current(): Promise<ManagedRuntimeDiscovery> {
    return discoverManagedRuntimeProcesses({ run: this.run });
  }
}

export async function discoverManagedRuntimeProcesses(opts?: {
  readonly timeoutMs?: number;
  readonly run?: Run;
}): Promise<ManagedRuntimeDiscovery> {
  const run = opts?.run ?? systemRun;
  if (process.platform === "win32") {
    return { supported: false, processes: [], error: "process sweep is not available on Windows" };
  }

  // `ww`: without it `ps` cuts each command at `COLUMNS`, and a long install path loses the
  // `bin/nextgen` that marks a server before the full command is ever read.
  const listed = await run("ps", ["axww", "-o", "pid=,ppid=,command="], {
    timeout: opts?.timeoutMs ?? 1000,
  })
    .then(({ stdout }) => stdout)
    .then(parsePsRows)
    .then(
      (rows) => {
        return { rows };
      },
      (error: unknown) => {
        return { error: errorMessage(error) };
      },
    );
  if ("error" in listed) {
    return { supported: false, processes: [], error: listed.error };
  }

  const candidates = listed.rows.filter((row) => {
    return isRuntimeCandidate(row.command);
  });
  const hydrated = await Promise.all(
    candidates.map(async (row) => {
      return {
        ...row,
        command: await hydrateCommand(run, "eww", row.pid, row.command, opts?.timeoutMs ?? 1000),
        shown: await hydrateCommand(run, "ww", row.pid, row.command, opts?.timeoutMs ?? 1000),
      };
    }),
  );
  const processes = (await Promise.all(hydrated.map(toManagedRuntimeProcess))).filter(
    (candidate): candidate is ManagedRuntimeProcess => {
      return candidate !== undefined;
    },
  );
  return { supported: true, processes: uniqueByPid(processes) };
}

/**
 * The full command of `pid`: `eww` adds the environment it ran with, which only
 * tells a managed runtime apart and is never reported; `ww` gives its arguments.
 */
async function hydrateCommand(
  run: Run,
  flags: "eww" | "ww",
  pid: number,
  fallback: string,
  timeoutMs: number,
): Promise<string> {
  try {
    const { stdout } = await run("ps", [flags, "-p", String(pid), "-o", "command="], {
      timeout: timeoutMs,
    });
    return stdout.trim() || fallback;
  } catch {
    return fallback;
  }
}

function parsePsRows(stdout: string): ReadonlyArray<ProcessRow> {
  const rows: ProcessRow[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const match = trimmed.match(/^(\d+)\s+(\d+)\s+(.+)$/);
    if (!match) {
      continue;
    }
    rows.push({
      pid: Number(match[1]),
      ppid: Number(match[2]),
      command: match[3] ?? "",
    });
  }
  return rows;
}

async function toManagedRuntimeProcess(
  row: ProcessRow,
): Promise<ManagedRuntimeProcess | undefined> {
  const dataDir = extractDataDir(row.command);
  // Judged by the arguments alone: the environment's values can hold spaces, and would be read as words.
  const wrapper = await isServerWrapper(row.shown ?? row.command);
  const binary = isServerBinary(row.command);
  if (!wrapper && !binary) {
    return undefined;
  }
  if (!wrapper && !isCliLocalDataDir(dataDir)) {
    return undefined;
  }
  const base = {
    pid: row.pid,
    ppid: row.ppid,
    command: stripEnvironmentNoise(row.shown ?? row.command),
  };
  const withDataDir = (dataDir && { data_dir: dataDir }) || {};
  if (wrapper) {
    return { ...base, kind: "server-wrapper", ...withDataDir };
  } else {
    return { ...base, kind: "server-binary", ...withDataDir };
  }
}

function isRuntimeCandidate(command: string): boolean {
  return (
    command.includes(WRAPPER_SCRIPT) ||
    isServerBinary(command) ||
    command.includes("NEXTGEN_SERVER_DATA_DIR=") ||
    basename(command.split(/\s+/)[0] ?? "") === "nextgen"
  );
}

/** The script `@zitadel/server` starts its server through. */
const WRAPPER_SCRIPT = "zitadel-server.js";

/** The JavaScript runtimes the wrapper script runs under. */
const SCRIPT_RUNTIMES = new Set(["node", "nodejs", "bun", "deno"]);

/** Runtime options whose value is the next word, which is then not the script. */
const OPTIONS_WITH_A_VALUE = new Set([
  "-r",
  "--require",
  "--import",
  "--loader",
  "--experimental-loader",
  "-C",
  "--conditions",
  "--env-file",
  "--watch-path",
]);

/**
 * Whether `command` runs `@zitadel/server`'s wrapper script: a JavaScript
 * runtime whose script is `zitadel-server.js`. Naming the file is not enough,
 * since `stop --all` signals every match: `tail -f …/zitadel-server.js`, an
 * editor holding it open or a tool node runs on it is not a server.
 *
 * `ps` joins a command's arguments with spaces, so a path that has a space in
 * it reads as several words. Where a path starts and the script's name comes
 * words later, the files on disk say which words are one path
 * ({@link isOnePath}).
 */
async function isServerWrapper(command: string): Promise<boolean> {
  if (!command.includes(WRAPPER_SCRIPT)) {
    return false;
  }
  const words = commandTokens(command);
  const runtime = words.findIndex((word) => {
    return SCRIPT_RUNTIMES.has(basename(word));
  });
  if (runtime < 0 || !(await isOnePath(words, runtime))) {
    return false;
  }
  const given = words.slice(runtime + 1);
  const first = given.findIndex((word, index) => {
    return (
      !word.startsWith("-") &&
      !(index === 0 && word === "run") &&
      !OPTIONS_WITH_A_VALUE.has(given[index - 1] ?? "")
    );
  });
  const rest = given.filter((_word, index) => {
    return first >= 0 && index >= first;
  });
  const script = rest.findIndex((word) => {
    return basename(word) === WRAPPER_SCRIPT;
  });
  return script >= 0 && isOnePath(rest, script);
}

/**
 * Whether the words up to and including the one at `end` are a single path,
 * and not a path followed by further arguments.
 *
 * One word is one path. More are one path only when no shorter run of them is
 * a file and all of them together are: `/Users/Jane Doe/app/zitadel-server.js`
 * is, and `/usr/bin/prettier zitadel-server.js` is not. Only an absolute path
 * can be looked up, so a relative one with a space in it is not recognised.
 */
async function isOnePath(words: readonly string[], end: number): Promise<boolean> {
  if (end === 0) {
    return true;
  }
  if (!words[0]?.startsWith("/")) {
    return false;
  }
  for (const length of Array.from({ length: end + 1 }, (_, index) => {
    return index + 1;
  })) {
    if (await isFile(words.slice(0, length).join(" "))) {
      return length === end + 1;
    }
  }
  return false;
}

function isServerBinary(command: string): boolean {
  if (/@zitadel\/server-[^/\s]+\/bin\/nextgen(?:\.exe)?(?:\s|$)/.test(command)) {
    return true;
  }
  return (
    isCliLocalDataDir(extractDataDir(command)) &&
    commandTokens(command).some((token) => {
      return basename(token) === "nextgen";
    })
  );
}

function extractDataDir(command: string): string | undefined {
  const match = command.match(/NEXTGEN_SERVER_DATA_DIR=("[^"]+"|'[^']+'|[^\s]+)/);
  const value = match?.[1];
  if (!value) {
    return undefined;
  }
  return value.replace(/^["']|["']$/g, "");
}

function isCliLocalDataDir(path: string | undefined): boolean {
  return Boolean(path && /(?:^|\/)\.zitadel\/local\/nextgen-data\/?$/.test(path));
}

function stripEnvironmentNoise(command: string): string {
  return command
    .replace(/(^|\s)[A-Z_][A-Z0-9_]*=(?:"[^"]+"|'[^']+'|[^\s]+)/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function commandTokens(command: string): string[] {
  return command.split(/\s+/).filter((token) => {
    return !/^[A-Z_][A-Z0-9_]*=/.test(token);
  });
}

function uniqueByPid(
  processes: ReadonlyArray<ManagedRuntimeProcess>,
): ReadonlyArray<ManagedRuntimeProcess> {
  const byPid = new Map<number, ManagedRuntimeProcess>();
  for (const processInfo of processes) {
    byPid.set(processInfo.pid, processInfo);
  }
  return [...byPid.values()].sort((a, b) => {
    return a.pid - b.pid;
  });
}
