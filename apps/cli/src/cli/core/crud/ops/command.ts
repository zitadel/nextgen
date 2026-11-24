import { Flags, type Command, type Interfaces } from "@oclif/core";

import { ZitadelError } from "@/lib/errors";
import type { BaseCommand } from "@/cli/core/base";
import type { CommandClass } from "@/lib/oclif/command-class";
import type { Json, ResourceCommandOptions, ResourceDescriptor } from "@/cli/core/crud/types";
import { EnvironmentCommand } from "@/cli/core/environment-command";
import { Tabulatable } from "@/cli/core/tabulatable";

/**
 * What gives a command the server it talks to: the mixin the CLI applies to
 * every command (`ServerCommand`), handed in by the one place that builds these
 * commands, so this layer names no server of its own.
 */
export type ServerMixin = <
  TBase extends CommandClass<BaseCommand> &
    Pick<typeof BaseCommand, "baseFlags" | "enableJsonFlag">,
>(
  Base: TBase,
) => TBase;

/** Everything an operation needs to know about the resource it serves. */
export type OperationDefinition<Ctx, Spec> = Readonly<{
  topic: string;
  resource: ResourceDescriptor<Ctx>;
  spec: Spec;
  options: ResourceCommandOptions<Ctx>;
}>;

/** The oclif statics an operation derives from its definition. */
export type OperationStatics = Readonly<{
  description: string;
  examples: readonly string[];
  flags: Interfaces.FlagInput;
  args: Interfaces.ArgInput;
  /** What `--force` does for this resource, for an operation that asks consent. */
  force?: string;
}>;

/**
 * What an operation receives: its parsed flags and args, as each operation
 * types them.
 */
export type OperationInput<
  Flags extends object = Json,
  Args extends object = Json,
  Found extends object = Record<never, never>,
> = Readonly<{
  flags: Readonly<Flags>;
  args: Readonly<Args>;
}> &
  Readonly<Found>;

/**
 * The static shape every operation class has: the {@link ResourceCommand}
 * statics, a concrete constructor oclif can instantiate, and a `describe`
 * that turns a definition into the command's statics.
 */
export type OperationClass<Ctx, Spec> = typeof ResourceCommand & {
  describe(definition: OperationDefinition<Ctx, Spec>): OperationStatics;
};

/**
 * Base of every generated command. Owns the definition an operation reads and
 * the connection it opens, so a concrete operation only implements its work and
 * its static {@link OperationClass.describe}. What the operation does to the
 * world is its own declaration: a read says nothing, a write is `Previewable`
 * and a deletion is `Destructive`, so `--dry-run` and `--force` reach only the
 * operations that mean them. The definition is bound onto a subclass by
 * {@link bindOperation}; the operation classes themselves are never registered
 * with oclif directly.
 */
export abstract class ResourceCommand extends Tabulatable(EnvironmentCommand) {
  /**
   * The definition {@link bindOperation} bound onto this command, which each
   * operation reads as the types it was defined with.
   *
   * @typeParam Ctx - What the operation's connection opens.
   * @typeParam Spec - The operation's own spec.
   * @returns The definition.
   * @throws {ZitadelError} When the command was not built by {@link bindOperation}.
   */
  protected defined<Ctx, Spec>(): OperationDefinition<Ctx, Spec> {
    const definition = definitionOf(this.constructor as typeof Command);
    if (!definition) {
      throw new ZitadelError(
        "E_NOT_IMPLEMENTED",
        `${this.id ?? "operation"} was not built by bindOperation`,
      );
    }
    return definition as OperationDefinition<Ctx, Spec>;
  }

  /** Open the platform connection; deferred so `--dry-run` connects only to ask the server. */
  protected context<Ctx>(): Promise<Ctx> {
    return this.defined<Ctx, unknown>().options.connect(() => {
      return this.connect();
    });
  }
}

/**
 * Produce the oclif command class for one operation on one resource: a
 * subclass carrying the definition and the statics `describe` derives from it.
 * The subclass takes its server from `takesServer`, which makes it a command
 * that can be run.
 */
export const bindOperation = <Ctx, Spec>(
  operation: OperationClass<Ctx, Spec>,
  definition: OperationDefinition<Ctx, Spec>,
  takesServer: ServerMixin,
): typeof Command => {
  const statics = operation.describe(definition);
  const served = takesServer(operation);
  abstract class Bound extends served {
    static override baseFlags =
      statics.force === undefined
        ? served.baseFlags
        : {
            ...served.baseFlags,
            force: Flags.boolean({
              char: "f",
              description: statics.force,
            }),
          };
    static override description = statics.description;
    static override examples = [...statics.examples];
    static override flags = statics.flags;
    static override args = statics.args;
    static override group = definition.resource.group;
    static override groupOrder = definition.resource.groupOrder;
  }
  definitions.set(Bound, definition as OperationDefinition<unknown, unknown>);

  return Bound;
};

/**
 * Definitions held beside their command classes, keyed weakly so they are
 * collectable. They sit beside the class, never on it: oclif copies a command's
 * own statics into `commands --json` and the published manifest, and a registry
 * entry (with a serialized request schema inside it) is implementation detail
 * that would dwarf the metadata an agent actually reads.
 */
const definitions = new WeakMap<object, OperationDefinition<unknown, unknown>>();

/** The definition {@link bindOperation} recorded for a command class, if any. */
export const definitionOf = (
  command: typeof Command,
): OperationDefinition<unknown, unknown> | undefined => {
  return definitions.get(command);
};
