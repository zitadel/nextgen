import { ZitadelError, type ZitadelErrorCode } from "@/lib/errors";
import { isSuggestion, type Suggested, type Suggestion } from "@/lib/suggestion";

/**
 * How a command refuses, written once as text. Every placeholder is written
 * `{name}` and filled from the values the refusal is raised with: a flag, an
 * argument, or whatever the check that raised it hands over.
 */
export type Refusal = Readonly<{
  code?: ZitadelErrorCode;
  message: string;
  hint?: string;
  /**
   * What to run next: a {@link Suggestion} checked against the command it
   * names, or a whole `{name}` placeholder the values fill with one or a list
   * of them. The run that reports the refusal renders each with its own scope.
   */
  next?: readonly (Suggestion | `{${string}}`)[];
  details?: unknown;
}>;

/** What a refusal's placeholders are filled from. */
export type Placeholders = Readonly<Record<string, unknown>>;

/**
 * The names a refusal's wording would leave unfilled, given the values it
 * would be raised with.
 *
 * A refusal with one is a defect in its own wording, not in the run, so the
 * person still gets refused and reads `{min}` where a number belonged. That
 * makes it a defect only a test can catch: a refusal's own test asserts this
 * is empty.
 */
export function unmetBy(refusal: Refusal, values: Placeholders): string[] {
  const placeholders = (refusal.next ?? []).filter((entry) => {
    return typeof entry === "string";
  });
  const unfilled = [refusal.message, refusal.hint ?? "", ...placeholders]
    .flatMap((template) => {
      return [...template.matchAll(PLACEHOLDER)];
    })
    .map((match) => {
      return match[1] as string;
    })
    .filter((name) => {
      return values[name] === undefined;
    });
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
function commandsOf(entry: Suggestion | `{${string}}`, values: Placeholders): Suggested[] {
  if (typeof entry !== "string") {
    return [entry];
  }
  const whole = WHOLE_PLACEHOLDER.exec(entry);
  const value = whole?.[1] === undefined ? undefined : values[whole[1]];
  const given: unknown[] = Array.isArray(value) ? value : value === undefined ? [] : [value];

  return given.filter((one): one is Suggested => {
    return (
      typeof one === "string" ||
      (typeof one === "object" && one !== null && isSuggestion(one as Suggested))
    );
  });
}

/**
 * The error a {@link Refusal} describes, `E_VALIDATION` unless it names a code.
 * Its `next` commands stay suggestions for the run that reports it to render,
 * so a refusal raised while a flag parses, before any run has settled, names
 * the same follow-ups as one raised by the command.
 */
export function refusalError(refusal: Refusal, values: Placeholders): ZitadelError {
  const suggested = refusal.next?.flatMap((entry) => {
    return commandsOf(entry, values);
  });
  return new ZitadelError(refusal.code ?? "E_VALIDATION", interpolate(refusal.message, values), {
    hint: refusal.hint === undefined ? undefined : interpolate(refusal.hint, values),
    nextCommands: suggested,
    details: fill(refusal.details, values),
  });
}
