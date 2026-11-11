import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect } from "vitest";

import { readPackageJson, readPackageJsonIfExists } from "@/lib/npm";
import { it } from "@tests/helpers/fixtures";

describe("readPackageJson", () => {
  it("returns the typed contents of package.json", async ({ dir }) => {
    await writeFile(join(dir, "package.json"), '{"name":"demo","dependencies":{"a":"1.0.0"}}');

    const pkg = await readPackageJson(dir);

    expect(pkg.dependencies).toEqual({ a: "1.0.0" });
  });

  it("throws when there is no package.json", async ({ dir }) => {
    await expect(readPackageJson(dir)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("throws on invalid JSON", async ({ dir }) => {
    await writeFile(join(dir, "package.json"), "{ nope");

    await expect(readPackageJson(dir)).rejects.toThrow(SyntaxError);
  });

  it("throws when the root is not an object, naming the file", async ({ dir }) => {
    await writeFile(join(dir, "package.json"), "[]");

    await expect(readPackageJson(dir)).rejects.toThrow(/package\.json must contain a JSON object/);
  });
});

describe("readPackageJsonIfExists", () => {
  it("returns undefined when there is no package.json", async ({ dir }) => {
    expect(await readPackageJsonIfExists(dir)).toBeUndefined();
  });

  it("returns the contents when there is one", async ({ dir }) => {
    await writeFile(join(dir, "package.json"), '{"name":"demo"}');

    expect(await readPackageJsonIfExists(dir)).toEqual({ name: "demo" });
  });

  it("still throws on a corrupt package.json", async ({ dir }) => {
    await writeFile(join(dir, "package.json"), "{ nope");

    await expect(readPackageJsonIfExists(dir)).rejects.toThrow(SyntaxError);
  });
});
