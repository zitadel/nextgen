import { mkdir, readFile, rename } from "node:fs/promises";
import { dirname, join } from "node:path";

import { isErrno } from "@/lib/errno";
import { pathExistsStrict } from "@/lib/fs";
import { parseJsonObject, stableStringify } from "@/lib/json";

import { ProjectSecretMalformedError, ProjectSecretMissingError } from "./errors";
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
  constructor(cwd: string, data: Readonly<ProjectSecretData>) {
    this.cwd = cwd;
    this.data = data;
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
   * and one that is not a complete secret are failures of their own; any
   * other error (the operating system refusing the read) propagates unchanged.
   *
   * @param cwd - The project's directory.
   * @returns The secret.
   * @throws {@link ProjectSecretMissingError} When there is no secret.
   * @throws {@link ProjectSecretMalformedError} When the file is not JSON or
   *   lacks a required field.
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
        throw new ProjectSecretMalformedError(".zitadel/secret is missing required fields");
      }
      // primary_origins was added with kinded origins; older secrets only have
      // preview_origins. A missing array reads as empty so doctor --fix can
      // still rebuild from the rest of the file.
      if (secret.primary_origins === undefined) {
        secret.primary_origins = [];
      }
      if (!Array.isArray(secret.primary_origins)) {
        throw new ProjectSecretMalformedError(".zitadel/secret is missing required fields");
      }
      return new ProjectSecret(cwd, secret as ProjectSecretData);
    } catch (error) {
      if (isErrno(error, "ENOENT")) {
        throw new ProjectSecretMissingError({
          cause: error,
        });
      }
      if (
        error instanceof SyntaxError ||
        (error instanceof Error && error.message === `${PATH} must contain a JSON object`)
      ) {
        throw new ProjectSecretMalformedError(error.message, {
          cause: error,
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
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
    await new SecretFile(tmp).write(`${stableStringify(this.data)}\n`);
    await rename(tmp, path);
  }
}
