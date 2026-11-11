import { describe, expect } from "vitest";

import { CONFIG_DIRECTORIES, ConfigError, FileExistsError, type JsonObject } from "@/lib/zitadel";
import type { Store } from "@/lib/zitadel/storage/backend/store";
import { BACKENDS } from "@tests/helpers/storage/backend/backends";
import { it } from "@tests/helpers/fixtures";
import { aBrandingReferencing } from "@tests/helpers/stores";
import { rejectionOf, thrownBy } from "@tests/helpers/thrown-value";

/**
 * A connection's file.
 */
const IDP_A = `${CONFIG_DIRECTORIES.connections}/a.json`;

/**
 * A directory beside the connection files, which a symlink can point at.
 */
const KEPT = `${CONFIG_DIRECTORIES.connections}/kept`;

/**
 * Another connection's file, which sorts after {@link IDP_A}.
 */
const IDP_B = `${CONFIG_DIRECTORIES.connections}/b.json`;

/**
 * The template beside the branding file.
 */
const TEMPLATE = `${CONFIG_DIRECTORIES.branding}/login.liquid`;

/**
 * A template the tests write.
 */
const MAIN = "<main></main>";

/**
 * A symlink that points at itself.
 */
const LOOP = "loop";

/**
 * A directory in the project, outside `.zitadel/`.
 */
const ELSEWHERE = "elsewhere";

/**
 * A file in the project, outside `.zitadel/`.
 */
const PACKAGE = "package.json";

/**
 * A path that climbs out of `.zitadel/`.
 */
const OUTSIDE = `${CONFIG_DIRECTORIES.schemas}/../../escaped.json`;

/**
 * A secret pasted into a file by mistake, short enough that V8 would quote all
 * of it (it quotes at most 10 characters of the token it choked on).
 */
const PASTED = "pasted_v";

/**
 * Whether the tests run as root, whom no file mode keeps out.
 */
const AS_ROOT = process.getuid?.() === 0;

/**
 * A body as the text a file holds.
 *
 * @param body - The body.
 * @returns Its JSON.
 */
function jsonOf(body: JsonObject): string {
  return JSON.stringify(body);
}

