import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it, vi } from "vitest";

import { runSyncLoop } from "../../src/sync/loop";
import type { ResourceSyncer } from "../../src/sync/syncers";
import type { PlatformClient } from "../../src/platform/client";

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

function makeClient(): PlatformClient {
  return {
    createProject: vi.fn(),
    getProject: vi.fn(),
    uploadConfig: vi.fn(),
    getConfig: vi.fn(),
    createSchema: vi.fn().mockResolvedValue({ id: "schema-001" }),
    deleteSchema: vi.fn().mockResolvedValue(undefined),
    createFlowDefinition: vi.fn().mockResolvedValue({ id: "flow-001" }),
    updateFlowDefinition: vi.fn().mockResolvedValue(undefined),
    deleteFlowDefinition: vi.fn().mockResolvedValue(undefined),
    initClaim: vi.fn(),
    getClaimStatus: vi.fn(),
    getCapabilities: vi.fn(),
  } as unknown as PlatformClient;
}

function makeSyncer(overrides: Partial<ResourceSyncer> = {}): ResourceSyncer {
  return {
    directory: ".zitadel/schemas",
    mutable: false,
    create: vi.fn().mockResolvedValue("created-id"),
    update: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("runSyncLoop", () => {
  it("creates resource when no id in state", async () => {
    const cwd = makeCwd();
    try {
      await writeState(cwd, { framework: "next", resources: {} });
      await writeResource(cwd, ".zitadel/schemas", "user.json", { kind: "user-schema" });

      const syncer = makeSyncer();
      const client = makeClient();
      await runSyncLoop(cwd, client, [syncer]);

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
      const client = makeClient();
      await runSyncLoop(cwd, client, [syncer]);

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
      const client = makeClient();
      await runSyncLoop(cwd, client, [syncer]);

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
      const client = makeClient();
      await runSyncLoop(cwd, client, [syncer]);

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
      const client = makeClient();
      await runSyncLoop(cwd, client, [syncer]);

      expect(syncer.delete).toHaveBeenCalledWith(client, "old-schema-id");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
