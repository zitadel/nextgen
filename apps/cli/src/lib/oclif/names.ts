/**
 * A flag is spelled as the command line takes it and read as code reads it:
 * `--client-id` is declared `"client-id"`, so the help, the CLI reference and
 * every suggested retry keep that spelling, while a command reads
 * `flags.clientId`. The same holds for an argument named `release_id`.
 */

/** `client-id` and `release_id` as `clientId` and `releaseId`. */
export type Named<Name extends string> = Name extends `${infer Head}-${infer Tail}`
  ? `${Head}${Capitalize<Named<Tail>>}`
  : Name extends `${infer Head}_${infer Tail}`
    ? `${Head}${Capitalize<Named<Tail>>}`
    : Name;

/** Every key of `Values` as {@link Named} spells it. */
export type ByName<Values> = {
  readonly [Key in keyof Values as Key extends string ? Named<Key> : Key]: Values[Key];
};

/** One name as {@link Named} spells it. */
export function named(name: string): string {
  return name.replace(/[-_](.)/g, (_separator, letter: string) => {
    return letter.toUpperCase();
  });
}

/** `values` keyed as {@link Named} spells each of its names. */
export function byName<Values extends object>(values: Values): ByName<Values> {
  const read: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(values)) {
    const key = named(name);
    // Two names that read the same would leave one of them unreadable, and a
    // flag nothing can read is a flag that silently does nothing.
    if (Object.hasOwn(read, key)) {
      throw new Error(`Two names are both read as ${key}; one of them must be renamed`);
    }
    read[key] = value;
  }
  return read as ByName<Values>;
}
