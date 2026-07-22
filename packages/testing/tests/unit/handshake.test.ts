import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { readHandshakeSync, waitForHandshake, writeHandshake } from "../../src/handshake";
import type { InstanceHandle } from "../../src/types";

const handle: InstanceHandle = {
  baseUrl: "http://localhost:8092",
  projectId: "proj_1",
  projectSecret: "secret_1",
  schemaId: "sch_1",
  previewSecret: "preview_1",
};

describe("handshake", () => {
  it("round-trips a handle, creating parent dirs", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zitadel-testing-handshake-"));
    const path = join(dir, "nested", "handshake.json");
    await writeHandshake(path, handle);
    expect(readHandshakeSync(path)).toEqual(handle);
  });

  it("rejects handles with missing fields", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zitadel-testing-handshake-"));
    const path = join(dir, "handshake.json");
    await writeFile(path, JSON.stringify({ baseUrl: "http://localhost:1" }));
    expect(() => readHandshakeSync(path)).toThrow(/missing "projectId"/);
  });

  it("reports the handshake path when JSON is malformed", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zitadel-testing-handshake-"));
    const path = join(dir, "handshake.json");
    await writeFile(path, "not json");

    let error: Error | undefined;
    try {
      readHandshakeSync(path);
    } catch (caught) {
      error = caught as Error;
    }

    expect(error?.message).toContain(path);
    expect(error?.cause).toBeInstanceOf(SyntaxError);
  });

  it("rejects handles with a malformed baseUrl", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zitadel-testing-handshake-"));
    const path = join(dir, "handshake.json");
    await writeFile(path, JSON.stringify({ ...handle, baseUrl: "not a url" }));
    expect(() => readHandshakeSync(path)).toThrow(/malformed "baseUrl"/);
  });

  it("waitForHandshake resolves once the file appears", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zitadel-testing-handshake-"));
    const path = join(dir, "handshake.json");
    const pending = waitForHandshake(path, 5_000);
    setTimeout(() => {
      void writeHandshake(path, handle);
    }, 300);
    await expect(pending).resolves.toEqual(handle);
  });

  it("waitForHandshake times out with the path in the error", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zitadel-testing-handshake-"));
    const path = join(dir, "never.json");
    await expect(waitForHandshake(path, 300)).rejects.toThrow(path);
  });
});
