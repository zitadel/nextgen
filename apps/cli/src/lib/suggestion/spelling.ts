import { CliPackage } from "@/lib/upgrade/cli-package";

/**
 * The CLI as a person runs it from outside this checkout: `npx @zitadel/cli@<version> …`.
 *
 * A scaffolded app does not depend on the CLI, so the bare `zitadel` command does not exist on
 * its PATH (and `npx zitadel` would fetch an unrelated package). Everything the CLI writes for a
 * person to copy goes through here, so no caller has to know how the CLI is published or how its
 * version maps to an npm selector.
 *
 * Reach a version's spellings with {@link Spelling.at}: `Spelling.at(version).command("deploy")`.
 */
export class Spelling {
  /**
   * The name of the binary the package installs, which is how a person runs an installed CLI and
   * how a `hint:` quotes one: `zitadel deploy`.
   */
  static readonly BINARY = "zitadel";

  /** The CLI version being spelled. */
  private readonly cli: CliPackage;

  /**
   * @param cliVersion - The running CLI's version.
   */
  private constructor(cliVersion: string) {
    this.cli = CliPackage.at(cliVersion);
  }

  /**
   * The spellings of one CLI version.
   *
   * @param cliVersion - The running CLI's version, e.g. `1.0.0-alpha.25` or `v0.1.0`.
   * @returns The version's spellings.
   */
  static at(cliVersion: string): Spelling {
    return new Spelling(cliVersion);
  }

  /**
   * The command a person runs to use this CLI version, pinned to it.
   *
   * @param args - The arguments after the binary, e.g. `setup --server local`; may be empty.
   * @returns `npx @zitadel/cli@<selector> <args>`.
   */
  command(args: string): string {
    const prefix = `npx ${CliPackage.NAME}@${this.cli.selector()}`;
    return args.length > 0 ? `${prefix} ${args}` : prefix;
  }

  /**
   * Where the list of every command is: the CLI run with no subcommand. Setup, status and every
   * command's help end with it, after their own next steps, so the overview can be found without
   * already knowing it exists. The command is on a line of its own, with nothing around it, so it
   * can be copied as written.
   *
   * @returns The pointer.
   */
  exploreAllCommands(): string {
    return ["Explore all commands:", `  ${this.command("")}`].join("\n");
  }

  /**
   * The command on this CLI's dist-tag rather than its exact version, for what has to run the
   * newest release: `upgrade` run by the old version would not know what the new one writes.
   *
   * @param args - The arguments after the binary.
   * @returns `npx @zitadel/cli@<dist-tag> <args>`.
   */
  newestCommand(args: string): string {
    return `npx ${CliPackage.NAME}@${this.cli.distTag()} ${args}`;
  }

  /**
   * A suggested command in its public form: `zitadel doctor` becomes
   * `npx @zitadel/cli@<selector> doctor`, and any other command is returned as it was.
   *
   * @param command - A suggested command.
   * @returns The command a person can run.
   */
  normalizeCommand(command: string): string {
    if (command === Spelling.BINARY) {
      return this.command("");
    }
    if (command.startsWith(`${Spelling.BINARY} `)) {
      return this.command(command.slice(`${Spelling.BINARY} `.length));
    }
    return command;
  }

  /**
   * {@link Spelling.normalizeCommand} over a list. Only the `zitadel` prefix changes, so a
   * suggestion stays a suggestion.
   *
   * @param commands - Suggested commands, if there are any.
   * @returns The same commands in their public form, or `undefined` when there were none.
   */
  normalizeCommands<T extends string>(commands: ReadonlyArray<T> | undefined): T[] | undefined {
    return commands?.map((command) => {
      return this.normalizeCommand(command) as T;
    });
  }

  /**
   * Text as a terminal shows it: a command quoted in backticks is written out as the one that runs
   * on the reader's machine, and every other backtick span loses its backticks, because a terminal
   * prints them rather than rendering them as code.
   *
   * Library code writes its hints in the readable form, with the command in backticks. This is the
   * single place that form becomes what a person sees, so no hint has to know the version of the
   * CLI or how it is run.
   *
   * @param text - A message or hint as its author wrote it.
   * @returns The text without backticks and with each `zitadel …` command spelled out.
   */
  spellOut(text: string): string {
    return text.replace(/`([^`\n]+)`/g, (_match, span: string) => {
      return span.replace(/(^|\|\s*)zitadel(?= |$)/g, (_found, lead: string) => {
        return `${lead}${this.command("")}`;
      });
    });
  }

  /**
   * Rewrites `zitadel …` command mentions in scaffolded prose (the `.zitadel/**` READMEs) to the
   * public `npx @zitadel/cli@<version> …` form.
   *
   * The checked-in README sources stay written with the bare `zitadel` command, the canonical,
   * readable spelling, but the CLI is not a dependency of the scaffolded app. Covers inline code
   * spans (`` `zitadel deploy` ``) and fenced-block lines that start with `zitadel `; prose file
   * names like `zitadel.json` and `zitadel.db` don't match because the word must end the span or
   * be followed by a space.
   *
   * @param content - Prose as its source wrote it.
   * @returns The prose with every command in its public form.
   */
  normalizeProse(content: string): string {
    const prefix = this.command("");
    return this.rewriteCodeSpans(content).replace(
      /^(\s*)zitadel (.*)$/gm,
      (_match, indent: string, rest: string) => {
        return `${indent}${prefix} ${rest}`;
      },
    );
  }

  /**
   * Rewrites `zitadel …` command mentions inside every string of a scaffolded JSON document, today
   * the `.zitadel/meta/*.json` dialect files.
   *
   * Those files are generated copies of the meta-schemas the server embeds, where the bare
   * `zitadel` spelling is the correct one: the server documents the product command, not one
   * project's install. Their `description` strings surface as editor tooltips on the scaffolded
   * files, where the bare command does not exist, so the copy is normalized on the way out instead
   * of the shared source being edited.
   *
   * Unlike {@link Spelling.normalizeProse} this rewrites inline code spans only: a JSON
   * `description` is prose, so a value that merely begins with the word `zitadel` is a sentence,
   * not a command line.
   *
   * @param value - A JSON document, or any part of one.
   * @returns A rewritten copy; the input is never mutated (the meta-schema bodies are imported JSON
   * modules shared across calls).
   */
  normalizeJson<T>(value: T): T {
    if (typeof value === "string") {
      return this.rewriteCodeSpans(value) as T;
    }
    if (Array.isArray(value)) {
      return value.map((item) => {
        return this.normalizeJson(item);
      }) as T;
    }
    if (typeof value === "object" && value !== null) {
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => {
          return [key, this.normalizeJson(item)];
        }),
      ) as T;
    }
    return value;
  }

  /**
   * The inline-code-span half of {@link Spelling.normalizeProse}.
   *
   * @param content - Text that may quote `zitadel …` commands in backticks.
   * @returns The text with each quoted command in its public form.
   */
  private rewriteCodeSpans(content: string): string {
    const prefix = this.command("");
    return content.replace(/`zitadel( [^`\n]*)?`/g, (_match, args: string | undefined) => {
      return `\`${prefix}${args ?? ""}\``;
    });
  }
}
