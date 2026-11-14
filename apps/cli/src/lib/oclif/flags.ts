import { Args, Flags } from "@oclif/core";
import type { IsNever } from "type-fest";
import { type ZodType, z } from "zod";

import type { Suggestion } from "@/lib/suggestion";

import type { Placeholders, ValueNames } from "./refusal";
import { type Refusal, refusalError } from "./refusal";

/**
 * A refusal a flag or argument raises as its value parses. Its `next` entries
 * are follow-ups and never a whole `{name}` placeholder: {@link read} has no
 * `next` values to fill one with, so the follow-up would quietly drop out of
 * the error.
 */
export interface ParseRefusal extends Refusal {
  readonly next?: readonly Suggestion[];
}

/**
 * What a flag or argument is refused for, with the schema that decides it.
 * `refusal` is worded once, and its placeholders are `{value}` as the value
 * was typed, `{input}` naming what took it (`--client-id`, or an argument's
 * name), `{problem}`, the first thing the schema found wrong, and anything
 * else `values` holds, such as the bounds the wording quotes.
 *
 * @typeParam T - What the value parses to.
 */
export type Refused<T> = Readonly<{
  schema: ZodType<T, string>;
  refusal: ParseRefusal;
  values?: Placeholders;
}>;

/** The names {@link read} fills in every flag's and argument's refusal. */
type Parsed = "value" | "input" | "problem";

/**
 * The names `Values` is sure to fill: each key it always has, with a value that
 * is never `undefined`. An optional key, one that may hold `undefined`, or an
 * index signature such as {@link Placeholders} fills nothing for certain.
 *
 * @typeParam Values - A declaration's `values`.
 */
type FilledBy<Values> = {
  [Key in keyof Values]-?: string extends Key ? never : undefined extends Values[Key] ? never : Key;
}[keyof Values];

/**
 * The names `R` asks for that neither {@link read} nor the declaration's own
 * `values` is sure to fill ({@link FilledBy}).
 *
 * @typeParam R - The declaration's refusal, as it is written.
 * @typeParam Declared - The declaration, as it is written.
 */
type Unfilled<R, Declared> = Exclude<
  ValueNames<R>,
  Parsed | (Declared extends { readonly values: infer Values } ? FilledBy<Values> : never)
>;

/**
 * What a declaration must hold besides itself for its refusal to read whole:
 * nothing when {@link read} and its own `values` fill every name its wording
 * asks for, and otherwise a value in `values` for each name left
 * ({@link Unfilled}), so leaving one out does not compile.
 *
 * @typeParam R - The declaration's refusal, as it is written.
 * @typeParam Declared - The declaration, as it is written.
 */
type Filled<R, Declared> =
  IsNever<Unfilled<R, Declared>> extends true
    ? unknown
    : {
        readonly values: {
          readonly [Name in Unfilled<R, Declared>]: NonNullable<unknown> | null;
        };
      };

/**
 * What a refusal must hold for {@link read} to fill it alone, with no
 * `values` beside it: nothing when it asks only for the names `read` fills
 * ({@link Parsed}), and otherwise a key naming the rest, so a refusal that
 * asks for more does not compile rather than print its braces.
 *
 * @typeParam R - The refusal, as it is written.
 */
export type ReadAlone<R> =
  IsNever<Unfilled<R, Record<never, never>>> extends true
    ? unknown
    : { readonly "asks for what only values could fill": Unfilled<R, Record<never, never>> };

/**
 * Nothing but the keys a declaration and its refusal may have: any other key,
 * such as a misspelt `hint` or `values`, must be `never`, so it does not
 * compile rather than being dropped without a word. Its `values` may not give
 * one of the names {@link read} fills ({@link Parsed}) either, since the
 * parse would replace it, and must name each value it gives: values typed as
 * a wide {@link Placeholders} could hold one of those names unseen.
 *
 * @typeParam R - The declaration's refusal, as it is written.
 * @typeParam Declared - The declaration, as it is written.
 */
type Known<R, Declared> = {
  readonly [Key in Exclude<keyof Declared, keyof Refused<unknown>>]: never;
} & {
  readonly refusal: { readonly [Key in Exclude<keyof R, keyof ParseRefusal>]: never };
} & (Declared extends { readonly values: infer Values }
    ? string extends keyof Values
      ? { readonly values: "a declaration's values must name each value they give" }
      : IsNever<Extract<keyof Values, Parsed>> extends true
        ? unknown
        : { readonly values: "a declaration's values may not give value, input or problem" }
    : unknown);