describe("Store.read", () => {
  describe.each(BACKENDS)("with a $name", ({ open }) => {
    it("reads every json file of a kind, in file-name order", async ({ dir, other }) => {
      const { store, project } = open(dir, other);
      await project.write({
        [IDP_B]: jsonOf({ slug: "b" }),
        [IDP_A]: jsonOf({ slug: "a" }),
      });

      const files = await store.read("connections");

      expect(files).toEqual([
        { path: IDP_A, body: { slug: "a" } },
        { path: IDP_B, body: { slug: "b" } },
      ]);
    });

    it.for([
      ["a file of another kind", { [`${CONFIG_DIRECTORIES.flows}/login.json`]: "{}" }],
      [
        "a file in a directory beneath the kind's",
        { [`${CONFIG_DIRECTORIES.connections}/nested/a.json`]: "{}" },
      ],
      ["a file that is not json", { [`${CONFIG_DIRECTORIES.connections}/README.md`]: "# notes" }],
    ] as const)("skips %s", async ([_file, held], { dir, other }) => {
      const { store, project } = open(dir, other);
      await project.write(held);

      const files = await store.read("connections");

      expect(files).toEqual([]);
    });

    it("finds nothing when it holds nothing", async ({ dir, other }) => {
      const { store } = open(dir, other);

      const files = await store.read("connections");

      expect(files).toEqual([]);
    });

    it("hands a file that is not valid json on as unparsed, naming the line and column", async ({
      dir,
      other,
    }) => {
      const { store, project } = open(dir, other);
      await project.write({ [IDP_A]: '{\n  "a": 1,\n  "b": "\\x"\n}' });

      const files = await store.read("connections");

      expect(files).toEqual([{ path: IDP_A, unparsed: "invalid JSON at line 3, column 10" }]);
    });

    it("names the line and column of an error the parser gives no position for", async ({
      dir,
      other,
    }) => {
      const { store, project } = open(dir, other);
      await project.write({ [IDP_A]: `{\n  "secret": ${PASTED}\n}` });

      const files = await store.read("connections");

      expect(files).toEqual([{ path: IDP_A, unparsed: "invalid JSON at line 2, column 13" }]);
    });

    it("keeps the file's text out of the reason it could not be parsed", async ({ dir, other }) => {
      const { store, project } = open(dir, other);
      await project.write({ [IDP_A]: `{"secret": ${PASTED}}` });

      const files = await store.read("connections");

      expect(JSON.stringify(files)).not.toContain(PASTED);
    });

    it("hands a file that holds json other than an object on as unparsed", async ({
      dir,
      other,
    }) => {
      const { store, project } = open(dir, other);
      await project.write({ [IDP_A]: "[1, 2]" });

      const files = await store.read("connections");

      expect(files).toEqual([{ path: IDP_A, unparsed: "not a JSON object" }]);
    });

    it("keeps reading the files beside one that is not valid json", async ({ dir, other }) => {
      const { store, project } = open(dir, other);
      await project.write({ [IDP_A]: "{ not json", [IDP_B]: "{}" });

      const files = await store.read("connections");

      expect(
        files.map((file) => {
          return file.path;
        }),
      ).toEqual([IDP_A, IDP_B]);
    });

    it("hands a directory named like a file on as unparsed, naming it", async ({ dir, other }) => {
      const { store, project } = open(dir, other);
      await project.directory(IDP_A);
      await project.write({ [IDP_B]: "{}" });

      const files = await store.read("connections");

      expect(files).toEqual([
        { path: IDP_A, unparsed: "is a directory" },
        { path: IDP_B, body: {} },
      ]);
    });

    it("refuses a kind's directory that is a regular file, rather than finding no files", async ({
      dir,
      other,
    }) => {
      const { store, project } = open(dir, other);
      await project.write({ [CONFIG_DIRECTORIES.connections]: "not a directory" });

      const error = await rejectionOf(() => {
        return store.read("connections");
      });

      expect(error).toMatchObject({
        message: `${CONFIG_DIRECTORIES.connections} cannot be read (ENOTDIR)`,
        details: { file: CONFIG_DIRECTORIES.connections, code: "ENOTDIR" },
      });
    });

    it.skipIf(AS_ROOT)("carries the errno of a file it may not read", async ({ dir, other }) => {
      const { store, project } = open(dir, other);
      await project.write({ [IDP_A]: "{}" });
      await project.restrict(IDP_A, 0o000);

      const error = await rejectionOf(() => {
        return store.read("connections");
      });

      expect(error).toMatchObject({
        message: `${IDP_A} cannot be read (EACCES)`,
        details: { file: IDP_A, code: "EACCES" },
      });
    });

    it.skipIf(AS_ROOT)(
      "carries the errno of a directory it may not read",
      async ({ dir, other }) => {
        const { store, project } = open(dir, other);
        await project.write({ [IDP_A]: "{}" });
        await project.restrict(CONFIG_DIRECTORIES.connections, 0o000);

        const error = await rejectionOf(() => {
          return store.read("connections");
        });

        expect(error).toMatchObject({
          message: `${CONFIG_DIRECTORIES.connections} cannot be read (EACCES)`,
          details: { file: CONFIG_DIRECTORIES.connections, code: "EACCES" },
        });
      },
    );
  });
});

describe("Store.exists", () => {
  describe.each(BACKENDS)("with a $name", ({ open }) => {
    it("is true for a configuration file it holds", async ({ dir, other }) => {
      const { store, project } = open(dir, other);
      await project.write({ [IDP_A]: "{}" });

      const exists = await store.exists(IDP_A);

      expect(exists).toBe(true);
    });

    it("is true for a file that is not valid json", async ({ dir, other }) => {
      const { store, project } = open(dir, other);
      await project.write({ [IDP_A]: "{ not json" });

      const exists = await store.exists(IDP_A);

      expect(exists).toBe(true);
    });

    it("is true for another file it holds", async ({ dir, other }) => {
      const { store, project } = open(dir, other);
      await project.write({ [TEMPLATE]: MAIN });

      const exists = await store.exists(TEMPLATE);

      expect(exists).toBe(true);
    });

    it("is false for a file it does not hold", async ({ dir, other }) => {
      const { store } = open(dir, other);

      const exists = await store.exists(IDP_A);

      expect(exists).toBe(false);
    });

    it("is false for a path through a regular file", async ({ dir, other }) => {
      const { store, project } = open(dir, other);
      await project.write({ [TEMPLATE]: MAIN });

      const exists = await store.exists(`${TEMPLATE}/x`);

      expect(exists).toBe(false);
    });

    it("rethrows an access error that is not an absent file", async ({ dir, other }) => {
      const { store, project } = open(dir, other);
      await project.symlink(LOOP, LOOP);

      const error = await rejectionOf(() => {
        return store.exists(LOOP);
      });

      expect(error).toMatchObject({ code: "ELOOP" });
    });
  });
});

