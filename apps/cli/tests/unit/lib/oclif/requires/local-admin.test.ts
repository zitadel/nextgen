import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { localAdmin } from "../../../../../src/lib/oclif/requires/local-admin";

const dirs: string[] = [];

afterEach(async () => {
  while (dirs.length > 0) {
    await rm(dirs.pop() as string, { recursive: true, force: true });
  }
});

describe("localAdmin", () => {
  it("finds nothing where `start` never created an admin, and refuses naming start", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "zitadel-admin-"));
    dirs.push(cwd);

    const found = await localAdmin.resolve({
      flags: {},
      args: {},
      meta: { cwd } as never,
      connect: () => Promise.reject(new Error("no connection")),
      resolved: {},
    });

    expect(found).toBeUndefined();
    expect(localAdmin.refusal).toMatchObject({
      message: "No local admin in this directory or its parents",
      next: ["start"],
    });
  });
});
