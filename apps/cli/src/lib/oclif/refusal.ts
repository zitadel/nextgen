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
 * person still gets refused and reads `{min}` where a number belonged. That
 * makes it a defect only a test can catch: a refusal's own test asserts this
 * is empty.
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

const PLACEHOLDER = /\{([\w-]+)\}/g;

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

const WHOLE_PLACEHOLDER = /^\{([\w-]+)\}$/;

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

/**
 * The error a {@link Refusal} describes, `E_VALIDATION` unless it names a code.
 * `values` fill its wording and `next` its whole-placeholder `next` entries.
 * Its `next` commands stay suggestions for the run that reports it to render,
 * so a refusal raised while a flag parses, before any run has settled, names
 * the same follow-ups as one raised by the command.
 */
export function refusalError(
  refusal: Refusal,
  values: Placeholders,
  next: NextPlaceholders = {},
): ZitadelError {
  const suggested = refusal.next?.flatMap((entry) => {
    return commandsOf(entry, next);
  });
  return new ZitadelError(refusal.code ?? "E_VALIDATION", interpolate(refusal.message, values), {
    hint: refusal.hint === undefined ? undefined : interpolate(refusal.hint, values),
    nextCommands: suggested,
    details: fill(refusal.details, values),
  });
}
