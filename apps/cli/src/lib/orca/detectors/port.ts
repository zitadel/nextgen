import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { PackageJson } from "./package-json";

/**
 * Port assumed when no explicit dev port can be discovered. Matches Next.js's
 * own default so the inferred issuer URL lines up with `next dev`.
 */
export const DEFAULT_DEV_PORT = 3000;

/**
 * Determines the local dev-server port for `cwd`. The `dev` script is the most
 * authoritative source, then a `PORT` declaration in an env file, falling back
 * to {@link DEFAULT_DEV_PORT}. Used to derive the local issuer URL.
 */
export async function detectDevPort(cwd: string, pkg: PackageJson): Promise<number> {
  const dev = pkg.scripts?.dev;
  const fromScript = typeof dev === "string" ? extractPort(dev) : undefined;
  if (fromScript) {
    return fromScript;
  }

  const fromEnvFile = await portFromEnvFile(cwd);
  if (fromEnvFile) {
    return fromEnvFile;
  }

  return DEFAULT_DEV_PORT;
}

async function portFromEnvFile(cwd: string): Promise<number | undefined> {
  for (const candidate of [".env.local", ".env"]) {
    try {
      const contents = await readFile(join(cwd, candidate), "utf8");
      const match = contents.match(/^\s*PORT\s*=\s*(\d+)/m);
      const rawPort = match?.[1];
      if (rawPort) {
        return Number.parseInt(rawPort, 10);
      }
    } catch {
      continue;
    }
  }
  return undefined;
}

/**
 * Parses a dev port out of an npm `dev` script string, recognizing both flag
 * forms (`-p`/`--port`) and a leading `PORT=` env assignment. Returns
 * `undefined` when no valid positive port is present so callers can fall back.
 */
export function extractPort(script: string): number | undefined {
  const inline = script.match(/-p\s+(\d+)|--port[=\s]+(\d+)/);
  if (inline) {
    const raw = inline[1] ?? inline[2];
    if (!raw) {
      return undefined;
    }
    const value = Number.parseInt(raw, 10);
    if (Number.isFinite(value) && value > 0) {
      return value;
    }
  }
  const env = script.match(/(?:^|\s)PORT=(\d+)/);
  const rawEnvPort = env?.[1];
  if (rawEnvPort) {
    return Number.parseInt(rawEnvPort, 10);
  }
  return undefined;
}

/**
 * Rewrites a `dev` script so it explicitly runs on `port`.
 *
 * Setup registers `http://localhost:<port>` as the project's only allowed
 * origin, so the dev server has to land on exactly that port — a bare
 * `next dev` does not: it defaults to 3000 and, when 3000 is taken, silently
 * falls back to 3001. Either way the flow API then rejects the app's origin
 * mid-login. An explicit `--port` removes both failure modes: the port
 * matches what setup registered, and a busy port fails loudly with
 * `EADDRINUSE` instead of drifting to one the project does not allow.
 *
 * `--port <n>` is the one spelling every framework this CLI scaffolds
 * accepts (`next dev`, `nuxt dev`, `vite`, `vinxi dev`, `ng serve`), so an
 * appended declaration stays framework-agnostic. An existing declaration is
 * rewritten in its own form instead — a `PORT=` env assignment keeps the
 * `PORT=` form — so the script keeps whichever mechanism its author chose and
 * only the number changes.
 */
export function withDevPort(script: string, port: number): string {
  // Test for a declaration rather than comparing before/after: a script that
  // already names the target port rewrites to itself, and treating that
  // "unchanged" as "no port found" would append a second, duplicate flag on
  // every re-run of setup.
  const flagPattern = /(-p\s+|--port[=\s]+)\d+/;
  if (flagPattern.test(script)) {
    return script.replace(flagPattern, (_match, prefix: string) => `${prefix}${String(port)}`);
  }
  const envPattern = /((?:^|\s)PORT=)\d+/;
  if (envPattern.test(script)) {
    return script.replace(envPattern, (_match, prefix: string) => `${prefix}${String(port)}`);
  }
  return `${script.trimEnd()} --port ${String(port)}`;
}

/**
 * Builds the local OIDC issuer URL for a given dev port. Centralized so the
 * `localhost` origin convention is defined in exactly one place.
 */
export function issuerFromPort(port: number): string {
  return `http://localhost:${port}`;
}

/**
 * The port an issuer URL names, or `undefined` when it names none.
 *
 * The inverse of {@link issuerFromPort}, and the authoritative way to learn
 * which port a project *registered* — as opposed to {@link detectDevPort},
 * which reports the port the app would start on right now. The two agree
 * during setup and diverge afterwards, which is exactly when it matters: a
 * dev script edited to another port must be read as a mismatch against the
 * registered origin, not as the new truth.
 */
export function portFromIssuer(issuer: string): number | undefined {
  try {
    // Validity gate only. `.port` cannot be read off this: WHATWG drops a
    // port matching the scheme's default, so `http://localhost:80` — a port
    // `--dev-port` accepts — would come back portless and silently disable
    // the dev-script pinning, reintroducing the very mismatch it prevents.
    new URL(issuer);
  } catch {
    return undefined;
  }
  // Re-parse under a scheme the URL standard treats as non-special. Those
  // have no default port, so an explicitly written 80/443 survives, while
  // host parsing (IPv6 brackets, userinfo) stays the standard's job.
  let probe: URL;
  try {
    probe = new URL(issuer.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:/, "zl-issuer-probe:"));
  } catch {
    return undefined;
  }
  const port = Number.parseInt(probe.port, 10);
  return Number.isFinite(port) && port > 0 ? port : undefined;
}