describe("Store.write", () => {
  describe.each(BACKENDS)("with a $name", ({ open }) => {
    it("holds the body it was given", async ({ dir, other }) => {
      const { store } = open(dir, other);

      await store.write({ path: IDP_A, body: { slug: "a" } }, "create");

      expect(await store.read("connections")).toEqual([{ path: IDP_A, body: { slug: "a" } }]);
    });

    it("writes the body with its keys sorted, creating the directories", async ({ dir, other }) => {
      const { store, project } = open(dir, other);

      await store.write({ path: IDP_A, body: { z: 1, a: { y: 2, b: 3 } } }, "create");

      expect(await project.text(IDP_A)).toBe(
        '{\n  "a": {\n    "b": 3,\n    "y": 2\n  },\n  "z": 1\n}\n',
      );
    });

    it.for([
      ["a configuration file", { [IDP_A]: "{}" }],
      ["another file", { [IDP_A]: "not json" }],
    ] as const)("refuses to replace %s under create", async ([_file, held], { dir, other }) => {
      const { store, project } = open(dir, other);
      await project.write(held);

      const error = await rejectionOf(() => {
        return store.write({ path: IDP_A, body: { slug: "a" } }, "create");
      });

      expect(error).toBeInstanceOf(FileExistsError);
      expect(error).toMatchObject({ path: IDP_A });
    });

    it("replaces a file under replace", async ({ dir, other }) => {
      const { store, project } = open(dir, other);
      await project.write({ [IDP_A]: "{}" });

      await store.write({ path: IDP_A, body: { slug: "a" } }, "replace");

      expect(await store.read("connections")).toEqual([{ path: IDP_A, body: { slug: "a" } }]);
    });

    it("refuses a path through a symlink that leads outside .zitadel/", async ({ dir, other }) => {
      const { store, project } = open(dir, other);
      await project.directory(ELSEWHERE);
      await project.symlink(ELSEWHERE, CONFIG_DIRECTORIES.schemas);

      const error = await rejectionOf(() => {
        return store.write({ path: `${CONFIG_DIRECTORIES.schemas}/x.json`, body: {} }, "create");
      });

      expect(error).toBeInstanceOf(ConfigError);
    });
  });
});

describe("Store.remove", () => {
  describe.each(BACKENDS)("with a $name", ({ open }) => {
    it("deletes the file", async ({ dir, other }) => {
      const { store, project } = open(dir, other);
      await project.write({ [IDP_A]: "{}" });

      await store.remove(IDP_A);

      expect(await store.exists(IDP_A)).toBe(false);
    });

    it("takes a file it does not hold as already deleted", async ({ dir, other }) => {
      const { store } = open(dir, other);

      const error = await rejectionOf(() => {
        return store.remove(IDP_A);
      });

      expect(error).toBeUndefined();
    });

    it("takes a path beneath a regular file as already deleted", async ({ dir, other }) => {
      const { store, project } = open(dir, other);
      await project.write({ [TEMPLATE]: MAIN });

      const error = await rejectionOf(() => {
        return store.remove(`${TEMPLATE}/x`);
      });

      expect(error).toBeUndefined();
    });

    it("removes a symlink to a directory", async ({ dir, other }) => {
      const { store, project } = open(dir, other);
      await project.directory(KEPT);
      await project.symlink(KEPT, IDP_A);

      await store.remove(IDP_A);

      expect(await store.exists(IDP_A)).toBe(false);
    });

    it("keeps the directory a removed symlink pointed at", async ({ dir, other }) => {
      const { store, project } = open(dir, other);
      await project.directory(KEPT);
      await project.symlink(KEPT, IDP_A);

      await store.remove(IDP_A);

      expect(await store.exists(KEPT)).toBe(true);
    });

    it("refuses a directory where the file should be", async ({ dir, other }) => {
      const { store, project } = open(dir, other);
      await project.directory(IDP_A);

      const error = await rejectionOf(() => {
        return store.remove(IDP_A);
      });

      expect(error).toBeInstanceOf(ConfigError);
    });

    it("names the directory it refuses to remove", async ({ dir, other }) => {
      const { store, project } = open(dir, other);
      await project.directory(IDP_A);

      const error = await rejectionOf(() => {
        return store.remove(IDP_A);
      });

      expect(error).toMatchObject({ details: { file: IDP_A, code: "EISDIR" } });
    });

    it("refuses a path outside .zitadel/", async ({ dir, other }) => {
      const { store, project } = open(dir, other);
      await project.write({ [PACKAGE]: "{}" });

      const error = await rejectionOf(() => {
        return store.remove(`${CONFIG_DIRECTORIES.schemas}/../../${PACKAGE}`);
      });

      expect(error).toBeInstanceOf(ConfigError);
    });

    it("leaves the file a refused path names", async ({ dir, other }) => {
      const { store, project } = open(dir, other);
      await project.write({ [PACKAGE]: "{}" });
      await rejectionOf(() => {
        return store.remove(`${CONFIG_DIRECTORIES.schemas}/../../${PACKAGE}`);
      });

      const exists = await store.exists(PACKAGE);

      expect(exists).toBe(true);
    });
  });
});

