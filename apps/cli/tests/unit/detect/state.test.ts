import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { hasZitadelConfig, hasZitadelSecret } from "../../../src/detect/state";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "zitadel-state-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("hasZitadelConfig", () => {
  it("returns true when zitadel.json exists", async () => {
    await writeFile(join(dir, "zitadel.json"), "{}");
    expect(await hasZitadelConfig(dir)).toBe(true);
  });

  it("returns false when zitadel.json is missing (ENOENT)", async () => {
    expect(await hasZitadelConfig(dir)).toBe(false);
  });
});

describe("hasZitadelSecret", () => {
  it("returns true when .zitadel/secret exists", async () => {
    await mkdir(join(dir, ".zitadel"), { recursive: true });
    await writeFile(join(dir, ".zitadel", "secret"), "shh");
    expect(await hasZitadelSecret(dir)).toBe(true);
  });

  it("returns false when .zitadel/secret is missing (ENOENT)", async () => {
    expect(await hasZitadelSecret(dir)).toBe(false);
  });

  it("returns false when the .zitadel directory exists but the secret does not", async () => {
    await mkdir(join(dir, ".zitadel"), { recursive: true });
    expect(await hasZitadelSecret(dir)).toBe(false);
  });
});
