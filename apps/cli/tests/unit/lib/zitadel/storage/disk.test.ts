import { chmod, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect } from "vitest";

import { it } from "@tests/helpers/fixtures";
import { FileExistsError } from "@/lib/zitadel/errors";
import { DiskStore } from "@/lib/zitadel/storage/disk";

/**
 * Writes files under a project directory, creating the directories they need.
 *
 * @param root - The project directory.
 * @param files - The text of each file, by project-relative path.
 */
async function project(root: string, files: Readonly<Record<string, string>>): Promise<void> {
  for (const [path, text] of Object.entries(files)) {
    await mkdir(join(root, path, ".."), { recursive: true });
    await writeFile(join(root, path), text);
  }
}

/**
 * A branding file whose template is a `$file` reference.
 *
 * @param ref - The reference as written.
 * @returns The file.
 */
function brandingWith(ref: string): { path: string; body: { liquid_template: { $file: string } } } {
  return { path: ".zitadel/branding/brand.json", body: { liquid_template: { $file: ref } } };
}

describe("DiskStore", () => {
  describe("read", () => {
    it("reads every json file of a kind, in file-name order", async ({ dir }) => {
      await project(dir, {
        ".zitadel/idps/b.json": '{"slug":"b"}',
        ".zitadel/idps/a.json": '{"slug":"a"}',
      });

      expect(await new DiskStore(dir).read("connections")).toEqual([
        { path: ".zitadel/idps/a.json", body: { slug: "a" } },
        { path: ".zitadel/idps/b.json", body: { slug: "b" } },
      ]);
    });

    it("skips a file that is not json", async ({ dir }) => {
      await project(dir, { ".zitadel/idps/README.md": "# notes" });

      expect(await new DiskStore(dir).read("connections")).toEqual([]);
    });

    it("finds nothing when the kind's directory is missing", async ({ dir }) => {
      expect(await new DiskStore(dir).read("connections")).toEqual([]);
    });

    it("refuses a file that is not valid json", async ({ dir }) => {
      await project(dir, { ".zitadel/idps/a.json": "{ not json" });

      await expect(new DiskStore(dir).read("connections")).rejects.toThrow(".zitadel/idps/a.json is not valid JSON");
    });

    it("keeps the file's text out of a parse failure", async ({ dir }) => {
      await project(dir, { ".zitadel/idps/a.json": '{"secret": sk_live_123}' });

      await expect(new DiskStore(dir).read("connections")).rejects.toMatchObject({
        details: { file: ".zitadel/idps/a.json", parse_error: expect.not.stringContaining("sk_live_123") },
      });
    });

    it("refuses a file that holds json other than an object", async ({ dir }) => {
      await project(dir, { ".zitadel/idps/a.json": "[1, 2]" });

      await expect(new DiskStore(dir).read("connections")).rejects.toThrow(".zitadel/idps/a.json does not contain a JSON object");
    });
  });

  describe("exists", () => {
    it("is true for a file that is there, parsed or not", async ({ dir }) => {
      await project(dir, { ".zitadel/idps/a.json": "{ not json" });

      expect(await new DiskStore(dir).exists(".zitadel/idps/a.json")).toBe(true);
    });

    it("is false for a file that is not there", async ({ dir }) => {
      expect(await new DiskStore(dir).exists(".zitadel/idps/a.json")).toBe(false);
    });
  });

  describe("write", () => {
    it("writes the body with its keys sorted, creating the directories", async ({ dir }) => {
      await new DiskStore(dir).write({ path: ".zitadel/idps/a.json", body: { z: 1, a: { y: 2, b: 3 } } }, "create");

      expect(await readFile(join(dir, ".zitadel/idps/a.json"), "utf8")).toBe(
        '{\n  "a": {\n    "b": 3,\n    "y": 2\n  },\n  "z": 1\n}\n',
      );
    });

    it("refuses to replace a file under create", async ({ dir }) => {
      await project(dir, { ".zitadel/idps/a.json": "{}" });

      await expect(
        new DiskStore(dir).write({ path: ".zitadel/idps/a.json", body: { slug: "a" } }, "create"),
      ).rejects.toThrow(FileExistsError);
    });

    it("replaces a file under replace", async ({ dir }) => {
      await project(dir, { ".zitadel/idps/a.json": "{}" });

      await new DiskStore(dir).write({ path: ".zitadel/idps/a.json", body: { slug: "a" } }, "replace");

      expect(await readFile(join(dir, ".zitadel/idps/a.json"), "utf8")).toBe('{\n  "slug": "a"\n}\n');
    });
  });

  describe("writeText", () => {
    it("writes the text as given, creating the directories", async ({ dir }) => {
      await new DiskStore(dir).writeText(".zitadel/branding/login.liquid", "<main></main>", "create");

      expect(await readFile(join(dir, ".zitadel/branding/login.liquid"), "utf8")).toBe("<main></main>");
    });

    it("refuses to replace a file under create", async ({ dir }) => {
      await project(dir, { ".zitadel/branding/login.liquid": "old" });

      await expect(
        new DiskStore(dir).writeText(".zitadel/branding/login.liquid", "new", "create"),
      ).rejects.toThrow(FileExistsError);
    });

    it("replaces a file under replace", async ({ dir }) => {
      await project(dir, { ".zitadel/branding/login.liquid": "old" });

      await new DiskStore(dir).writeText(".zitadel/branding/login.liquid", "new", "replace");

      expect(await readFile(join(dir, ".zitadel/branding/login.liquid"), "utf8")).toBe("new");
    });
  });

  describe("inlineReferences", () => {
    it("inlines a file beside the one that references it", async ({ dir }) => {
      await project(dir, { ".zitadel/branding/login.liquid": "<main></main>" });

      expect(new DiskStore(dir).inlineReferences(brandingWith("./login.liquid"), "throw")).toEqual({
        liquid_template: "<main></main>",
      });
    });

    it("inlines a file elsewhere in the project", async ({ dir }) => {
      await project(dir, { "templates/login.liquid": "<main></main>" });

      expect(new DiskStore(dir).inlineReferences(brandingWith("../../templates/login.liquid"), "throw")).toEqual({
        liquid_template: "<main></main>",
      });
    });

    it("inlines a file through a symlink that stays inside the project", async ({ dir }) => {
      await project(dir, { "templates/login.liquid": "<main></main>" });
      await mkdir(join(dir, ".zitadel/branding"), { recursive: true });
      await symlink(join(dir, "templates"), join(dir, ".zitadel/branding/templates"));

      expect(new DiskStore(dir).inlineReferences(brandingWith("./templates/login.liquid"), "throw")).toEqual({
        liquid_template: "<main></main>",
      });
    });

    it("refuses a missing reference under throw", async ({ dir }) => {
      expect(() => {
        return new DiskStore(dir).inlineReferences(brandingWith("./gone.liquid"), "throw");
      }).toThrow('$file "./gone.liquid" cannot be read');
    });

    it("leaves out a missing reference under omit", async ({ dir }) => {
      expect(new DiskStore(dir).inlineReferences(brandingWith("./gone.liquid"), "omit")).toEqual({});
    });

    it("leaves out a reference through a regular file under omit", async ({ dir }) => {
      await project(dir, { ".zitadel/branding/login.liquid": "<main></main>" });

      expect(new DiskStore(dir).inlineReferences(brandingWith("./login.liquid/x"), "omit")).toEqual({});
    });

    it.skipIf(process.getuid?.() === 0)("refuses a file that is there but cannot be read, even under omit", async ({ dir }) => {
      await project(dir, { ".zitadel/branding/login.liquid": "<main></main>" });
      await chmod(join(dir, ".zitadel/branding/login.liquid"), 0o000);

      expect(() => {
        return new DiskStore(dir).inlineReferences(brandingWith("./login.liquid"), "omit");
      }).toThrow('$file "./login.liquid" cannot be read');
    });

    it("refuses a reference that climbs out of the project", async ({ dir }) => {
      expect(() => {
        return new DiskStore(dir).inlineReferences(brandingWith("../../../outside.txt"), "omit");
      }).toThrow('$file "../../../outside.txt" points outside the project');
    });

    it("refuses a reference through a symlink that leads outside the project", async ({ dir, other }) => {
      await writeFile(join(other, "secret.txt"), "secret");
      await mkdir(join(dir, ".zitadel/branding"), { recursive: true });
      await symlink(other, join(dir, ".zitadel/branding/elsewhere"));

      expect(() => {
        return new DiskStore(dir).inlineReferences(brandingWith("./elsewhere/secret.txt"), "omit");
      }).toThrow('$file "./elsewhere/secret.txt" points outside the project');
    });

    it("refuses a reference through a symlink that resolves nowhere", async ({ dir }) => {
      await mkdir(join(dir, ".zitadel/branding"), { recursive: true });
      await symlink(join(dir, "gone"), join(dir, ".zitadel/branding/dangling"));

      expect(() => {
        return new DiskStore(dir).inlineReferences(brandingWith("./dangling/x.liquid"), "omit");
      }).toThrow('$file "./dangling/x.liquid" points outside the project');
    });
  });

  describe("referencedPaths", () => {
    it("lists each reference as a project-relative path", async ({ dir }) => {
      expect(new DiskStore(dir).referencedPaths(brandingWith("../../templates/login.liquid"))).toEqual([
        "templates/login.liquid",
      ]);
    });

    it("lists a reference whose file is missing", async ({ dir }) => {
      expect(new DiskStore(dir).referencedPaths(brandingWith("./gone.liquid"))).toEqual([
        ".zitadel/branding/gone.liquid",
      ]);
    });

    it("refuses a reference that climbs out of the project", async ({ dir }) => {
      expect(() => {
        return new DiskStore(dir).referencedPaths(brandingWith("../../../outside.txt"));
      }).toThrow('$file "../../../outside.txt" points outside the project');
    });
  });
});
