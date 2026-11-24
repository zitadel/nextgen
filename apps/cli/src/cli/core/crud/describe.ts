import { describeBody } from "./fields";
import type { Json, ResourceRegistry, Schema, WriteShape } from "./types";

/**
 * A machine-readable description of what a registry exposes: one entry per
 * topic with its verbs, the fields each list accepts, and the body fields of
 * its writes. It is the same information `--help` renders for a reader, in the
 * shape an agent can consume in a single call — the role `stripe resources`
 * and `kubectl api-resources` play in those CLIs.
 *
 * `id_arg` is the positional the id-taking verbs read, which is not always
 * "id": an environment is addressed by name. `paged` says whether `list` is
 * cursor-paginated, so an agent that loops on `next_page_token` knows which
 * collections arrive whole, and `drains` says whether a bare `list` returns the
 * whole collection, so an agent that must not miss a row knows which resources
 * it has to drain itself. `delete_outcome` is the property a delete's envelope
 * carries beside `id`; it is not always `deleted` (a team's DELETE deactivates
 * it, ADR 024) and an agent should not have to guess which. Every list shares
 * one filter grammar, so each filter field is reported with the operations
 * that field accepts rather than a single set the resource may not honour
 * everywhere. `document_root` is the property of the request body the document
 * sits under, which the fields are relative to; `--data` and `--file` take the
 * document. The create and update fields are described per verb, not per
 * resource: a create's required field is often optional on the update of the
 * same resource, so one list would misdescribe one of them.
 *
 * @param registry - The resources to describe, by topic.
 * @returns One description per topic.
 */
export const describeRegistry = <Ctx>(registry: ResourceRegistry<Ctx>): readonly Json[] => {
  return Object.entries(registry).map(([topic, resource]) => {
    const documentRoot = resource.create?.root ?? resource.update?.root;
    return {
      topic,
      singular: resource.singular,
      id_field: resource.idField,
      id_arg: resource.idArg ?? "id",
      verbs: [
        ...(resource.list ? ["list"] : []),
        ...(resource.get ? ["get"] : []),
        ...(resource.create ? ["create"] : []),
        ...(resource.update ? ["update"] : []),
        ...(resource.delete ? [resource.delete.verb ?? "delete"] : []),
      ],
      columns: [...resource.columns],
      ...(resource.list ? { paged: resource.list.paged !== false } : {}),
      ...(resource.list?.drains === true ? { drains: true } : {}),
      ...(resource.delete
        ? {
            delete_outcome:
              resource.delete.outcome ??
              {
                delete: "deleted",
                revoke: "revoked",
                deactivate: "deactivated",
              }[resource.delete.verb ?? "delete"],
          }
        : {}),
      ...(resource.list?.filters?.length
        ? {
            filters: resource.list.filters.map((field) => {
              return {
                field: field.field,
                operations: [...field.operations],
                ...(field.values ? { values: [...field.values] } : {}),
                ...(field.default !== undefined ? { default: field.default } : {}),
                ...(field.combine === "or" ? { combine: "or" } : {}),
              };
            }),
          }
        : {}),
      ...(resource.list?.sorts?.length ? { sort_fields: [...resource.list.sorts] } : {}),
      ...(documentRoot ? { document_root: documentRoot } : {}),
      ...(resource.create ? { create_fields: fieldsOf(resource.create) } : {}),
      ...(resource.update ? { update_fields: fieldsOf(resource.update) } : {}),
    };
  });
};

/**
 * A write's fields as an agent needs them, nested ones included: the dot path
 * (`name`), the flag that carries it — `null` when only `--set` reaches it —
 * its kind, and whether a body must carry it. Enough to assemble flags,
 * `--set` assignments or a whole document from one call (ADR 071 §9).
 */
const fieldsOf = (spec: WriteShape & { schema: Schema }): readonly Json[] => {
  return describeBody(spec.schema, { root: spec.root }).map((field) => {
    return {
      name: field.name,
      flag: field.flag ? `--${field.flag}` : null,
      kind: field.kind,
      required: field.required,
      ...(field.requiredWith ? { required_with: field.requiredWith.join(".") } : {}),
      ...(field.item ? { item: field.item } : {}),
      ...(field.options ? { options: [...field.options] } : {}),
      ...(field.default ? { default: field.default.value } : {}),
      ...(field.summary ? { description: field.summary } : {}),
    };
  });
};
