import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it, vi } from "vitest";

import { buildSyncPlan, runSyncLoop } from "../../../../src/lib/sync/loop";
import { makeSyncers } from "../../../../src/lib/sync/syncers";
import type { ResourceSyncer } from "../../../../src/lib/sync/syncers";

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
    validate: vi.fn(),
    create: vi.fn().mockResolvedValue("created-id"),
    update: vi.fn().mockResolvedValue(undefined),
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

  it("returns skip(immutable) when immutable resource already has an id in state", async () => {
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
        expect(actions[0].reason).toBe("immutable");
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
        buildSyncPlan(cwd, makeSyncers({ projectId: "proj-1", env: {} })),
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
        buildSyncPlan(cwd, makeSyncers({ projectId: "proj-1", env: {} })),
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

  it("skips immutable resource when id already in state", async () => {
    const cwd = makeCwd();
    try {
      const data = { kind: "user-schema" };
      await writeState(cwd, {
        framework: "next",
        resources: {
          ".zitadel/schemas/user.json": { id: "existing-id", hash: "anything" },
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
