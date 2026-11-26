import type { ZitadelLibError } from "@/lib/errors";

import type { NextPlaceholders, Placeholders, Refusal } from "@/cli/core/refusal";

/** A class of lib error, as a wording names it. */
export type LibErrorClass = abstract new (...args: never[]) => ZitadelLibError;

/**
 * What the CLI says of a class of lib error beyond what the error says of
 * itself: a hint that names a command or a flag, and the commands to run next.
 * The message, a hint about the world and the facts are the error's own.
 */
export type Advice = Readonly<{
  /** The hint, in place of the error's own, `{name}` filled from its fields. */
  hint?: string;
  /** What to run next, as a refusal's `next`. */
  next?: Refusal["next"];
  /** The details, in place of the error's own facts, as a refusal's `details`. */
  details?: unknown;
}>;

/** What a wording takes beyond the error's own fields: values worked out from it and the run. */
export type Derived = Readonly<{
  /** Values its hint and details are filled from, over the error's own fields. */
  values?: Placeholders;
  /** What its whole-placeholder `next` entries are filled from. */
  next?: NextPlaceholders;
}>;

/**
 * The advice for one class of lib error: the class, the advice, and, where
 * the words need more than the error's own fields, what works the rest out
 * from the error and the folder the run acts on.
 */
export type Wording = readonly [
  LibErrorClass,
  Advice,
  ((error: ZitadelLibError, cwd: string) => Derived)?,
];

/**
 * The wording of a class whose advice needs more than its own fields, such as
 * a path quoted for a shell or a follow-up aimed at the folder that holds a
 * record.
 *
 * @typeParam T - The class's instances.
 * @param Class - The class.
 * @param advice - The advice.
 * @param derive - What works out the rest from the error and the folder the run acts on.
 * @returns The wording.
 */
export function derived<T extends ZitadelLibError>(
  Class: abstract new (...args: never[]) => T,
  advice: Advice,
  derive: (error: T, cwd: string) => Derived,
): Wording {
  return [
    Class,
    advice,
    (error, cwd) => {
      if (error instanceof Class) {
        return derive(error, cwd);
      }
      return {};
    },
  ];
}
