import { join } from "node:path";

import type { CreateIdpBodyIdp } from "@zitadel/api/generated/model";
import { consola } from "consola";

import { isVariableReference, referencedVariable } from "@zitadel/config/idp";
import { idpConnectionConfigSchema } from "@zitadel/config/schemas";

import { ZitadelError } from "../../errors";
import { IDPS_DIR, refuseResolvedSecret } from "../../idp";
import { readJsonDirEntries } from "../../json-dir";
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
    const entries = await readJsonDirEntries(join(ctx.cwd, IDPS_DIR));
    const connections = entries.map((entry) => entry.body);
    // Validate every file before creating any. `POST /idps` writes one
    // connection at a time, so a malformed file partway through would leave the
    // earlier ones already created — a partial write. Checking the whole set
    // first means a bad file stops the deploy before any connection is written.
    // A dry run surfaces the same failures, which is why it validates here too.
    for (const connection of connections) {
      validateConnection(connection, ctx.suggest);
    }
    // The credentials a connection names must be variables the project holds,
    // the client id a plain one and the secret a secret one: otherwise the
    // deploy publishes a sign-in button that fails at the provider.
    if (connections.length > 0) {
      const held = await heldVariables(ctx);
      for (const entry of entries) {
        checkCredentialVariables(entry.body, `${IDPS_DIR}/${entry.name}`, held, ctx.suggest);
      }
    }
    for (const connection of connections) {
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
function validateConnection(data: object, suggest: StepContext["suggest"]): void {
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
          ? `Use "client_secret": "\${{ NAME }}" and publish the value with \`${suggest("variables set NAME --project-level --secret")}\`.`
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

/** The project's variables, by name, and whether each is a secret. */
async function heldVariables(ctx: StepContext): Promise<Map<string, boolean>> {
  const held = await ctx.client.getVariables({ project_id: ctx.projectId });
  // A secret reads back as `{ secret: true }`, a plain value as the value.
  return new Map(Object.entries(held).map(([name, value]) => [name, typeof value === "object"]));
}

/**
 * What the engine needs from the variables a connection names: they exist,
 * the client id is a plain one it can put in the authorize URL, the client
 * secret is a secret one, and they are not one and the same.
 */
function checkCredentialVariables(
  connection: object,
  file: string,
  held: ReadonlyMap<string, boolean>,
  suggest: StepContext["suggest"],
): void {
  const body = connection as {
    oidc?: { client_id?: unknown; client_secret?: unknown };
    oauth2?: { client_id?: unknown; client_secret?: unknown };
  };
  const block = body.oidc ?? body.oauth2;
  const nameOf = (value: unknown) =>
    typeof value === "string" ? referencedVariable(value) : undefined;
  const named = [
    { field: "client_id", secret: false, name: nameOf(block?.client_id) },
    { field: "client_secret", secret: true, name: nameOf(block?.client_secret) },
  ].flatMap((credential) =>
    credential.name === undefined ? [] : [{ ...credential, name: credential.name }],
  );
  const [id, secret] = named;
  if (id !== undefined && secret !== undefined && id.name === secret.name) {
    throw new ZitadelError(
      "E_VALIDATION",
      `${file}: client_id and client_secret both name the variable ${id.name}`,
      {
        hint: "Give each its own variable: a plain one for the client id, a secret one for the client secret.",
        details: { variable: id.name, file },
      },
    );
  }
  for (const { field, secret: wantsSecret, name } of named) {
    const isSecret = held.get(name);
    if (isSecret === undefined) {
      throw new ZitadelError(
        "E_CREDENTIAL_MISSING",
        `${file}: ${field} names the variable ${name}, which the project does not have`,
        {
          hint: "Publish it with the command below, then deploy again.",
          nextCommands: [
            suggest(`variables set ${name} --project-level${wantsSecret ? " --secret" : ""}`),
          ],
          details: { variable: name, field, file },
        },
      );
    }
    if (isSecret !== wantsSecret) {
      throw new ZitadelError(
        "E_VALIDATION",
        `${file}: ${field} names the variable ${name}, which is ${isSecret ? "a secret" : "not a secret"}`,
        {
          hint: wantsSecret
            ? "The client secret must be a secret variable: publish it with the command below."
            : "The client id must be a plain variable the engine can read back: publish it with the command below, without --secret.",
          nextCommands: [
            suggest(`variables set ${name} --project-level${wantsSecret ? " --secret" : ""}`),
          ],
          details: { variable: name, field, file, secret: isSecret },
        },
      );
    }
  }
}