describe("Store.assertWritable", () => {
  describe.each(BACKENDS)("with a $name", ({ open }) => {
    it("reports a path beneath a regular file as not writable", async ({ dir, other }) => {
      const { store, project } = open(dir, other);
      await project.write({ [TEMPLATE]: MAIN });

      const error = thrownBy(() => {
        store.assertWritable(`${TEMPLATE}/x`);
      });

      expect(error).toBeInstanceOf(ConfigError);
    });
  });
});

describe("Store.assertRemovable", () => {
  describe.each(BACKENDS)("with a $name", ({ open }) => {
    it("accepts a path beneath a regular file as removable", async ({ dir, other }) => {
      const { store, project } = open(dir, other);
      await project.write({ [TEMPLATE]: MAIN });

      const error = thrownBy(() => {
        store.assertRemovable(`${TEMPLATE}/x`);
      });

      expect(error).toBeUndefined();
    });

    it("refuses a directory where the file should be", async ({ dir, other }) => {
      const { store, project } = open(dir, other);
      await project.directory(IDP_A);

      const error = thrownBy(() => {
        store.assertRemovable(IDP_A);
      });

      expect(error).toBeInstanceOf(ConfigError);
    });

    it("names the directory it refuses as removable", async ({ dir, other }) => {
      const { store, project } = open(dir, other);
      await project.directory(IDP_A);

      const error = thrownBy(() => {
        store.assertRemovable(IDP_A);
      });

      expect(error).toMatchObject({ details: { file: IDP_A, code: "EISDIR" } });
    });

    it("refuses a path outside .zitadel/", async ({ dir, other }) => {
      const { store } = open(dir, other);

      const error = thrownBy(() => {
        store.assertRemovable(OUTSIDE);
      });

      expect(error).toBeInstanceOf(ConfigError);
    });
  });
});

