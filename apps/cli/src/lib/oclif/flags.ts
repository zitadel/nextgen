import { Args, Flags, type Interfaces } from "@oclif/core";
import { type ZodType, z } from "zod";

import { type FlagRelations, RELATIONS } from "@/lib/suggestion";

import type { Placeholders } from "./refusal";
import { type Refusal, refusalError } from "./refusal";

/**
 * What a flag or argument is refused for, with the schema that decides it.
 * `refusal` is worded once, and its placeholders are `{value}` as the value
 * was typed, `{input}` naming what took it (`--client-id`, or an argument's
 * name), `{problem}`, the first thing the schema found wrong, and anything
 * else `values` holds, such as the bounds the wording quotes.
 */
export type Refused<T> = Readonly<{
  schema: ZodType<T, string>;
  refusal: Refusal;
  values?: Placeholders;
}>;

function read<T>(refused: Refused<T>, value: string, input: string): T {
  const parsed = refused.schema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }
  throw refusalError(refused.refusal, {
    ...refused.values,
    value,
    input,
    problem: parsed.error.issues[0]?.message ?? "it is not valid",
  });
}

/**
 * The `parse` a flag gives `Flags.custom`, so a flag is its schema and the
 * wording of its refusal and nothing else:
 *
 * ```ts
 * const ttlFlag = Flags.custom<Ttl>({ parse: reads(TTL) });
 * ```
 *
 * Refusing during parse rather than in the command puts it at the same point
 * oclif's own refusal lands, so a missing value and an unusable one fail the
 * same way, and the value the command is handed is already the parsed type.
 */
export function reads<T>(refused: Refused<T>) {
  return async (value: string, _command: unknown, definition: { name: string }): Promise<T> => {
    return read(refused, value, `--${definition.name}`);
  };
}

/** The `parse` an argument gives `Args.custom`, named as it is. See {@link reads}. */
export function taken<T>(refused: Refused<T>) {
  return async (value: string, _command: unknown, definition: { name: string }): Promise<T> => {
    return read(refused, value, definition.name);
  };
}

/**
 * A value that is present but holds nothing, trimmed.
 *
 * `required: true` is no help: it asks whether a token arrived in argv, and an
 * empty one satisfies it. The way this happens is the shell, not a typo —
 * `--client-id "$CLIENT_ID"` with the variable unset sends exactly that, the
 * expansion dropping the value while the quotes keep the word, so argv carries
 * `["--client-id", ""]`. Unquoted, the word vanishes and oclif refuses with
 * "expects a value"; quoted, nothing complained and the empty string travelled
 * on as if it were a real answer.
 */
export const filled = z.string().trim().min(1, "it was given an empty value");

/**
 * A whole number the value spells out in digits, which `Number` holds exactly.
 *
 * Digits alone are not enough, and nor is the number alone: `1e3` is not a
 * count a person typed, while enough digits overflow to `Infinity` and past
 * 2^53 round to a neighbour.
 */
export const whole = z
  .string()
  .trim()
  .regex(/^-?\d+$/, "it is not a whole number")
  .transform(Number)
  .pipe(
    z.number().int("it is not a whole number").safe("it is larger than a whole number can hold"),
  );

/** A string flag whose value must not be blank. See {@link filled}. */
export const nonBlankString = Flags.custom<string>({
  parse: reads({
    schema: filled,
    refusal: {
      message: "{input} was given an empty value",
      hint: "Pass a value for {input}, or omit it entirely.",
      details: {
        argument: "{input}",
      },
    },
  }),
});

/** A positional argument whose value must not be blank. See {@link filled}. */
export const nonBlankArg = Args.custom<string>({
  parse: taken({
    schema: filled,
    refusal: {
      message: "{input} was given an empty value",
      hint: "Pass a value for {input}, or omit it entirely.",
      details: {
        argument: "{input}",
      },
    },
  }),
});

/** The server a command is about: `local`, or an http(s) URL, as it was typed. */
export const serverFlag = Flags.custom<string>({
  parse: reads({
    schema: z
      .string()
      .trim()
      .pipe(z.union([z.literal("local"), z.url({ protocol: /^https?$/ })])),
    refusal: {
      message: 'Invalid server "{value}"',
      hint: "Use `local`, or a URL like https://acme.zitadel.cloud.",
    },
  }),
});

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
