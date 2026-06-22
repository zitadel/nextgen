import { execFile } from "node:child_process";

export type TcpListener = Readonly<{
  address: string;
  command?: string;
  host: string;
  pid?: number;
  port: number;
}>;

/**
 * Enumerate TCP ports currently in LISTEN state on the loopback interface
 * (`127.0.0.1`, `::1`, or the wildcard `*`). Spawns `lsof -iTCP -sTCP:LISTEN
 * -P -n -F n` and parses its machine-readable output. Returns the unique,
 * numerically-sorted list of ports.
 *
 * Never throws. Returns `[]` whenever lsof is unavailable (e.g. Windows,
 * unusual PATH), the spawn errors, exits non-zero, or the call exceeds
 * `timeoutMs` (default 1000ms). The caller treats an empty list the same as
 * "no listeners worth probing."
 */
export async function listListeningPorts(opts?: {
  readonly timeoutMs?: number;
}): Promise<ReadonlyArray<number>> {
  const listeners = await listListeningTcpListeners(opts);
  return uniqueSortedPorts(listeners);
}

/**
 * Enumerate TCP LISTEN sockets on loopback/wildcard interfaces with enough
 * metadata for CLI diagnostics. Never throws; an empty array means either no
 * visible listeners or that process inspection is unavailable.
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

/**
 * Spawn `lsof` with the canned argv and resolve to its stdout. Hand-rolled
 * rather than `util.promisify(execFile)` because the latter resolves with a
 * `{stdout, stderr}` object via its custom-promisify symbol — a heavier shape
 * to mock and worse to read at the call site, where we only ever want stdout.
 */
function runLsof(timeoutMs: number): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    execFile(
      "lsof",
      ["-iTCP", "-sTCP:LISTEN", "-P", "-n", "-F", "pcn"],
      { timeout: timeoutMs, encoding: "utf8" },
      (err, stdout) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(stdout);
      },
    );
  });
}

/**
 * Parse the pid (`p`), command (`c`), and name/address (`n`) records emitted by
 * `lsof -F pcn`. Address records end in `:<port>` (e.g. `n*:8080`,
 * `n127.0.0.1:3000`, `n[::1]:5050`). Only loopback/wildcard hosts are kept;
 * external interface bindings are ignored.
 */
function parseLsofListeners(stdout: string): ReadonlyArray<TcpListener> {
  const listeners: TcpListener[] = [];
  let pid: number | undefined;
  let command: string | undefined;
  for (const line of stdout.split(/\r?\n/)) {
    if (line.startsWith("p")) {
      const parsed = Number.parseInt(line.slice(1), 10);
      pid = Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
      command = undefined;
      continue;
    }
    if (line.startsWith("c")) {
      command = line.slice(1) || undefined;
      continue;
    }
    if (!line.startsWith("n")) {
      continue;
    }
    const address = line.slice(1);
    const colon = address.lastIndexOf(":");
    if (colon < 0) {
      continue;
    }
    const host = address.slice(0, colon);
    const portStr = address.slice(colon + 1);
    if (!isLoopback(host)) {
      continue;
    }
    const port = Number.parseInt(portStr, 10);
    if (Number.isFinite(port) && port > 0 && port < 65536) {
      listeners.push({ address, command, host, pid, port });
    }
  }
  return listeners.sort((a, b) => a.port - b.port || (a.pid ?? 0) - (b.pid ?? 0));
}

function uniqueSortedPorts(listeners: ReadonlyArray<TcpListener>): ReadonlyArray<number> {
  const ports = new Set<number>();
  for (const listener of listeners) {
    ports.add(listener.port);
  }
  return [...ports].sort((a, b) => a - b);
}

/** Recognised loopback host strings as emitted by `lsof -F n`. */
function isLoopback(host: string): boolean {
  return host === "*" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
}
