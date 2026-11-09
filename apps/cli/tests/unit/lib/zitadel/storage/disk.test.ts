import { chmod, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect } from "vitest";

import { CONFIG_DIRECTORIES, ConfigError, DiskStore } from "@/lib/zitadel";
import { it } from "@tests/helpers/fixtures";
import { write } from "@tests/helpers/git-repo";
import { aBrandingReferencing } from "@tests/helpers/stores";
import { rejectionOf, thrownBy } from "@tests/helpers/thrown-value";

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
 * Whether the tests run as root, whom no file mode keeps out.
 */
const AS_ROOT = process.getuid?.() === 0;

describe("DiskStore.read", () => {
  it("refuses a file that is not valid json", async ({ dir }) => {
    await write(dir, { [IDP]: "{ not json" });

    const error = await rejectionOf(() => {
      return new DiskStore(dir).read("connections");
    });

    expect(error).toBeInstanceOf(ConfigError);
    expect(error).toMatchObject({ message: `${IDP} is not valid JSON` });
  });

  it("keeps the file's text out of a parse failure", async ({ dir }) => {
    await write(dir, { [IDP]: '{"secret": sk_live_123}' });

    const error = await rejectionOf(() => {
      return new DiskStore(dir).read("connections");
    });

    expect(error).toBeInstanceOf(ConfigError);
    expect(error).toMatchObject({
      details: { file: IDP, parse_error: expect.not.stringContaining("sk_live_123") },
    });
  });

  it("reports a file that cannot be read as unreadable, not as invalid json", async ({ dir }) => {
    await mkdir(join(dir, IDP), { recursive: true });

    const error = await rejectionOf(() => {
      return new DiskStore(dir).read("connections");
    });

    expect(error).toBeInstanceOf(ConfigError);
    expect(error).toMatchObject({
      message: `${IDP} cannot be read (EISDIR)`,
      details: { file: IDP, code: "EISDIR" },
    });
  });

  it("refuses a file that holds json other than an object", async ({ dir }) => {
    await write(dir, { [IDP]: "[1, 2]" });

    const error = await rejectionOf(() => {
      return new DiskStore(dir).read("connections");
    });

    expect(error).toBeInstanceOf(ConfigError);
    expect(error).toMatchObject({ message: `${IDP} does not contain a JSON object` });
  });
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
