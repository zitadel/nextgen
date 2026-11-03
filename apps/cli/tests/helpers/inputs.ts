/**
 * Drives one value through what a command declares, so a test exercises the
 * flag or argument itself rather than a validator exported beside it. A flag
 * or argument file exports only its definition; the rule it holds, and the
 * wording it refuses with, are reached from here.
 */

/** A flag or argument as a command declares it, built and ready to parse. */
type Declared<T> = {
  readonly parse?: (input: string, context: never, declared: never) => Promise<T>;
};

async function parsed<T>(declared: Declared<T>, value: string, name: string): Promise<T> {
  if (declared.parse === undefined) {
    throw new Error(`${name} declares no parse to drive`);
  }
  return declared.parse(
    value,
    {} as never,
    {
      name,
    } as never,
  );
}

/**
 * The value a flag holds, or the refusal it raises. `name` is the flag as the
 * command line spells it, without `--`, which some refusals name.
 */
export async function parseFlag<T>(flag: Declared<T>, value: string, name = "flag"): Promise<T> {
  return parsed(flag, value, name);
}

/**
 * The value an argument holds, or the refusal it raises. `name` is the
 * argument as the help names it, which some refusals name.
 */
export async function parseArg<T>(arg: Declared<T>, value: string, name = "name"): Promise<T> {
  return parsed(arg, value, name);
}
