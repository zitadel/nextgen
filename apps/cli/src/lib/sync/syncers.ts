import { FLOWS_DIR } from "../flows";
import { SCHEMAS_DIR } from "../user-schema";
import type { PlatformClient } from "../api/client.js";
import type { ResourceSyncer } from "./types.js";

/**
 * Build the syncer list with the project context every flow create
 * needs. Callers (apply / plan) read `project_id` from
 * `.zitadel/secret` and pass it here. The returned array is treated
 * as read-only by the sync loop.
 */
export function makeSyncers(opts: { projectId: string }): ReadonlyArray<ResourceSyncer> {
  return [new SchemaSyncer(), new FlowDefinitionSyncer(opts.projectId)];
}

class SchemaSyncer implements ResourceSyncer {
  readonly kind = "schema";
  readonly directory = SCHEMAS_DIR;
  readonly mutable = false;

  async create(client: PlatformClient, data: object): Promise<string> {
    const result = await client.createSchema(data);
    return result.id;
  }

  async update(_client: PlatformClient, _id: string, _data: object): Promise<void> {
    // Never called — mutable = false. Schemas are immutable on the platform.
  }

  async delete(client: PlatformClient, id: string): Promise<void> {
    await client.deleteSchema(id);
  }

  async fetch(client: PlatformClient, id: string): Promise<object> {
    return client.getSchema(id);
  }
}

class FlowDefinitionSyncer implements ResourceSyncer {
  readonly kind = "flow";
  readonly directory = FLOWS_DIR;
  readonly mutable = true;

  constructor(private readonly projectId: string) {}

  async create(client: PlatformClient, data: object): Promise<string> {
    // Wrap the bare flow body in the spec envelope before sending.
    // The on-disk file stays bare so it is editable by humans; only
    // the wire request carries `project_id` and the surrounding
    // envelope per
    // `api/openapi/components/flows/flow-definition-create-request.yaml`.
    const result = await client.createFlowDefinition({
      project_id: this.projectId,
      flow_definition: data,
    });
    return result.id;
  }

  async update(client: PlatformClient, id: string, data: object): Promise<void> {
    // PATCH body is the bare partial flow per
    // `flow-definition-update-request` — no envelope.
    await client.updateFlowDefinition(id, data);
  }

  async delete(client: PlatformClient, id: string): Promise<void> {
    await client.deleteFlowDefinition(id);
  }

  async fetch(client: PlatformClient, id: string): Promise<object> {
    // The GET /flow_definitions/:id response wraps the bare flow body
    // in a detail envelope (`id`, `project_id`, `schema_uri`,
    // `status`, `created_at`, `updated_at`). Strip those envelope
    // fields before returning so the diff compares apples-to-apples
    // against the on-disk flow file, which stores only the bare body.
    const {
      id: _id,
      project_id: _projectId,
      schema_uri: _schemaUri,
      status: _status,
      created_at: _createdAt,
      updated_at: _updatedAt,
      ...body
    } = (await client.getFlowDefinition(id)) as Record<string, unknown>;
    return body;
  }
}
