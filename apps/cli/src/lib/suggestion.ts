import { Cmd } from "./cmd";
import { newestCliCommand, publicCliCommand } from "./public-cli";

declare const suggestedCommand: unique symbol;

/**
 * A command the CLI suggests running next: a `next.commands` entry on a
 * result, a `nextCommands` entry on an error, or the `retry` of an input
 * question. Only the builders below make one, so a suggestion cannot be
 * written without deciding whether it targets this run's project.
 *
 * That decision is the point. A suggestion for a command that talks to a
 * project must carry the run's `--env` / `--env-file` / `--server`, or
 * following it quietly targets the default project instead. A raw
 * string does not typecheck where a suggestion is expected, so forgetting the
 * selector means choosing {@link unscopedCommand} by name, not by accident.
 */
/**
 * The arguments of a suggested publish. A non-interactive `deploy` with no
 * message to fall back on refuses to run without `-m`, so a suggested deploy
 * carries one for the reader to fill in.
 */
export const DEPLOY_ARGS = "deploy -m '<what changed>'";

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
 * (`next_args`). Each argument is quoted as a shell word where it needs it
 * (`Cmd.quote`), so a URL with a port stays as it is and a value with shell
 * metacharacters or a placeholder to fill in (`<what changed>`) is wrapped.
 * The lists carry whatever selector the command needs: they are the arguments
 * as run.
 */
export function portableSuggestions(
  argLists: readonly (readonly string[])[],
  cliVersion: string,
): SuggestedCommand[] {
  return argLists.map((args) => {
    return publicCliCommand(
      args
        .map((word) => {
          return Cmd.quote(word);
        })
        .join(" "),
      cliVersion,
    ) as SuggestedCommand;
  });
}

/** A command that is not the CLI (`npm install …`, `rm …`), suggested as written. */
export function shellCommand(command: string): SuggestedCommand {
  return command as SuggestedCommand;
}

/** `upgrade` on the CLI's dist-tag, so the newest release does the upgrading. */
export function upgradeCommand(cliVersion: string, typedCwd?: string): SuggestedCommand {
  const args = typedCwd === undefined ? "upgrade" : `upgrade ${Cmd.option("--cwd", typedCwd)}`;
  return newestCliCommand(args, cliVersion) as SuggestedCommand;
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
