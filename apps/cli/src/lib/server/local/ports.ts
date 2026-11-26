import { ExecaError, execa } from "execa";

import { isLoopbackHost } from "@/lib/server/host";

/**
 * How a program is run: its name, its arguments and how long to wait, answering
 * with what it printed. The machine's own is `execa`; a test passes a function
 * that answers from a string.
 */
export type Run = (
  program: string,
  args: readonly string[],
  options: { timeout: number },
) => Promise<{ stdout: string }>;

/** Runs a program on this machine. */
export const systemRun: Run = (program, args, options) => {
  return execa(program, [...args], options);
};

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
  readonly run?: Run;
}): Promise<ReadonlyArray<TcpListener>> {
  const timeoutMs = opts?.timeoutMs ?? 1000;
  const run = opts?.run ?? systemRun;
  try {
    const { stdout } = await run("lsof", ["-iTCP", "-sTCP:LISTEN", "-P", "-n", "-F", "pcn"], {
      timeout: timeoutMs,
    });
    return parseLsofListeners(stdout);
  } catch (error) {
    if (error instanceof ExecaError) {
      return [];
    }
    throw error;
  }
}

export async function listenersForPort(
  port: number,
  opts?: { readonly timeoutMs?: number; readonly run?: Run },
): Promise<ReadonlyArray<TcpListener>> {
  return (await listListeningTcpListeners(opts)).filter((listener) => {
    return listener.port === port;
  });
}

/**
 * The folder each of `pids` runs in, as `lsof -a -p <pids> -d cwd -F n` names it: for a dev server
 * started with `npm run dev` and the like, the app's own folder, which its child processes keep.
 *
 * Never throws: a process lsof cannot see is left out, and lsof missing, failing or slower than
 * `timeoutMs` (default 1000ms) leaves every one out.
 */
export async function workingDirectories(
  pids: readonly number[],
  opts?: { readonly timeoutMs?: number; readonly run?: Run },
): Promise<ReadonlyMap<number, string>> {
  if (pids.length === 0) {
    return new Map();
  }
  const run = opts?.run ?? systemRun;
  try {
    const { stdout } = await run("lsof", ["-a", "-p", pids.join(","), "-d", "cwd", "-F", "n"], {
      timeout: opts?.timeoutMs ?? 1000,
    });
    return new Map(
      stdout.split(/\r?\n(?=p)/).flatMap((block): [number, string][] => {
        const lines = block.split(/\r?\n/);
        const pidLine = lines[0] ?? "";
        const pid = Number.parseInt(pidLine.slice(1), 10);
        const folder = lines
          .find((line) => {
            return line.startsWith("n");
          })
          ?.slice(1);
        return pidLine.startsWith("p") && pid > 0 && folder ? [[pid, folder]] : [];
      }),
    );
  } catch (error) {
    if (error instanceof ExecaError) {
      return new Map();
    }
    throw error;
  }
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
      // `p` opens each block, so a first line that is not one names no process.
      const pid = [Number.parseInt(pidLine.slice(1), 10)].find((value) => {
        return pidLine.startsWith("p") && Number.isFinite(value) && value > 0;
      });
      const command =
        lines
          .find((line) => {
            return line.startsWith("c");
          })
          ?.slice(1) || undefined;
      return lines
        .filter((line) => {
          return line.startsWith("n");
        })
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
    .sort((a, b) => {
      return a.port - b.port || (a.pid ?? 0) - (b.pid ?? 0);
    });
}