describe("Store.writeText", () => {
  describe.each(BACKENDS)("with a $name", ({ open }) => {
    it("writes the text as given, creating the directories", async ({ dir, other }) => {
      const { store, project } = open(dir, other);

      await store.writeText(TEMPLATE, MAIN, "create");

      expect(await project.text(TEMPLATE)).toBe(MAIN);
    });

    it("holds the text for a reference to read", async ({ dir, other }) => {
      const { store } = open(dir, other);
      await store.writeText(TEMPLATE, MAIN, "create");

      const body = store.inlineReferences(aBrandingReferencing("./login.liquid"), "throw");

      expect(body).toEqual({ liquid_template: MAIN });
    });

    it.for([
      ["directly beneath", `${TEMPLATE}/x`],
      ["further beneath", `${TEMPLATE}/y/x`],
    ] as const)(
      "refuses to write a file %s a regular file",
      async ([_where, path], { dir, other }) => {
        const { store, project } = open(dir, other);
        await project.write({ [TEMPLATE]: MAIN });

        const error = await rejectionOf(() => {
          return store.writeText(path, MAIN, "create");
        });

        expect(error).toBeInstanceOf(ConfigError);
        expect(error).toMatchObject({
          message: `${path} cannot be written (ENOTDIR)`,
          hint: `Remove ${TEMPLATE}, which is a file where a directory is needed, then run the command again.`,
          details: { file: path, code: "ENOTDIR", blocker: TEMPLATE },
        });
      },
    );

    it("refuses to replace a file under create", async ({ dir, other }) => {
      const { store, project } = open(dir, other);
      await project.write({ [TEMPLATE]: "old" });

      const error = await rejectionOf(() => {
        return store.writeText(TEMPLATE, "new", "create");
      });

      expect(error).toBeInstanceOf(FileExistsError);
      expect(error).toMatchObject({ path: TEMPLATE });
    });

    it("replaces a file under replace", async ({ dir, other }) => {
      const { store, project } = open(dir, other);
      await project.write({ [TEMPLATE]: "old" });

      await store.writeText(TEMPLATE, "new", "replace");

      expect(await project.text(TEMPLATE)).toBe("new");
    });
  });
});

describe("Store outside .zitadel/", () => {
  describe.each(BACKENDS)("with a $name", ({ open }) => {
    it.for([
      [
        "write",
        (store: Store) => {
          return store.write({ path: OUTSIDE, body: {} }, "create");
        },
      ],
      [
        "writeText",
        (store: Store) => {
          return store.writeText(OUTSIDE, MAIN, "create");
        },
      ],
      [
        "remove",
        (store: Store) => {
          return store.remove(OUTSIDE);
        },
      ],
    ] as const)("refuses %s of a path outside it", async ([_call, act], { dir, other }) => {
      const { store } = open(dir, other);

      const error = await rejectionOf(() => {
        return act(store);
      });

      expect(error).toBeInstanceOf(ConfigError);
      expect(error).toMatchObject({ message: `${OUTSIDE} points outside .zitadel/` });
    });

    it("refuses to hold a file written outside it", async ({ dir, other }) => {
      const { store } = open(dir, other);

      await rejectionOf(() => {
        return store.writeText("escaped.json", MAIN, "create");
      });

      expect(await store.exists("escaped.json")).toBe(false);
    });

    it("reports a path outside it as not writable, and one inside as writable", async ({
      dir,
      other,
    }) => {
      const { store } = open(dir, other);

      const outside = thrownBy(() => {
        store.assertWritable(OUTSIDE);
      });
      const inside = thrownBy(() => {
        store.assertWritable(IDP_A);
      });

      expect([outside, inside]).toEqual([expect.any(ConfigError), undefined]);
    });
  });
});

