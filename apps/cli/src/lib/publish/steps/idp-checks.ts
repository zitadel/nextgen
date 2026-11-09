import { ForbiddenError, type VariableService } from "@/lib/backend";
import { ZitadelError } from "@/lib/errors";
import type { PipelineMode, StepContext } from "@/lib/publish/pipeline";
import type { Connection } from "@/lib/zitadel";

/**
 * The kind of variable each publish freezes, with no fallback from one to the
 * other (ADR 069).
 */
const VARIABLE_KIND = {
  deploy: "primary",
  preview: "preview",
} as const satisfies Record<PipelineMode, Parameters<VariableService["heldByName"]>[0]>;

/**
 * The checks a connection gets against the project before the release is built.
 *
 * @remarks
 * The server creates the connections from the bundle, inside the release's own
 * transaction, and holds them to the same rules. Every rule about the file
 * itself, a `client_secret` held as a value included, is the configuration's,
 * and the validate step refuses on it before this runs, so nothing here leaves
 * the machine first. What stays here is what the server cannot check for us:
 * that the variables a connection names are the kind the engine needs, named
 * locally with the file and the command that fixes it rather than coming back
 * as one bulk `rel.invalid`.
 *
 * A preview is checked the same way, except that its token may not read the
 * project's variables; that check then belongs to the deploy that merges it.
 *
 * @param ctx - The step's context: the connections, the variables and the
 *   commands a refusal suggests.
 * @returns Nothing when every connection's variables are held as it needs.
 * @throws {@link ZitadelError} `E_VALIDATION` When a connection's client id and
 *   secret name one variable, or a variable is not the kind its field needs.
 * @throws {@link ZitadelError} `E_CREDENTIAL_MISSING` When a connection names a
 *   variable the project does not hold.
 * @throws {@link ForbiddenError} When a deploy's token may not read the
 *   variables.
 */
export async function validateConnections(ctx: StepContext): Promise<void> {
  const connections = ctx.config.connections.all;
  if (connections.length === 0) {
    return;
  }
  const held = await heldVariables(ctx);
  if (held === undefined) {
    return;
  }
  for (const connection of connections) {
    checkCredentialVariables(ctx, connection, held);
  }
}

/**
 * The variables the deploy would freeze, by name, and whether each is a secret.
 *
 * @remarks
 * The primary kind's for a deploy and the preview kind's for a preview, with
 * no fallback from one to the other (ADR 069). A preview's token may not read
 * them, which leaves the check to the deploy that merges it.
 *
 * @param ctx - The step's context.
 * @returns Each variable's name and whether it is a secret, or `undefined`
 *   when a preview's token may not read them.
 * @throws {@link ForbiddenError} When a deploy's token may not read them.
 */
async function heldVariables(ctx: StepContext): Promise<ReadonlyMap<string, boolean> | undefined> {
  try {
    return await ctx.variables.heldByName(VARIABLE_KIND[ctx.mode]);
  } catch (error) {
    if (ctx.mode === "preview" && error instanceof ForbiddenError) {
      return undefined;
    }
    throw error;
  }
}

/**
 * The `variable set` arguments that publish a variable as its field needs it.
 *
 * @remarks
 * A preview freezes the preview kind alone, so the value it lacks is set for
 * that kind.
 *
 * @param variable - The variable.
 * @param secret - Whether the field needs a secret variable.
 * @param mode - The publish the variable is for.
 * @returns The arguments.
 */
function variableSetArgs(variable: string, secret: boolean, mode: PipelineMode): string {
  const kindFlags = secret ? ["--secret"] : [];
  const modeFlags = mode === "preview" ? ["--preview"] : [];
  return ["variable", "set", variable, ...kindFlags, ...modeFlags].join(" ");
}

/**
 * Refuse a connection whose variables are not what the engine needs: they
 * exist, the client id is a plain one it can put in the authorize URL, the
 * client secret is a secret one, and they are not one and the same.
 *
 * @param ctx - The step's context, for the commands a refusal suggests.
 * @param connection - The connection.
 * @param held - The project's variables, and whether each is a secret.
 * @throws {@link ZitadelError} `E_VALIDATION` When the client id and secret
 *   name one variable, or a variable is not the kind its field needs.
 * @throws {@link ZitadelError} `E_CREDENTIAL_MISSING` When a named variable is
 *   not held.
 */
function checkCredentialVariables(
  ctx: StepContext,
  connection: Connection,
  held: ReadonlyMap<string, boolean>,
): void {
  const file = connection.path;
  const credentials = connection.credentials;
  if (credentials === undefined) {
    return;
  }
  const uses = [credentials.clientId, credentials.clientSecret].flatMap((credential) => {
    if (credential.kind === "literal") {
      return [];
    }
    return [credential];
  });
  const id = uses.find((use) => {
    return use.field === "client_id";
  });
  const secret = uses.find((use) => {
    return use.field === "client_secret";
  });
  // The two are branded apart, so they are compared as the names they both are.
  const idVariable: string | undefined = id?.variable;
  const secretVariable: string | undefined = secret?.variable;
  if (idVariable !== undefined && idVariable === secretVariable) {
    throw new ZitadelError(
      "E_VALIDATION",
      `${file}: client_id and client_secret both name the variable ${idVariable}`,
      {
        hint: "Give each its own variable: a plain one for the client id, a secret one for the client secret.",
        details: { variable: idVariable, file },
      },
    );
  }
  for (const use of uses) {
    const field = use.field;
    const variable = use.variable;
    const wantsSecret = field === "client_secret";
    const setCommand = ctx.suggest(variableSetArgs(variable, wantsSecret, ctx.mode));
    const isSecret = held.get(variable);
    if (isSecret === undefined) {
      throw new ZitadelError(
        "E_CREDENTIAL_MISSING",
        `${file}: ${field} names the variable ${variable}, which the project does not have`,
        {
          hint: "Publish it with the command below, then deploy again.",
          nextCommands: [setCommand],
          details: { variable, field, file },
        },
      );
    }
    if (isSecret !== wantsSecret) {
      const kind = isSecret ? "a secret" : "not a secret";
      const hint = wantsSecret
        ? "The client secret must be a secret variable: publish it with the command below."
        : "The client id must be a plain variable the engine can read back: publish it with the command below, without --secret.";
      throw new ZitadelError(
        "E_VALIDATION",
        `${file}: ${field} names the variable ${variable}, which is ${kind}`,
        {
          hint,
          nextCommands: [setCommand],
          details: { variable, field, file, secret: isSecret },
        },
      );
    }
  }
}
