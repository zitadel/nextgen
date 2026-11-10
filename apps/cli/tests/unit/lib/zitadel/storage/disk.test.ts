import { chmod, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, vi } from "vitest";

import { CONFIG_DIRECTORIES, ConfigError, DiskStore } from "@/lib/zitadel";
import { it } from "@tests/helpers/fixtures";
import { write } from "@tests/helpers/git-repo";
import { aBrandingReferencing } from "@tests/helpers/stores";
import { rejectionOf, thrownBy } from "@tests/helpers/thrown-value";

/**
 * The files whose read is held back, by the milliseconds it is.
 */
const SLOW_READS = vi.hoisted(() => {
  return new Map<string, number>();
});

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    readFile: async (...args: Parameters<typeof actual.readFile>) => {
      const delay = SLOW_READS.get(String(args[0]));
      if (delay !== undefined) {
        await new Promise((resolve) => {
          setTimeout(resolve, delay);
        });
      }
      return actual.readFile(...args);
    },
  };
});

/**
 * A connection's file.
 */
const IDP = `${CONFIG_DIRECTORIES.connections}/a.json`;

/**
 * The template beside the branding file.
 */
const TEMPLATE = `${CONFIG_DIRECTORIES.branding}/login.liquid`;

/**
 * A template the tests write.
 */
const MAIN = "<main></main>";

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
 * `it` with a connections directory that no one may read, whose mode is given
 * back when the test ends so the temp directory can be removed.
 */
const itWithLockedConnections = it.extend<{ locked: string }>({
  locked: async ({ dir }, use) => {
    await write(dir, { [IDP]: "{}" });
    const directory = join(dir, CONFIG_DIRECTORIES.connections);
    await chmod(directory, 0o000);
    await use(dir);
    await chmod(directory, 0o755);
  },
});

describe("DiskStore.read", () => {
  it("hands a file that is not valid json on as unparsed, naming the line and column", async ({
    dir,
  }) => {
    await write(dir, { [IDP]: '{\n  "a": 1,\n  "b": "\\x"\n}' });

    const files = await new DiskStore(dir).read("connections");

    expect(files).toEqual([{ path: IDP, unparsed: "invalid JSON at line 3, column 10" }]);
  });

  it("names the line and column of an error the parser gives no position for", async ({ dir }) => {
    await write(dir, { [IDP]: `{\n  "secret": ${PASTED}\n}` });

    const files = await new DiskStore(dir).read("connections");

    expect(files).toEqual([{ path: IDP, unparsed: "invalid JSON at line 2, column 13" }]);
  });

  it("keeps the file's text out of the reason it could not be parsed", async ({ dir }) => {
    await write(dir, { [IDP]: `{"secret": ${PASTED}}` });

    const files = await new DiskStore(dir).read("connections");

    expect(JSON.stringify(files)).not.toContain(PASTED);
  });

  it("hands a directory named like a file on as unparsed, naming it", async ({ dir }) => {
    await mkdir(join(dir, IDP), { recursive: true });
    await write(dir, { [`${CONFIG_DIRECTORIES.connections}/b.json`]: "{}" });

    const files = await new DiskStore(dir).read("connections");

    expect(files).toEqual([
      { path: IDP, unparsed: "is a directory" },
      { path: `${CONFIG_DIRECTORIES.connections}/b.json`, body: {} },
    ]);
  });

  it.skipIf(AS_ROOT)("carries the errno of a file it may not read", async ({ dir }) => {
    await write(dir, { [IDP]: "{}" });
    await chmod(join(dir, IDP), 0o000);

    const error = await rejectionOf(() => {
      return new DiskStore(dir).read("connections");
    });

    expect(error).toMatchObject({
      message: `${IDP} cannot be read (EACCES)`,
      details: { file: IDP, code: "EACCES" },
    });
  });

  itWithLockedConnections.skipIf(AS_ROOT)(
    "carries the errno of a directory it may not read",
    async ({ locked }) => {
      const error = await rejectionOf(() => {
        return new DiskStore(locked).read("connections");
      });

      expect(error).toMatchObject({
        message: `${CONFIG_DIRECTORIES.connections} cannot be read (EACCES)`,
        details: { file: CONFIG_DIRECTORIES.connections, code: "EACCES" },
      });
    },
  );

  it("refuses a kind's directory that is a regular file, rather than finding no files", async ({
    dir,
  }) => {
    await write(dir, { [CONFIG_DIRECTORIES.connections]: "not a directory" });

    const error = await rejectionOf(() => {
      return new DiskStore(dir).read("connections");
    });

    expect(error).toMatchObject({
      message: `${CONFIG_DIRECTORIES.connections} cannot be read (ENOTDIR)`,
      details: { file: CONFIG_DIRECTORIES.connections, code: "ENOTDIR" },
    });
  });

  it("hands a file that holds json other than an object on as unparsed", async ({ dir }) => {
    await write(dir, { [IDP]: "[1, 2]" });

    const files = await new DiskStore(dir).read("connections");

    expect(files).toEqual([{ path: IDP, unparsed: "not a JSON object" }]);
  });

  it("keeps reading the files beside one that is not valid json", async ({ dir }) => {
    await write(dir, { [IDP]: "{ not json", [`${CONFIG_DIRECTORIES.connections}/b.json`]: "{}" });

    const files = await new DiskStore(dir).read("connections");

    expect(
      files.map((file) => {
        return file.path;
      }),
    ).toEqual([IDP, `${CONFIG_DIRECTORIES.connections}/b.json`]);
  });
});

