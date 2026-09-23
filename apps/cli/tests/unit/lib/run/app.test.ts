import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { isAppSkipped, resolveAppCommand } from "../../../../src/lib/run/app";

const dirs: string[] = [];

afterEach(async () => {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

async function project(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "zitadel-run-app-"));
  dirs.push(dir);
  for (const [name, contents] of Object.entries(files)) {
    await writeFile(join(dir, name), contents);
  }
  return dir;
}

describe("resolveAppCommand", () => {
  it("runs the dev script through the package manager the project declares", async () => {
    const cwd = await project({
      "package.json": JSON.stringify({
        packageManager: "pnpm@9.0.0",
        scripts: { dev: "next dev --port 3100" },
      }),
    });

    const resolved = await resolveAppCommand(cwd);

    expect(isAppSkipped(resolved)).toBe(false);
    expect(resolved).toMatchObject({ command: "pnpm", args: ["dev"], display: "pnpm dev" });
  });

  it("reports the port the dev script pins, for the session banner", async () => {
    const cwd = await project({
      "package.json": JSON.stringify({ scripts: { dev: "next dev --port 3100" } }),
    });

    const resolved = await resolveAppCommand(cwd);

    expect(resolved).toMatchObject({ port: 3100 });
  });

  it("falls back to npm when no lockfile or declaration names a manager", async () => {
    const cwd = await project({
      "package.json": JSON.stringify({ scripts: { dev: "vite" } }),
    });

    const resolved = await resolveAppCommand(cwd);

    expect(resolved).toMatchObject({ command: "npm", args: ["run", "dev"] });
  });

  it("skips, with the reason, when the project has no dev script", async () => {
    const cwd = await project({ "package.json": JSON.stringify({ scripts: { build: "vite" } }) });

    const resolved = await resolveAppCommand(cwd);

    expect(isAppSkipped(resolved) && resolved.reason).toContain('"dev" script');
  });

  it("skips, with the reason, when there is no package.json to read", async () => {
    const cwd = await project({});

    const resolved = await resolveAppCommand(cwd);

    expect(isAppSkipped(resolved) && resolved.reason).toContain("package.json");
  });

  it("takes an explicit command over the dev script", async () => {
    const cwd = await project({
      "package.json": JSON.stringify({ scripts: { dev: "next dev" } }),
    });

    const resolved = await resolveAppCommand(cwd, "  bun run start:dev  ");

    expect(resolved).toEqual({
      command: "bun",
      args: ["run", "start:dev"],
      display: "bun run start:dev",
    });
  });

  it("skips when the explicit command is blank", async () => {
    const cwd = await project({
      "package.json": JSON.stringify({ scripts: { dev: "next dev" } }),
    });

    const resolved = await resolveAppCommand(cwd, "   ");

    expect(isAppSkipped(resolved)).toBe(true);
  });
});
