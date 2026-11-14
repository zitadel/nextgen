import { resolveEnvironment } from "@/lib/environment";
import { type Refusal, refusalError } from "@/lib/oclif/refusal";
import { WizardStep } from "@/lib/wizard";

import type { EnableInput, EnableServices } from "@/cli/commands/auth-method/sso/enable/shared";

/**
 * What a Project with no development issuer is refused for.
 */
const NO_ISSUER_REFUSAL = {
  message: "This project has no development issuer",
  hint: "Set the project up first, or set ZITADEL_ISSUER to the origin your app serves from.",
  next: [{ id: "setup" }],
} as const satisfies Refusal;

/**
 * The flags that pick the environment a run reads its issuer from.
 */
type EnvironmentFlags = {
  readonly server?: string | undefined;
  readonly env?: string | undefined;
  readonly envFile?: string | undefined;
};

/**
 * The origin the app serves from, as the run's environment names it.
 *
 * @param cwd - The project root.
 * @param flags - The flags that pick the environment.
 * @param env - The process environment.
 * @returns The issuer.
 * @throws {@link ZitadelError} When the Project has none, so it has not been set up.
 */
export async function developmentIssuer(
  cwd: string,
  flags: EnvironmentFlags,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const environment = await resolveEnvironment({
    cwd,
    env,
    serverFlag: flags.server,
    envName: flags.env,
    envFile: flags.envFile,
  });
  const issuer = environment.values.ZITADEL_ISSUER?.value;
  if (issuer === undefined) {
    throw refusalError(NO_ISSUER_REFUSAL, {});
  }
  return issuer;
}

/**
 * Reads the origin the app serves from, which every callback URI is built on.
 */
export class ReadIssuer extends WizardStep<
  "issuer",
  Readonly<{ issuer: string }>,
  EnableInput,
  EnableServices
> {
  readonly key = "issuer";

  /**
   * Read the issuer from the run's environment.
   *
   * @param needs - What the run starts from.
   * @param services - What the command provides.
   * @returns The issuer.
   */
  async run(needs: EnableInput, services: EnableServices): Promise<Readonly<{ issuer: string }>> {
    return {
      issuer: await developmentIssuer(services.cwd, needs.flags, services.env),
    };
  }
}
