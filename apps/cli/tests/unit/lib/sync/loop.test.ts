import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it, vi } from "vitest";

import { createZitadelClient } from "@zitadel/api/client";
import { normalizeFlowBody, normalizeSchemaBody } from "@zitadel/config/normalize";

import {
  buildSyncPlan,
  hashForState,
  runSyncLoop,
  writeBackResource,
} from "../../../../src/lib/sync/loop";
import { makeSyncers } from "../../../../src/lib/sync/syncers";
import type { ResourceSyncer } from "../../../../src/lib/sync/syncers";

const client = createZitadelClient({ baseUrl: "http://test.local" });

function makeCwd(): string {
  return join(tmpdir(), `zitadel-test-${Math.random().toString(36).slice(2)}`);
}

async function writeState(cwd: string, state: object): Promise<void> {
  await mkdir(join(cwd, ".zitadel"), { recursive: true });
  await writeFile(join(cwd, ".zitadel/state.json"), JSON.stringify(state));
}

async function writeResource(cwd: string, dir: string, name: string, contents: object): Promise<void> {
  await mkdir(join(cwd, dir), { recursive: true });
  await writeFile(join(cwd, dir, name), JSON.stringify(contents));
}

function makeSyncer(overrides: Partial<ResourceSyncer> = {}): ResourceSyncer {
  return {
    kind: "schema",
    directory: ".zitadel/schemas",
    mutable: false,
    revisioned: false,
    validate: vi.fn(),
    create: vi.fn().mockResolvedValue({ id: "created-id" }),
    update: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("buildSyncPlan", () => {
  it("returns create action when file exists with no state entry", async () => {
    const cwd = makeCwd();
    try {
      await writeState(cwd, { framework: "next", resources: {} });
      await writeResource(cwd, ".zitadel/schemas", "user.json", { kind: "user-schema" });

      const syncer = makeSyncer();
      const actions = await buildSyncPlan(cwd, [syncer]);

      expect(actions).toHaveLength(1);
      expect(actions[0].kind).toBe("create");
      expect(actions[0].path).toBe(".zitadel/schemas/user.json");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("returns skip(no-change) when an unchanged file already has an id in state", async () => {
    const cwd = makeCwd();
    try {
      const data = { kind: "user-schema" };
      const { createHash } = await import("node:crypto");
      const hash = createHash("sha256").update(JSON.stringify(data)).digest("hex");
      await writeState(cwd, {
        framework: "next",
        resources: { ".zitadel/schemas/user.json": { id: "existing-id", hash } },
      });
      await writeResource(cwd, ".zitadel/schemas", "user.json", data);

      const syncer = makeSyncer({ mutable: false });
      const actions = await buildSyncPlan(cwd, [syncer]);

      expect(actions).toHaveLength(1);
      expect(actions[0].kind).toBe("skip");
      if (actions[0].kind === "skip") {
        expect(actions[0].reason).toBe("no-change");
      }
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("returns skip(immutable) when a non-mutable non-revisioned resource has a changed hash", async () => {
    const cwd = makeCwd();
    try {
      await writeState(cwd, {
        framework: "next",
        resources: { ".zitadel/schemas/user.json": { id: "existing-id", hash: "old-hash" } },
      });
      await writeResource(cwd, ".zitadel/schemas", "user.json", { kind: "user-schema", v: 2 });

      const syncer = makeSyncer({ mutable: false, revisioned: false });
      const actions = await buildSyncPlan(cwd, [syncer]);

      expect(actions).toHaveLength(1);
      expect(actions[0].kind).toBe("skip");
      if (actions[0].kind === "skip") {
        expect(actions[0].reason).toBe("immutable");
      }
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("returns revise action when a revisioned resource has a changed hash", async () => {
    const cwd = makeCwd();
    try {
      await writeState(cwd, {
        framework: "next",
        resources: {
          ".zitadel/schemas/user.json": { id: "sch_A", hash: "old-hash" },
        },
      });
      await writeResource(cwd, ".zitadel/schemas", "user.json", { kind: "user-schema", v: 2 });
      await writeResource(cwd, ".zitadel/flows", "signin.json", {
        name: "signin",
        user_schema: "sch_A",
      });
      await writeResource(cwd, ".zitadel/flows", "signin-alt.json", {
        name: "signin-alt",
        user_schema: "sch_OTHER",
      });

      const syncer = makeSyncer({ revisioned: true });
      const actions = await buildSyncPlan(cwd, [syncer]);

      expect(actions).toHaveLength(1);
      expect(actions[0].kind).toBe("revise");
      if (actions[0].kind === "revise") {
        expect(actions[0].previousId).toBe("sch_A");
        expect(actions[0].affectedPaths).toEqual([".zitadel/flows/signin.json"]);
      }
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("returns skip(no-change) when mutable resource hash is unchanged", async () => {
    const cwd = makeCwd();
    try {
      const data = { kind: "flow-definition" };
      const { createHash } = await import("node:crypto");
      const hash = createHash("sha256").update(JSON.stringify(data)).digest("hex");
      await writeState(cwd, {
        framework: "next",
        resources: { ".zitadel/flows/default.json": { id: "flow-001", hash } },
      });
      await writeResource(cwd, ".zitadel/flows", "default.json", data);

      const syncer = makeSyncer({ directory: ".zitadel/flows", mutable: true });
      const actions = await buildSyncPlan(cwd, [syncer]);

      expect(actions).toHaveLength(1);
      expect(actions[0].kind).toBe("skip");
      if (actions[0].kind === "skip") {
        expect(actions[0].reason).toBe("no-change");
      }
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("returns update action when mutable resource hash changed", async () => {
    const cwd = makeCwd();
    try {
      await writeState(cwd, {
        framework: "next",
        resources: { ".zitadel/flows/default.json": { id: "flow-001", hash: "old-hash" } },
      });
      await writeResource(cwd, ".zitadel/flows", "default.json", { kind: "flow-definition", version: 2 });

      const syncer = makeSyncer({ directory: ".zitadel/flows", mutable: true });
      const actions = await buildSyncPlan(cwd, [syncer]);

      expect(actions).toHaveLength(1);
      expect(actions[0].kind).toBe("update");
      if (actions[0].kind === "update") {
        expect(actions[0].id).toBe("flow-001");
        expect(actions[0].path).toBe(".zitadel/flows/default.json");
      }
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("returns delete action when resource is in state but missing from disk", async () => {
    const cwd = makeCwd();
    try {
      await writeState(cwd, {
        framework: "next",
        resources: { ".zitadel/schemas/old.json": { id: "old-id", hash: "abc" } },
      });
      await mkdir(join(cwd, ".zitadel/schemas"), { recursive: true });

      const syncer = makeSyncer();
      const actions = await buildSyncPlan(cwd, [syncer]);

      expect(actions).toHaveLength(1);
      expect(actions[0].kind).toBe("delete");
      if (actions[0].kind === "delete") {
        expect(actions[0].id).toBe("old-id");
        expect(actions[0].path).toBe(".zitadel/schemas/old.json");
      }
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("fetches oldContent via syncer.fetch when fetchOld is enabled", async () => {
    const cwd = makeCwd();
    try {
      await writeState(cwd, {
        framework: "next",
        resources: { ".zitadel/schemas/old.json": { id: "old-id", hash: "abc" } },
      });
      await mkdir(join(cwd, ".zitadel/schemas"), { recursive: true });

      const fetchedContent = { kind: "user-schema", version: 1 };
      const fetchFn = vi.fn().mockResolvedValue(fetchedContent);
      const syncer = makeSyncer({ fetch: fetchFn });
      const actions = await buildSyncPlan(cwd, [syncer], true);

      expect(fetchFn).toHaveBeenCalledWith("old-id");
      expect(actions[0].kind).toBe("delete");
      if (actions[0].kind === "delete") {
        expect(actions[0].oldContent).toEqual(fetchedContent);
      }
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("leaves oldContent null when fetch throws", async () => {
    const cwd = makeCwd();
    try {
      await writeState(cwd, {
        framework: "next",
        resources: { ".zitadel/schemas/old.json": { id: "old-id", hash: "abc" } },
      });
      await mkdir(join(cwd, ".zitadel/schemas"), { recursive: true });

      const fetchFn = vi.fn().mockRejectedValue(new Error("network error"));
      const syncer = makeSyncer({ fetch: fetchFn });
      const actions = await buildSyncPlan(cwd, [syncer], true);

      expect(actions[0].kind).toBe("delete");
      if (actions[0].kind === "delete") {
        expect(actions[0].oldContent).toBeNull();
      }
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});

describe("buildSyncPlan validation (real syncers)", () => {
  it("fails the run when an on-disk schema is not a valid JSON Schema", async () => {
    const cwd = makeCwd();
    try {
      await writeState(cwd, { framework: "next", resources: {} });
      await writeResource(cwd, ".zitadel/schemas", "user.json", { type: 123 });

      await expect(
        buildSyncPlan(cwd, makeSyncers({ client, projectId: "proj-1", env: {} })),
      ).rejects.toMatchObject({ code: "E_VALIDATION" });
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("fails the run when an on-disk flow definition is malformed", async () => {
    const cwd = makeCwd();
    try {
      await writeState(cwd, { framework: "next", resources: {} });
      await writeResource(cwd, ".zitadel/flows", "default.json", { version: 99, kind: "wrong" });

      await expect(
        buildSyncPlan(cwd, makeSyncers({ client, projectId: "proj-1", env: {} })),
      ).rejects.toMatchObject({ code: "E_VALIDATION" });
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});

describe("runSyncLoop", () => {
  it("creates resource when no id in state", async () => {
    const cwd = makeCwd();
    try {
      await writeState(cwd, { framework: "next", resources: {} });
      await writeResource(cwd, ".zitadel/schemas", "user.json", { kind: "user-schema" });

      const syncer = makeSyncer();
      
      await runSyncLoop(cwd, [syncer]);

      expect(syncer.create).toHaveBeenCalledOnce();
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("skips immutable resource with unchanged hash without calling create/update", async () => {
    const cwd = makeCwd();
    try {
      const data = { kind: "user-schema" };
      const { createHash } = await import("node:crypto");
      const hash = createHash("sha256").update(JSON.stringify(data)).digest("hex");
      await writeState(cwd, {
        framework: "next",
        resources: {
          ".zitadel/schemas/user.json": { id: "existing-id", hash },
        },
      });
      await writeResource(cwd, ".zitadel/schemas", "user.json", data);

      const syncer = makeSyncer({ mutable: false });

      await runSyncLoop(cwd, [syncer]);

      expect(syncer.create).not.toHaveBeenCalled();
      expect(syncer.update).not.toHaveBeenCalled();
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("publishes a new revision (POST) when a revisioned resource changes on disk", async () => {
    const cwd = makeCwd();
    try {
      await writeState(cwd, {
        framework: "next",
        resources: {
          ".zitadel/schemas/user.json": { id: "sch_A", hash: "old-hash" },
        },
      });
      await writeResource(cwd, ".zitadel/schemas", "user.json", { kind: "user-schema", v: 2 });

      const syncer = makeSyncer({
        revisioned: true,
        create: vi.fn().mockResolvedValue({ id: "sch_B" }),
      });

      await runSyncLoop(cwd, [syncer]);

      expect(syncer.create).toHaveBeenCalledOnce();
      expect(syncer.update).not.toHaveBeenCalled();

      const state = JSON.parse(
        await (await import("node:fs/promises")).readFile(
          join(cwd, ".zitadel/state.json"),
          "utf8",
        ),
      ) as { resources: Record<string, { id: string }> };
      expect(state.resources[".zitadel/schemas/user.json"].id).toBe("sch_B");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("skips mutable resource when hash unchanged", async () => {
    const cwd = makeCwd();
    try {
      const data = { kind: "flow-definition" };
      const { createHash } = await import("node:crypto");
      const hash = createHash("sha256").update(JSON.stringify(data)).digest("hex");
      await writeState(cwd, {
        framework: "next",
        resources: { ".zitadel/flows/default.json": { id: "flow-001", hash } },
      });
      await writeResource(cwd, ".zitadel/flows", "default.json", data);

      const syncer = makeSyncer({ directory: ".zitadel/flows", mutable: true });
      
      await runSyncLoop(cwd, [syncer]);

      expect(syncer.update).not.toHaveBeenCalled();
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("updates mutable resource when hash changed", async () => {
    const cwd = makeCwd();
    try {
      await writeState(cwd, {
        framework: "next",
        resources: {
          ".zitadel/flows/default.json": { id: "flow-001", hash: "old-hash" },
        },
      });
      await writeResource(cwd, ".zitadel/flows", "default.json", { kind: "flow-definition", version: 2 });

      const syncer = makeSyncer({ directory: ".zitadel/flows", mutable: true });
      
      await runSyncLoop(cwd, [syncer]);

      expect(syncer.update).toHaveBeenCalledOnce();
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("deletes resource when file removed from disk but id in state", async () => {
    const cwd = makeCwd();
    try {
      await writeState(cwd, {
        framework: "next",
        resources: {
          ".zitadel/schemas/old.json": { id: "old-schema-id", hash: "abc" },
        },
      });
      await mkdir(join(cwd, ".zitadel/schemas"), { recursive: true });

      const syncer = makeSyncer();

      await runSyncLoop(cwd, [syncer]);

      expect(syncer.delete).toHaveBeenCalledWith("old-schema-id");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});

describe("normalized hashing and write-back", () => {
  it("skips when state holds a legacy hash even though the normalized hash differs", async () => {
    const cwd = makeCwd();
    try {
      const data = { name: "login", audience: {} };
      const { createHash } = await import("node:crypto");
      const legacyHash = createHash("sha256").update(JSON.stringify(data)).digest("hex");
      await writeState(cwd, {
        framework: "next",
        resources: { ".zitadel/flows/default.json": { id: "flow-001", hash: legacyHash } },
      });
      await writeResource(cwd, ".zitadel/flows", "default.json", data);

      const syncer = makeSyncer({
        directory: ".zitadel/flows",
        mutable: true,
        normalize: normalizeFlowBody,
      });
      const actions = await buildSyncPlan(cwd, [syncer]);

      // A legacy-format state hash must never read as an edit — a spurious
      // mismatch would publish an unintended update/revision.
      expect(actions[0].kind).toBe("skip");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("skips a reordered file whose legacy state hash was computed on sorted keys", async () => {
    const cwd = makeCwd();
    try {
      const { createHash } = await import("node:crypto");
      // Setup-era legacy hashes were sha256(JSON.stringify(...)) over
      // stably-sorted content; the user then reordered keys by hand.
      const sortedLegacyHash = createHash("sha256")
        .update(JSON.stringify({ a: 1, b: 2 }))
        .digest("hex");
      await writeState(cwd, {
        framework: "next",
        resources: { ".zitadel/flows/default.json": { id: "flow-001", hash: sortedLegacyHash } },
      });
      await writeResource(cwd, ".zitadel/flows", "default.json", { b: 2, a: 1 });

      const syncer = makeSyncer({ directory: ".zitadel/flows", mutable: true });
      const actions = await buildSyncPlan(cwd, [syncer]);

      expect(actions[0].kind).toBe("skip");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("skips when only key order differs from the hashed state", async () => {
    const cwd = makeCwd();
    try {
      const syncer = makeSyncer({ directory: ".zitadel/flows", mutable: true });
      const hash = hashForState(syncer, { a: 1, b: 2 });
      await writeState(cwd, {
        framework: "next",
        resources: { ".zitadel/flows/default.json": { id: "flow-001", hash } },
      });
      await writeResource(cwd, ".zitadel/flows", "default.json", { b: 2, a: 1 });

      const actions = await buildSyncPlan(cwd, [syncer]);

      expect(actions[0].kind).toBe("skip");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("skips when the file omits noise the hashed state was normalized over", async () => {
    const cwd = makeCwd();
    try {
      const syncer = makeSyncer({
        directory: ".zitadel/flows",
        mutable: true,
        normalize: normalizeFlowBody,
      });
      // State was seeded from a server body that carried `audience: {}`.
      const hash = hashForState(syncer, { name: "login", audience: {} });
      await writeState(cwd, {
        framework: "next",
        resources: { ".zitadel/flows/default.json": { id: "flow-001", hash } },
      });
      await writeResource(cwd, ".zitadel/flows", "default.json", { name: "login" });

      const actions = await buildSyncPlan(cwd, [syncer]);

      expect(actions[0].kind).toBe("skip");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("writes the canonical body back after an update and converges to an empty plan", async () => {
    const cwd = makeCwd();
    try {
      await writeState(cwd, {
        framework: "next",
        resources: { ".zitadel/flows/default.json": { id: "flow-001", hash: "old-hash" } },
      });
      await writeResource(cwd, ".zitadel/flows", "default.json", { name: "login", version: 2 });

      const syncer = makeSyncer({
        directory: ".zitadel/flows",
        mutable: true,
        normalize: normalizeFlowBody,
        normalizeWrite: normalizeFlowBody,
        update: vi.fn().mockResolvedValue({
          // Server canonicalized the body: echoed audience plus a defaulted field.
          canonical: { name: "login", version: 2, status: "active", audience: {} },
        }),
      });

      const { filesUpdated } = await runSyncLoop(cwd, [syncer]);

      expect(filesUpdated).toEqual([".zitadel/flows/default.json"]);
      const { readFile } = await import("node:fs/promises");
      const onDisk = JSON.parse(
        await readFile(join(cwd, ".zitadel/flows/default.json"), "utf8"),
      ) as Record<string, unknown>;
      // Write-back stores the normalized canonical form: server noise
      // (empty audience) stays out of the user's file.
      expect(onDisk).toEqual({ name: "login", version: 2, status: "active" });

      const actions = await buildSyncPlan(cwd, [syncer]);
      expect(actions.every((a) => a.kind === "skip")).toBe(true);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("write-back preserves spelled-out schema defaults (schemas have no normalizeWrite)", async () => {
    const cwd = makeCwd();
    try {
      await mkdir(join(cwd, ".zitadel/schemas"), { recursive: true });
      await writeFile(
        join(cwd, ".zitadel/schemas/user.json"),
        JSON.stringify({ kind: "user-schema" }),
      );
      // The live schema spells out a meta-schema default; the file the next
      // apply uploads must keep it, or the flag would vanish from the next
      // published revision (the server stores schema bytes verbatim).
      const canonical = {
        kind: "user-schema",
        title: "Canonical",
        properties: { email: { type: "string", "x-editable": true } },
      };

      const { changed } = await writeBackResource(
        cwd,
        ".zitadel/schemas/user.json",
        { normalize: normalizeSchemaBody },
        canonical,
      );

      expect(changed).toBe(true);
      const { readFile } = await import("node:fs/promises");
      const onDisk = JSON.parse(
        await readFile(join(cwd, ".zitadel/schemas/user.json"), "utf8"),
      ) as { properties: { email: Record<string, unknown> } };
      expect(onDisk.properties.email["x-editable"]).toBe(true);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("leaves the file untouched when the canonical body matches in normalized form", async () => {
    const cwd = makeCwd();
    try {
      await writeState(cwd, {
        framework: "next",
        resources: { ".zitadel/flows/default.json": { id: "flow-001", hash: "old-hash" } },
      });
      const raw = JSON.stringify({ version: 2, name: "login" });
      await mkdir(join(cwd, ".zitadel/flows"), { recursive: true });
      await writeFile(join(cwd, ".zitadel/flows/default.json"), raw);

      const syncer = makeSyncer({
        directory: ".zitadel/flows",
        mutable: true,
        normalize: normalizeFlowBody,
        normalizeWrite: normalizeFlowBody,
        update: vi.fn().mockResolvedValue({
          canonical: { name: "login", version: 2, audience: {} },
        }),
      });

      const { filesUpdated } = await runSyncLoop(cwd, [syncer]);

      expect(filesUpdated).toEqual([]);
      const { readFile } = await import("node:fs/promises");
      // Byte-identical: the churn guard skipped the rewrite.
      expect(await readFile(join(cwd, ".zitadel/flows/default.json"), "utf8")).toBe(raw);

      const actions = await buildSyncPlan(cwd, [syncer]);
      expect(actions.every((a) => a.kind === "skip")).toBe(true);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});

describe("auto-repin on schema revise", () => {
  const FLOW_PATH = ".zitadel/flows/default.json";
  const SCHEMA_PATH = ".zitadel/schemas/user.json";

  function makeFlowSyncer(overrides: Partial<ResourceSyncer> = {}): ResourceSyncer {
    return makeSyncer({
      kind: "flow",
      directory: ".zitadel/flows",
      mutable: true,
      normalize: normalizeFlowBody,
      normalizeWrite: normalizeFlowBody,
      ...overrides,
    });
  }

  function makeSchemaSyncer(overrides: Partial<ResourceSyncer> = {}): ResourceSyncer {
    return makeSyncer({
      revisioned: true,
      create: vi.fn().mockResolvedValue({ id: "sch_B" }),
      ...overrides,
    });
  }

  async function readJson(path: string): Promise<Record<string, unknown>> {
    const { readFile } = await import("node:fs/promises");
    return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  }

  it("re-pins an edited flow and updates it with the new revision in one apply", async () => {
    const cwd = makeCwd();
    try {
      await writeState(cwd, {
        framework: "next",
        resources: {
          [SCHEMA_PATH]: { id: "sch_A", hash: "stale" },
          [FLOW_PATH]: { id: "flow-001", hash: "stale" },
        },
      });
      await writeResource(cwd, ".zitadel/schemas", "user.json", { kind: "user-schema", v: 2 });
      await writeResource(cwd, ".zitadel/flows", "default.json", {
        name: "login",
        user_schema: "sch_A",
        version: 2,
      });

      const schemaSyncer = makeSchemaSyncer();
      const update = vi.fn().mockResolvedValue({});
      const flowSyncer = makeFlowSyncer({ update });

      const { filesUpdated } = await runSyncLoop(cwd, [schemaSyncer, flowSyncer]);

      // The wire request adopted the new revision without a second apply.
      expect(update).toHaveBeenCalledWith(
        "flow-001",
        expect.objectContaining({ user_schema: "sch_B" }),
      );
      const flowFile = await readJson(join(cwd, FLOW_PATH));
      expect(flowFile.user_schema).toBe("sch_B");
      expect(filesUpdated).toContain(FLOW_PATH);

      const state = await readJson(join(cwd, ".zitadel/state.json"));
      const resources = state.resources as Record<string, { id?: string; previousId?: string }>;
      expect(resources[SCHEMA_PATH]?.id).toBe("sch_B");
      // The re-pin completed, so the recovery marker is cleaned up — a later
      // deliberate pin of sch_A must not be force-bumped.
      expect(resources[SCHEMA_PATH]?.previousId).toBeUndefined();

      const followUp = await buildSyncPlan(cwd, [schemaSyncer, flowSyncer]);
      expect(followUp.every((a) => a.kind === "skip")).toBe(true);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("emits a repin update for an untouched flow pinned to a revised schema", async () => {
    const cwd = makeCwd();
    try {
      const flowSyncer = makeFlowSyncer({ update: vi.fn().mockResolvedValue({}) });
      const flowBody = { name: "login", user_schema: "sch_A" };
      await writeState(cwd, {
        framework: "next",
        resources: {
          [SCHEMA_PATH]: { id: "sch_A", hash: "stale" },
          [FLOW_PATH]: { id: "flow-001", hash: hashForState(flowSyncer, flowBody) },
        },
      });
      await writeResource(cwd, ".zitadel/schemas", "user.json", { kind: "user-schema", v: 2 });
      await writeResource(cwd, ".zitadel/flows", "default.json", flowBody);

      const schemaSyncer = makeSchemaSyncer();
      const actions = await buildSyncPlan(cwd, [schemaSyncer, flowSyncer]);
      const flowAction = actions.find((a) => a.path === FLOW_PATH);
      expect(flowAction?.kind).toBe("update");
      if (flowAction?.kind === "update") {
        expect(flowAction.repin).toEqual({ previousId: "sch_A", schemaPath: SCHEMA_PATH });
      }

      await runSyncLoop(cwd, [schemaSyncer, flowSyncer]);
      const flowFile = await readJson(join(cwd, FLOW_PATH));
      expect(flowFile.user_schema).toBe("sch_B");

      const followUp = await buildSyncPlan(cwd, [schemaSyncer, flowSyncer]);
      expect(followUp.every((a) => a.kind === "skip")).toBe(true);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("recovers a re-pin from state.previousId when a prior run died mid-apply", async () => {
    const cwd = makeCwd();
    try {
      const flowSyncer = makeFlowSyncer({ update: vi.fn().mockResolvedValue({}) });
      const schemaSyncer = makeSchemaSyncer({
        create: vi.fn().mockRejectedValue(new Error("must not revise again")),
      });
      const schemaBody = { kind: "user-schema", v: 2 };
      const flowBody = { name: "login", user_schema: "sch_A" };
      // A previous apply published sch_B (state advanced, previousId kept)
      // but died before rewriting the flow.
      await writeState(cwd, {
        framework: "next",
        resources: {
          [SCHEMA_PATH]: {
            id: "sch_B",
            previousId: "sch_A",
            hash: hashForState(schemaSyncer, schemaBody),
          },
          [FLOW_PATH]: { id: "flow-001", hash: hashForState(flowSyncer, flowBody) },
        },
      });
      await writeResource(cwd, ".zitadel/schemas", "user.json", schemaBody);
      await writeResource(cwd, ".zitadel/flows", "default.json", flowBody);

      const actions = await buildSyncPlan(cwd, [schemaSyncer, flowSyncer]);
      const flowAction = actions.find((a) => a.path === FLOW_PATH);
      expect(flowAction?.kind).toBe("update");
      if (flowAction?.kind === "update") {
        expect(flowAction.repin).toEqual({
          previousId: "sch_A",
          schemaPath: SCHEMA_PATH,
          newId: "sch_B",
        });
      }

      await runSyncLoop(cwd, [schemaSyncer, flowSyncer]);
      expect(schemaSyncer.create).not.toHaveBeenCalled();
      const flowFile = await readJson(join(cwd, FLOW_PATH));
      expect(flowFile.user_schema).toBe("sch_B");

      const followUp = await buildSyncPlan(cwd, [schemaSyncer, flowSyncer]);
      expect(followUp.every((a) => a.kind === "skip")).toBe(true);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("re-pins every flow pinned to the revised schema, including URL-form ids", async () => {
    const cwd = makeCwd();
    try {
      const urlId = "https://example.test/api/schemas/human.json";
      await writeState(cwd, {
        framework: "next",
        resources: {
          [SCHEMA_PATH]: { id: urlId, hash: "stale" },
          [FLOW_PATH]: { id: "flow-001", hash: "stale" },
          ".zitadel/flows/admin.json": { id: "flow-002", hash: "stale" },
        },
      });
      await writeResource(cwd, ".zitadel/schemas", "user.json", { kind: "user-schema", v: 2 });
      await writeResource(cwd, ".zitadel/flows", "default.json", {
        name: "login",
        user_schema: urlId,
        version: 2,
      });
      await writeResource(cwd, ".zitadel/flows", "admin.json", {
        name: "admin",
        user_schema: urlId,
        version: 2,
      });

      const schemaSyncer = makeSchemaSyncer();
      const update = vi.fn().mockResolvedValue({});
      const flowSyncer = makeFlowSyncer({ update });

      await runSyncLoop(cwd, [schemaSyncer, flowSyncer]);

      expect((await readJson(join(cwd, FLOW_PATH))).user_schema).toBe("sch_B");
      expect((await readJson(join(cwd, ".zitadel/flows/admin.json"))).user_schema).toBe("sch_B");
      expect(update).toHaveBeenCalledTimes(2);
      for (const call of update.mock.calls) {
        expect((call[1] as { user_schema: string }).user_schema).toBe("sch_B");
      }
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("creates a new flow with the revision minted in the same run, not its stale pin", async () => {
    const cwd = makeCwd();
    try {
      // The flow file is brand new (no state entry) and pins the schema id
      // that this same run supersedes.
      await writeState(cwd, {
        framework: "next",
        resources: { [SCHEMA_PATH]: { id: "sch_A", hash: "stale" } },
      });
      await writeResource(cwd, ".zitadel/schemas", "user.json", { kind: "user-schema", v: 2 });
      await writeResource(cwd, ".zitadel/flows", "default.json", {
        name: "login",
        user_schema: "sch_A",
      });

      const schemaSyncer = makeSchemaSyncer();
      const create = vi.fn().mockResolvedValue({ id: "flow-001" });
      const flowSyncer = makeFlowSyncer({ create });

      await runSyncLoop(cwd, [schemaSyncer, flowSyncer]);

      expect(create).toHaveBeenCalledWith(expect.objectContaining({ user_schema: "sch_B" }));
      expect((await readJson(join(cwd, FLOW_PATH))).user_schema).toBe("sch_B");

      const followUp = await buildSyncPlan(cwd, [schemaSyncer, flowSyncer]);
      expect(followUp.every((a) => a.kind === "skip")).toBe(true);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("does not let a stale canonical echo revert a re-pinned file on flow create", async () => {
    const cwd = makeCwd();
    try {
      await writeState(cwd, {
        framework: "next",
        resources: { [SCHEMA_PATH]: { id: "sch_A", hash: "stale" } },
      });
      await writeResource(cwd, ".zitadel/schemas", "user.json", { kind: "user-schema", v: 2 });
      await writeResource(cwd, ".zitadel/flows", "default.json", {
        name: "login",
        user_schema: "sch_A",
      });

      const schemaSyncer = makeSchemaSyncer();
      // The server echoes back exactly what was POSTed — which must already
      // carry the new pin, so write-back cannot resurrect sch_A.
      const create = vi.fn().mockImplementation(async (body: object) => ({
        id: "flow-001",
        canonical: structuredClone(body),
      }));
      const flowSyncer = makeFlowSyncer({ create });

      await runSyncLoop(cwd, [schemaSyncer, flowSyncer]);

      expect((await readJson(join(cwd, FLOW_PATH))).user_schema).toBe("sch_B");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("rejects the whole plan when a re-pinned flow references a property the edited schema dropped", async () => {
    const cwd = makeCwd();
    try {
      const flowSyncer = makeFlowSyncer();
      const flowBody = {
        name: "login",
        user_schema: "sch_A",
        steps: [
          { name: "register", fields: ["email", "company", "x-auth-methods#password"] },
        ],
      };
      await writeState(cwd, {
        framework: "next",
        resources: {
          [SCHEMA_PATH]: { id: "sch_A", hash: "stale" },
          [FLOW_PATH]: { id: "flow-001", hash: hashForState(flowSyncer, flowBody) },
        },
      });
      // The edit renamed `company` away — the untouched flow still lists it.
      await writeResource(cwd, ".zitadel/schemas", "user.json", {
        kind: "user-schema",
        properties: { email: { type: "string" }, companyName: { type: "string" } },
      });
      await writeResource(cwd, ".zitadel/flows", "default.json", flowBody);

      const schemaSyncer = makeSchemaSyncer();
      // Fails at plan time — before any revision is published — naming the
      // flow and the missing field; credential tokens are not checked.
      await expect(buildSyncPlan(cwd, [schemaSyncer, flowSyncer])).rejects.toMatchObject({
        code: "E_VALIDATION",
        message: expect.stringContaining('"company"'),
      });
      await expect(buildSyncPlan(cwd, [schemaSyncer, flowSyncer])).rejects.toMatchObject({
        message: expect.stringContaining(FLOW_PATH),
      });
      expect(schemaSyncer.create).not.toHaveBeenCalled();
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("allows the re-pin when every plain flow field exists in the edited schema", async () => {
    const cwd = makeCwd();
    try {
      const flowSyncer = makeFlowSyncer({ update: vi.fn().mockResolvedValue({}) });
      const flowBody = {
        name: "login",
        user_schema: "sch_A",
        steps: [{ name: "register", fields: ["email", "x-auth-methods#password"] }],
      };
      await writeState(cwd, {
        framework: "next",
        resources: {
          [SCHEMA_PATH]: { id: "sch_A", hash: "stale" },
          [FLOW_PATH]: { id: "flow-001", hash: hashForState(flowSyncer, flowBody) },
        },
      });
      await writeResource(cwd, ".zitadel/schemas", "user.json", {
        kind: "user-schema",
        properties: { email: { type: "string" }, company: { type: "string" } },
      });
      await writeResource(cwd, ".zitadel/flows", "default.json", flowBody);

      const actions = await buildSyncPlan(cwd, [makeSchemaSyncer(), flowSyncer]);
      expect(actions.find((a) => a.path === FLOW_PATH)?.kind).toBe("update");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("plan (buildSyncPlan) never writes files, even with a pending re-pin", async () => {
    const cwd = makeCwd();
    try {
      await writeState(cwd, {
        framework: "next",
        resources: {
          [SCHEMA_PATH]: { id: "sch_A", hash: "stale" },
          [FLOW_PATH]: { id: "flow-001", hash: "stale" },
        },
      });
      await writeResource(cwd, ".zitadel/schemas", "user.json", { kind: "user-schema", v: 2 });
      const rawFlow = JSON.stringify({ name: "login", user_schema: "sch_A", version: 2 });
      await mkdir(join(cwd, ".zitadel/flows"), { recursive: true });
      await writeFile(join(cwd, FLOW_PATH), rawFlow);

      await buildSyncPlan(cwd, [makeSchemaSyncer(), makeFlowSyncer()]);

      const { readFile } = await import("node:fs/promises");
      expect(await readFile(join(cwd, FLOW_PATH), "utf8")).toBe(rawFlow);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
