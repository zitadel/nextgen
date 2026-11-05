import { execa } from "execa";

import { isLoopbackHost } from "@/lib/host";

export type TcpListener = Readonly<{
  address: string;
  command?: string;
  host: string;
  pid?: number;
  port: number;
}>;

/**
 * Enumerate TCP LISTEN sockets on loopback/wildcard interfaces (`127.0.0.1`,
 * `::1`, or the wildcard `*`) with enough metadata for CLI diagnostics.
 * Spawns `lsof -iTCP -sTCP:LISTEN -P -n -F pcn` and parses its
 * machine-readable output.
 *
 * Never throws. Returns `[]` whenever lsof is unavailable (e.g. Windows,
 * unusual PATH), the spawn errors, exits non-zero, or the call exceeds
 * `timeoutMs` (default 1000ms). The caller treats an empty list the same as
 * "no visible listeners."
 */
export async function listListeningTcpListeners(opts?: {
  readonly timeoutMs?: number;
}): Promise<ReadonlyArray<TcpListener>> {
  const timeoutMs = opts?.timeoutMs ?? 1000;
  try {
    const stdout = await runLsof(timeoutMs);
    return parseLsofListeners(stdout);
  } catch {
    return [];
  }
}

export async function listenersForPort(
  port: number,
  opts?: { readonly timeoutMs?: number },
): Promise<ReadonlyArray<TcpListener>> {
  return (await listListeningTcpListeners(opts)).filter((listener) => listener.port === port);
}

/** Runs `lsof` with the canned argv and resolves to its stdout. */
async function runLsof(timeoutMs: number): Promise<string> {
  return (
    await execa("lsof", ["-iTCP", "-sTCP:LISTEN", "-P", "-n", "-F", "pcn"], { timeout: timeoutMs })
  ).stdout;
}

/**
 * Parse the pid (`p`), command (`c`), and name/address (`n`) records emitted by
 * `lsof -F pcn`. Address records end in `:<port>` (e.g. `n*:8080`,
 * `n127.0.0.1:3000`, `n[::1]:5050`). Only loopback/wildcard hosts are kept;
 * external interface bindings are ignored.
 */
function parseLsofListeners(stdout: string): ReadonlyArray<TcpListener> {
  return stdout
    .split(/\r?\n(?=p)/)
    .flatMap((block): TcpListener[] => {
      const lines = block.split(/\r?\n/);
      const pidLine = lines[0] ?? "";
      const parsedPid = pidLine.startsWith("p")
        ? Number.parseInt(pidLine.slice(1), 10)
        : Number.NaN;
      const pid = Number.isFinite(parsedPid) && parsedPid > 0 ? parsedPid : undefined;
      const command = lines.find((line) => line.startsWith("c"))?.slice(1) || undefined;
      return lines
        .filter((line) => line.startsWith("n"))
        .flatMap((line): TcpListener[] => {
          const address = line.slice(1);
          const colon = address.lastIndexOf(":");
          if (colon < 0) {
            return [];
          }
          const host = address.slice(0, colon);
          if (host !== "*" && !isLoopbackHost(host)) {
            return [];
          }
          const port = Number.parseInt(address.slice(colon + 1), 10);
          if (!Number.isFinite(port) || port <= 0 || port >= 65536) {
            return [];
          }
          return [{ address, command, host, pid, port }];
        });
    })
    .sort((a, b) => a.port - b.port || (a.pid ?? 0) - (b.pid ?? 0));
}
