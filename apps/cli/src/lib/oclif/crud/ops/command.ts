import type { Command, Interfaces } from "@oclif/core";

import { ZitadelError } from "../../../errors";
import { BaseCommand } from "../../base";
import type { CommandResult, GlobalOptions, JsonEnvelope } from "../../types";
import type { Json, ResourceCommandOptions, ResourceDescriptor } from "../types";

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
}>;

/** Parsed flags and args, untyped: operations narrow what they read. */
export type OperationInput = Readonly<{ flags: Json; args: Json }>;

/**
 * The static shape every operation class has: the {@link ResourceCommand}
 * statics, a concrete constructor oclif can instantiate, and a `describe`
 * that turns a definition into the command's statics.
 */
export type OperationClass<Ctx, Spec> = typeof ResourceCommand<Ctx, Spec> & {
  new (...args: ConstructorParameters<typeof Command>): ResourceCommand<Ctx, Spec>;
  describe(definition: OperationDefinition<Ctx, Spec>): OperationStatics;
};

/**
 * Base of every generated command. Owns the lifecycle all operations share —
 * parse, resolve meta, run, emit — so a concrete operation only implements
 * {@link execute} and its static {@link OperationClass.describe}. The
 * definition is bound onto a subclass by {@link bindOperation}; the operation
 * classes themselves are never registered with oclif directly.
 */
export class ResourceCommand<Ctx, Spec> extends BaseCommand {
  protected get definition(): OperationDefinition<Ctx, Spec> {
    const definition = definitionOf(this.constructor as typeof Command);
    if (!definition) {
      throw new ZitadelError(
        "E_NOT_IMPLEMENTED",
        `${this.id ?? "operation"} was not built by bindOperation`,
      );
    }
    return definition as OperationDefinition<Ctx, Spec>;
  }

  async run(): Promise<JsonEnvelope> {
    const parsed = await this.parse(this.constructor as typeof ResourceCommand);
    const meta = await this.toMeta(parsed.flags);
    return this.emit(
      await this.execute({ flags: parsed.flags as Json, args: parsed.args as Json }, meta),
    );
  }

  /** Open the platform connection; deferred so `--dry-run` never connects. */
  protected connect(meta: GlobalOptions): Promise<Ctx> {
    return this.definition.options.connect(meta);
  }

  /**
   * The operation's work. Every concrete operation overrides this; the base
   * implementation exists only so {@link bindOperation} can subclass through
   * the generic static type, which TypeScript cannot do for an abstract member.
   */
  protected execute(_input: OperationInput, _meta: GlobalOptions): Promise<CommandResult> {
    return Promise.reject(
      new ZitadelError("E_NOT_IMPLEMENTED", `${this.id ?? "operation"} has no execute`),
    );
  }
}

/**
 * Produce the oclif command class for one operation on one resource: a
 * subclass carrying the definition and the statics `describe` derives from it.
 */
export const bindOperation = <Ctx, Spec>(
  operation: OperationClass<Ctx, Spec>,
  definition: OperationDefinition<Ctx, Spec>,
): typeof Command => {
  const statics = operation.describe(definition);
  const bound = class extends operation {
    static override description = statics.description;
    static override examples = [...statics.examples];
    static override flags = statics.flags;
    static override args = statics.args;
  };
  // Beside the class, never on it: oclif copies a command's own statics into
  // `commands --json` and the published manifest, and a registry entry (with a
  // serialized request schema inside it) is implementation detail that would
  // dwarf the metadata an agent actually reads.
  definitions.set(bound, definition as OperationDefinition<unknown, unknown>);
  return bound;
};

/** Definitions held beside their command classes, keyed weakly so they are collectable. */
const definitions = new WeakMap<object, OperationDefinition<unknown, unknown>>();

/** The definition {@link bindOperation} recorded for a command class, if any. */
export const definitionOf = (
  command: typeof Command,
): OperationDefinition<unknown, unknown> | undefined => definitions.get(command);
