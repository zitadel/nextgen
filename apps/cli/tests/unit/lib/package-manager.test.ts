import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  detectPackageManager,
  devCommandFor,
  installCommandFor,
  type PackageManager,
} from "../../../src/lib/package-manager";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempProject(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "zitadel-pm-"));
  dirs.push(dir);
  await writeFile(join(dir, "package.json"), JSON.stringify({ name: "demo" }));
  return dir;
}

describe("package manager detection", () => {
  it("prefers package.json#packageManager over lockfiles", async () => {
    const cwd = await tempProject();
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "demo", packageManager: "pnpm@10.33.2" }),
    );
    await writeFile(join(cwd, "package-lock.json"), "{}");

    expect(await detectPackageManager(cwd)).toBe("pnpm");
  });

  it.each([
    ["pnpm-lock.yaml", "pnpm"],
    ["yarn.lock", "yarn"],
    ["bun.lock", "bun"],
    ["bun.lockb", "bun"],
    ["package-lock.json", "npm"],
  ] satisfies Array<[string, PackageManager]>)("detects %s", async (file, expected) => {
    const cwd = await tempProject();
    await writeFile(join(cwd, file), "");

    expect(await detectPackageManager(cwd)).toBe(expected);
  });

  it("falls back to npm", async () => {
    expect(await detectPackageManager(await tempProject())).toBe("npm");
  });
});

describe("package manager commands", () => {
  it.each([
    ["npm", "npm install", "npm run dev"],
    ["pnpm", "pnpm install", "pnpm dev"],
    ["yarn", "yarn install", "yarn dev"],
    ["bun", "bun install", "bun run dev"],
  ] satisfies Array<[PackageManager, string, string]>)(
    "maps %s commands",
    (packageManager, install, dev) => {
      expect(installCommandFor(packageManager).display).toBe(install);
      expect(devCommandFor(packageManager).display).toBe(dev);
    },
  );
});
