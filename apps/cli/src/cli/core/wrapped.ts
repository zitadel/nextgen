import { format } from "node:util";

import type { Command } from "@oclif/core";

import { ZitadelError } from "@/lib/errors";
import { refusalError, type Refusal } from "@/cli/core/refusal";
import { prose } from "@/lib/oclif/rendering";
import { escapeControlCharacters } from "@/lib/terminal-text";

import type { BaseCommand } from "./base";
import type { CommandClass } from "@/lib/oclif/command-class";
import type { CommandResult } from "./types";

/**
 * A wrapped command whose plugin ships no command of that name.
 */
const NO_SUCH_COMMAND_REFUSAL = {
  code: "E_NOT_IMPLEMENTED",
  message: "The {plugin} plugin has no {id} command",
} as const satisfies Refusal;

/**
 * What the plugin's command failed with, in its own words and without the
 * framework's error object, which no script should read.
 */
const PLUGIN_REFUSED_REFUSAL = {
  message: "{problem}",
} as const satisfies Refusal;

/**
 * Runs a command a framework plugin ships (`version`, `commands`, `which`,
 * `help`, `autocomplete`) as every command of this CLI is run.
 *
 * The plugins skip {@link BaseCommand}, so `--json` printed their own object,
 * and a flag they refused printed oclif's whole error, the config included.
 * This runs the plugin's command inside the base command's lifecycle instead:
 * what it logs becomes the rendering, what it returns becomes `data`, and a
 * failure is the failure envelope with its exit code.
 *
 * ```ts
 * export class Version extends Wrapped(BaseCommand) {
 *   static override readonly wrapsPlugin = "@oclif/plugin-version";
 * }
 * ```
 *
 * The class names the plugin it wraps and declares the flags that plugin's
 * command takes, so oclif parses them and `--help` lists them. A root command
 * outranks a plugin's of the same id, so no plugin is removed.
 */
export function Wrapped<TBase extends CommandClass<BaseCommand>>(Base: TBase) {
  abstract class WrappedCommand extends Base {
    /**
     * The plugin that ships the command, as `oclif.plugins` names it.
     */
    static readonly wrapsPlugin: string;

    /**
     * Runs the plugin's command, capturing what it prints.
     *
     * The plugin is given the arguments and the flags it declares, and
     * `--json` when it has such a flag: the global flags are this command's.
     * The envelope's `data` is what the command returned, a list as `result`
     * (so it is not mistaken for a paged list), or what it printed as `output`
     * when it returned nothing. Some commands write to stdout
     * themselves rather than through `log`, and oclif's `ux` prints through
     * `console.log`, which a runner may have replaced, so both are captured
     * for the length of the run.
     *
     * @returns The success envelope, with what the command returned as `data`.
     * @throws {ZitadelError} E_NOT_IMPLEMENTED when the plugin or its command cannot be found.
     */
    protected async execute(): Promise<CommandResult> {
      const id = this.id ?? "";
      const { wrapsPlugin: plugin } = this.constructor as typeof WrappedCommand;
      const found = this.config.plugins.get(plugin)?.commands.find((command) => {
        return command.id === id;
      });
      if (found === undefined) {
        throw refusalError(NO_SUCH_COMMAND_REFUSAL, { plugin, id });
      }
      const Real = await found.load();
      const { raw } = await this.parseOnce();
      const passed: string[] = [];
      const words: string[] = [];
      for (const token of raw) {
        const flag = token.type === "flag" ? Real.flags?.[token.flag] : undefined;
        if (token.type === "arg") {
          words.push(token.input);
        } else if (flag?.type === "boolean") {
          passed.push(`--${token.flag}`);
        } else if (flag !== undefined) {
          passed.push(`--${token.flag}=${token.input}`);
        }
      }
      if (Real.enableJsonFlag && this.jsonEnabled()) {
        passed.push("--json");
      }
      if (words.length > 0) {
        passed.push("--", ...words);
      }
      const real: Command = Reflect.construct(Real, [passed, this.config]);
      const written: string[] = [];
      real.log = (message = "", ...args: unknown[]): void => {
        written.push([message, ...args].join(" "));
      };
      const write = process.stdout.write;
      process.stdout.write = ((
        chunk: string | Uint8Array,
        encodingOrCallback?: BufferEncoding | ((error?: Error | null) => void),
        callback?: (error?: Error | null) => void,
      ): boolean => {
        written.push(String(chunk).replace(/\n$/, ""));
        const done = typeof encodingOrCallback === "function" ? encodingOrCallback : callback;
        done?.();

        return true;
      }) as typeof process.stdout.write;
      const consoleLog = console.log;
      console.log = (...args: unknown[]): void => {
        written.push(format(...args));
      };
      const returned: unknown = await real
        .run()
        .catch((error: unknown) => {
          if (error instanceof ZitadelError) {
            throw error;
          }

          throw refusalError(PLUGIN_REFUSED_REFUSAL, {
            problem: error instanceof Error ? error.message : String(error),
          });
        })
        .finally(() => {
          process.stdout.write = write;
          console.log = consoleLog;
        });
      const text = written.join("\n");
      const title = escapeControlCharacters(id);

      const data = Array.isArray(returned) ? { result: returned } : returned;

      return {
        status: "ok",
        data: data ?? { output: text },
        verbatim: true,
        pretty: prose(text),
        summary: {
          title,
          sections: [],
          lines:
            text === ""
              ? []
              : text.split("\n").map((line) => {
                  return escapeControlCharacters(line);
                }),
        },
      };
    }
  }

  return WrappedCommand;
}
