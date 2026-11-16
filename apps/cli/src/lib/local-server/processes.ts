import { basename } from "node:path";

import { execa } from "execa";

import { errorMessage } from "@/lib/errors";

export type ManagedRuntimeProcess = Readonly<{
  command: string;
  data_dir?: string;
  kind: "server-binary" | "server-wrapper";
  pid: number;
  ppid?: number;
}>;

export type ManagedRuntimeDiscovery = Readonly<{
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
  current(): Promise<ManagedRuntimeDiscovery> {
    return discoverManagedRuntimeProcesses();
  }
}

export async function discoverManagedRuntimeProcesses(opts?: {
  readonly timeoutMs?: number;
}): Promise<ManagedRuntimeDiscovery> {
  if (process.platform === "win32") {
    return { supported: false, processes: [], error: "process sweep is not available on Windows" };
  }

  const listed = await runPs(["axo", "pid=,ppid=,command="], opts?.timeoutMs ?? 1000)
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
        command: await hydrateCommand("eww", row.pid, row.command, opts?.timeoutMs ?? 1000),
        shown: await hydrateCommand("ww", row.pid, row.command, opts?.timeoutMs ?? 1000),
      };
    }),
  );
  const processes = hydrated
    .map(toManagedRuntimeProcess)
    .filter((candidate): candidate is ManagedRuntimeProcess => {
      return candidate !== undefined;
    });
  return { supported: true, processes: uniqueByPid(processes) };
}

async function runPs(args: string[], timeoutMs: number): Promise<string> {
  return (await execa("ps", args, { timeout: timeoutMs })).stdout;
}

/**
 * The full command of `pid`: `eww` adds the environment it ran with, which only
 * tells a managed runtime apart and is never reported; `ww` gives its arguments.
 */
async function hydrateCommand(
  flags: "eww" | "ww",
  pid: number,
  fallback: string,
  timeoutMs: number,
): Promise<string> {
  try {
    const hydrated = await runPs([flags, "-p", String(pid), "-o", "command="], timeoutMs);
    return hydrated.trim() || fallback;
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

function toManagedRuntimeProcess(row: ProcessRow): ManagedRuntimeProcess | undefined {
  const dataDir = extractDataDir(row.command);
  const wrapper = isServerWrapper(row.command);
  const binary = isServerBinary(row.command);
  if (!wrapper && !binary) {
    return undefined;
  }
  if (!wrapper && !isCliLocalDataDir(dataDir)) {
    return undefined;
  }
  return {
    pid: row.pid,
    ppid: row.ppid,
    command: stripEnvironmentNoise(row.shown ?? row.command),
    kind: wrapper ? "server-wrapper" : "server-binary",
    ...(dataDir ? { data_dir: dataDir } : {}),
  };
}

function isRuntimeCandidate(command: string): boolean {
  return (
    isServerWrapper(command) ||
    isServerBinary(command) ||
    command.includes("NEXTGEN_SERVER_DATA_DIR=") ||
    basename(command.split(/\s+/)[0] ?? "") === "nextgen"
  );
}

function isServerWrapper(command: string): boolean {
  return command.includes("zitadel-server.js");
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
