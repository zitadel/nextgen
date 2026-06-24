import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * A stable, anonymous identifier for this install. It is a random UUID tied to
 * no account, email, or machine fingerprint — its only job is to let Mixpanel
 * group events from the same install into a funnel. `isFirstRun` is true the
 * one time we mint and persist the id, which drives the one-time consent notice.
 */
export type Identity = {
  readonly distinctId: string;
  readonly isFirstRun: boolean;
};

type StoredIdentity = { distinctId: string };

/**
 * Resolve the directory the CLI persists cross-invocation state in, honoring
 * the platform conventions: `XDG_CONFIG_HOME` then `~/.config` on Unix, and
 * `%APPDATA%` on Windows. The anonymous id lives here so it survives between
 * runs without touching the user's project tree.
 */
export function telemetryConfigDir(env: NodeJS.ProcessEnv): string {
  if (process.platform === "win32" && env.APPDATA) {
    return join(env.APPDATA, "zitadel", "cli");
  }
  const base = env.XDG_CONFIG_HOME?.trim() || join(homedir(), ".config");
  return join(base, "zitadel", "cli");
}

/**
 * Load the persisted anonymous id, minting and storing a new one on first run.
 *
 * Fail-open: if the config dir cannot be read or written (read-only home, CI
 * sandbox, permissions), fall back to an ephemeral per-process id and report
 * `isFirstRun: false` so we neither crash nor nag the user with the notice on
 * every run. Telemetry is best-effort, never load-bearing.
 */
export function loadOrCreateIdentity(env: NodeJS.ProcessEnv): Identity {
  let dir: string;
  try {
    dir = telemetryConfigDir(env);
  } catch {
    // `os.homedir()` can throw in restricted/containerized environments. Fail
    // open to an ephemeral id rather than crash the host CLI.
    return { distinctId: randomUUID(), isFirstRun: false };
  }
  const file = join(dir, "telemetry.json");

  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as StoredIdentity;
    if (typeof parsed.distinctId === "string" && parsed.distinctId.length > 0) {
      return { distinctId: parsed.distinctId, isFirstRun: false };
    }
  } catch {
    /* fall through to mint a fresh id */
  }

  const distinctId = randomUUID();
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, `${JSON.stringify({ distinctId } satisfies StoredIdentity)}\n`, {
      mode: 0o600,
    });
    return { distinctId, isFirstRun: true };
  } catch {
    return { distinctId, isFirstRun: false };
  }
}
