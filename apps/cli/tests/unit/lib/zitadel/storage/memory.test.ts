import { describe, expect, it } from "vitest";

import { FileExistsError } from "@/lib/zitadel/errors";
import { MemoryStore } from "@/lib/zitadel/storage/memory";

/**
 * A branding file whose template is a `$file` reference.
 *
 * @param ref - The reference as written.
 * @returns The file.
 */
function brandingWith(ref: string): { path: string; body: { liquid_template: { $file: string } } } {
  return { path: ".zitadel/branding/brand.json", body: { liquid_template: { $file: ref } } };
}

describe("MemoryStore", () => {
  describe("read", () => {
    it("reads every json file of a kind, in file-name order", async () => {
      const store = new MemoryStore([
        { path: ".zitadel/idps/b.json", body: { slug: "b" } },
        { path: ".zitadel/idps/a.json", body: { slug: "a" } },
      ]);

      expect(await store.read("connections")).toEqual([
        { path: ".zitadel/idps/a.json", body: { slug: "a" } },
        { path: ".zitadel/idps/b.json", body: { slug: "b" } },
      ]);
    });

    it("skips a file of another kind", async () => {
      const store = new MemoryStore([{ path: ".zitadel/flows/login.json", body: {} }]);

      expect(await store.read("connections")).toEqual([]);
    });

    it("skips a file in a directory beneath the kind's", async () => {
      const store = new MemoryStore([{ path: ".zitadel/idps/nested/a.json", body: {} }]);

      expect(await store.read("connections")).toEqual([]);
    });

    it("finds nothing when it holds nothing", async () => {
      expect(await new MemoryStore().read("connections")).toEqual([]);
    });
  });

  describe("exists", () => {
    it("is true for a configuration file it holds", async () => {
      expect(await new MemoryStore([{ path: ".zitadel/idps/a.json", body: {} }]).exists(".zitadel/idps/a.json")).toBe(
        true,
      );
    });

    it("is true for another file it holds", async () => {
      expect(await new MemoryStore([], { "templates/login.liquid": "x" }).exists("templates/login.liquid")).toBe(true);
    });

    it("is false for a file it does not hold", async () => {
      expect(await new MemoryStore().exists(".zitadel/idps/a.json")).toBe(false);
    });
  });

  describe("write", () => {
    it("holds the body it was given", async () => {
      const store = new MemoryStore();

      await store.write({ path: ".zitadel/idps/a.json", body: { slug: "a" } }, "create");

      expect(store.get(".zitadel/idps/a.json")).toEqual({ slug: "a" });
    });

    it("refuses to replace a file under create", async () => {
      const store = new MemoryStore([{ path: ".zitadel/idps/a.json", body: {} }]);

      await expect(store.write({ path: ".zitadel/idps/a.json", body: { slug: "a" } }, "create")).rejects.toThrow(
        FileExistsError,
      );
    });

    it("refuses to replace another file at the path under create", async () => {
      const store = new MemoryStore([], { ".zitadel/idps/a.json": "{}" });

      await expect(store.write({ path: ".zitadel/idps/a.json", body: { slug: "a" } }, "create")).rejects.toThrow(
        FileExistsError,
      );
    });

    it("replaces a file under replace", async () => {
      const store = new MemoryStore([{ path: ".zitadel/idps/a.json", body: {} }]);

      await store.write({ path: ".zitadel/idps/a.json", body: { slug: "a" } }, "replace");

      expect(store.get(".zitadel/idps/a.json")).toEqual({ slug: "a" });
    });
  });

  describe("writeText", () => {
    it("holds the text for a reference to read", async () => {
      const store = new MemoryStore();

      await store.writeText(".zitadel/branding/login.liquid", "<main></main>", "create");

      expect(store.inlineReferences(brandingWith("./login.liquid"), "throw")).toEqual({
        liquid_template: "<main></main>",
      });
    });

    it("refuses to replace a file under create", async () => {
      const store = new MemoryStore([], { ".zitadel/branding/login.liquid": "old" });

      await expect(store.writeText(".zitadel/branding/login.liquid", "new", "create")).rejects.toThrow(FileExistsError);
    });

    it("replaces a file under replace", async () => {
      const store = new MemoryStore([], { ".zitadel/branding/login.liquid": "old" });

      await store.writeText(".zitadel/branding/login.liquid", "new", "replace");

      expect(store.inlineReferences(brandingWith("./login.liquid"), "throw")).toEqual({ liquid_template: "new" });
    });
  });

  describe("inlineReferences", () => {
    it("inlines a file elsewhere in the project", () => {
      const store = new MemoryStore([], { "templates/login.liquid": "<main></main>" });

      expect(store.inlineReferences(brandingWith("../../templates/login.liquid"), "throw")).toEqual({
        liquid_template: "<main></main>",
      });
    });

    it("refuses a missing reference under throw", () => {
      expect(() => {
        return new MemoryStore().inlineReferences(brandingWith("./gone.liquid"), "throw");
      }).toThrow('$file "./gone.liquid" cannot be read');
    });

    it("leaves out a missing reference under omit", () => {
      expect(new MemoryStore().inlineReferences(brandingWith("./gone.liquid"), "omit")).toEqual({});
    });

    it("refuses a reference that climbs out of the project", () => {
      expect(() => {
        return new MemoryStore().inlineReferences(brandingWith("../../../outside.txt"), "omit");
      }).toThrow('$file "../../../outside.txt" points outside the project');
    });
  });

  describe("referencedPaths", () => {
    it("lists each reference as a project-relative path", () => {
      expect(new MemoryStore().referencedPaths(brandingWith("../../templates/login.liquid"))).toEqual([
        "templates/login.liquid",
      ]);
    });

    it("refuses a reference that climbs out of the project", () => {
      expect(() => {
        return new MemoryStore().referencedPaths(brandingWith("../../../outside.txt"));
      }).toThrow('$file "../../../outside.txt" points outside the project');
    });
  });

  describe("get", () => {
    it("is undefined for a path it does not hold", () => {
      expect(new MemoryStore().get(".zitadel/idps/a.json")).toBeUndefined();
    });
  });
});
