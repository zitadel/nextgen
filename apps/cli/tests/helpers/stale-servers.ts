import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The directory a fake server (`aFakeServerBinary`) runs from, read off its
 * `ps` command line, or `undefined` when the process is not one.
 */
const serverDirOf = (command: string): string | undefined =>
  /^(?:\S*\/)?node\s+(\S*\/zitadel-fake-server-[^/\s]+)\//.exec(command)?.[1];

/**
 * Whether the vitest process that made the fake server in `serverDir` is
 * still running. `aFakeServerBinary` records that process in an `owner` file;
 * one that is gone, or never wrote it, owns nothing.
 */
export function ownerIsAlive(serverDir: string): boolean {
  try {
    process.kill(Number(readFileSync(join(serverDir, "owner"), "utf8")), 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * The pids of fake servers left behind by a run that was killed before its
 * `afterEach`, from `ps -o pid=,ppid=,command=` output. Such a server keeps
 * its port from the test band, and every later run that draws that port
 * fails on it until someone kills the process. One whose owner is still
 * running belongs to a run in progress, whoever its parent is, and is left
 * alone.
 */
export function staleFakeServers(ps: string, owned: (serverDir: string) => boolean): number[] {
  return ps.split("\n").flatMap((line) => {
    const [, pid, , command] = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line) ?? [];
    const serverDir = command === undefined ? undefined : serverDirOf(command);
    return pid !== undefined && serverDir !== undefined && !owned(serverDir) ? [Number(pid)] : [];
  });
}

/** Vitest's global setup: ends the fake servers an earlier, interrupted run left behind. */
export default function sweepStaleFakeServers(): void {
  if (process.platform === "win32") {
    return;
  }
  const ps = execFileSync("ps", ["axww", "-o", "pid=,ppid=,command="], { encoding: "utf8" });
  for (const pid of staleFakeServers(ps, ownerIsAlive)) {
    for (const target of [-pid, pid]) {
      try {
        process.kill(target, "SIGKILL");
      } catch {}
    }
  }
}
