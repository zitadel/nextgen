import type { Alphanumeric, IsNever } from "type-fest";

import { ZitadelError, type ZitadelErrorCode } from "@/lib/errors";
import type { Suggested, Suggestion } from "@/lib/suggestion";

/**
 * How a command refuses, written once as text. Every placeholder is written
 * `{name}` and filled from the values the refusal is raised with: a flag, an
 * argument, or whatever the check that raised it hands over.
 */
// An interface rather than a type alias: a flag's refusal is part of its
// command's type, and an interface member is only resolved when it is read, so
// `next` can name the command table without the table depending on itself.
export interface Refusal {
  readonly code?: ZitadelErrorCode;
  readonly message: string;
  readonly hint?: string;
  /**
   * What to run next: a {@link Suggestion} checked against the command it
   * names, or a whole `{name}` placeholder the refusal's `next` values fill
   * with one or a list of them. The run that reports the refusal renders each
   * with its own scope.
   */
  readonly next?: readonly (Suggestion | `{${string}}`)[];
  readonly details?: unknown;
}

/** What a refusal's placeholders are filled from. */
export type Placeholders = Readonly<Record<string, unknown>>;

/**
 * What a refusal's whole-placeholder `next` entries are filled from: each a
 * follow-up the compiler checked, or a list of them. Kept apart from
 * {@link Placeholders}, which takes any value, so a `next` entry can never be
 * filled with a string written by hand.
 */
export type NextPlaceholders = Readonly<Record<string, Suggested | readonly Suggested[]>>;

/**
 * The names a refusal's wording would leave unfilled, given the values it
 * would be raised with.
 *
 * A refusal with one is a defect in its own wording, not in the run, so the
 * person still gets refused and reads `{min}` where a number belonged. The
 * compiler catches it where the wording is written as a literal
 * ({@link ValuesFor}); a refusal whose wording is only known as `string` is
 * held to this by its own test.
 *
 * @param refusal - The refusal.
 * @param values - What its message and hint are filled from.
 * @param next - What its whole-placeholder `next` entries are filled from.
 * @returns Each name nothing fills, once.
 */
export function unmetBy(
  refusal: Refusal,
  values: Placeholders,
  next: NextPlaceholders = {},
): string[] {
  const namesIn = (templates: readonly string[]) => {
    return templates.flatMap((template) => {
      return [...template.matchAll(PLACEHOLDER)].map((match) => {
        return match[1] as string;
      });
    });
  };
  const placeholders = (refusal.next ?? []).filter((entry) => {
    return typeof entry === "string";
  });
  const unfilled = [
    ...namesIn([refusal.message, refusal.hint ?? ""]).filter((name) => {
      return values[name] === undefined;
    }),
    ...namesIn(placeholders).filter((name) => {
      return next[name] === undefined;
    }),
  ];
  return [...new Set(unfilled)];
}

/**
 * Each placeholder in a refusal's wording, and the name it is filled from: one
 * or more letters, digits, `_` or `-` between braces. {@link NamesIn} reads a
 * literal's names the same way, so the compiler asks for exactly the values
 * {@link interpolate} would fill.
 */
const PLACEHOLDER = /\{([\w-]+)\}/g;

/** A character a placeholder's name may have, as `[\w-]` in {@link PLACEHOLDER} matches one. */
type NameCharacter = Alphanumeric | "_" | "-";

/**
 * Whether `Text` is a placeholder's name: one or more {@link NameCharacter}s.
 * Only literal text can be; text known only as `string` is not.
 *
 * @typeParam Text - What a pair of braces holds.
 */
type IsName<Text extends string> = Text extends `${NameCharacter}${infer Rest}`
  ? Rest extends ""
    ? true
    : IsName<Rest>
  : false;

/**
 * The name of each placeholder in `Text`, read as {@link PLACEHOLDER} reads
 * them: from each `{` on, the text up to the next `}` is a name when it is
 * made only of {@link NameCharacter}s, and the reading goes on either way. So
 * `{{limit}}` asks for `limit`, while `{}`, `{a.b}` and `{json|yaml}` ask for
 * nothing. Text known only as `string` asks for nothing either.
 *
 * @typeParam Text - The wording.
 * @typeParam Found - The names read so far. Carrying them keeps each step in
 *   tail position, so a long message does not run out of recursion depth.
 */
type NamesIn<
  Text extends string,
  Found extends string = never,
> = Text extends `${string}{${infer Rest}`
  ? Rest extends `${infer Name}}${infer After}`
    ? IsName<Name> extends true
      ? NamesIn<After, Found | Name>
      : NamesIn<Rest, Found>
    : Found
  : Found;

/**
 * The placeholder names anywhere in `Value`: in a string, or in each string a
 * list or an object holds, as {@link fill} fills a refusal's details.
 *
 * @typeParam Value - A refusal's message, hint or details.
 */
type NamesInValue<Value> = Value extends string
  ? NamesIn<Value>
  : Value extends readonly (infer Each)[]
    ? NamesInValue<Each>
    : Value extends object
      ? { [Key in keyof Value]: NamesInValue<Value[Key]> }[keyof Value]
      : never;

/**
 * `template` with each `{name}` replaced by the value `values` holds for it.
 *
 * A placeholder with no value is left as it was written. It is a defect in the
 * refusal, but the person is being refused something, and a thrown error here
 * would lose the code that says why and answer with an unexplained failure
 * instead; the wording reads oddly and the refusal still lands.
 */
export function interpolate(template: string, values: Placeholders): string {
  return template.replace(PLACEHOLDER, (placeholder, name: string) => {
    const value = values[name];
    return value === undefined ? placeholder : String(value);
  });
}

/**
 * A string that is one placeholder and nothing else, which takes its value as
 * it is rather than as text. {@link WholeName} reads a literal the same way.
 */
