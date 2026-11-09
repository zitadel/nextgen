import { lstat, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { projectMetaSchemas, type ProjectMetaSchema, writeMetaSchemas } from "@/lib/meta-schemas";

const CLI_VERSION = "0.1.0";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((dir) => {
      return rm(dir, { recursive: true, force: true });
    }),
  );
});

/**
 * A new, empty project directory, removed after the test.
 *
 * @returns Its path.
 */
async function aProject(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "zitadel-meta-schemas-"));
  dirs.push(cwd);
  return cwd;
}

/**
 * This CLI's meta-schema at `.zitadel/meta/<name>`.
 *
 * @param name - The file's name.
 * @returns The meta-schema.
 * @throws When this CLI ships no meta-schema by that name.
 */
function metaSchema(name: string): ProjectMetaSchema {
  const file = projectMetaSchemas(CLI_VERSION).find((candidate) => {
    return candidate.path === `.zitadel/meta/${name}`;
  });
  if (file === undefined) {
    throw new Error(`no meta-schema named ${name}`);
  }
  return file;
}

describe("writeMetaSchemas", () => {
  it("writes every missing file byte for byte as projectMetaSchemas gives it", async () => {
    const cwd = await aProject();
    const files = projectMetaSchemas(CLI_VERSION);

    await writeMetaSchemas(cwd, files, { dryRun: false });

    const held = await Promise.all(
      files.map((file) => {
        return readFile(join(cwd, file.path), "utf8");
      }),
    );
    expect(held).toEqual(
      files.map((file) => {
        return file.contents;
      }),
    );
  });

  it("reports the directory it created and each file it created", async () => {
    const cwd = await aProject();

    const result = await writeMetaSchemas(cwd, [metaSchema("branding.json")], { dryRun: false });

    expect(result.written).toEqual([
      { path: ".zitadel/meta", kind: "dir", action: "create" },
      { path: ".zitadel/meta/branding.json", kind: "file", action: "create" },
    ]);
  });

  it("replaces an outdated file and reports it as updated", async () => {
    const cwd = await aProject();
    await mkdir(join(cwd, ".zitadel/meta"), { recursive: true });
    await writeFile(join(cwd, ".zitadel/meta/branding.json"), '{"title": "an older dialect"}\n');

    const result = await writeMetaSchemas(cwd, [metaSchema("branding.json")], { dryRun: false });

    expect(result.written).toEqual([
      { path: ".zitadel/meta/branding.json", kind: "file", action: "update" },
    ]);
  });

  it("leaves a current file alone and reports it unchanged", async () => {
    const cwd = await aProject();
    await writeMetaSchemas(cwd, [metaSchema("branding.json")], { dryRun: false });

    const result = await writeMetaSchemas(cwd, [metaSchema("branding.json")], { dryRun: false });

    expect(result).toEqual({
      written: [],
      unchanged: [".zitadel/meta/branding.json"],
      linked: [],
      unreadable: [],
    });
  });

  it("writes nothing through a symlink and reports the file as linked", async () => {
    const cwd = await aProject();
    await mkdir(join(cwd, ".zitadel/meta"), { recursive: true });
    await writeFile(join(cwd, ".zitadel/secret"), '{"project_secret": "sk_proj_test"}\n');
    await symlink("../secret", join(cwd, ".zitadel/meta/branding.json"));

    const result = await writeMetaSchemas(cwd, [metaSchema("branding.json")], { dryRun: false });

    expect(result.linked).toEqual([".zitadel/meta/branding.json"]);
    expect(await readFile(join(cwd, ".zitadel/secret"), "utf8")).toBe(
      '{"project_secret": "sk_proj_test"}\n',
    );
    expect((await lstat(join(cwd, ".zitadel/meta/branding.json"))).isSymbolicLink()).toBe(true);
  });

  it("reports a file it cannot read and leaves it in place", async () => {
    const cwd = await aProject();
    await mkdir(join(cwd, ".zitadel/meta/branding.json"), { recursive: true });

    const result = await writeMetaSchemas(cwd, [metaSchema("branding.json")], { dryRun: false });

    expect(result.unreadable).toEqual([{ path: ".zitadel/meta/branding.json", reason: "EISDIR" }]);
    expect((await lstat(join(cwd, ".zitadel/meta/branding.json"))).isDirectory()).toBe(true);
  });

  it("reports what it would write in a dry run", async () => {
    const cwd = await aProject();

    const result = await writeMetaSchemas(cwd, [metaSchema("branding.json")], { dryRun: true });

    expect(result.written).toEqual([
      { path: ".zitadel/meta", kind: "dir", action: "create" },
      { path: ".zitadel/meta/branding.json", kind: "file", action: "create" },
    ]);
  });

  it("writes nothing in a dry run", async () => {
    const cwd = await aProject();

    await writeMetaSchemas(cwd, projectMetaSchemas(CLI_VERSION), { dryRun: true });

    expect(await readdir(cwd)).toEqual([]);
  });
});
