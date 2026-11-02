/**
 * A small, generic battery of checks.
 *
 * Nothing here knows about the CLI, the network or any one domain: a suite
 * (see `./idp`) supplies a context type and its checks, and {@link runChecks}
 * runs them in order. Everything a check touches outside itself arrives through
 * its context, so a unit test hands it a fake and asserts on the outcome.
 */

/**
 * How a check ended. `skipped` is not a pass: it says the check could not tell,
 * and a battery must never read as healthy because a check had nothing to say.
 */
export type Status = "pass" | "warn" | "fail" | "skipped";

export type Outcome = {
  readonly status: Status;
  readonly message: string;
  /** The one thing to do about a `warn` or `fail`. */
  readonly recovery?: string;
};

export type CheckResult = Outcome & {
  readonly name: string;
  readonly title: string;
};

export abstract class Check<Context> {
  /** Stable identifier, named by `dependsOn` and shown in the output. */
  abstract readonly name: string;
  abstract readonly title: string;
  /** Names of checks that must not have failed or been skipped for this one to run. */
  readonly dependsOn: readonly string[] = [];

  abstract run(context: Context): Promise<Outcome>;
}

/** One check's result, given the results of the checks that ran before it. */
async function resultOf<Context>(
  check: Check<Context>,
  context: Context,
  earlier: readonly CheckResult[],
): Promise<CheckResult> {
  const blocker = check.dependsOn.find((name) => {
    const status = earlier.find((result) => result.name === name)?.status;
    return status !== "pass" && status !== "warn";
  });
  const outcome: Outcome =
    blocker === undefined
      ? await (async () => check.run(context))().catch(
          (error: unknown): Outcome => ({
            status: "fail",
            message: error instanceof Error ? error.message : String(error),
          }),
        )
      : {
          status: "skipped",
          message: `Needs "${earlier.find((result) => result.name === blocker)?.title ?? blocker}" first`,
        };
  return { name: check.name, title: check.title, ...outcome };
}

/**
 * Run `checks` in order against `context`. A check whose dependency failed or
 * was skipped is skipped; a check that throws fails with the error's message.
 * `onResult` is called as each check finishes, so a caller can show progress
 * instead of waiting for the whole battery.
 */
export function runChecks<Context>(
  checks: readonly Check<Context>[],
  context: Context,
  onResult?: (result: CheckResult) => void,
): Promise<readonly CheckResult[]> {
  return checks.reduce<Promise<readonly CheckResult[]>>(async (done, check) => {
    const earlier = await done;
    const result = await resultOf(check, context, earlier);
    onResult?.(result);
    return [...earlier, result];
  }, Promise.resolve([]));
}
