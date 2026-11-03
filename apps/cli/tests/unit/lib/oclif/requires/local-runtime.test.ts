import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { DEFAULT_LOCAL_SERVER_URL } from "../../../../../src/lib/local-server/runtime";
import { recordedRuntime } from "../../../../../src/lib/oclif/requires/local-runtime";

const dirs: string[] = [];

afterEach(async () => {
  while (dirs.length > 0) {
    await rm(dirs.pop() as string, { recursive: true, force: true });
  }
});

describe("recordedRuntime", () => {
  it("is found as nothing, not refused, where no server was started", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "zitadel-recorded-"));
    dirs.push(cwd);

    const found = await recordedRuntime.resolve({
      flags: {},
      args: {},
      meta: { cwd } as never,
      connect: () => Promise.reject(new Error("no connection")),
      resolved: {},
    });

    expect(found).toEqual({ runtime: undefined });
    expect(recordedRuntime.refusal).toBeUndefined();
    expect(recordedRuntime.source?.({ runtime: undefined })).toBe(DEFAULT_LOCAL_SERVER_URL);
  });
});
