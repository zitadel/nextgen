import { execFileSync } from "node:child_process";

/**
 * The pids of fake servers (see `aFakeServerBinary`) whose parent is
 * gone, from `ps -o pid=,ppid=,command=` output. A run that is killed before
 * its `afterEach` leaves them behind, still listening on a port from the test
 * band, and every later run that draws that port fails on it until someone
 * kills the process. One whose parent is alive belongs to a run in progress,
 * and is left alone.
 */
export function staleFakeServers(ps: string): number[] {
  return ps.split("\n").flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    const [, pid, parent, command] = match ?? [];
    return pid !== undefined &&
      parent === "1" &&
      command !== undefined &&
      command.includes("/zitadel-fake-server-")
      ? [Number(pid)]
      : [];
  });
}

/** Vitest's global setup: ends the fake servers an earlier, interrupted run left behind. */
export default function sweepStaleFakeServers(): void {
  if (process.platform === "win32") {
    return;
  }
  const ps = (() => {
    try {
      return execFileSync("ps", ["axww", "-o", "pid=,ppid=,command="], { encoding: "utf8" });
    } catch {
      return "";
    }
  })();
  for (const pid of staleFakeServers(ps)) {
    for (const target of [-pid, pid]) {
      try {
        process.kill(target, "SIGKILL");
      } catch {}
    }
  }
}
