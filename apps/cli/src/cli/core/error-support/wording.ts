import type { ZitadelLibError } from "@/lib/errors";

import type { NextPlaceholders, Placeholders, Refusal } from "@/cli/core/refusal";

/** A class of lib error, as a wording names it. */
export type LibErrorClass = abstract new (...args: never[]) => ZitadelLibError;

/** What a wording takes beyond the error's own fields: values worked out from it and the run. */
export type Derived = Readonly<{
  /** Values its message and hint are filled from, over the error's own fields. */
  values?: Placeholders;
  /** What its whole-placeholder `next` entries are filled from. */
  next?: NextPlaceholders;
}>;

/**
 * How one class of lib error is told to a person: the class, the refusal that
 * words it, and, where the words need more than the error's own fields, what
 * works the rest out from the error and the folder the run acts on.
 */
export type Wording = readonly [
  LibErrorClass,
  Refusal,
  ((error: ZitadelLibError, cwd: string) => Derived)?,
];

/**
 * The wording of a class whose words need more than its own fields, such as a
 * path quoted for a shell or a follow-up aimed at the folder that holds a
 * record.
 *
 * @typeParam T - The class's instances.
 * @param Class - The class.
 * @param refusal - The refusal that words it.
 * @param derive - What works out the rest from the error and the folder the run acts on.
 * @returns The wording.
 */
export function derived<T extends ZitadelLibError>(
  Class: abstract new (...args: never[]) => T,
  refusal: Refusal,
  derive: (error: T, cwd: string) => Derived,
): Wording {
  return [
    Class,
    refusal,
    (error, cwd) => {
      if (error instanceof Class) {
        return derive(error, cwd);
      }
      return {};
    },
  ];
}
