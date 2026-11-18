import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * A stable, anonymous identifier for this install. It is a random UUID tied to
 * no account, email, or machine fingerprint — its only job is to let Mixpanel
 * group events from the same install into a funnel. `isFirstRun` is true until
 * the one-time consent notice has been shown on this install (see
 * {@link markNoticed}), so a first run that cannot show it leaves it for the
 * next run that can.
 */
export type Identity = {
  readonly distinctId: string;
  readonly isFirstRun: boolean;
  /** What the install's record said when it was read, so a run reads it once. */
  readonly record?: StoredIdentity;
};

export type StoredIdentity = {
  distinctId: string;
  /** Set when this install's record was created by a release that writes profiles, so its first version is known. */
  began?: true;
  /** When the install's profile was last written, and a hash of what was written. */
  profile?: { at: number; hash: string };
};

/**
 * Writes the install's record whole or not at all: a run reading it while
 * another writes never sees a half-written file, which would read as no
 * identity and mint a second id.
 */
function writeStored(file: string, stored: StoredIdentity): void {
  const temporary = `${file}.${process.pid}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(stored)}\n`, { mode: 0o600 });
    renameSync(temporary, file);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
}

/**
 * The file whose existence says the first-run notice was shown. It is a file of
 * its own, not a field of the install's record, so two runs that each rewrite
 * the record never lose it.
 */
const NOTICE_FILE = "notice-shown";

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
      return {
        distinctId: parsed.distinctId,
        isFirstRun: !existsSync(join(dir, NOTICE_FILE)),
        record: parsed,
      };
    }
  } catch {
    /* fall through to mint a fresh id */
  }

  const record: StoredIdentity = { distinctId: randomUUID(), began: true };
  try {
    mkdirSync(dir, { recursive: true });
    writeStored(file, record);
    return { distinctId: record.distinctId, isFirstRun: true, record };
  } catch {
    // Another run may have stored its id first: take that one, so the two are one install.
    try {
      const other = JSON.parse(readFileSync(file, "utf8")) as StoredIdentity;
      if (typeof other.distinctId === "string" && other.distinctId.length > 0) {
        return {
          distinctId: other.distinctId,
          isFirstRun: !existsSync(join(dir, NOTICE_FILE)),
          record: other,
        };
      }
    } catch {
      /* nothing stored: this run is on its own */
    }

    return { distinctId: record.distinctId, isFirstRun: false };
  }
}

/**
 * Whether the install's profile is due to be written now, and if so remember
 * that it was: when it has never been written, when what it would say differs
 * from what it last said, or when a day has passed since it was last written.
 * That keeps the profile's version facts current within a day of an upgrade,
 * and its "last seen" within a day of the install's last run. The hash holds
 * only what changes with the install (versions, platform), never what changes
 * with the run (the host, the package manager), so the profile is written at
 * most once a day unless the install itself changed.
 *
 * Fail-closed: an install that cannot remember what it wrote (no config
 * directory, a read-only home) never writes a profile, so it cannot add a new
 * profile on every run.
 *
 * @param env - The environment the run reads.
 * @param hash - A hash of what the profile would say.
 * @param record - The install's record as the run read it.
 * @param now - The time in milliseconds.
 * @returns Nothing when no profile is due; else whether this is the install's first
 *   profile, written by the release that created the install, so its version is the first one.
 */
export function profileDue(
  env: NodeJS.ProcessEnv,
  hash: string,
  record: StoredIdentity | undefined,
  now: number = Date.now(),
): { readonly first: boolean } | undefined {
  const dir = telemetryConfigDir(env);
  if (dir === undefined || record === undefined) {
    return undefined;
  }
  const last = record.profile;
  const due = last === undefined || last.hash !== hash || now - last.at >= PROFILE_EVERY_MS;
  if (!due) {
    return undefined;
  }
  try {
    writeStored(join(dir, "telemetry.json"), { ...record, profile: { at: now, hash } });
  } catch {
    return undefined;
  }

  return { first: record.began === true && last === undefined };
}

/**
 * Remembers that the first-run notice was shown, so no later run shows it again.
 * Best-effort: an install that cannot write its record shows it once per run
 * instead of never.
 *
 * @param env - The environment the run reads.
 */
export function markNoticed(env: NodeJS.ProcessEnv): void {
  const dir = telemetryConfigDir(env);
  if (dir === undefined) {
    return;
  }
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, NOTICE_FILE), "", { mode: 0o600 });
  } catch {
    /* the notice may show again */
  }
}
