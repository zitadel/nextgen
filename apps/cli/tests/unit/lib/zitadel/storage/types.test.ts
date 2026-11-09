import { describe, expect } from "vitest";

import {
  CONFIG_DIRECTORIES,
  type ConfigFile,
  ConfigError,
  DiskStore,
  FileExistsError,
  MemoryStore,
} from "@/lib/zitadel";
import type { ConfigStore } from "@/lib/zitadel/storage/types";
import { it } from "@tests/helpers/fixtures";
import { write } from "@tests/helpers/git-repo";
import { aBrandingReferencing } from "@tests/helpers/stores";
import { rejectionOf, thrownBy } from "@tests/helpers/thrown-value";

/**
 * What a store holds before a test acts on it.
 */
type Held = Readonly<{
  /**
   * The configuration files.
   */
  documents?: readonly ConfigFile[];
  /**
   * Other files, such as templates, by project-relative path.
   */
  texts?: Readonly<Record<string, string>>;
}>;

/**
 * Opens a store holding what a test arranges.
 *
 * @param dir - A temporary directory the store may keep its files in.
 * @param held - What the store holds.
 * @returns The store.
 */
type Open = (dir: string, held?: Held) => Promise<ConfigStore>;

/**
 * A store over `dir`, with each file written there first.
 *
 * @param dir - The project directory.
 * @param held - What to write.
 * @returns The store.
 */
const onDisk: Open = async (dir, held = {}) => {
  const { documents = [], texts = {} } = held;
  await write(dir, {
    ...Object.fromEntries(
      documents.map((file) => {
        return [file.path, JSON.stringify(file.body)];
      }),
    ),
    ...texts,
  });
  return new DiskStore(dir);
};

/**
 * A store holding each file in memory.
 *
 * @param _dir - Unused.
 * @param held - What to hold.
 * @returns The store.
 */
const inMemory: Open = (_dir, held = {}) => {
  return Promise.resolve(new MemoryStore(held.documents, held.texts));
};

/**
 * Every store, each held to the same contract.
 */
const STORES: readonly (readonly [string, Open])[] = [
  ["DiskStore", onDisk],
  ["MemoryStore", inMemory],
];

/**
 * A connection's file.
 */
const IDP_A = `${CONFIG_DIRECTORIES.connections}/a.json`;

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

describe("ConfigStore.read", () => {
  describe.each(STORES)("with a %s", (_store, open) => {
    it("reads every json file of a kind, in file-name order", async ({ dir }) => {
      const store = await open(dir, {
        documents: [
          { path: IDP_B, body: { slug: "b" } },
          { path: IDP_A, body: { slug: "a" } },
        ],
      });

      const files = await store.read("connections");

      expect(files).toEqual([
        { path: IDP_A, body: { slug: "a" } },
        { path: IDP_B, body: { slug: "b" } },
      ]);
    });

    it.for([
      [
        "a file of another kind",
        { documents: [{ path: `${CONFIG_DIRECTORIES.flows}/login.json`, body: {} }] },
      ],
      [
        "a file in a directory beneath the kind's",
        { documents: [{ path: `${CONFIG_DIRECTORIES.connections}/nested/a.json`, body: {} }] },
      ],
      [
        "a file that is not json",
        { texts: { [`${CONFIG_DIRECTORIES.connections}/README.md`]: "# notes" } },
      ],
    ] as const)("skips %s", async ([_file, held], { dir }) => {
      const store = await open(dir, held);

      const files = await store.read("connections");

      expect(files).toEqual([]);
    });

    it("finds nothing when it holds nothing", async ({ dir }) => {
      const store = await open(dir);

      const files = await store.read("connections");

      expect(files).toEqual([]);
    });
  });
});

describe("ConfigStore.exists", () => {
  describe.each(STORES)("with a %s", (_store, open) => {
    it("is true for a configuration file it holds", async ({ dir }) => {
      const store = await open(dir, { documents: [{ path: IDP_A, body: {} }] });

      const exists = await store.exists(IDP_A);

      expect(exists).toBe(true);
    });

    it("is true for another file it holds", async ({ dir }) => {
      const store = await open(dir, { texts: { [TEMPLATE]: MAIN } });

      const exists = await store.exists(TEMPLATE);

      expect(exists).toBe(true);
    });

    it("is false for a file it does not hold", async ({ dir }) => {
      const store = await open(dir);

      const exists = await store.exists(IDP_A);

      expect(exists).toBe(false);
    });
  });
});

describe("ConfigStore.write", () => {
  describe.each(STORES)("with a %s", (_store, open) => {
    it("holds the body it was given", async ({ dir }) => {
      const store = await open(dir);

      await store.write({ path: IDP_A, body: { slug: "a" } }, "create");

      expect(await store.read("connections")).toEqual([{ path: IDP_A, body: { slug: "a" } }]);
    });

    it.for([
      ["a configuration file", { documents: [{ path: IDP_A, body: {} }] }],
      ["another file", { texts: { [IDP_A]: "{}" } }],
    ] as const)("refuses to replace %s under create", async ([_file, held], { dir }) => {
      const store = await open(dir, held);

      const error = await rejectionOf(() => {
        return store.write({ path: IDP_A, body: { slug: "a" } }, "create");
      });

      expect(error).toBeInstanceOf(FileExistsError);
      expect(error).toMatchObject({ path: IDP_A });
    });

    it("replaces a file under replace", async ({ dir }) => {
      const store = await open(dir, { documents: [{ path: IDP_A, body: {} }] });

      await store.write({ path: IDP_A, body: { slug: "a" } }, "replace");

      expect(await store.read("connections")).toEqual([{ path: IDP_A, body: { slug: "a" } }]);
    });
  });
});

