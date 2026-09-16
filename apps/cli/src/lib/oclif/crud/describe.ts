import { describeBody } from "./fields";
import type { Json, ResourceRegistry } from "./types";

/**
 * A machine-readable description of what a registry exposes: one entry per
 * topic with its verbs, the fields each list accepts, and the body fields of
 * its writes. It is the same information `--help` renders for a reader, in the
 * shape an agent can consume in a single call — the role `stripe resources`
 * and `kubectl api-resources` play in those CLIs.
 */
export const describeRegistry = <Ctx>(registry: ResourceRegistry<Ctx>): readonly Json[] =>
  Object.entries(registry).map(([topic, resource]) => {

    return {
      topic,
      singular: resource.singular,
      id_field: resource.idField,
      // The positional the id-taking verbs read, which is not always "id":
      // an environment is addressed by name.
      id_arg: resource.idArg ?? "id",
      verbs: [
        ...(resource.list ? ["list"] : []),
        ...(resource.get ? ["get"] : []),
        ...(resource.create ? ["create"] : []),
        ...(resource.update ? ["update"] : []),
        ...(resource.delete ? [resource.delete.verb ?? "delete"] : []),
      ],
      columns: [...resource.columns],
      // Whether `list` is cursor-paginated. An agent that loops on
      // `next_page_token` needs to know which collections arrive whole.
      ...(resource.list ? { paged: resource.list.paged !== false } : {}),
      // Whether a bare `list` returns the whole collection. An agent that must
      // not miss a row needs to know which resources it has to drain itself.
      ...(resource.list?.drains === true ? { drains: true } : {}),
      // The property a delete's envelope carries beside `id`. It is not always
      // `deleted` — a team's DELETE deactivates it (ADR 024) — and an agent
      // reading this surface should not have to guess which.
      ...(resource.delete
        ? {
            delete_outcome:
              resource.delete.outcome ??
              { delete: "deleted", revoke: "revoked", deactivate: "deactivated" }[
                resource.delete.verb ?? "delete"
              ],
          }
        : {}),
      // Every list shares one filter grammar, so the surface reports each
      // field with the operations that field accepts rather than a single set
      // the resource may not honour everywhere.
      ...(resource.list?.filters?.length
        ? {
            filters: resource.list.filters.map((field) => ({
              field: field.field,
              operations: [...field.operations],
              ...(field.values ? { values: [...field.values] } : {}),
              ...(field.combine === "or" ? { combine: "or" } : {}),
            })),
          }
        : {}),
      ...(resource.list?.sorts?.length ? { sort_fields: [...resource.list.sorts] } : {}),
      // Per verb, not per resource: a create's required field is often optional
      // on the update of the same resource, so one list would misdescribe one
      // of them.
      ...(resource.create ? { create_fields: fieldsOf(resource.create.schema) } : {}),
      ...(resource.update ? { update_fields: fieldsOf(resource.update.schema) } : {}),
    };
  });

/** A write's fields as an agent needs them: flag, kind, whether it is required. */
const fieldsOf = (schema: Parameters<typeof describeBody>[0]): readonly Json[] =>
  describeBody(schema).map((field) => ({
    name: field.name,
    flag: `--${field.flag}`,
    kind: field.kind,
    required: field.required,
    ...(field.options ? { options: [...field.options] } : {}),
  }));
