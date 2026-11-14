import type { EnableServices, Fact } from "@/cli/commands/auth-method/sso/enable/shared";
import { resolveEnvironment } from "@/lib/environment";
import { type Refusal, refusalError } from "@/lib/oclif/refusal";
import { WizardStep } from "@/lib/wizard";

/**
 * What a Project with no development issuer is refused for.
 */
const NO_ISSUER_REFUSAL = {
  message: "This project has no development issuer",
  hint: "Set the project up first, or set ZITADEL_ISSUER to the origin your app serves from.",
  next: [{ id: "setup" }],
} as const satisfies Refusal;

/**
 * What the step reads from what is known: the flags that pick the environment a
 * run reads its issuer from.
 */
type Needs = Readonly<{
  flags: Partial<Pick<Fact<"flags">["flags"], "server" | "env" | "envFile">>;
}>;

/**
 * What the step is given by the command.
 */
type Deps = Pick<EnableServices, "cwd" | "env">;

/**
 * Reads the origin the app serves from, which every callback URI is built on.
 */
export class ReadIssuer extends WizardStep<"issuer", Fact<"issuer">, Needs> {
  /**
   * The step's name, which a wizard refuses to hold twice.
   */
  readonly key = "issuer";

  /**
   * What the command gives the step.
   */
  private readonly deps: Deps;

  /**
   * @param deps - What the command gives the step.
   */
  constructor(deps: Deps) {
    super();
    this.deps = deps;
  }

  /**
   * Read the issuer from the run's environment.
   *
   * @param needs - The flags that pick the environment.
   * @returns The issuer.
   * @throws {@link ZitadelError} When the Project has none, so it has not been set up.
   */
  async run(needs: Needs): Promise<Fact<"issuer">> {
    const environment = await resolveEnvironment({
      cwd: this.deps.cwd,
      env: this.deps.env,
      serverFlag: needs.flags.server,
      envName: needs.flags.env,
      envFile: needs.flags.envFile,
    });
    const issuer = environment.values.ZITADEL_ISSUER?.value;
    if (issuer === undefined) {
      throw refusalError(NO_ISSUER_REFUSAL, {});
    }
    return {
      issuer,
    };
  }
}
