import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ZitadelClient } from "@zitadel/api/client";
import { DEFAULT_SCHEMA_CONFIG_PATH } from "@zitadel/config/defaults";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { materializeSetupResources } from "../../../src/lib/setup-resources";
import type { ZitadelState } from "../../../src/lib/sync/types";

let cwd: string;

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), "zitadel-setup-resources-"));
  await mkdir(join(cwd, ".zitadel"), { recursive: true });
  await writeFile(
    join(cwd, ".zitadel/state.json"),
    JSON.stringify({
      framework: "next",
      resources: {},
    }),
  );
});

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

describe("materializeSetupResources", () => {
  it("persists schema state before creating the flow so apply can recover partial setup", async () => {
    const client = {
      createSchema: vi.fn().mockResolvedValue({
        id: "https://nextgen.com/api/schemas/default-human-user.json",
      }),
      createFlowDefinition: vi.fn().mockRejectedValue(new Error("flow create failed")),
    } as unknown as ZitadelClient;

    await expect(
      materializeSetupResources({
        cwd,
        client,
        projectId: "project_123",
        force: false,
      }),
    ).rejects.toThrow("flow create failed");

    const state = JSON.parse(
      await readFile(join(cwd, ".zitadel/state.json"), "utf8"),
    ) as ZitadelState;
    expect(state.resources[DEFAULT_SCHEMA_CONFIG_PATH]).toMatchObject({
      id: "https://nextgen.com/api/schemas/default-human-user.json",
      hash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
  });
});
