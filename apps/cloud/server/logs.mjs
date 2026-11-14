// Relays the server's output to Vercel's runtime logs, a line at a time.
//
// The launcher and the server write their logs to stdout and stderr. Written
// straight to the function's own stdout and stderr, a line reaches Vercel
// without a request or a level: Vercel files a copy under every request in
// flight, all at level info. A line printed with console is filed once, under
// the request whose context prints it, at the level of the console method. So
// the wrapper reads the output and prints each line itself, unchanged:
//
// - at the level the line names, the "level" of the server's JSON log lines:
//   console.error for ERROR, console.warn for WARN, console.debug for DEBUG
//   and console.log for the rest, a line that is not JSON included;
// - in the context of the request the line names ("request_id": Vercel's
//   request ID, which the server takes from x-vercel-id) while the wrapper
//   holds that request open. Any other line (startup, background work, a
//   line that arrives after its request was closed) is printed in the
//   context of the newest request in flight, which for the server's startup
//   is the request that started the instance: Vercel keeps the level only of
//   what a request prints, and files what none prints under every request in
//   flight at level info. Outside any request only when none is in flight.

import { createInterface } from "node:readline";

const printers = [
  ["ERROR", "error"],
  ["WARN", "warn"],
  ["DEBUG", "debug"],
];

// The request ID as Vercel shows it: x-vercel-id lists the regions before it
// (sfo1::fra1::2vxlh-1792820352212-3ce3eb4ad630), as the server reads it too.
export function vercelRequestId(header) {
  return typeof header === "string" ? (header.split("::").pop() ?? "") : "";
}

// The level and request a line names; neither for a line that is not one of
// the server's JSON log lines.
function describe(line) {
  if (!line.startsWith("{")) {
    return {};
  }
  try {
    const { level, request_id: requestId } = JSON.parse(line);
    return {
      level: typeof level === "string" ? level : undefined,
      requestId: typeof requestId === "string" ? requestId : undefined,
    };
  } catch {
    return {};
  }
}

export class LogRelay {
  #requests = new Map();
  #outside;
  #console;

  /**
   * @param {{ outside: (print: () => void) => void, console?: Console }} options
   *   outside runs a function outside any request's context
   *   (AsyncLocalStorage.snapshot() taken while the module loads)
   */
  constructor({ outside, console: output = console }) {
    this.#outside = outside;
    this.#console = output;
  }

  /**
   * Holds a request open: its lines are printed with run, which runs a
   * function in the request's context (AsyncLocalStorage.snapshot() taken in
   * the request's handler).
   */
  open(requestId, run) {
    if (requestId !== "") {
      this.#requests.set(requestId, run);
    }
  }

  close(requestId) {
    this.#requests.delete(requestId);
  }

  /** Prints one line of the server's output. */
  line(text) {
    if (text === "") {
      return;
    }
    const { level = "", requestId } = describe(text);
    const method = printers.find(([prefix]) => level.startsWith(prefix))?.[1] ?? "log";
    const run = this.#requests.get(requestId) ?? this.#newest() ?? this.#outside;
    // One argument: the line is never a format string.
    run(() => this.#console[method](text));
  }

  // The request opened last, of those still open.
  #newest() {
    let newest;
    for (const run of this.#requests.values()) {
      newest = run;
    }
    return newest;
  }

  /** Relays every line a stream of the server's output carries. */
  read(stream) {
    createInterface({ input: stream, crlfDelay: Infinity }).on("line", (text) => this.line(text));
  }

  get openCount() {
    return this.#requests.size;
  }
}
