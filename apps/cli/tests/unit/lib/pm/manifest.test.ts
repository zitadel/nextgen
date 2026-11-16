import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect } from "vitest";

import { PM } from "@/lib/pm";
import { it } from "@tests/helpers/fixtures";

describe("PM.manifest", () => {
  it("returns the typed contents of package.json", async ({ dir }) => {
    await writeFile(join(dir, "package.json"), '{"name":"demo","dependencies":{"a":"1.0.0"}}');

    const json = await PM.manifest(dir);

    expect(json.dependencies).toEqual({ a: "1.0.0" });
  });

  it("throws when there is no package.json", async ({ dir }) => {
    await expect(PM.manifest(dir)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("throws on invalid JSON", async ({ dir }) => {
    await writeFile(join(dir, "package.json"), "{ nope");

    await expect(PM.manifest(dir)).rejects.toThrow(SyntaxError);
  });

  it("throws when the root is not an object, naming the file", async ({ dir }) => {
    await writeFile(join(dir, "package.json"), "[]");

    await expect(PM.manifest(dir)).rejects.toThrow(/package\.json must contain a JSON object/);
  });
});

describe("PM.manifestIfExists", () => {
  it("returns undefined when there is no package.json", async ({ dir }) => {
    expect(await PM.manifestIfExists(dir)).toBeUndefined();
  });

  it("returns the contents when there is one", async ({ dir }) => {
    await writeFile(join(dir, "package.json"), '{"name":"demo"}');

    expect(await PM.manifestIfExists(dir)).toEqual({ name: "demo" });
  });

  it("still throws on a corrupt package.json", async ({ dir }) => {
    await writeFile(join(dir, "package.json"), "{ nope");

    await expect(PM.manifestIfExists(dir)).rejects.toThrow(SyntaxError);
  });
});
