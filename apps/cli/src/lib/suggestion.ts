import { portableCommands, publicCliCommand } from "./public-cli";

declare const suggestedCommand: unique symbol;

/**
 * A command the CLI suggests running next: a `nextCommands` entry on a result
 * or an error, a `next_commands` row in a command's data, or the `retry` of an
 * input question. Only the builders below make one, so a suggestion cannot be
 * written without deciding whether it targets this run's project.
 *
 * That decision is the point. A suggestion for a command that talks to a
 * project must carry the run's `--env` / `--env-file` / `--server`, or
 * following it quietly targets the default project instead (#1689). A raw
 * string does not typecheck where a suggestion is expected, so forgetting the
 * selector means choosing {@link unscopedCommand} by name, not by accident.
 */
export type SuggestedCommand = string & { readonly [suggestedCommand]: true };

declare const environmentSelector: unique symbol;

/**
 * The flags that reproduce a run's environment selection, as a suffix
 * (` --env production`), or `""` when the run named none. Only
 * `environmentSelectorSuffix` makes one, so a project command can only be
 * built from a selector the run actually resolved.
 */
export type EnvironmentSelector = string & { readonly [environmentSelector]: true };

/** Brands a suffix built by `environmentSelectorSuffix`; nothing else calls it. */
export function asEnvironmentSelector(suffix: string): EnvironmentSelector {
  return suffix as EnvironmentSelector;
}

/**
 * A `zitadel` command aimed at the same project as the run that suggests it.
 * The selector is appended to `args`, so `args` must not end with a shell
 * redirection; put that after the result instead.
 */
export function projectCommand(
  args: string,
  selector: EnvironmentSelector,
  cliVersion: string,
): SuggestedCommand {
  return publicCliCommand(`${args}${selector}`, cliVersion) as SuggestedCommand;
}

/**
 * A `zitadel` command that does not target a project: `setup`, `start`,
 * `doctor`, the local runtime. Without `cliVersion` it is the bare `zitadel …`
 * spelling, which the envelope rewrites to the public `npx` form on the way
 * out; pass it when the command is also quoted in a hint.
 */
export function unscopedCommand(args: string, cliVersion?: string): SuggestedCommand {
  return (
    cliVersion === undefined ? `zitadel ${args}` : publicCliCommand(args, cliVersion)
  ) as SuggestedCommand;
}

/**
 * Commands built from argument lists, for a caller that also reports the lists
 * (`next_args`). Every argument must be a portable shell word, or none is
 * returned and the lists stand alone, which no shell interprets. The lists
 * carry whatever selector the command needs: they are the arguments as run.
 */
export function portableSuggestions(
  argLists: readonly string[][],
  cliVersion: string,
): SuggestedCommand[] {
  return portableCommands(argLists, cliVersion) as SuggestedCommand[];
}

/** A command that is not the CLI (`npm install …`, `rm …`), suggested as written. */
export function shellCommand(command: string): SuggestedCommand {
  return command as SuggestedCommand;
}

/**
 * A suggestion wrapped in shell around it: a pipe that feeds it a secret
 * (`printf '%s' "$SECRET" | `) or the `< value.txt` redirection that must
 * follow the selector. The command itself stays the one a builder made.
 */
export function inShell(
  command: SuggestedCommand,
  shell: { before?: string; after?: string },
): SuggestedCommand {
  return `${shell.before ?? ""}${command}${shell.after ?? ""}` as SuggestedCommand;
}
