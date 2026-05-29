import { describe, expect, it } from "vitest";

import { FLOWS_DIR } from "../../../../src/lib/flows";
import { SCHEMAS_DIR } from "../../../../src/lib/user-schema";
import { makeSyncers } from "../../../../src/lib/sync/syncers";
import { ZitadelError } from "../../../../src/lib/errors";
import type { PlatformClient } from "../../../../src/lib/api/client";

/**
 * Build a literal fake PlatformClient. Each method records the args it
 * was called with and returns a simple canned value, so individual
 * tests can assert how a syncer translates the opaque payload into the
 * resource-specific envelope. Not vi.mock — a plain object literal.
 */
function makeFakeClient(): {
  client: PlatformClient;
  calls: Record<string, unknown[]>;
} {
  const calls: Record<string, unknown[]> = {};
  const record = (name: string, args: unknown[]): void => {
    calls[name] = args;
  };

  const client = {
    async createProject(req: unknown) {
      record("createProject", [req]);
      return {} as never;
    },
    async getProject(id: unknown) {
      record("getProject", [id]);
      return {} as never;
    },
    async createSchema(data: object) {
      record("createSchema", [data]);
      return { id: "schema-id-1" };
    },
    async getSchema(id: string) {
      record("getSchema", [id]);
      return { kind: "user-schema", version: 1 };
    },
    async deleteSchema(id: string) {
      record("deleteSchema", [id]);
    },
    async createFlowDefinition(req: object) {
      record("createFlowDefinition", [req]);
      return { id: "flow-id-1" };
    },
    async getFlowDefinition(id: string) {
      record("getFlowDefinition", [id]);
      return {
        id,
        project_id: "proj-1",
        schema_uri: "https://example/schema",
        status: "active",
        created_at: "2026-01-01",
        updated_at: "2026-01-02",
        name: "Default",
        version: 2,
      };
    },
    async updateFlowDefinition(id: string, data: object) {
      record("updateFlowDefinition", [id, data]);
    },
    async deleteFlowDefinition(id: string) {
      record("deleteFlowDefinition", [id]);
    },
  } satisfies PlatformClient;

  return { client, calls };
}

describe("makeSyncers", () => {
  it("returns the schema and flow syncers in order", () => {
    const syncers = makeSyncers({ projectId: "proj-1" });

    expect(syncers).toHaveLength(2);
    expect(syncers.map((s) => s.kind)).toEqual(["schema", "flow"]);
  });

  it("configures the schema syncer (immutable, SCHEMAS_DIR)", () => {
    const [schema] = makeSyncers({ projectId: "proj-1" });

    expect(schema.kind).toBe("schema");
    expect(schema.directory).toBe(SCHEMAS_DIR);
    expect(schema.mutable).toBe(false);
    expect(typeof schema.fetch).toBe("function");
  });

  it("configures the flow syncer (mutable, FLOWS_DIR)", () => {
    const [, flow] = makeSyncers({ projectId: "proj-1" });

    expect(flow.kind).toBe("flow");
    expect(flow.directory).toBe(FLOWS_DIR);
    expect(flow.mutable).toBe(true);
    expect(typeof flow.fetch).toBe("function");
  });
});

describe("SchemaSyncer", () => {
  it("validate accepts a structurally valid JSON Schema", () => {
    const [schema] = makeSyncers({ projectId: "proj-1" });

    expect(() => schema.validate({ type: "object" })).not.toThrow();
  });

  it("validate throws E_VALIDATION on a malformed JSON Schema", () => {
    const [schema] = makeSyncers({ projectId: "proj-1" });

    expect(() => schema.validate({ type: 123 })).toThrow(ZitadelError);
  });

  it("create passes the bare data through and returns the platform id", async () => {
    const [schema] = makeSyncers({ projectId: "proj-1" });
    const { client, calls } = makeFakeClient();
    const data = { kind: "user-schema", version: 1 };

    const id = await schema.create(client, data);

    expect(id).toBe("schema-id-1");
    expect(calls.createSchema).toEqual([data]);
  });

  it("update is a no-op and does not call the client", async () => {
    const [schema] = makeSyncers({ projectId: "proj-1" });
    const { client, calls } = makeFakeClient();

    await expect(schema.update(client, "schema-id-1", { a: 1 })).resolves.toBeUndefined();
    expect(Object.keys(calls)).toHaveLength(0);
  });

  it("delete dispatches to deleteSchema with the id", async () => {
    const [schema] = makeSyncers({ projectId: "proj-1" });
    const { client, calls } = makeFakeClient();

    await schema.delete(client, "schema-id-1");

    expect(calls.deleteSchema).toEqual(["schema-id-1"]);
  });

  it("fetch dispatches to getSchema and returns its body verbatim", async () => {
    const [schema] = makeSyncers({ projectId: "proj-1" });
    const { client, calls } = makeFakeClient();

    const body = await schema.fetch?.(client, "schema-id-1");

    expect(calls.getSchema).toEqual(["schema-id-1"]);
    expect(body).toEqual({ kind: "user-schema", version: 1 });
  });
});

const VALID_FLOW = {
  name: "default",
  user_schema:
    "https://raw.githubusercontent.com/zitadel/nextgen/refs/heads/main/api/openapi/endpoints/schemas/human-user.yaml",
  purposes: ["login"],
  initial_steps: { login: "identifier" },
  steps: [
    { name: "identifier", type: "identifier", fields: {}, actions: {}, gates: {}, transitions: {} },
  ],
};

describe("FlowDefinitionSyncer", () => {
  it("validate accepts a well-formed flow definition", () => {
    const [, flow] = makeSyncers({ projectId: "proj-1" });

    expect(() => flow.validate(VALID_FLOW)).not.toThrow();
  });

  it("validate throws E_VALIDATION on a malformed flow definition", () => {
    const [, flow] = makeSyncers({ projectId: "proj-1" });

    expect(() => flow.validate({ version: 99, kind: "wrong" })).toThrow(ZitadelError);
  });

  it("create wraps the body in the spec envelope with project_id", async () => {
    const [, flow] = makeSyncers({ projectId: "proj-1" });
    const { client, calls } = makeFakeClient();
    const data = { name: "Default", version: 2 };

    const id = await flow.create(client, data);

    expect(id).toBe("flow-id-1");
    expect(calls.createFlowDefinition).toEqual([
      { project_id: "proj-1", flow_definition: data },
    ]);
  });

  it("update sends the bare partial body with no envelope", async () => {
    const [, flow] = makeSyncers({ projectId: "proj-1" });
    const { client, calls } = makeFakeClient();
    const patch = { version: 3 };

    await flow.update(client, "flow-id-1", patch);

    expect(calls.updateFlowDefinition).toEqual(["flow-id-1", patch]);
  });

  it("delete dispatches to deleteFlowDefinition with the id", async () => {
    const [, flow] = makeSyncers({ projectId: "proj-1" });
    const { client, calls } = makeFakeClient();

    await flow.delete(client, "flow-id-1");

    expect(calls.deleteFlowDefinition).toEqual(["flow-id-1"]);
  });

  it("fetch strips the detail envelope and returns only the bare body", async () => {
    const [, flow] = makeSyncers({ projectId: "proj-1" });
    const { client, calls } = makeFakeClient();

    const body = await flow.fetch?.(client, "flow-id-1");

    expect(calls.getFlowDefinition).toEqual(["flow-id-1"]);
    expect(body).toEqual({ name: "Default", version: 2 });
  });
});
