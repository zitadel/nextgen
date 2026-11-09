import { lstat, mkdir, readdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect } from "vitest";

import { type ProjectMetaSchema, projectMetaSchemas, writeMetaSchemas } from "@/lib/meta-schemas";
import { it } from "@tests/helpers/fixtures";

/**
 * The CLI version whose meta-schemas the tests write.
 */
const CLI_VERSION = "0.1.0";

/**
 * Where the meta-schemas go.
 */
const META = ".zitadel/meta";

/**
 * The branding meta-schema's path.
 */
const BRANDING = `${META}/branding.json`;

/**
 * What a project's secret holds, which no write may reach.
 */
const SECRET = '{"project_secret": "sk_proj_test"}\n';

/**
 * This CLI's meta-schema for branding.
 *
 * @returns The meta-schema.
 * @throws When this CLI ships none.
 */
function brandingMetaSchema(): ProjectMetaSchema {
  const file = projectMetaSchemas(CLI_VERSION).find((candidate) => {
    return candidate.path === BRANDING;
  });
  if (file === undefined) {
    throw new Error(`no meta-schema at ${BRANDING}`);
  }
  return file;
}

/**
 * Puts a symlink at the branding meta-schema's place, pointing at the project's secret.
 *
 * @param cwd - The project directory.
 */
async function linkBrandingToTheSecret(cwd: string): Promise<void> {
  await mkdir(join(cwd, META), { recursive: true });
  await writeFile(join(cwd, ".zitadel/secret"), SECRET);
  await symlink("../secret", join(cwd, BRANDING));
}

describe("writeMetaSchemas", () => {
  it("writes every missing file byte for byte as projectMetaSchemas gives it", async ({ dir }) => {
    const files = projectMetaSchemas(CLI_VERSION);

    await writeMetaSchemas(dir, files, { dryRun: false });

    expect(
      await Promise.all(
        files.map((file) => {
          return readFile(join(dir, file.path), "utf8");
        }),
      ),
    ).toEqual(
      files.map((file) => {
        return file.contents;
      }),
    );
  });

  it("reports the directory it created and each file it created", async ({ dir }) => {
    const result = await writeMetaSchemas(dir, [brandingMetaSchema()], { dryRun: false });

    expect(result.written).toEqual([
      { path: META, kind: "dir", action: "create" },
      { path: BRANDING, kind: "file", action: "create" },
    ]);
  });

  describe("with an outdated file", () => {
    it("replaces it and reports it as updated", async ({ dir }) => {
      await mkdir(join(dir, META), { recursive: true });
      await writeFile(join(dir, BRANDING), '{"title": "an older dialect"}\n');

      const result = await writeMetaSchemas(dir, [brandingMetaSchema()], { dryRun: false });

      expect(result.written).toEqual([{ path: BRANDING, kind: "file", action: "update" }]);
    });
  });

  describe("when the project pins a package newer than the CLI", () => {
    /**
     * Pins a `@zitadel/*` package newer than the CLI the tests write for.
     *
     * @param cwd - The project directory.
     */
    async function pinNewer(cwd: string): Promise<void> {
      await writeFile(
        join(cwd, "package.json"),
        JSON.stringify({ devDependencies: { "@zitadel/config": "99.0.0" } }),
      );
    }

    it("leaves an outdated file as it was and names the pin", async ({ dir }) => {
      await mkdir(join(dir, META), { recursive: true });
      await writeFile(join(dir, BRANDING), '{"title": "a newer dialect"}\n');
      await pinNewer(dir);

      const result = await writeMetaSchemas(dir, [brandingMetaSchema()], { dryRun: false });

      expect(result.written).toEqual([]);
      expect(result.newerPin).toEqual({ name: "@zitadel/config", version: "99.0.0" });
      expect(await readFile(join(dir, BRANDING), "utf8")).toBe('{"title": "a newer dialect"}\n');
    });

    it("writes no missing file either", async ({ dir }) => {
      await pinNewer(dir);

      const result = await writeMetaSchemas(dir, [brandingMetaSchema()], { dryRun: false });

      expect(result.written).toEqual([]);
      expect(await readdir(dir)).not.toContain(".zitadel");
    });
  });

  describe("with a current file", () => {
    it("leaves it alone and reports it unchanged", async ({ dir }) => {
      await writeMetaSchemas(dir, [brandingMetaSchema()], { dryRun: false });

      const result = await writeMetaSchemas(dir, [brandingMetaSchema()], { dryRun: false });

      expect(result).toEqual({
        written: [],
        unchanged: [BRANDING],
        linked: [],
        unreadable: [],
        newerPin: undefined,
      });
    });
  });

  describe("with a symlink in a file's place", () => {
    it("reports the file as linked", async ({ dir }) => {
      await linkBrandingToTheSecret(dir);

      const result = await writeMetaSchemas(dir, [brandingMetaSchema()], { dryRun: false });

      expect(result.linked).toEqual([BRANDING]);
    });

    it("writes nothing through it", async ({ dir }) => {
      await linkBrandingToTheSecret(dir);

      await writeMetaSchemas(dir, [brandingMetaSchema()], { dryRun: false });

      expect(await readFile(join(dir, ".zitadel/secret"), "utf8")).toBe(SECRET);
    });

    it("leaves the symlink in place", async ({ dir }) => {
      await linkBrandingToTheSecret(dir);

      await writeMetaSchemas(dir, [brandingMetaSchema()], { dryRun: false });

      expect((await lstat(join(dir, BRANDING))).isSymbolicLink()).toBe(true);
    });
  });

  describe("with a file it cannot read", () => {
    it("reports it as unreadable", async ({ dir }) => {
      await mkdir(join(dir, BRANDING), { recursive: true });

      const result = await writeMetaSchemas(dir, [brandingMetaSchema()], { dryRun: false });

      expect(result.unreadable).toEqual([{ path: BRANDING, reason: "EISDIR" }]);
    });

    it("leaves it in place", async ({ dir }) => {
      await mkdir(join(dir, BRANDING), { recursive: true });

      await writeMetaSchemas(dir, [brandingMetaSchema()], { dryRun: false });

      expect((await lstat(join(dir, BRANDING))).isDirectory()).toBe(true);
    });
  });

  describe("with a dry run", () => {
    it("reports what it would write", async ({ dir }) => {
      const result = await writeMetaSchemas(dir, [brandingMetaSchema()], { dryRun: true });

      expect(result.written).toEqual([
        { path: META, kind: "dir", action: "create" },
        { path: BRANDING, kind: "file", action: "create" },
      ]);
    });

    it("writes nothing", async ({ dir }) => {
      await writeMetaSchemas(dir, projectMetaSchemas(CLI_VERSION), { dryRun: true });

      expect(await readdir(dir)).toEqual([]);
    });
  });
});
