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
      verbs: [
        ...(resource.list ? ["list"] : []),
        ...(resource.get ? ["get"] : []),
        ...(resource.create ? ["create"] : []),
        ...(resource.update ? ["update"] : []),
        ...(resource.delete ? [resource.delete.verb ?? "delete"] : []),
      ],
      columns: [...resource.columns],
      // The property a delete's envelope carries beside `id`. It is not always
      // `deleted` — a team's DELETE deactivates it (ADR 024) — and an agent
      // reading this surface should not have to guess which.
      ...(resource.delete
        ? {
            delete_outcome:
              resource.delete.outcome ??
              (resource.delete.verb === "revoke" ? "revoked" : "deleted"),
          }
        : {}),
      ...(resource.list?.kind === "query"
        ? {
            filter_fields: [...resource.list.filterFields],
            sort_fields: [...resource.list.sortFields],
          }
        : {}),
      ...(resource.list?.kind === "params"
        ? { params: resource.list.params.map((param) => param.flag) }
        : {}),
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
