import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { deployReason } from "../../../../../src/lib/oclif/requires/deploy-message";

const dirs: string[] = [];

afterEach(async () => {
  while (dirs.length > 0) {
    await rm(dirs.pop() as string, { recursive: true, force: true });
  }
});

async function context(
  flags: Record<string, unknown>,
  meta: { dryRun: boolean; nonInteractive: boolean },
) {
  const cwd = await mkdtemp(join(tmpdir(), "zitadel-reason-"));
  dirs.push(cwd);
  return {
    flags,
    args: {},
    meta: { ...meta, cwd, env: {} } as never,
    connect: () => Promise.reject(new Error("no connection")),
    resolved: {},
  };
}

describe("deployReason", () => {
  it("is the message that was given", async () => {
    const given = await context({ message: "ship it" }, { dryRun: false, nonInteractive: true });

    await expect(deployReason.resolve(given)).resolves.toEqual({ message: "ship it" });
  });

  it("may be left off when someone can be asked", async () => {
    const given = await context({}, { dryRun: false, nonInteractive: false });

    await expect(deployReason.resolve(given)).resolves.toEqual({ message: undefined });
  });

  it("is refused when nobody can be asked and nothing implies one", async () => {
    const given = await context({}, { dryRun: false, nonInteractive: true });

    await expect(deployReason.resolve(given)).resolves.toBeUndefined();
    expect(deployReason.refusal?.message).toBe("A deploy needs a message in non-interactive mode");
  });

  it("is not needed by a dry run, which records nothing", async () => {
    const given = await context({}, { dryRun: true, nonInteractive: true });

    await expect(deployReason.resolve(given)).resolves.toEqual({ message: undefined });
  });
});
