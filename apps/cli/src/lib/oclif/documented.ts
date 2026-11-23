import type { Command } from "@oclif/core";

import { Input } from "./input";

/** A class that can be extended, abstract or not, whatever arguments it takes. */
// biome-ignore lint/suspicious/noExplicitAny: the constructor of any command, which a mixin cannot name
type CommandClass = abstract new (...args: any[]) => Command;

/**
 * Lets a command take its whole invocation as one JSON document, passed with
 * `--input`, `--flags-file` or `--cli-input-json`.
 *
 * The document is laid under the words the command is run with before oclif
 * parses them, so the command, and every flag and argument it declares, never
 * knows it was there: each is checked by its own declaration, as if the words
 * had been typed. A document that cannot be used stays on the line as
 * `--input=<text>`, and the flag refuses it with the reason when the command
 * parses it, so the refusal is the command's own, in the envelope every
 * failure ends in.
 *
 * ```ts
 * export abstract class BaseCommand extends Documented(Interruptible(Command)) {}
 * ```
 *
 * See {@link Input} for what a document may hold.
 */
export function Documented<TBase extends CommandClass>(Base: TBase) {
  abstract class DocumentedCommand extends Base {
    /**
     * oclif runs this before it parses the flags, with the array of words it
     * then parses, so the words are replaced in place.
     */
    protected override async init(): Promise<void> {
      this.argv.splice(0, this.argv.length, ...(await new Input(this.ctor).rewrite(this.argv)));
      await super.init();
    }
  }

  return DocumentedCommand;
}