describe("DiskStore.read when several files cannot be read", () => {
  it.skipIf(AS_ROOT)(
    "names the first in path order, whichever read fails first",
    async ({ dir }) => {
      const first = `${CONFIG_DIRECTORIES.connections}/a.json`;
      const second = `${CONFIG_DIRECTORIES.connections}/b.json`;
      await write(dir, { [first]: "{}", [second]: "{}" });
      await chmod(join(dir, first), 0o000);
      await chmod(join(dir, second), 0o000);
      SLOW_READS.set(join(dir, first), 50);

      const error = await rejectionOf(() => {
        return new DiskStore(dir).read("connections");
      });
      SLOW_READS.clear();

      expect(error).toMatchObject({ details: { file: first } });
    },
  );
});

describe("DiskStore.exists", () => {
  it("is true for a file that is there, parsed or not", async ({ dir }) => {
    await write(dir, { [IDP]: "{ not json" });

    const exists = await new DiskStore(dir).exists(IDP);

    expect(exists).toBe(true);
  });

  it("is false for a file that is not there", async ({ dir }) => {
    const exists = await new DiskStore(dir).exists(IDP);

    expect(exists).toBe(false);
  });

  it("is false for a path through a regular file", async ({ dir }) => {
    await write(dir, { [TEMPLATE]: MAIN });

    const exists = await new DiskStore(dir).exists(`${TEMPLATE}/x`);

    expect(exists).toBe(false);
  });

  it("rethrows an access error that is not an absent file", async ({ dir }) => {
    await symlink(join(dir, "loop"), join(dir, "loop"));

    const error = await rejectionOf(() => {
      return new DiskStore(dir).exists("loop");
    });

    expect(error).toMatchObject({ code: "ELOOP" });
  });
});

describe("DiskStore.write", () => {
  it("writes the body with its keys sorted, creating the directories", async ({ dir }) => {
    const store = new DiskStore(dir);

    await store.write({ path: IDP, body: { z: 1, a: { y: 2, b: 3 } } }, "create");

    expect(await readFile(join(dir, IDP), "utf8")).toBe(
      '{\n  "a": {\n    "b": 3,\n    "y": 2\n  },\n  "z": 1\n}\n',
    );
  });
});

describe("DiskStore.write outside .zitadel/", () => {
  const OUTSIDE = `${CONFIG_DIRECTORIES.schemas}/../../escaped.json`;

  it("refuses a path that climbs out of .zitadel/", async ({ dir }) => {
    const error = await rejectionOf(() => {
      return new DiskStore(dir).write({ path: OUTSIDE, body: {} }, "create");
    });

    expect(error).toBeInstanceOf(ConfigError);
    expect(error).toMatchObject({ message: `${OUTSIDE} points outside .zitadel/` });
  });

  it("writes nothing for it", async ({ dir }) => {
    await rejectionOf(() => {
      return new DiskStore(dir).write({ path: OUTSIDE, body: {} }, "create");
    });

    expect(await new DiskStore(dir).exists("escaped.json")).toBe(false);
  });

  it("refuses a path through a symlink that leads outside", async ({ dir }) => {
    await mkdir(join(dir, ".zitadel"), { recursive: true });
    await mkdir(join(dir, "elsewhere"));
    await symlink(join(dir, "elsewhere"), join(dir, ".zitadel/schemas"));

    const error = await rejectionOf(() => {
      return new DiskStore(dir).write(
        { path: `${CONFIG_DIRECTORIES.schemas}/x.json`, body: {} },
        "create",
      );
    });

    expect(error).toBeInstanceOf(ConfigError);
  });
});

describe("DiskStore.assertWritable", () => {
  it("refuses a path that climbs out of .zitadel/", ({ dir }) => {
    const error = thrownBy(() => {
      new DiskStore(dir).assertWritable(`${CONFIG_DIRECTORIES.schemas}/../../escaped.json`);
    });

    expect(error).toBeInstanceOf(ConfigError);
  });

  it("accepts a path inside .zitadel/", ({ dir }) => {
    const error = thrownBy(() => {
      new DiskStore(dir).assertWritable(`${CONFIG_DIRECTORIES.schemas}/user.json`);
    });

    expect(error).toBeUndefined();
  });
});

