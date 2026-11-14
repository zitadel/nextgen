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
 * What the step reads from what the run starts from: the flags that pick the
 * environment a run reads its issuer from.
 */
type Needs = Readonly<{
  flags: Readonly<{
    server?: string | undefined;
    env?: string | undefined;
    envFile?: string | undefined;
  }>;
}>;

/**
 * What the step is given by the command.
 */
type Deps = Readonly<{
  /**
   * The project's directory.
   */
  cwd: string;

  /**
   * The run's environment variables.
   */
  env: Readonly<NodeJS.ProcessEnv>;
}>;

/**
 * Reads the origin the app serves from, which every callback URI is built on.
 */
export class ReadIssuer extends WizardStep<"issuer", Readonly<{ issuer: string }>, Needs> {
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
  async run(needs: Needs): Promise<Readonly<{ issuer: string }>> {
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
