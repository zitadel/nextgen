import { join } from "node:path";

import type { CreateIdpBodyIdp } from "@zitadel/api/generated/model";
import { consola } from "consola";

import { isVariableReference } from "@zitadel/config/idp";
import { idpConnectionConfigSchema } from "@zitadel/config/schemas";

import { ZitadelError } from "../../errors";
import { IDPS_DIR, refuseResolvedSecret } from "../../idp";
import { readJsonDir } from "../../json-dir";
import type { Step, StepContext } from "../pipeline";

/**
 * TEMPORARY. Identity-provider connections are not a release-bundle kind yet,
 * so a deploy syncs them on the side — `POST /idps`, one per
 * `.zitadel/idps/*.json`, before the release — because flow steps reference a
 * connection by slug and the slug must exist when the release is built. When
 * the bundle gains an `idp` kind this whole step goes away and connections ride
 * the bundle like schemas, flows and branding do. It is deploy-only: a preview
 * never writes connections.
 */
export const idpConnectionsStep: Step = {
  name: "idp-connections",
  runsFor: ["deploy"],
  // Not marked `writes`: a dry run must still run this step to validate and
  // preview the connection files. The write itself (`POST /idps`) is guarded on
  // `ctx.dryRun` below rather than the whole step being skipped, so a dry run
  // reports what it would sync without a bad file slipping past validation.
  async run(ctx: StepContext): Promise<void> {
    const connections = await readJsonDir(join(ctx.cwd, IDPS_DIR));
    for (const connection of connections) {
      // Validation runs on every deploy, dry or not: a dry run must surface a
      // malformed file (or a literal client_secret) rather than defer it.
      validateConnection(connection);
      if (ctx.dryRun) {
        // A dry run writes nothing; it only reports what the real deploy would
        // sync. Withheld under `--json` so the envelope travels alone on stdout.
        if (!ctx.json) {
          const slug = typeof connection.slug === "string" ? connection.slug : "(unnamed)";
          process.stdout.write(`Would sync idp connection ${slug}\n`);
        }
        continue;
      }
      // `POST /idps` dedupes on the slug inside the body, so re-sending an
      // unchanged connection revises it in place rather than creating a second.
      const result = await ctx.client.createIdp(
        { idp: connection as CreateIdpBodyIdp },
        { project_id: ctx.projectId },
      );
      consola.debug(`synced idp connection ${result.id}`);
    }
  },
};

/**
 * The connection's shape, and the one mistake that would publish a credential:
 * a `client_secret` held as a value rather than a `${{ NAME }}` reference.
 */
function validateConnection(data: object): void {
  const result = idpConnectionConfigSchema.safeParse(data);
  if (!result.success) {
    const literalSecret = result.error.issues.some((issue) => {
      if (issue.path[issue.path.length - 1] !== "client_secret") {
        return false;
      }
      const stored = valueAt(data, issue.path);
      return typeof stored === "string" && !isVariableReference(stored);
    });
    throw new ZitadelError(
      "E_VALIDATION",
      literalSecret
        ? "Connection file's client_secret must reference a variable, not hold a value"
        : "Connection file is not a valid identity provider connection",
      {
        hint: literalSecret
          ? 'Use "client_secret": "${{ NAME }}" and publish the value with `variable set NAME --secret`.'
          : undefined,
        details: { issues: result.error.issues },
      },
    );
  }
  // A read that resolved a secret must never be sent on; validate the body too.
  refuseResolvedSecret(data, "the connection");
}

/** The value a Zod issue path points at, or undefined when it is absent. */
function valueAt(data: object, path: ReadonlyArray<PropertyKey>): unknown {
  let current: unknown = data;
  for (const key of path) {
    if (typeof current !== "object" || current === null) {
      return undefined;
    }
    current = (current as Record<PropertyKey, unknown>)[key];
  }
  return current;
}
