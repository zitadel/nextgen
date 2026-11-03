import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { GlobalOptions } from "../../../../../src/lib/oclif";
import { developmentIssuer } from "../../../../../src/lib/oclif/requires/environment";

async function projectWith(envFile: string | undefined): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "zitadel-issuer-"));
  await mkdir(join(cwd, ".zitadel"), { recursive: true });
  if (envFile !== undefined) {
    await writeFile(join(cwd, ".env.local"), envFile);
  }
  return cwd;
}

function contextFor(cwd: string) {
  return {
    flags: {},
    args: {},
    meta: {
      cwd,
    } as GlobalOptions,
    resolved: {},
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("developmentIssuer", () => {
  it("is the issuer the environment names", async () => {
    vi.stubEnv("ZITADEL_ISSUER", "");
    const cwd = await projectWith("ZITADEL_ISSUER=http://localhost:3000\n");

    expect(await developmentIssuer.resolve(contextFor(cwd))).toBe("http://localhost:3000");
  });

  it("is nothing for a Project that was never set up", async () => {
    vi.stubEnv("ZITADEL_ISSUER", "");
    const cwd = await projectWith(undefined);

    expect(await developmentIssuer.resolve(contextFor(cwd))).toBeFalsy();
  });

  it("refuses with the next move", () => {
    expect(developmentIssuer.refusal).toEqual({
      message: "This Project has no development issuer",
      hint: "Run `zitadel setup` first, or set ZITADEL_ISSUER to the origin your app serves from.",
    });
  });
});
