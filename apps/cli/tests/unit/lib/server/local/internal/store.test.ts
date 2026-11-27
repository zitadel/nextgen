import { describe, expect } from "vitest";

import { RuntimeFileStore } from "@/lib/server/local";
import { writeRuntimeMetadata } from "@/lib/server/local";
import { it } from "@tests/fixtures";
import { aBinaryRecord, aDockerRecord } from "@tests/helpers/runtime-record";

describe("RuntimeFileStore", () => {
  it("reads back what it wrote", async ({ dir: cwd }) => {
    const store = new RuntimeFileStore(cwd, "binary");

    await store.write(aBinaryRecord({ pid: 4242, port: 8081 }));

    await expect(store.read()).resolves.toMatchObject({ pid: 4242, port: 8081 });
  });

  it("reads nothing from a directory that has no record", async ({ dir }) => {
    await expect(new RuntimeFileStore(dir, "binary").read()).resolves.toBeUndefined();
  });

  it("does not treat a Docker record as a binary server", async ({ dir: cwd }) => {
    const docker = aDockerRecord();
    await writeRuntimeMetadata(cwd, docker);

    await expect(new RuntimeFileStore(cwd, "binary").read()).resolves.toBeUndefined();
  });
});
