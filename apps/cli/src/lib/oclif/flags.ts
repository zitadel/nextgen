import { Args, Flags } from "@oclif/core";
import { type ZodType, z } from "zod";

import { type SuggestedCommand, unscopedCommand } from "@/lib/suggestion";

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

/**
 * How a refusal raised while a flag parses names a follow-up command.
 *
 * It is unscoped, naming the command without the `--env`, `--env-file` or
 * `--server` a scoped suggestion repeats: the environment is resolved from the
 * flags, so there is none to repeat until they have all been read. The
 * command is whatever oclif hands a `parse`, so one invoked outside a run
 * suggests nothing. The suggestion is the bare spelling, which the command's
 * failure handler writes out in full with the `--cwd` the run was given.
 */
export function suggesterOf(command: unknown): ((next: string) => SuggestedCommand) | undefined {
  const version = (command as { config?: { version?: unknown } } | undefined)?.config?.version;
  if (typeof version !== "string") {
    return undefined;
  }
  return (next) => {
    return unscopedCommand(next);
  };
}

function read<T>(refused: Refused<T>, value: string, input: string, command: unknown): T {
  const parsed = refused.schema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }
  throw refusalError(
    refused.refusal,
    {
      ...refused.values,
      value,
      input,
      problem: parsed.error.issues[0]?.message ?? "it is not valid",
    },
    suggesterOf(command),
  );
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
  return async (value: string, command: unknown, definition: { name: string }): Promise<T> => {
    return read(refused, value, `--${definition.name}`, command);
  };
}

/** The `parse` an argument gives `Args.custom`, named as it is. See {@link reads}. */
export function taken<T>(refused: Refused<T>) {
  return async (value: string, command: unknown, definition: { name: string }): Promise<T> => {
    return read(refused, value, definition.name, command);
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