describe("ConfigStore.remove", () => {
  describe.each(STORES)("with a %s", (_store, open) => {
    it("deletes the file", async ({ dir }) => {
      const store = await open(dir, { documents: [{ path: IDP_A, body: {} }] });

      await store.remove(IDP_A);

      expect(await store.exists(IDP_A)).toBe(false);
    });

    it("takes a file it does not hold as already deleted", async ({ dir }) => {
      const store = await open(dir);

      const error = await rejectionOf(() => {
        return store.remove(IDP_A);
      });

      expect(error).toBeUndefined();
    });
  });
});

describe("ConfigStore.writeText", () => {
  describe.each(STORES)("with a %s", (_store, open) => {
    it("holds the text for a reference to read", async ({ dir }) => {
      const store = await open(dir);

      await store.writeText(TEMPLATE, MAIN, "create");

      expect(store.inlineReferences(aBrandingReferencing("./login.liquid"), "throw")).toEqual({
        liquid_template: MAIN,
      });
    });

    it("refuses to replace a file under create", async ({ dir }) => {
      const store = await open(dir, { texts: { [TEMPLATE]: "old" } });

      const error = await rejectionOf(() => {
        return store.writeText(TEMPLATE, "new", "create");
      });

      expect(error).toBeInstanceOf(FileExistsError);
      expect(error).toMatchObject({ path: TEMPLATE });
    });

    it("replaces a file under replace", async ({ dir }) => {
      const store = await open(dir, { texts: { [TEMPLATE]: "old" } });

      await store.writeText(TEMPLATE, "new", "replace");

      expect(store.inlineReferences(aBrandingReferencing("./login.liquid"), "throw")).toEqual({
        liquid_template: "new",
      });
    });
  });
});

describe("ConfigStore outside .zitadel/", () => {
  describe.each(STORES)("with a %s", (_store, open) => {
    const OUTSIDE = `${CONFIG_DIRECTORIES.schemas}/../../escaped.json`;

    it.for([
      [
        "write",
        (store: ConfigStore) => {
          return store.write({ path: OUTSIDE, body: {} }, "create");
        },
      ],
      [
        "writeText",
        (store: ConfigStore) => {
          return store.writeText(OUTSIDE, MAIN, "create");
        },
      ],
      [
        "remove",
        (store: ConfigStore) => {
          return store.remove(OUTSIDE);
        },
      ],
    ] as const)("refuses %s of a path outside it", async ([_call, act], { dir }) => {
      const store = await open(dir);

      const error = await rejectionOf(() => {
        return act(store);
      });

      expect(error).toBeInstanceOf(ConfigError);
      expect(error).toMatchObject({ message: `${OUTSIDE} points outside .zitadel/` });
    });

    it("refuses to hold a file written outside it", async ({ dir }) => {
      const store = await open(dir);

      await rejectionOf(() => {
        return store.writeText("escaped.json", MAIN, "create");
      });

      expect(await store.exists("escaped.json")).toBe(false);
    });

    it("reports a path outside it as not writable, and one inside as writable", async ({ dir }) => {
      const store = await open(dir);

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

describe("ConfigStore.inlineReferences", () => {
  describe.each(STORES)("with a %s", (_store, open) => {
    it.for([
      ["beside the one that references it", TEMPLATE, "./login.liquid"],
      ["elsewhere in the project", "templates/login.liquid", "../../templates/login.liquid"],
    ] as const)("inlines a file %s", async ([_where, path, ref], { dir }) => {
      const store = await open(dir, { texts: { [path]: MAIN } });

      const body = store.inlineReferences(aBrandingReferencing(ref), "throw");

      expect(body).toEqual({ liquid_template: MAIN });
    });

    it("refuses a missing reference under throw", async ({ dir }) => {
      const store = await open(dir);

      const error = thrownBy(() => {
        return store.inlineReferences(aBrandingReferencing("./gone.liquid"), "throw");
      });

      expect(error).toBeInstanceOf(ConfigError);
      expect(error).toMatchObject({ message: '$file "./gone.liquid" cannot be read' });
    });

    it("leaves out a missing reference under omit", async ({ dir }) => {
      const store = await open(dir);

      const body = store.inlineReferences(aBrandingReferencing("./gone.liquid"), "omit");

      expect(body).toEqual({});
    });

    it("refuses a reference that climbs out of the project", async ({ dir }) => {
      const store = await open(dir);

      const error = thrownBy(() => {
        return store.inlineReferences(aBrandingReferencing("../../../outside.txt"), "omit");
      });

      expect(error).toBeInstanceOf(ConfigError);
      expect(error).toMatchObject({
        message: '$file "../../../outside.txt" points outside the project',
      });
    });
  });
});

describe("ConfigStore.listReferencedPaths", () => {
  describe.each(STORES)("with a %s", (_store, open) => {
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
    ] as const)("lists %s", async ([_reference, ref, path], { dir }) => {
      const store = await open(dir);

      const paths = store.listReferencedPaths(aBrandingReferencing(ref));

      expect(paths).toEqual([path]);
    });

    it("refuses a reference that climbs out of the project", async ({ dir }) => {
      const store = await open(dir);

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
