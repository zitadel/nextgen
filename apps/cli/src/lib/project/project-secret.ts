import { readFile, rename } from "node:fs/promises";
import { join } from "node:path";

import { ZitadelError } from "@/lib/errors";
import { isErrno } from "@/lib/errno";
import { pathExistsStrict } from "@/lib/fs";
import { parseJsonObject, stableStringify } from "@/lib/json";

import { SecretFile } from "./secret-file";

/**
 * What the project secret at `.zitadel/secret` holds: the project identity plus
 * the credentials used to talk to the platform in preview and production.
 */
export type ProjectSecretData = {
  project_id: string;
  project_secret: string;
  preview_secret: string;
  /** Exact primary origin patterns that admit requests. */
  primary_origins: string[];
  /** Preview origin patterns that bound which preview URLs may register. */
  preview_origins: string[];
  created_at: string;
  /**
   * When the project was attached to an owning team, recorded by
   * `zitadel claim`. Absent until then. The durable record lives on the
   * platform (the team's project grant); this is a local cache so commands can
   * answer "is this already attached?" without a round trip.
   */
  claimed_at?: string;
  /** The team that owns the project, recorded alongside {@link ProjectSecretData.claimed_at}. */
  team_id?: string;
};

/** Where the secret lives, relative to the project's directory. */
const PATH = ".zitadel/secret";

/**
 * A project's secret, `.zitadel/secret`: local credentials that are never
 * committed. It is read whole and validated, so a command never proceeds with
 * partial credentials.
 */
export class ProjectSecret {
  /** What the file holds. */
  readonly data: Readonly<ProjectSecretData>;

  /** The project's directory, which the secret is read from and written back to. */
  private readonly cwd: string;

  /**
   * @param cwd - The project's directory.
   * @param data - What the file holds.
   */
  private constructor(cwd: string, data: Readonly<ProjectSecretData>) {
    this.cwd = cwd;
    this.data = data;
  }

  /**
   * A secret built from known data, to be written with {@link ProjectSecret.write}.
   *
   * @param cwd - The project's directory.
   * @param data - What the file should hold.
   * @returns The secret.
   */
  static of(cwd: string, data: Readonly<ProjectSecretData>): ProjectSecret {
    return new ProjectSecret(cwd, data);
  }

  /**
   * Whether local secret material is present. Gates commands that need
   * credentials, and signals that secrets were already pulled.
   *
   * @param cwd - The project's directory.
   * @returns `true` when the file exists.
   */
  static async exists(cwd: string): Promise<boolean> {
    return pathExistsStrict(join(cwd, PATH));
  }

  /**
   * Reads, parses and structurally validates `.zitadel/secret`. A missing file
   * becomes an actionable `E_VALIDATION` error pointing at `setup` and
   * `doctor --fix`; a present-but-incomplete file throws.
   *
   * @param cwd - The project's directory.
   * @returns The secret.
   * @throws {@link ZitadelError} When there is no secret.
   * @throws {Error} When the file lacks a required field.
   */
  static async read(cwd: string): Promise<ProjectSecret> {
    try {
      const secret = parseJsonObject(await readFile(join(cwd, PATH), "utf8"), PATH);
      if (
        typeof secret.project_id !== "string" ||
        typeof secret.project_secret !== "string" ||
        typeof secret.preview_secret !== "string" ||
        !Array.isArray(secret.preview_origins)
      ) {
        throw new Error(".zitadel/secret is missing required fields");
      }
      // primary_origins was added with kinded origins; older secrets only have
      // preview_origins. A missing array reads as empty so doctor --fix can
      // still rebuild from the rest of the file.
      if (secret.primary_origins === undefined) {
        secret.primary_origins = [];
      }
      if (!Array.isArray(secret.primary_origins)) {
        throw new Error(".zitadel/secret is missing required fields");
      }
      return new ProjectSecret(cwd, secret as ProjectSecretData);
    } catch (error) {
      if (isErrno(error, "ENOENT")) {
        throw new ZitadelError("E_VALIDATION", ".zitadel/secret was not found", {
          hint: "Run `zitadel setup` first. If this project was set up before, `zitadel doctor --fix` restores the secret from .env.development.local.",
          nextCommands: [{ id: "setup" }, { id: "doctor", flags: { fix: true } }],
        });
      }
      throw error;
    }
  }

  /**
   * This secret with some of its fields changed.
   *
   * @param changes - The fields to replace.
   * @returns A new secret; this one is left as it is.
   */
  with(changes: Partial<ProjectSecretData>): ProjectSecret {
    return new ProjectSecret(this.cwd, { ...this.data, ...changes });
  }

  /**
   * Writes `.zitadel/secret` back after a command changed it (today only
   * `zitadel claim`, which records `claimed_at` and `team_id`).
   *
   * Atomic by construction: the bytes land in a sibling temp file that is
   * locked down and then renamed over the target, so a crash mid-write can
   * never leave a truncated or world-readable credentials file. Serialised
   * with the stable stringifier at mode `0600`, as setup's patcher first wrote
   * it, so a claim does not churn the file's formatting or loosen the
   * permissions `doctor` asserts.
   *
   */
  async write(): Promise<void> {
    const path = join(this.cwd, PATH);
    const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
    await new SecretFile(tmp).write(`${stableStringify(this.data)}\n`);
    await rename(tmp, path);
  }
}