describe("DiskStore.writeText outside .zitadel/", () => {
  it("refuses a path outside .zitadel/", async ({ dir }) => {
    const error = await rejectionOf(() => {
      return new DiskStore(dir).writeText("README.md", MAIN, "create");
    });

    expect(error).toBeInstanceOf(ConfigError);
  });
});

describe("DiskStore.remove", () => {
  it("refuses a path outside .zitadel/, leaving the file", async ({ dir }) => {
    await write(dir, { "package.json": "{}" });

    const error = await rejectionOf(() => {
      return new DiskStore(dir).remove(`${CONFIG_DIRECTORIES.schemas}/../../package.json`);
    });

    expect(error).toBeInstanceOf(ConfigError);
    expect(await new DiskStore(dir).exists("package.json")).toBe(true);
  });
});

describe("DiskStore.writeText", () => {
  it("writes the text as given, creating the directories", async ({ dir }) => {
    const store = new DiskStore(dir);

    await store.writeText(TEMPLATE, MAIN, "create");

    expect(await readFile(join(dir, TEMPLATE), "utf8")).toBe(MAIN);
  });
});

describe("DiskStore.inlineReferences", () => {
  it("inlines a file through a symlink that stays inside the project", async ({ dir }) => {
    await write(dir, { "templates/login.liquid": MAIN });
    await mkdir(join(dir, CONFIG_DIRECTORIES.branding), { recursive: true });
    await symlink(join(dir, "templates"), join(dir, CONFIG_DIRECTORIES.branding, "templates"));

    const body = new DiskStore(dir).inlineReferences(
      aBrandingReferencing("./templates/login.liquid"),
      "throw",
    );

    expect(body).toEqual({ liquid_template: MAIN });
  });

  it("leaves out a reference through a regular file under omit", async ({ dir }) => {
    await write(dir, { [TEMPLATE]: MAIN });

    const body = new DiskStore(dir).inlineReferences(
      aBrandingReferencing("./login.liquid/x"),
      "omit",
    );

    expect(body).toEqual({});
  });

  it.skipIf(AS_ROOT)(
    "refuses a file that is there but cannot be read, even under omit",
    async ({ dir }) => {
      await write(dir, { [TEMPLATE]: MAIN });
      await chmod(join(dir, TEMPLATE), 0o000);

      const error = thrownBy(() => {
        return new DiskStore(dir).inlineReferences(aBrandingReferencing("./login.liquid"), "omit");
      });

      expect(error).toBeInstanceOf(ConfigError);
      expect(error).toMatchObject({ message: '$file "./login.liquid" cannot be read' });
    },
  );

  it.skipIf(AS_ROOT)("carries the errno of a reference it may not read", async ({ dir }) => {
    await write(dir, { [TEMPLATE]: MAIN });
    await chmod(join(dir, TEMPLATE), 0o000);

    const error = thrownBy(() => {
      return new DiskStore(dir).inlineReferences(aBrandingReferencing("./login.liquid"), "omit");
    });

    expect(error).toMatchObject({ details: { code: "EACCES" } });
  });

  it("refuses a reference through a symlink that leads outside the project", async ({
    dir,
    other,
  }) => {
    await writeFile(join(other, "secret.txt"), "secret");
    await mkdir(join(dir, CONFIG_DIRECTORIES.branding), { recursive: true });
    await symlink(other, join(dir, CONFIG_DIRECTORIES.branding, "elsewhere"));

    const error = thrownBy(() => {
      return new DiskStore(dir).inlineReferences(
        aBrandingReferencing("./elsewhere/secret.txt"),
        "omit",
      );
    });

    expect(error).toBeInstanceOf(ConfigError);
    expect(error).toMatchObject({
      message: '$file "./elsewhere/secret.txt" points outside the project',
    });
  });

  it("refuses a reference through a symlink that resolves nowhere", async ({ dir }) => {
    await mkdir(join(dir, CONFIG_DIRECTORIES.branding), { recursive: true });
    await symlink(join(dir, "gone"), join(dir, CONFIG_DIRECTORIES.branding, "dangling"));

    const error = thrownBy(() => {
      return new DiskStore(dir).inlineReferences(
        aBrandingReferencing("./dangling/x.liquid"),
        "omit",
      );
    });

    expect(error).toBeInstanceOf(ConfigError);
    expect(error).toMatchObject({
      message: '$file "./dangling/x.liquid" points outside the project',
    });
  });
});
