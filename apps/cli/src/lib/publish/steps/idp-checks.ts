import { isVariableReference, referencedVariable } from "@zitadel/config/idp";

import { ForbiddenError } from "@/lib/backend";
import { ZitadelError } from "@/lib/errors";
import { isObject } from "@/lib/json";
import type { StepContext } from "@/lib/publish/pipeline";

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
  // The bundle's connections sit in the configuration's order, without the
  // editor's `$schema` pointer the contract would refuse.
  const named = ctx.bundle.idps.map((body, index) => ({
    body,
    file: ctx.config.connections[index]?.path ?? "(unnamed)",
  }));
  // A connection's shape is the configuration's rules to judge. What stays
  // here is the guard that a read which resolved a secret is never sent on.
  for (const { body } of named) {
    refuseResolvedSecret(body, "the connection");
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
 * The variables the deploy would freeze, by name, and whether each is a secret:
 * the primary kind's for a deploy and the preview kind's for a preview, with no
 * fallback from one to the other (ADR 069). A preview's token may not read them,
 * which leaves the check to the deploy that merges it.
 */
async function heldVariables(ctx: StepContext): Promise<ReadonlyMap<string, boolean> | undefined> {
  try {
    return await ctx.variables.heldByName(ctx.mode === "preview" ? "preview" : "primary");
  } catch (error) {
    if (ctx.mode === "preview" && error instanceof ForbiddenError) {
      return undefined;
    }
    throw error;
  }
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

/**
 * Stop when a connection hands back a credential value.
 *
 * `client_secret` is always a `${{ NAME }}` reference, so a value here is a
 * reference something resolved. Every path that reaches this has somewhere
 * worse to put it than a log: a release would publish it.
 *
 * @param definition - The connection's body.
 * @param id - How the connection is named in the refusal.
 */
function refuseResolvedSecret(definition: object, id: string): void {
  const block: unknown = Reflect.get(definition, "oidc");
  const stored = isObject(block) ? block.client_secret : undefined;
  if (typeof stored === "string" && !isVariableReference(stored)) {
    throw new ZitadelError("E_VALIDATION", `${id} came back holding a client_secret value`, {
      hint:
        "A stored connection must keep the ${{ NAME }} reference. Report this: the endpoint " +
        "is resolving secrets, and the value would be written to disk.",
      details: { id, block: "oidc" },
    });
  }
}
