import { ZitadelError, type ZitadelErrorCode } from "../errors";
import type { SuggestedCommand } from "../suggestion";

/**
 * How a command refuses, written once as text. Every placeholder is written
 * `{name}` and filled from the values the refusal is raised with: a flag, an
 * argument, or whatever the check that raised it hands over. A refusal with
 * a placeholder that has no value is a defect in the command, so it throws.
 */
export type Refusal = Readonly<{
  code?: ZitadelErrorCode;
  message: string;
  hint?: string;
  next?: readonly string[];
  details?: unknown;
}>;

/** What a refusal's placeholders are filled from. */
export type Placeholders = Readonly<Record<string, unknown>>;

const PLACEHOLDER = /\{([\w-]+)\}/g;

/** `template` with each `{name}` replaced by the value `values` holds for it. */
export function interpolate(template: string, values: Placeholders): string {
  return template.replace(PLACEHOLDER, (_placeholder, name: string) => {
    const value = values[name];
    if (value === undefined) {
      throw new Error(`The placeholder {${name}} in "${template}" has no value`);
    }
    return String(value);
  });
}

/**
 * The error a {@link Refusal} describes, `E_VALIDATION` unless it names a code.
 * `suggest` turns each of its `next` commands into the suggestion the run's own
 * builders make, so a refusal names a command and never spells one out; a
 * refusal raised where no run exists, such as while a flag parses, has none.
 */
export function refusalError(
  refusal: Refusal,
  values: Placeholders,
  suggest?: (command: string) => SuggestedCommand,
): ZitadelError {
  if (refusal.next !== undefined && suggest === undefined) {
    throw new Error(
      `The refusal "${refusal.message}" names next commands but nothing to suggest them with`,
    );
  }
  return new ZitadelError(refusal.code ?? "E_VALIDATION", interpolate(refusal.message, values), {
    hint: refusal.hint === undefined ? undefined : interpolate(refusal.hint, values),
    nextCommands: refusal.next?.map(
      (command) => suggest?.(interpolate(command, values)) as SuggestedCommand,
    ),
    details: refusal.details,
  });
}
