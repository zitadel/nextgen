import type { Placeholders, Refusal } from "./refusal";

/**
 * What a rule reads: the parsed flags and arguments. `json` is among the
 * flags, and is set whenever this run answers in the JSON envelope.
 */
export type RuleView = Readonly<{
  flags: Readonly<Record<string, unknown>>;
  args: Readonly<Record<string, unknown>>;
}>;

/**
 * A rule between the flags and arguments of one command, checked straight
 * after they parse and before the command does anything. `refusal` is what
 * the person reads when the rule is broken; its placeholders are filled from
 * the flags and arguments by name, and from the values `broken` answers with
 * when it has worked something out, such as why a value does not parse.
 */
export type Rule = Readonly<{
  refusal: Refusal;
  broken: (view: RuleView) => boolean | Placeholders;
}>;

/** What the flags and arguments of `view` offer a refusal's placeholders. */
export function placeholdersOf(view: RuleView): Placeholders {
  return { ...view.args, ...view.flags };
}

function given(view: RuleView, name: string): boolean {
  const value = view.flags[name] ?? view.args[name];
  return value !== undefined && value !== false;
}

/** The flag or argument `name` is given when it holds `value`. */
function holds(view: RuleView, name: string, value: unknown): boolean {
  return (view.flags[name] ?? view.args[name]) === value;
}

/** Two flags that cannot be given together. */
export function excludes(first: string, second: string, refusal: Refusal): Rule {
  return {
    refusal,
    broken: (view) => given(view, first) && given(view, second),
  };
}

/**
 * A flag that is only meaningful beside another. `needs` is the flag it needs,
 * or a record of the flags it needs and the value each must hold.
 */
export function needs(
  flag: string,
  needs: string | Readonly<Record<string, unknown>>,
  refusal: Refusal,
): Rule {
  return {
    refusal,
    broken: (view) => {
      if (!given(view, flag)) {
        return false;
      }
      if (typeof needs === "string") {
        return !given(view, needs);
      }
      return Object.entries(needs).some(([name, value]) => !holds(view, name, value));
    },
  };
}

/** A set of flags of which at least one must be given. */
export function atLeastOne(flags: readonly string[], refusal: Refusal): Rule {
  return {
    refusal,
    broken: (view) => !flags.some((flag) => given(view, flag)),
  };
}

/** Any other rule, as a predicate that is true when the rule is broken. */
export function refuses(broken: (view: RuleView) => boolean, refusal: Refusal): Rule {
  return {
    refusal,
    broken,
  };
}
