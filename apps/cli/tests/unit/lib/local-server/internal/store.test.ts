import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { RuntimeFileStore } from "../../../../../src/lib/local-server/internal/store";
import { writeRuntimeMetadata } from "../../../../../src/lib/local-server/runtime";
import { aBinaryRecord, aDockerRecord } from "../../../../helpers/runtime-record";

const dirs: string[] = [];

afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe("RuntimeFileStore", () => {
  async function folder(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "zitadel-store-"));
    dirs.push(dir);
    return dir;
  }

  it("reads back what it wrote", async () => {
    const cwd = await folder();
    const store = new RuntimeFileStore(cwd, "binary");

    await store.write(aBinaryRecord({ pid: 4242, port: 8081 }));

    await expect(store.read()).resolves.toMatchObject({ pid: 4242, port: 8081 });
  });

  it("reads nothing from a directory that has no record", async () => {
    await expect(new RuntimeFileStore(await folder(), "binary").read()).resolves.toBeUndefined();
  });

  it("does not treat a Docker record as a binary server", async () => {
    const cwd = await folder();
    const docker = aDockerRecord();
    await writeRuntimeMetadata(cwd, docker);

    await expect(new RuntimeFileStore(cwd, "binary").read()).resolves.toBeUndefined();
  });
});
