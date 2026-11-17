import { mkdir, readdir, readFile, stat, symlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { describe, expect } from "vitest";

import { ScaffoldWorkspace } from "@/lib/orca/scaffold-workspace";
import { it } from "@tests/fixtures";

async function aProjectHolding(dir: string, files: Record<string, string>): Promise<string> {
  const cwd = join(dir, "app");
  await mkdir(cwd, { recursive: true });
  for (const [name, text] of Object.entries(files)) {
    await writeFile(join(cwd, name), text);
  }
  return cwd;
}

describe("ScaffoldWorkspace", () => {
  it("is not opened for an empty project", async ({ dir }) => {
    expect(await ScaffoldWorkspace.open(join(dir, "app"), [])).toBeUndefined();
  });

  it("runs in an empty directory named as the project is, beside it", async ({ dir }) => {
    const cwd = await aProjectHolding(dir, { "a.txt": "x" });

    const workspace = await ScaffoldWorkspace.open(cwd, ["a.txt"]);

    expect(basename(workspace?.work ?? "")).toBe("app");
    expect(dirname(dirname(dirname(workspace?.work ?? "")))).toBe(dir);
    expect(await readdir(workspace?.work ?? "")).toEqual([]);
  });

  it("moves in what the scaffold made, backs up what it replaced, and restores it", async ({
    dir,
  }) => {
    const cwd = await aProjectHolding(dir, { "keep.txt": "kept", "clash.txt": "mine" });
    const workspace = await ScaffoldWorkspace.open(cwd, ["keep.txt", "clash.txt"]);
    await writeFile(join(workspace?.work ?? "", "clash.txt"), "theirs");
    await writeFile(join(workspace?.work ?? "", "new.txt"), "new");

    await workspace?.moveInto(cwd);

    expect(await readFile(join(cwd, "keep.txt"), "utf8")).toBe("kept");
    expect(await readFile(join(cwd, "clash.txt"), "utf8")).toBe("theirs");
    expect(await readFile(join(cwd, "new.txt"), "utf8")).toBe("new");
    expect(await workspace?.replaced()).toEqual(["clash.txt"]);

    await workspace?.restoreInto(cwd);
    await workspace?.drop();

    expect(await readFile(join(cwd, "clash.txt"), "utf8")).toBe("mine");
    expect(await readdir(dir)).toEqual(["app"]);
  });

  it("merges the replaced .gitignore rules into the scaffold's", async ({ dir }) => {
    const cwd = await aProjectHolding(dir, { ".gitignore": ".zitadel/local/\n" });
    const workspace = await ScaffoldWorkspace.open(cwd, [".gitignore"]);
    await writeFile(join(workspace?.work ?? "", ".gitignore"), "node_modules\n");

    await workspace?.moveInto(cwd);

    expect(await readFile(join(cwd, ".gitignore"), "utf8")).toBe("node_modules\n.zitadel/local/\n");
  });

  it("backs up a link whose target is missing instead of overwriting it", async ({ dir }) => {
    const cwd = await aProjectHolding(dir, {});
    await symlink(join(dir, "missing"), join(cwd, ".env"));
    const workspace = await ScaffoldWorkspace.open(cwd, [".env"]);
    await writeFile(join(workspace?.work ?? "", ".env"), "theirs");

    await workspace?.moveInto(cwd);

    expect(await workspace?.replaced()).toEqual([".env"]);
  });

  it.skipIf(process.platform === "win32")("keeps the backup to its owner", async ({ dir }) => {
    const cwd = await aProjectHolding(dir, { "a.txt": "x" });
    const workspace = await ScaffoldWorkspace.open(cwd, ["a.txt"]);
    await writeFile(join(workspace?.work ?? "", "a.txt"), "y");
    await workspace?.moveInto(cwd);

    const [entry] = (await readdir(dir)).filter((name) => {
      return name !== "app";
    });

    expect((await stat(join(dir, entry ?? "", "backup"))).mode & 0o777).toBe(0o700);
  });
});