/**
 * A declaration as {@link reads} and {@link taken} take it: refused as `T`,
 * with only the keys a declaration has ({@link Known}), and filling everything
 * its refusal asks for ({@link Filled}).
 *
 * `R` and `Declared` stand on their own so the compiler infers each from the
 * declaration as written, an inline object included. The refusal is inferred
 * apart from the rest so that one chosen by a condition keeps the wording of
 * both, which a single inference would widen to `string`.
 *
 * @typeParam T - What the value parses to.
 * @typeParam R - The declaration's refusal, as it is written.
 * @typeParam Declared - The declaration, as it is written.
 */
export type Declaration<T, R, Declared> = Declared &
  Refused<T> & { readonly refusal: R } & Known<R, Declared> &
  Filled<R, Declared>;

/**
 * The `parse` oclif calls with the value a flag or an argument was given.
 *
 * @typeParam T - What the value parses to.
 */
type Parse<T> = (value: string, command: unknown, definition: { name: string }) => Promise<T>;

/**
 * `value` as `refused` parses it, or the refusal it is refused with.
 *
 * @typeParam T - What the value parses to.
 * @param refused - What the flag or argument is refused for.
 * @param value - The value, as it was typed.
 * @param input - What took it, as the refusal names it: `--client-id`, or an
 *   argument's name.
 * @returns The parsed value.
 * @throws {ZitadelError} The declaration's refusal, when the schema refuses
 *   the value.
 */
function read<T>(refused: Refused<T>, value: string, input: string): T {
  const parsed = refused.schema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }
  const filled = {
    value,
    input,
    problem: parsed.error.issues[0]?.message ?? "it is not valid",
  } satisfies Record<Parsed, string>;
  throw refusalError(refused.refusal, { ...refused.values, ...filled });
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
 *
 * @typeParam T - What the value parses to.
 * @typeParam R - The declaration's refusal. Inferred, as the other two are:
 *   naming them by hand can widen the wording and skip its check.
 * @typeParam Declared - The declaration, as it is written.
 * @param refused - What the flag is refused for.
 * @returns The `parse`, which names the value `--<flag>` in the refusal.
 */
export function reads<T, const R extends ParseRefusal, const Declared extends Refused<T>>(
  refused: Declaration<T, R, Declared>,
): Parse<T> {
  return async (value, _command, definition) => {
    return read(refused, value, `--${definition.name}`);
  };
}

/**
 * The `parse` an argument gives `Args.custom`: {@link reads}, with the value
 * named by the argument's own name in the refusal.
 *
 * @typeParam T - What the value parses to.
 * @typeParam R - The declaration's refusal. Inferred, as the other two are:
 *   naming them by hand can widen the wording and skip its check.
 * @typeParam Declared - The declaration, as it is written.
 * @param refused - What the argument is refused for.
 * @returns The `parse`.
 */
