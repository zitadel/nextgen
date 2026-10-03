import { describe, expect, it } from "vitest";

import { ApiError } from "@zitadel/api/runtime/fetch";

import { rewriteRefsToHandles } from "../../../../src/lib/sync/references";
import type { ReferenceField, ResourceSyncer } from "../../../../src/lib/sync/types";

/**
 * The resolver is kind-agnostic: it reads a syncer's declared references and
 * resolves each through the target syncer's `fetch` + `handleField` + `idPrefix`.
 * These doubles stand in for the real syncers so the test owns exactly the
 * reference topology under test, not the whole platform client.
 */
function syncerDouble(props: {
  kind: string;
  idPrefix?: string;
  handleField?: string;
  references?: ReadonlyArray<ReferenceField>;
  fetch?: (id: string) => Promise<object>;
}): ResourceSyncer {
  // Only the members the resolver reads are provided; the `unknown` cast
  // supplies the rest of the interface, which `rewriteRefsToHandles` never
  // touches.
  return {
    kind: props.kind,
    directory: `.zitadel/${props.kind}`,
    mutable: false,
    revisioned: true,
    idPrefix: props.idPrefix,
    handleField: props.handleField,
    references: props.references,
    fetch: props.fetch,
  } as unknown as ResourceSyncer;
}

const schemaDouble = (byId: Record<string, object>): ResourceSyncer =>
  syncerDouble({
    kind: "schema",
    idPrefix: "sch",
    handleField: "objectType",
    fetch: async (id) => {
      const doc = byId[id];
      if (doc === undefined) {
        throw new ApiError(404, `/schemas/${id}`, { code: "not_found" }, "not found");
      }
      return doc;
    },
  });

const flowDouble = (): ResourceSyncer =>
  syncerDouble({
    kind: "flow",
    idPrefix: "flowdef",
    handleField: "name",
    references: [{ path: "user_schema", kind: "schema" }],
  });

describe("rewriteRefsToHandles", () => {
  it("rewrites a flow's user_schema id to the referenced schema's objectType handle", async () => {
    const syncers = [schemaDouble({ sch_123: { objectType: "human-user" } }), flowDouble()];
    const flow = { name: "login", user_schema: "sch_123", steps: [] };

    const { body, warnings } = await rewriteRefsToHandles("flow", flow, syncers);

    expect(body).toMatchObject({ user_schema: "human-user" });
    expect(warnings).toEqual([]);
    // The input is not mutated — the resolver clones.
    expect(flow.user_schema).toBe("sch_123");
  });

  it("leaves a value that is not a concrete id untouched", async () => {
    const syncers = [schemaDouble({}), flowDouble()];
    const flow = { name: "login", user_schema: "https://example.test/human-user.yaml" };

    const { body, warnings } = await rewriteRefsToHandles("flow", flow, syncers);

    expect(body).toMatchObject({ user_schema: "https://example.test/human-user.yaml" });
    expect(warnings).toEqual([]);
  });

  it("keeps the id and warns when the referenced revision no longer exists", async () => {
    const syncers = [schemaDouble({}), flowDouble()];
    const flow = { name: "login", user_schema: "sch_gone" };

    const { body, warnings } = await rewriteRefsToHandles("flow", flow, syncers);

    expect(body).toMatchObject({ user_schema: "sch_gone" });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("sch_gone");
    expect(warnings[0]).toContain("user_schema");
  });

  it("returns a kind with no declared references unchanged", async () => {
    const syncers = [schemaDouble({ sch_1: { objectType: "human-user" } }), flowDouble()];
    const schema = { objectType: "human-user", properties: {} };

    const { body, warnings } = await rewriteRefsToHandles("schema", schema, syncers);

    expect(body).toBe(schema);
    expect(warnings).toEqual([]);
  });
});
