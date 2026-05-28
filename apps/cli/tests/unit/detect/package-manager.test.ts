import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { detectPackageManager } from "../../../src/detect/package-manager";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "zitadel-package-manager-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("detectPackageManager", () => {
  it("defaults to npm when no lockfile is present", async () => {
    expect(await detectPackageManager(dir)).toBe("npm");
  });

  it("detects pnpm from pnpm-lock.yaml", async () => {
    await writeFile(join(dir, "pnpm-lock.yaml"), "");
    expect(await detectPackageManager(dir)).toBe("pnpm");
  });

  it("detects yarn from yarn.lock", async () => {
    await writeFile(join(dir, "yarn.lock"), "");
    expect(await detectPackageManager(dir)).toBe("yarn");
  });

  it("detects bun from bun.lockb", async () => {
    await writeFile(join(dir, "bun.lockb"), "");
    expect(await detectPackageManager(dir)).toBe("bun");
  });

  it("detects npm from package-lock.json", async () => {
    await writeFile(join(dir, "package-lock.json"), "");
    expect(await detectPackageManager(dir)).toBe("npm");
  });

  it("prefers pnpm over yarn when both lockfiles exist", async () => {
    await writeFile(join(dir, "pnpm-lock.yaml"), "");
    await writeFile(join(dir, "yarn.lock"), "");
    expect(await detectPackageManager(dir)).toBe("pnpm");
  });

  it("prefers yarn over bun when both lockfiles exist", async () => {
    await writeFile(join(dir, "yarn.lock"), "");
    await writeFile(join(dir, "bun.lockb"), "");
    expect(await detectPackageManager(dir)).toBe("yarn");
  });

  it("prefers bun over package-lock.json when both lockfiles exist", async () => {
    await writeFile(join(dir, "bun.lockb"), "");
    await writeFile(join(dir, "package-lock.json"), "");
    expect(await detectPackageManager(dir)).toBe("bun");
  });
});
