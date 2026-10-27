import { isVariableReference, missingEndpoints, referencedVariable } from "@zitadel/config/idp";
import { idpConnectionConfigSchema } from "@zitadel/config/schemas";
import { ApiError } from "@zitadel/api/runtime/fetch";

import { ZitadelError } from "../../errors";
import { IDPS_DIR, refuseResolvedSecret } from "../../idp";
import { valuesOfKind } from "../../variables";
import type { StepContext } from "../pipeline";

/**
 * The checks a connection file gets before the release is built.
 *
 * The server creates the connections from the bundle, inside the release's own
 * transaction, and holds them to the same rules. These run first anyway so a
 * bad file is named locally — with the file it came from and the command that
 * fixes it — rather than coming back as one bulk `rel.invalid`. Two of them the
 * server cannot run for us: that a `client_secret` references a variable rather
 * than holding a value, which must fail before anything leaves the machine, and
 * that the variables a connection names are the kind the engine needs.
 *
 * A preview is checked the same way, except that its token may not read the
 * project's variables; that check then belongs to the deploy that merges it.
 */
export async function validateConnections(ctx: StepContext): Promise<void> {
  const files = ctx.idpFiles;
  const named = ctx.bundle.idps.map((body, index) => ({
    body,
    file: `${IDPS_DIR}/${files[index] ?? "(unnamed)"}`,
  }));
  // Every file first: a later bad one must not be reported only after the
  // earlier ones passed, because the whole bundle is built or none of it is.
  for (const { body, file } of named) {
    validateConnection(body, file, ctx.suggest);
  }
  if (named.length === 0) {
    return;
  }
  const held = await heldVariables(ctx);
  if (held === undefined) {
    return;
  }
  for (const { body, file } of named) {
    checkCredentialVariables(body, file, held, ctx.suggest, ctx.mode === "preview");
  }
}

/**
 * The connection's shape, and the one mistake that would publish a credential:
 * a `client_secret` held as a value rather than a `${{ NAME }}` reference.
 */
function validateConnection(data: object, file: string, suggest: StepContext["suggest"]): void {
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
          ? `Use "client_secret": "\${{ NAME }}" and publish the value with \`${suggest("variable set NAME --secret")}\`.`
          : undefined,
        details: { issues: result.error.issues },
      },
    );
  }
  // A valid document is then held to the server's endpoint rule: an `oidc`
  // block names no endpoint or every one it needs. The server refuses anything
  // in between, so it is refused here, before a deploy could stop part-way.
  const missing = missingEndpoints((data as { oidc?: unknown }).oidc);
  if (missing.length > 0) {
    throw new ZitadelError(
      "E_VALIDATION",
      `${file}: oidc names some endpoints but not ${missing.join(", ")}`,
      {
        hint:
          "Name every endpoint (authorization_endpoint, jwks_uri, token_endpoint, and " +
          "userinfo_endpoint unless id_token_mapping is true), or none to read them from " +
          "the issuer's discovery document.",
        details: { file, missing },
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

/**
 * The variables the deploy would freeze, by name, and whether each is a secret:
 * the primary kind's for a deploy and the preview kind's for a preview, with no
 * fallback from one to the other (ADR 069). A preview's token may not read them,
 * which leaves the check to the deploy that merges it.
 */
async function heldVariables(ctx: StepContext): Promise<Map<string, boolean> | undefined> {
  const kind = ctx.mode === "preview" ? "preview" : "primary";
  let held: Awaited<ReturnType<StepContext["client"]["getVariables"]>>;
  try {
    held = await ctx.client.getVariables({ project_id: ctx.projectId, kind });
  } catch (error) {
    if (ctx.mode === "preview" && error instanceof ApiError && error.status === 403) {
      return undefined;
    }
    throw error;
  }
  // A secret reads back as `{ secret: true }`, a plain value as the value.
  return new Map(
    Object.entries(valuesOfKind(held, kind)).map(([name, value]) => [
      name,
      typeof value === "object",
    ]),
  );
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
  preview: boolean,
): void {
  // A preview freezes the preview kind alone, so the value it lacks is set for
  // that kind.
  const setCommand = (name: string, secret: boolean) =>
    suggest(`variable set ${name}${secret ? " --secret" : ""}${preview ? " --preview" : ""}`);
  const body = connection as {
    oidc?: { client_id?: unknown; client_secret?: unknown };
  };
  const block = body.oidc;
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
          nextCommands: [setCommand(name, wantsSecret)],
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
          nextCommands: [setCommand(name, wantsSecret)],
          details: { variable: name, field, file, secret: isSecret },
        },
      );
    }
  }
}
