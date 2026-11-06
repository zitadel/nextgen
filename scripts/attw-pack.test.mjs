import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { main } from "./attw-pack.mjs";

describe("attw-pack", () => {
  it("packs with pnpm and runs attw on the tarball, never npm pack", async () => {
    const packDir = mkdtempSync(join(tmpdir(), "zitadel-attw-test-"));
    writeFileSync(join(packDir, "zitadel-api-0.0.0.tgz"), "");
    const calls = [];
    const run = vi.fn(async (command, args) => {
      calls.push([command, ...args]);
      return { code: 0 };
    });

    await main({
      args: ["--profile=esm-only"],
      cwd: "/pkg",
      env: process.env,
      packDir,
      repoRoot: "/repo",
      run,
    });

    expect(calls).toEqual([
      ["corepack", "pnpm", "pack", "--pack-destination", packDir],
      [
        "corepack",
        "pnpm",
        "exec",
        "attw",
        join(packDir, "zitadel-api-0.0.0.tgz"),
        "--profile=esm-only",
      ],
    ]);
    expect(calls.flat().join(" ")).not.toMatch(/\bnpm\b/);
  });

  it("fails when pnpm pack leaves no tarball", async () => {
    const packDir = mkdtempSync(join(tmpdir(), "zitadel-attw-empty-"));
    await expect(
      main({
        args: [],
        packDir,
        run: async () => ({ code: 0 }),
      }),
    ).rejects.toThrow(/did not produce a tarball/);
  });
});