export function taken<T, const R extends ParseRefusal, const Declared extends Refused<T>>(
  refused: Declaration<T, R, Declared>,
): Parse<T> {
  return async (value, _command, definition) => {
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

/**
 * What a parser that may refuse a value answers: the value it made, or what is
 * wrong with the text. Structurally the platform's own `Parsed<T>`, so a
 * parser a prompt already uses can be handed to {@link parses} and
 * {@link accepts} as it is.
 *
 * @typeParam T - What the text parses to.
 */
export type Outcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly problem: string };

/**
 * How a blank value is refused when a flag's refusal does not say: what to do
 * about an empty value is to pass one or leave the flag out, which is not what
 * to do about a value the parser would reject, so the two are worded apart.
 */
export const BLANK_VALUE = {
  message: "the value is empty",
  hint: "Pass a value for {input}, or omit it entirely.",
} as const satisfies Refusal;

/**
 * How a value a parser refused is worded when a flag's refusal does not say:
 * the flag, then the parser's own reason.
 */
export const REFUSED_SETTING = {
  message: "{input}: {problem}",
  hint: "Fix {input} and run the command again.",
  details: {
    flag: "{input}",
  },
} as const satisfies Refusal;

/**
 * Passed as {@link ParserOptions.empty}, it refuses a blank value with the
 * flag's own refusal, the reason being that it was given an empty value,
 * instead of with {@link BLANK_VALUE}.
 */
export const AS_REFUSED = "as-refused";

/**
 * What {@link parses} and {@link accepts} may be told besides the parser.
 *
 * @typeParam R - The refusal for a value the parser refuses, as it is written.
 * @typeParam Empty - The refusal for a blank value, as it is written.
 */
export type ParserOptions<R extends ParseRefusal, Empty extends ParseRefusal> = Readonly<{
  /**
   * What a value the parser refuses is refused with, asking only for what
   * {@link read} fills ({@link ReadAlone}). {@link REFUSED_SETTING} when it is
   * left out.
   */
  refusal?: R & ReadAlone<R>;

  /**
   * What a blank value is refused with, asking only for what `read` fills, or
   * {@link AS_REFUSED}. {@link BLANK_VALUE} when it is left out.
   */
  empty?: (Empty & ReadAlone<Empty>) | typeof AS_REFUSED;
}>;

/**
 * The schema of a trimmed, non-blank value a parser accepts.
 *
 * @remarks
 * The parser's `problem` becomes the schema's message, so a flag and the prompt
 * that asks the same thing cannot word a refusal differently.
 *
 * @typeParam T - What the parser makes of the text.
 * @typeParam V - What the schema yields.
 * @param parse - The parser.
 * @param pick - What the schema yields, given the trimmed text and what the
 *   parser made of it.
 * @returns The schema.
 */
function acceptedBy<T, V>(
  parse: (value: string) => Outcome<T>,
  pick: (text: string, made: T) => V,
) {
  return filled.transform((text, ctx) => {
    const outcome = parse(text);
    if (!outcome.ok) {
      ctx.addIssue({
        code: "custom",
        message: outcome.problem,
      });
      return z.NEVER;
    }
    return pick(text, outcome.value);
  });
}

/**
 * The `parse` of a flag that refuses a blank value, then whatever its parser
 * refuses, and yields what `pick` makes of the rest.
 *
 * @typeParam T - What the parser makes of the text.
 * @typeParam V - What the flag yields.
 * @param parse - The parser.
 * @param pick - What the flag yields.
 * @param refusal - What the parser's refusal is worded with, or `undefined`.
 * @param empty - What a blank value is refused with, or `undefined`.
 * @returns The `parse`.
 */
function parsing<T, V>(
  parse: (value: string) => Outcome<T>,
  pick: (text: string, made: T) => V,
  refusal: ParseRefusal | undefined,
  empty: ParseRefusal | typeof AS_REFUSED | undefined,
): Parse<V> {
  const refusing: ParseRefusal = refusal ?? REFUSED_SETTING;
  const declared: Refused<V> = {
    schema: acceptedBy(parse, pick),
    refusal: refusing,
  };
  const value = reads(declared);
  if (empty === AS_REFUSED) {
    return value;
  }
  const emptied: ParseRefusal = empty ?? BLANK_VALUE;
  const blank = reads({
    schema: filled,
    refusal: emptied,
  });
  return async (given, command, definition) => {
    await blank(given, command, definition);
    return value(given, command, definition);
  };
}

/**
 * The `parse` of a flag whose value is what a parser makes of the trimmed text,
 * so the flag is its parser and nothing else:
 *
 * ```ts
 * const clientId = Flags.custom<ClientId>({ parse: parses(parseClientId) });
 * ```
 *
 * @remarks
 * A blank value is refused first, as {@link nonBlankString} refuses one; the
 * parser then refuses what it cannot make. Both read the flag as `{input}`.
 *
 * @typeParam T - What the parser makes of the text.
 * @typeParam R - The parser refusal, as it is written.
 * @typeParam Empty - The blank-value refusal, as it is written.
 * @param parse - The parser, which answers with an {@link Outcome}.
 * @param options - How the two refusals are worded; see {@link ParserOptions}.
 * @returns The `parse`.
 */
export function parses<
  T,
  const R extends ParseRefusal = typeof REFUSED_SETTING,
  const Empty extends ParseRefusal = typeof BLANK_VALUE,
>(parse: (value: string) => Outcome<T>, options?: ParserOptions<R, Empty>): Parse<T> {
  return parsing(
    parse,
    (_text, made) => {
      return made;
    },
    options?.refusal,
    options?.empty,
  );
}

/**
 * The `parse` of a flag whose parser only checks the text: the flag keeps the
 * trimmed text as it was typed, not what the parser made of it. See
 * {@link parses}.
 *
 * @typeParam R - The parser refusal, as it is written.
 * @typeParam Empty - The blank-value refusal, as it is written.
 * @param parse - The parser, which answers with an {@link Outcome}.
 * @param options - How the two refusals are worded; see {@link ParserOptions}.
 * @returns The `parse`.
 */
export function accepts<
  const R extends ParseRefusal = typeof REFUSED_SETTING,
  const Empty extends ParseRefusal = typeof BLANK_VALUE,
>(parse: (value: string) => Outcome<unknown>, options?: ParserOptions<R, Empty>): Parse<string> {
  return parsing(
    parse,
    (text) => {
      return text;
    },
    options?.refusal,
    options?.empty,
  );
}

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
