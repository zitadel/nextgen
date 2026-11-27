import {
  PublishApplicationSecretMissingError,
  PublishApplicationSecretPlainError,
} from "@/lib/publish/errors";
import type { StepContext } from "@/lib/publish/pipeline";

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
 * @throws {@link PublishApplicationSecretMissingError} When a client names a
 *   variable the project does not hold.
 * @throws {@link PublishApplicationSecretPlainError} When a client names a variable
 *   that is not a secret.
 * @throws {@link BackendForbiddenError} When a deploy's token may not read the
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
    const use = { variable, client, file, preview: ctx.mode === "preview" };
    const isSecret = held.get(variable);
    if (isSecret === undefined) {
      throw new PublishApplicationSecretMissingError(use);
    }
    if (!isSecret) {
      throw new PublishApplicationSecretPlainError(use);
    }
  }
}
