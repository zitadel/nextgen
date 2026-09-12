import type { Command } from "@oclif/core";

import { bindOperation, type OperationClass } from "./ops/command";
import { DeleteOperation } from "./ops/delete";
import { ListOperation } from "./ops/list";
import { GetOperation } from "./ops/read";
import { CreateOperation, UpdateOperation } from "./ops/write";
import type {
  ResourceCommandId,
  ResourceCommandOptions,
  ResourceDescriptor,
  ResourceRegistry,
  Verb,
} from "./types";

/**
 * Generic `<topic> <verb>` command factory for oclif. It knows nothing about
 * the platform behind the commands: every API call is a closure in the
 * registry that receives a caller-supplied connection `Ctx`, and every
 * platform-specific flag or credential lookup arrives through
 * {@link ResourceCommandOptions}. What the factory owns is the CLI contract —
 * flag grammar, pagination, local schema validation, the dry-run and
 * destructive-action guards, and the JSON / table envelopes.
 */

export { bodyFieldFlags, bodyFromFlags, describeBody, fieldExample } from "./fields";
export type { BodyField, FieldKind } from "./fields";
export { describeRegistry } from "./describe";
export { collectPages } from "./paging";
export { parseFilter, parseSort } from "./query";
export { chosenColumns } from "./columns";
export { allows, fieldPaths, itemSchemaOf, observedPaths, suggestable } from "./paths";
export type { FieldPaths } from "./paths";
export { renderDetail, renderRows, renderTable } from "./table";
export { bindOperation, definitionOf, ResourceCommand } from "./ops/command";
export type {
  OperationClass,
  OperationDefinition,
  OperationInput,
  OperationStatics,
} from "./ops/command";
export { CreateOperation, DeleteOperation, GetOperation, ListOperation, UpdateOperation };
export type * from "./types";

/**
 * Builds the command classes for every registry entry, keyed by oclif command
 * id (`users:list`), ready to spread into an explicit command table. oclif's
 * help, manifest, autocomplete, and README generation read them exactly as
 * they read hand-written classes.
 */
export const buildResourceCommands = <Ctx>(
  registry: ResourceRegistry<Ctx>,
  options: ResourceCommandOptions<Ctx>,
): Readonly<Record<ResourceCommandId, typeof Command>> =>
  Object.fromEntries(
    Object.entries(registry).flatMap(([topic, resource]) => {
      const bind = <Spec>(
        verb: Verb,
        operation: OperationClass<Ctx, Spec>,
        spec: Spec | undefined,
      ): readonly (readonly [ResourceCommandId, typeof Command])[] =>
        spec === undefined
          ? []
          : [[`${topic}:${verb}`, bindOperation(operation, { topic, resource, spec, options })]];
      return [
        ...bind("list", ListOperation, resource.list),
        ...bind("get", GetOperation, resource.get),
        ...bind("create", CreateOperation, resource.create),
        ...bind("update", UpdateOperation, resource.update),
        ...bind(resource.delete?.verb ?? "delete", DeleteOperation, resource.delete),
      ];
    }),
  );

/** Re-exported for registries that want to describe a resource in isolation. */
export type { ResourceDescriptor };
