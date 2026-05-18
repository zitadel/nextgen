import type { PlatformClient } from "../platform/client.js";

export interface ResourceSyncer {
  readonly kind: string;
  readonly directory: string;
  readonly mutable: boolean;
  create(client: PlatformClient, data: object): Promise<string>;
  update(client: PlatformClient, id: string, data: object): Promise<void>;
  delete(client: PlatformClient, id: string): Promise<void>;
  fetch?(client: PlatformClient, id: string): Promise<object>;
}

export class SchemaSyncer implements ResourceSyncer {
  readonly kind = "schema";
  readonly directory = ".zitadel/schemas";
  readonly mutable = false;

  async create(client: PlatformClient, data: object): Promise<string> {
    const result = await client.createSchema(data);
    return result.id;
  }

  async update(_client: PlatformClient, _id: string, _data: object): Promise<void> {
    // never called — mutable = false
  }

  async delete(client: PlatformClient, id: string): Promise<void> {
    await client.deleteSchema(id);
  }

  async fetch(client: PlatformClient, id: string): Promise<object> {
    return client.getSchema(id);
  }
}

export class FlowDefinitionSyncer implements ResourceSyncer {
  readonly kind = "flow";
  readonly directory = ".zitadel/flows";
  readonly mutable = true;

  constructor(private readonly projectId: string) {}

  async create(client: PlatformClient, data: object): Promise<string> {
    // Wrap the bare flow body in the spec envelope before sending. The flow
    // file on disk stays the bare flow-definition object so it is editable
    // by humans; only the wire request carries `project_id` and the
    // surrounding envelope per
    // `api/openapi/components/flows/flow-definition-create-request.yaml`.
    const result = await client.createFlowDefinition({
      project_id: this.projectId,
      flow_definition: data,
    });
    return result.id;
  }

  async update(client: PlatformClient, id: string, data: object): Promise<void> {
    // PATCH body is the bare partial flow per `flow-definition-update-request`
    // — no envelope.
    await client.updateFlowDefinition(id, data);
  }

  async delete(client: PlatformClient, id: string): Promise<void> {
    await client.deleteFlowDefinition(id);
  }

  // no fetch — GET /flow_definitions/{id} is currently in the spec but the
  // CLI doesn't read it back; a field-level diff in `plan` is therefore
  // marked as "unavailable" rather than fetched.
}

/**
 * Build the syncer list with the project context every flow create needs.
 * Callers (apply / plan) read `project_id` from `.zitadel/secret` and pass
 * it here.
 */
export function makeSyncers(opts: { projectId: string }): ResourceSyncer[] {
  return [new SchemaSyncer(), new FlowDefinitionSyncer(opts.projectId)];
}
