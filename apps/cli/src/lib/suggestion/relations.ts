import type { Interfaces } from "@oclif/core";

/**
 * The relations between a command's flags (`exclusive`, `dependsOn`,
 * `required`), declared once where the flags are, so the parser enforces them
 * and the compiler checks every suggestion of the command against them.
 */

/**
 * Where `relatedFlags()` keeps the relations it was declared with. It is a symbol and
 * not enumerable, so oclif, which reads a command's flags by their names, never
 * sees it, while the type of a command's `flags` carries the relations for
 * {@link SuggestInput} to check against.
 */
export const RELATIONS: unique symbol = Symbol("relations");

/**
 * What one flag requires of the others: the `exclusive` flags it must not be
 * given with, the `dependsOn` flags it must be given with, and `required` when
 * it must be given at all. Names are the CLI spelling.
 */
export type FlagRelation<Name extends string> = Readonly<{
  exclusive?: readonly Name[];
  dependsOn?: readonly Name[];
  required?: true;
}>;

/** The relations of a set of flags, each keyed and naming flags of the same set. */
export type FlagRelations<Defs> = {
  readonly [Key in keyof Defs & string]?: FlagRelation<keyof Defs & string>;
};

/** The flags a command declares, carrying the relations {@link relatedFlags} declared them with. */
export type Flagged<Defs, Relations> = Requiring<Defs, Relations> & {
  readonly [RELATIONS]?: Relations;
};

/**
 * `Defs` with each flag its relations declare `required` parsed to a value
 * that is there, as oclif types a flag declared `required: true` inline, so
 * moving the declaration into {@link relatedFlags} costs the command nothing.
 */
export type Requiring<Defs, Relations> = {
  [Key in keyof Defs]: Key extends keyof Relations
    ? Relations[Key] extends { readonly required: true }
      ? Defs[Key] extends Interfaces.OptionFlag<infer Value, infer Options>
        ? Interfaces.OptionFlag<Exclude<Value, undefined>, Options>
        : Defs[Key]
      : Defs[Key]
    : Defs[Key];
};

/**
 * A command's own flags and the relations between them, declared in one place.
 *
 * oclif's `Flags.*` types erase `exclusive`, `dependsOn` and `required`, so a
 * suggested command could not be checked against them. Here they are given
 * once, typed against the flags beside them, and applied to the flags handed
 * to oclif, so the parser and the compiler read the same declaration. A
 * relation written inline on a flag instead is refused by a unit test
 * (`tests/unit/lib/oclif/flags-declared.test.ts`).
 *
 * @param defs - The flags, as `Flags.*` declares them, by CLI spelling.
 * @param relations - What each flag requires of the others, by CLI spelling.
 * @returns The flags with their relations applied, typed with the relations.
 * @throws {Error} When a relation names a flag `defs` does not declare.
 * @example
 * static override flags = relatedFlags(
 *   { fix: Flags.boolean({ … }), force: Flags.boolean({ … }) },
 *   { force: { dependsOn: ["fix"] } },
 * );
 */
export function relatedFlags<
  const Defs extends object,
  const Relations extends FlagRelations<Defs> = Record<never, never>,
>(defs: Defs, relations?: Relations): Flagged<Defs, Relations> {
  // Constrained to `object` rather than oclif's `FlagInput`, whose `any` would
  // be inferred into every `Flags.boolean` here and erase its type.
  const declared = { ...defs } as Record<string, Interfaces.Flag<unknown>>;
  for (const [name, relation] of Object.entries(relations ?? {})) {
    const definition = declared[name];
    if (definition === undefined) {
      throw new Error(`flags(): a relation names --${name}, which is not declared`);
    }
    const { exclusive, dependsOn, required } = relation as {
      exclusive?: readonly string[];
      dependsOn?: readonly string[];
      required?: true;
    };
    declared[name] = {
      ...definition,
      ...(exclusive === undefined ? {} : { exclusive: [...exclusive] }),
      ...(dependsOn === undefined ? {} : { dependsOn: [...dependsOn] }),
      ...(required === undefined ? {} : { required: true }),
    } as Interfaces.Flag<unknown>;
  }
  // Not enumerable, so oclif — which reads the flags by name, and spreads them
  // into the base flags — never sees it.
  Object.defineProperty(declared, RELATIONS, { value: relations ?? {}, enumerable: false });

  return declared as Flagged<Defs, Relations>;
}

/**
 * The relations a command's flags were declared with through {@link relatedFlags},
 * or an empty record for flags declared without it.
 *
 * @param declared - A command's `flags`.
 * @returns The relations, by CLI spelling.
 */
export function relationsOf(declared: object): FlagRelations<Record<string, unknown>> {
  return (declared as { [RELATIONS]?: FlagRelations<Record<string, unknown>> })[RELATIONS] ?? {};
}
