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