const WHOLE_PLACEHOLDER = /^\{([\w-]+)\}$/;

/**
 * The name `Entry` is filled from when it is one placeholder and nothing else,
 * as {@link WHOLE_PLACEHOLDER} reads one: `{fix}` is filled from `fix`, while
 * `{a} then {b}` is no whole placeholder at all.
 *
 * @typeParam Entry - One of a refusal's `next` entries.
 */
type WholeName<Entry> = Entry extends `{${infer Name}}`
  ? IsName<Name> extends true
    ? Name
    : never
  : never;

function isPlain(value: object): boolean {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * `details` with each string filled in. A string that is only a placeholder
 * takes the value as it is, so a list stays a list in the error's details.
 */
function fill(details: unknown, values: Placeholders): unknown {
  if (typeof details === "string") {
    const whole = WHOLE_PLACEHOLDER.exec(details);
    if (whole?.[1] !== undefined && values[whole[1]] !== undefined) {
      return values[whole[1]];
    }
    return interpolate(details, values);
  }
  if (Array.isArray(details)) {
    return details.map((one) => {
      return fill(one, values);
    });
  }
  // Only a plain object is rebuilt: anything else — a Date, a Map, a class —
  // would come apart into its entries and lose what it held.
  if (typeof details === "object" && details !== null && isPlain(details)) {
    return Object.fromEntries(
      Object.entries(details).map(([key, one]) => {
        return [key, fill(one, values)];
      }),
    );
  }
  return details;
}

/**
 * The commands one `next` entry stands for. An entry that is only a
 * placeholder takes its value as it is, as a refusal's `details` do, so a
 * check that found two steps — remove an origin, then add it back — writes one
 * entry and hands over both, and one that found a single step is unchanged.
 */
function commandsOf(entry: Suggestion | `{${string}}`, next: NextPlaceholders): Suggested[] {
  if (typeof entry !== "string") {
    return [entry];
  }
  const whole = WHOLE_PLACEHOLDER.exec(entry);
  const value = whole?.[1] === undefined ? undefined : next[whole[1]];
  if (value === undefined) {
    return [];
  }

  return isSuggestedList(value) ? [...value] : [value];
}

/** Whether a `next` placeholder's value is a list of follow-ups rather than one. */
function isSuggestedList(value: Suggested | readonly Suggested[]): value is readonly Suggested[] {
  return Array.isArray(value);
}

/** The parts of a refusal whose wording its `values` fill. */
type Worded = "message" | "hint" | "details";

/**
 * The names `R`'s message, hint and details ask `values` for. Each part is
 * read on its own: one known only as `string`, as every part of a refusal
 * typed {@link Refusal} is, asks for nothing, and the others are still read.
 * A refusal chosen by a condition asks for what either one asks for.
 *
 * @typeParam R - The refusal, as its declaration or the call spells it.
 */
export type ValueNames<R> = R extends unknown
  ? { [Part in Worded & keyof R]: NamesInValue<R[Part]> }[Worded & keyof R]
  : never;

/**
 * The names `R`'s whole-placeholder `next` entries ask the `next` values for
 * ({@link WholeName}).
 *
 * @typeParam R - The refusal, as its declaration or the call spells it.
 */
export type NextNames<R> = R extends { readonly next?: readonly (infer Entry)[] }
  ? WholeName<Entry>
  : never;

/**
 * What a refusal's `values` must hold: a value for every name its wording asks
 * for ({@link ValueNames}), and anything else besides. A refusal whose wording
 * is only known as `string` asks for nothing, so its values go unchecked and
 * its own test holds it to {@link unmetBy}.
 *
 * @typeParam R - The refusal, as its declaration or the call spells it.
 */
export type ValuesFor<R> = Placeholders & {
  readonly [Name in ValueNames<R>]: NonNullable<unknown> | null;
};

/**
 * What a refusal's `next` values must hold: a follow-up, or a list of them, for
 * each whole placeholder its `next` entries name ({@link NextNames}).
 *
 * @typeParam R - The refusal, as its declaration or the call spells it.
 */
export type NextFor<R> = NextPlaceholders & {
  readonly [Name in NextNames<R>]: Suggested | readonly Suggested[];
};

/**
 * The error a {@link Refusal} describes, `E_VALIDATION` unless it names a code.
 * `values` fill its wording and `next` its whole-placeholder `next` entries.
 * Its `next` commands stay suggestions for the run that reports it to render,
 * so a refusal raised while a flag parses, before any run has settled, names
 * the same follow-ups as one raised by the command.
 *
 * A refusal written as a literal is checked where it is raised: leaving out a
 * value its wording asks for, or the `next` values its whole placeholders ask
 * for, does not compile.
 *
 * @typeParam R - The refusal, as its declaration or the call spells it.
 * @param refusal - The refusal.
 * @param values - What its message, hint and details are filled from.
 * @param given - What its whole-placeholder `next` entries are filled from:
 *   required when it has one, and optional otherwise.
 * @returns The error, for the caller to throw.
 */
export function refusalError<const R extends Refusal>(
  refusal: R,
  values: ValuesFor<R>,
  ...given: IsNever<NextNames<R>> extends true ? [next?: NextPlaceholders] : [next: NextFor<R>]
): ZitadelError {
  const next: NextPlaceholders = given[0] ?? {};
  const suggested = refusal.next?.flatMap((entry) => {
    return commandsOf(entry, next);
  });
  return new ZitadelError(refusal.code ?? "E_VALIDATION", interpolate(refusal.message, values), {
    hint: refusal.hint === undefined ? undefined : interpolate(refusal.hint, values),
    nextCommands: suggested,
    details: fill(refusal.details, values),
  });
}
