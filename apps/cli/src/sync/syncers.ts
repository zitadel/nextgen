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

  async create(client: PlatformClient, data: object): Promise<string> {
    const result = await client.createFlowDefinition(data);
    return result.id;
  }

  async update(client: PlatformClient, id: string, data: object): Promise<void> {
    await client.updateFlowDefinition(id, data);
  }

  async delete(client: PlatformClient, id: string): Promise<void> {
    await client.deleteFlowDefinition(id);
  }

  // no fetch — GET /flow_definitions/{id} not implemented in backend
}

export const syncers: ResourceSyncer[] = [new SchemaSyncer(), new FlowDefinitionSyncer()];
