import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseEnv } from "node:util";

import { createZitadelClient, Origins } from "@/lib/backend";
import { isErrno } from "@/lib/errno";
import { Project } from "@/lib/project";
import { Runtime } from "@/lib/runtime";

import { AbstractSanityCheck, type CheckContext } from "./types";

/**
 * The env file the CLI reads, which setup fills with the project's credentials.
 */
const DEVELOPMENT_ENV_FILE = ".env.development.local";

/**
 * Verifies `.zitadel/secret` exists and parses. A missing file is rebuilt from
 * the credentials `.env.development.local` holds and the origins the server
 * reports for the project.
 */
export class SecretCheck extends AbstractSanityCheck {
  readonly name = "secret";
  readonly path = ".zitadel/secret";
  protected readonly summary = ".zitadel/secret parses";

  protected async verify(ctx: CheckContext): Promise<void> {
    await Project.at(ctx.cwd).secret();
  }

  /**
   * Rebuilds a missing `.zitadel/secret`; leaves a present file alone, since a
   * file that exists but is damaged may hold what no other copy does.
   *
   * @param ctx - The project to repair.
   * @throws When the file is missing and `.env.development.local` cannot supply
   *   the project's id, server and secrets.
   */
  override async fix(ctx: CheckContext): Promise<void> {
    if (await Project.at(ctx.cwd).hasSecret()) {
      return;
    }
    const env = await readFile(join(ctx.cwd, DEVELOPMENT_ENV_FILE), "utf8").then(
      parseEnv,
      (error: unknown) => {
        if (isErrno(error, "ENOENT")) {
          throw new Error(
            `${DEVELOPMENT_ENV_FILE} is missing, so the project's secrets cannot be restored from it`,
          );
        }
        throw error;
      },
    );
    const server = env.ZITADEL_URL;
    const projectId = env.ZITADEL_PROJECT_ID;
    const projectSecret = env.ZITADEL_PROJECT_SECRET;
    const previewSecret = env.ZITADEL_PREVIEW_TOKEN;
    if (!server || !projectId || !projectSecret || !previewSecret) {
      throw new Error(
        `${DEVELOPMENT_ENV_FILE} must hold ZITADEL_URL, ZITADEL_PROJECT_ID, ZITADEL_PROJECT_SECRET and ZITADEL_PREVIEW_TOKEN to restore the project's secrets`,
      );
    }
    if (ctx.dryRun) {
      return;
    }
    const project = await createZitadelClient({
      userAgent: Runtime.current().userAgent(),
      baseUrl: server,
      token: projectSecret,
      signal: ctx.signal,
    }).getProject(projectId);
    const origins = Origins.wrap(project.origins);
    await Project.at(ctx.cwd).restoreSecret({
      project_id: project.id,
      project_secret: projectSecret,
      preview_secret: previewSecret,
      primary_origins: [...origins.primary],
      preview_origins: [...origins.preview],
      created_at: project.created_at,
    });
  }
}
