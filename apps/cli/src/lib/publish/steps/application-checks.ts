import { ZitadelError } from "@/lib/errors";
import type { StepContext } from "@/lib/publish/pipeline";
import type { Suggestion } from "@/lib/suggestion";

import { heldVariables } from "./held-variables";

/**
 * The checks a declared application gets against the project before the
 * release is built.
 *
 * @remarks
 * The server refuses the deployment while a variable a client names as its
 * secret has no value or holds a plain one (`dep.variables_missing`,
 * `dep.variables_not_secret`), but only once the release is built. Checked
 * here, the refusal names the file, the client and the command that fixes it
 * before anything is sent. Every rule about the files themselves is the
 * configuration's, which the validate step refuses on first.
 *
 * A preview is checked the same way, except that its token may not read the
 * project's variables; that check then belongs to the deploy that merges it.
 *
 * @param ctx - The step's context: the applications and the variables.
 * @returns Nothing when every client's secret variable is a secret the project holds.
 * @throws {@link ZitadelError} `E_CREDENTIAL_MISSING` When a client names a
 *   variable the project does not hold.
 * @throws {@link ZitadelError} `E_VALIDATION` When a client names a variable
 *   that is not a secret.
 * @throws `ForbiddenError` When a deploy's token may not read the
 *   variables.
 */
export async function validateApplications(ctx: StepContext): Promise<void> {
  const secrets = ctx.config.applications.all.flatMap((application) => {
    return application.secretVariables.map((secret) => {
      return { file: application.path, ...secret };
    });
  });
  if (secrets.length === 0) {
    return;
  }
  const held = await heldVariables(ctx);
  if (held === undefined) {
    return;
  }
  for (const { file, client, variable } of secrets) {
    const setCommand: Suggestion = {
      id: "variable:set",
      args: { name: variable },
      flags: { secret: true, preview: ctx.mode === "preview" },
    };
    const isSecret = held.get(variable);
    if (isSecret === undefined) {
      throw new ZitadelError(
        "E_CREDENTIAL_MISSING",
        `${file}: client "${client}" names the variable ${variable} as its secret, which the project does not have`,
        {
          hint: "Publish it as a secret with the command below, then deploy again.",
          nextCommands: [setCommand],
          details: { variable, client, file },
        },
      );
    }
    if (!isSecret) {
      throw new ZitadelError(
        "E_VALIDATION",
        `${file}: client "${client}" names the variable ${variable} as its secret, which is not a secret`,
        {
          hint: "A client secret must be a secret variable: publish it with the command below.",
          nextCommands: [setCommand],
          details: { variable, client, file, secret: false },
        },
      );
    }
  }
}
