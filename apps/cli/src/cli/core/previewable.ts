import { Flags, type Interfaces } from "@oclif/core";

import type { SuggestedCommand } from "@/lib/suggestion";

import type { Admitted, BaseCommand } from "./base";
import type { CommandClass } from "@/lib/oclif/command-class";
import { EFFECT } from "./effect";
import type { CommandResult } from "./types";

/**
 * Marks a command that changes something, and gives it the one way to: it has
 * a dry run, and the dry run is a method of its own. `--dry-run` is a flag of
 * this mixin's alone, so a command that changes nothing never takes it, and a
 * command that takes it cannot be compiled without saying what it would do.
 *
 * ```ts
 * export default class VariableSet extends Previewable(ServerCommand(EnvironmentCommand)) {
 *   protected async preview({ args }: Admitted<typeof VariableSet>): Promise<CommandResult> {}
 *   protected async apply({ args }: Admitted<typeof VariableSet>): Promise<CommandResult> {}
 * }
 * ```
 *
 * `execute` is this mixin's: it answers with `preview` under `--dry-run` and
 * with `apply` otherwise, so no command writes the branch and none can forget
 * it. A refusal both would raise is raised first, by whatever the command
 * calls at the top of each.
 *
 * Only a command built on this has `this.dryRun`, and the public `EFFECT` key is
 * what a mixin that must sit on a command that changes something
 * ({@link Destructive}) asks of its host.
 *
 * @param Base - The command class to extend.
 * @returns The class, with a dry run.
 */
export function Previewable<
  TBase extends CommandClass<BaseCommand> &
    Pick<typeof BaseCommand, "baseFlags" | "enableJsonFlag">,
>(Base: TBase) {
  /** A command that has a dry run, which takes the one `--dry-run` every such command carries. */
  abstract class PreviewableCommand extends Base {
    /**
     * The flags of the command, with `--dry-run`. oclif reads a command's
     * statics up the chain of classes only while each declares a static of its
     * own, so this mixin declares the two it passes on.
     */
    static override baseFlags = {
      ...Base.baseFlags,
      "dry-run": Flags.boolean({ description: "Preview without mutating files or the platform." }),
    };

    /** Whether the command takes `--json`, as the class it extends says. */
    static override enableJsonFlag = Base.enableJsonFlag;

    /** What the command does to the world, which a mixin that needs a command that changes it asks for. */
    readonly [EFFECT] = "changes" as const;

    /** Whether this run previews its work instead of doing it (`--dry-run`). */
    protected get dryRun(): boolean {
      return this.meta.dryRun;
    }

    /**
     * The command a dry run offers next: this run again with `--dry-run` taken
     * off, every typed flag kept but the ones that only say how it answered.
     *
     * @param adding - Flags the real run is given on top, such as `force` for a command that asks consent.
     * @returns The command.
     */
    protected async realRun(adding: { force?: true } = {}): Promise<SuggestedCommand> {
      return this.rerun<{
        dryRun: Interfaces.BooleanFlag<boolean>;
        force: Interfaces.BooleanFlag<boolean>;
      }>({
        without: ["dryRun"],
        with: adding,
      });
    }

    /**
     * What the command would do, said without doing any of it: no write, no
     * request that changes a thing, no question that needs a person.
     *
     * @param input - The flags and arguments the command accepts.
     * @returns The envelope of the dry run.
     */
    protected abstract preview(input: Admitted<typeof BaseCommand>): Promise<CommandResult>;

    /**
     * What the command does.
     *
     * @param input - The flags and arguments the command accepts.
     * @returns The envelope of the run.
     */
    protected abstract apply(input: Admitted<typeof BaseCommand>): Promise<CommandResult>;

    /**
     * Picks the dry run or the work. A property, so a command that declares an
     * `execute` of its own is refused by the compiler.
     *
     * @param input - The flags and arguments the command accepts.
     * @returns The envelope of whichever ran.
     */
    protected override readonly execute = (
      input: Admitted<typeof BaseCommand>,
    ): Promise<CommandResult> => {
      return this.dryRun ? this.preview(input) : this.apply(input);
    };
  }

  return PreviewableCommand;
}
