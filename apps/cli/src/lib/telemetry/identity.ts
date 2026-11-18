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

type StoredIdentity = {
  distinctId: string;
  /** When the install's profile was last written, and a hash of what was written. */
  profile?: { at: number; hash: string };
};

/** How long a written profile stands before it is written again: a day. */
const PROFILE_EVERY_MS = 24 * 60 * 60 * 1000;

/**
 * Resolve the directory the CLI persists cross-invocation state in, honoring
 * the platform conventions: `XDG_CONFIG_HOME` then `~/.config` on Unix, and
 * `%APPDATA%` on Windows. The anonymous id lives here so it survives between
 * runs without touching the user's project tree.
 *
 * It is `undefined` when the home directory cannot be determined, as
 * `os.homedir()` throws in some restricted or containerised environments.
 */
export function telemetryConfigDir(env: NodeJS.ProcessEnv): string | undefined {
  if (process.platform === "win32" && env.APPDATA) {
    return join(env.APPDATA, "zitadel", "cli");
  }
  const configured = env.XDG_CONFIG_HOME?.trim();
  if (configured) {
    return join(configured, "zitadel", "cli");
  }
  try {
    return join(homedir(), ".config", "zitadel", "cli");
  } catch {
    return undefined;
  }
}

/**
 * Load the persisted anonymous id, minting and storing a new one on first run.
 *
 * Fail-open: if the config dir cannot be resolved, read, or written — including
 * an `os.homedir()` throw in a restricted/containerized environment, a
 * read-only home, a CI sandbox, or a permissions error — fall back to an
 * ephemeral per-process id and report `isFirstRun: false` so we neither crash
 * nor nag the user with the notice on every run. Telemetry is best-effort,
 * never load-bearing.
 */
export function loadOrCreateIdentity(env: NodeJS.ProcessEnv): Identity {
  const dir = telemetryConfigDir(env);
  if (dir === undefined) {
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

/**
 * Whether the install's profile is due to be written now, and if so remember
 * that it was: when it has never been written, when what it would say differs
 * from what it last said, or when a day has passed since it was last written.
 * That keeps the profile's version facts current within a day of an upgrade,
 * and its "last seen" within a day of the install's last run, for at most one
 * request per install per day.
 *
 * Fail-closed: an install that cannot remember what it wrote (no config
 * directory, a read-only home) never writes a profile, so it cannot add a new
 * profile on every run.
 *
 * @param env - The environment the run reads.
 * @param hash - A hash of what the profile would say.
 * @param now - The time in milliseconds.
 * @returns Whether to write the profile now.
 */
export function profileDue(
  env: NodeJS.ProcessEnv,
  hash: string,
  now: number = Date.now(),
): boolean {
  const dir = telemetryConfigDir(env);
  if (dir === undefined) {
    return false;
  }
  const file = join(dir, "telemetry.json");
  try {
    const stored = JSON.parse(readFileSync(file, "utf8")) as StoredIdentity;
    const last = stored.profile;
    const due = last === undefined || last.hash !== hash || now - last.at >= PROFILE_EVERY_MS;
    if (!due) {
      return false;
    }
    writeFileSync(file, `${JSON.stringify({ ...stored, profile: { at: now, hash } })}\n`, {
      mode: 0o600,
    });

    return true;
  } catch {
    return false;
  }
}
