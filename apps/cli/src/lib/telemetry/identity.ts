import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import {
  FsError,
  FsExistsError,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "@/lib/fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { TelemetryHomeUnknownError } from "./errors";

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
  /** The CLI version the install's first profile was written on, kept to send again until Mixpanel has it. */
  firstVersion?: string;
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
    try {
      return join(homedir(), ".config", "zitadel", "cli");
    } catch (error) {
      // The boundary: `homedir` throws Node's untyped system error.
      throw new TelemetryHomeUnknownError("Cannot find the home directory", error);
    }
  } catch (error) {
    if (error instanceof TelemetryHomeUnknownError) {
      return undefined;
    }
    throw error;
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
  const stored = readStored(dir);
  if (stored !== undefined) {
    return stored;
  }

  const record: StoredIdentity = { distinctId: randomUUID(), began: true };
  try {
    mkdirSync(dir, { recursive: true });
    writeStored(join(dir, "telemetry.json"), record);
    return { distinctId: record.distinctId, isFirstRun: true, record };
  } catch (error) {
    // Another run may have stored its id first: take that one, so the two are one install.
    if (error instanceof FsError) {
      return readStored(dir) ?? { distinctId: record.distinctId, isFirstRun: false };
    }
    throw error;
  }
}

/**
 * The install's identity as its record says, if there is a usable one. An install
 * whose record predates the notice marker (it has no `began`) already saw the
 * notice on an earlier release, so only an install this release began is first-run
 * until the notice has been shown.
 *
 * @param dir - The directory the install's state lives in.
 * @returns The identity, or nothing when there is no record or it is unusable.
 */
function readStored(dir: string): Identity | undefined {
  try {
    const record = JSON.parse(readFileSync(join(dir, "telemetry.json"), "utf8")) as StoredIdentity;
    if (typeof record.distinctId === "string" && record.distinctId.length > 0) {
      return {
        distinctId: record.distinctId,
        isFirstRun: record.began === true && !existsSync(join(dir, NOTICE_FILE)),
        record,
      };
    }
  } catch (error) {
    // No usable record: JSON that does not parse, or a file Node cannot read.
    if (error instanceof SyntaxError) {
      return undefined;
    }
    if (error instanceof FsError) {
      return undefined;
    }
    throw error;
  }

  return undefined;
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
 * @param version - The CLI version the run is on.
 * @param now - The time in milliseconds.
 * @returns Nothing when no profile is due; else the version the install began on, for an
 *   install created by a release that writes profiles. It is sent with every profile write,
 *   as `set_once`, so a first write that failed to arrive is made up by the next one.
 */
export function profileDue(
  env: NodeJS.ProcessEnv,
  hash: string,
  record: StoredIdentity | undefined,
  version: string,
  now: number = Date.now(),
): { readonly firstVersion: string | undefined } | undefined {
  const dir = telemetryConfigDir(env);
  if (dir === undefined || record === undefined) {
    return undefined;
  }
  const last = record.profile;
  const due = last === undefined || last.hash !== hash || now - last.at >= PROFILE_EVERY_MS;
  if (!due) {
    return undefined;
  }
  const firstVersion = record.began === true ? (record.firstVersion ?? version) : undefined;
  try {
    writeStored(join(dir, "telemetry.json"), {
      ...record,
      ...(firstVersion !== undefined && { firstVersion }),
      profile: { at: now, hash },
    });
  } catch (error) {
    if (error instanceof FsError) {
      return undefined;
    }
    throw error;
  }

  return { firstVersion };
}

/**
 * Claims the first-run notice for this run: the marker is created exclusively and
 * before the notice is printed, so of two concurrent first runs only one shows it,
 * and a run that dies after printing never shows it twice.
 *
 * Fail-open: an install that cannot write the marker shows the notice on every run
 * instead of never.
 *
 * @param env - The environment the run reads.
 * @returns Whether this run is the one to show the notice.
 */
export function markNoticed(env: NodeJS.ProcessEnv): boolean {
  const dir = telemetryConfigDir(env);
  if (dir === undefined) {
    return true;
  }
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, NOTICE_FILE), "", { mode: 0o600, flag: "wx" });
  } catch (error) {
    // A marker already there means another run claimed the notice; any other failure shows it.
    if (error instanceof FsExistsError) {
      return false;
    }
    if (error instanceof FsError) {
      return true;
    }
    throw error;
  }

  return true;
}
