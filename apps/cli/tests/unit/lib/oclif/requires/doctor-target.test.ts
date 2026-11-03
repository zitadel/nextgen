import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { DEFAULT_LOCAL_SERVER_PORT } from "../../../../../src/lib/local-server/runtime";
import { doctorTarget } from "../../../../../src/lib/oclif/requires/doctor-target";

type Target = {
  port: number;
  hostedServer: string | undefined;
};

const dirs: string[] = [];

afterEach(async () => {
  while (dirs.length > 0) {
    await rm(dirs.pop() as string, { recursive: true, force: true });
  }
});

async function context(flags: Record<string, unknown>) {
  const cwd = await mkdtemp(join(tmpdir(), "zitadel-doctor-"));
  dirs.push(cwd);
  return {
    flags,
    args: {},
    meta: { cwd } as never,
    connect: () => Promise.reject(new Error("no connection")),
    resolved: {},
  };
}

describe("doctorTarget", () => {
  it("is the default local port where nothing was started and no port was asked for", async () => {
    const found = (await doctorTarget.resolve(await context({}))) as Target;

    expect(found).toEqual({ port: DEFAULT_LOCAL_SERVER_PORT, hostedServer: undefined });
    expect(doctorTarget.source?.(found)).toBe(`http://localhost:${DEFAULT_LOCAL_SERVER_PORT}`);
  });

  it("is the port that was asked for", async () => {
    const found = (await doctorTarget.resolve(await context({ port: 9090 }))) as Target;

    expect(found.port).toBe(9090);
  });
});