describe("Store.inlineReferences", () => {
  describe.each(BACKENDS)("with a $name", ({ open }) => {
    it.for([
      ["beside the one that references it", TEMPLATE, "./login.liquid"],
      ["elsewhere in the project", "templates/login.liquid", "../../templates/login.liquid"],
    ] as const)("inlines a file %s", async ([_where, path, ref], { dir, other }) => {
      const { store, project } = open(dir, other);
      await project.write({ [path]: MAIN });

      const body = store.inlineReferences(aBrandingReferencing(ref), "throw");

      expect(body).toEqual({ liquid_template: MAIN });
    });

    it("inlines a file through a symlink that stays inside the project", async ({ dir, other }) => {
      const { store, project } = open(dir, other);
      await project.write({ "templates/login.liquid": MAIN });
      await project.symlink("templates", `${CONFIG_DIRECTORIES.branding}/templates`);

      const body = store.inlineReferences(
        aBrandingReferencing("./templates/login.liquid"),
        "throw",
      );

      expect(body).toEqual({ liquid_template: MAIN });
    });

    it("refuses a missing reference under throw", async ({ dir, other }) => {
      const { store } = open(dir, other);

      const error = thrownBy(() => {
        return store.inlineReferences(aBrandingReferencing("./gone.liquid"), "throw");
      });

      expect(error).toBeInstanceOf(ConfigError);
      expect(error).toMatchObject({ message: '$file "./gone.liquid" cannot be read' });
    });

    it("leaves out a missing reference under omit", async ({ dir, other }) => {
      const { store } = open(dir, other);

      const body = store.inlineReferences(aBrandingReferencing("./gone.liquid"), "omit");

      expect(body).toEqual({});
    });

    it("leaves out a reference through a regular file under omit", async ({ dir, other }) => {
      const { store, project } = open(dir, other);
      await project.write({ [TEMPLATE]: MAIN });

      const body = store.inlineReferences(aBrandingReferencing("./login.liquid/x"), "omit");

      expect(body).toEqual({});
    });

    it.skipIf(AS_ROOT)(
      "refuses a file that is there but cannot be read, even under omit",
      async ({ dir, other }) => {
        const { store, project } = open(dir, other);
        await project.write({ [TEMPLATE]: MAIN });
        await project.restrict(TEMPLATE, 0o000);

        const error = thrownBy(() => {
          return store.inlineReferences(aBrandingReferencing("./login.liquid"), "omit");
        });

        expect(error).toBeInstanceOf(ConfigError);
        expect(error).toMatchObject({ message: '$file "./login.liquid" cannot be read' });
      },
    );

    it.skipIf(AS_ROOT)(
      "carries the errno of a reference it may not read",
      async ({ dir, other }) => {
        const { store, project } = open(dir, other);
        await project.write({ [TEMPLATE]: MAIN });
        await project.restrict(TEMPLATE, 0o000);

        const error = thrownBy(() => {
          return store.inlineReferences(aBrandingReferencing("./login.liquid"), "omit");
        });

        expect(error).toMatchObject({ details: { code: "EACCES" } });
      },
    );

    it("refuses a reference that climbs out of the project", async ({ dir, other }) => {
      const { store } = open(dir, other);

      const error = thrownBy(() => {
        return store.inlineReferences(aBrandingReferencing("../../../outside.txt"), "omit");
      });

      expect(error).toBeInstanceOf(ConfigError);
      expect(error).toMatchObject({
        message: '$file "../../../outside.txt" points outside the project',
      });
    });

    it("refuses a reference through a symlink that leads outside the project", async ({
      dir,
      other,
    }) => {
      const { store, project } = open(dir, other);
      const outside = await project.outside({ "secret.txt": "secret" });
      await project.symlink(outside, `${CONFIG_DIRECTORIES.branding}/elsewhere`);

      const error = thrownBy(() => {
        return store.inlineReferences(aBrandingReferencing("./elsewhere/secret.txt"), "omit");
      });

      expect(error).toBeInstanceOf(ConfigError);
      expect(error).toMatchObject({
        message: '$file "./elsewhere/secret.txt" points outside the project',
      });
    });

    it("refuses a reference through a symlink that resolves nowhere", async ({ dir, other }) => {
      const { store, project } = open(dir, other);
      await project.symlink("gone", `${CONFIG_DIRECTORIES.branding}/dangling`);

      const error = thrownBy(() => {
        return store.inlineReferences(aBrandingReferencing("./dangling/x.liquid"), "omit");
      });

      expect(error).toBeInstanceOf(ConfigError);
      expect(error).toMatchObject({
        message: '$file "./dangling/x.liquid" points outside the project',
      });
    });
  });
});

describe("Store.listReferencedPaths", () => {
  describe.each(BACKENDS)("with a $name", ({ open }) => {
    it.for([
      [
        "each reference as a project-relative path",
        "../../templates/login.liquid",
        "templates/login.liquid",
      ],
      [
        "a reference whose file is missing",
        "./gone.liquid",
        `${CONFIG_DIRECTORIES.branding}/gone.liquid`,
      ],
    ] as const)("lists %s", async ([_reference, ref, path], { dir, other }) => {
      const { store } = open(dir, other);

      const paths = store.listReferencedPaths(aBrandingReferencing(ref));

      expect(paths).toEqual([path]);
    });

    it("refuses a reference that climbs out of the project", async ({ dir, other }) => {
      const { store } = open(dir, other);

      const error = thrownBy(() => {
        return store.listReferencedPaths(aBrandingReferencing("../../../outside.txt"));
      });

      expect(error).toBeInstanceOf(ConfigError);
      expect(error).toMatchObject({
        message: '$file "../../../outside.txt" points outside the project',
      });
    });
  });
});
