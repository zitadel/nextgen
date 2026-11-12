import { Config } from "@oclif/core";

import {
  declaredOf,
  renderSuggestion,
  type Scope,
  type Suggest,
  type SuggestWords,
  suggestion,
  suggestionWords,
} from "@/lib/suggestion";

import { cliPackageRoot } from "./oclif-build";

/** The release the commands a test renders are written for, unless it says otherwise. */
export const SUGGEST_CLI_VERSION = "0.1.0";

const config = await Config.load(cliPackageRoot);

/**
 * A {@link Suggest} as a run renders its suggestions, against the commands the
 * CLI really declares: what a command suggests in a test is what it suggests
 * for a person.
 *
 * @param scope - What the run puts back on each command: its directory and environment.
 * @param cliVersion - The release the commands are written for.
 * @returns The renderer.
 */
export function aSuggest(scope: Scope = {}, cliVersion: string = SUGGEST_CLI_VERSION): Suggest {
  return (id, ...rest) => {
    return renderSuggestion(
      suggestion(id, ...rest),
      declaredOf(id, config.findCommand(id)),
      scope,
      cliVersion,
    );
  };
}

/**
 * A {@link SuggestWords} as a run renders its suggestions: the words after the
 * CLI, unquoted, for a result that reports argument lists too.
 *
 * @param scope - What the run puts back on each command: its directory and environment.
 * @returns The renderer.
 */
export function aSuggestWords(scope: Scope = {}): SuggestWords {
  return (id, ...rest) => {
    return suggestionWords(
      id,
      suggestion(id, ...rest).input,
      declaredOf(id, config.findCommand(id)),
      scope,
    );
  };
}

/**
 * A config for a command built in a test: the release it reports is fixed, so
 * what it renders reads the same on every build, and it finds the CLI's real
 * commands, which its suggestions are rendered against.
 *
 * @param version - The release the run reports.
 * @returns The config.
 */
export function aConfigAt(version: string): Config {
  return {
    version,
    findCommand: (id: string) => {
      return config.findCommand(id);
    },
  } as unknown as Config;
}
