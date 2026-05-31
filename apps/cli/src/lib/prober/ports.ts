import { execFile } from "node:child_process";

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
  const timeoutMs = opts?.timeoutMs ?? 1000;
  try {
    const stdout = await runLsof(timeoutMs);
    return parseLsofPorts(stdout);
  } catch {
    return [];
  }
}

/**
 * Spawn `lsof` with the canned argv and return its stdout. Hand-rolled rather
 * than `util.promisify` so the mock used by `ports.test.ts` only has to wire
 * the plain `(err, stdout, stderr)` callback semantics, not the custom
 * `{stdout, stderr}` resolution shape promisify uses for `execFile`.
 */
function runLsof(timeoutMs: number): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    execFile(
      "lsof",
      ["-iTCP", "-sTCP:LISTEN", "-P", "-n", "-F", "n"],
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
 * Parse the `n` records emitted by `lsof -F n`. Each record is a single line
 * `n<address>` where `<address>` ends in `:<port>` (e.g. `n*:8080`,
 * `n127.0.0.1:3000`, `n[::1]:5050`). Only loopback/wildcard hosts are kept;
 * external interface bindings are ignored.
 */
function parseLsofPorts(stdout: string): ReadonlyArray<number> {
  const ports = new Set<number>();
  for (const line of stdout.split(/\r?\n/)) {
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
      ports.add(port);
    }
  }
  return [...ports].sort((a, b) => a - b);
}

/** Recognised loopback host strings as emitted by `lsof -F n`. */
function isLoopback(host: string): boolean {
  return host === "*" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
}
