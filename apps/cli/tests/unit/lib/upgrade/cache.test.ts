import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Cache } from "@/lib/upgrade/cache";

let home: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "zitadel-cache-"));
});
afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

describe("Cache", () => {
  it("gives back what was set, to a later cache on the same file", async () => {
    const file = join(home, "cache.json");

    await new Cache(file).set("a", { checked_at: 1, version: "1.0.0" });

    await expect(new Cache(file).get("a")).resolves.toEqual({ checked_at: 1, version: "1.0.0" });
  });

  it("keeps the other keys when one is set", async () => {
    const cache = new Cache(join(home, "cache.json"));

    await cache.set("a", { checked_at: 1 });
    await cache.set("b", { checked_at: 2 });

    await expect(cache.get("a")).resolves.toEqual({ checked_at: 1 });
  });

  it("has nothing for a key it was never given", async () => {
    await expect(new Cache(join(home, "cache.json")).get("a")).resolves.toBeUndefined();
  });

  it("remembers nothing without a file", async () => {
    const cache = new Cache(undefined);

    await cache.set("a", { checked_at: 1 });

    await expect(cache.get("a")).resolves.toBeUndefined();
  });

  it.each(["not json", "null", "[]", '"text"'])(
    "treats a file holding %s as empty",
    async (text) => {
      const file = join(home, "cache.json");
      await writeFile(file, text);

      await expect(new Cache(file).get("a")).resolves.toBeUndefined();
    },
  );

  it("ignores an entry without a timestamp", async () => {
    const file = join(home, "cache.json");
    await writeFile(file, JSON.stringify({ a: { version: "1.0.0" } }));

    await expect(new Cache(file).get("a")).resolves.toBeUndefined();
  });

  it("survives a home it cannot write to", async () => {
    const file = join(home, "taken");
    await writeFile(file, "");

    await expect(
      new Cache(join(file, "cache.json")).set("a", { checked_at: 1 }),
    ).resolves.toBeUndefined();
  });

  it("writes JSON where it was told to", async () => {
    const file = join(home, "cache.json");

    await new Cache(file).set("a", { checked_at: 1 });

    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ a: { checked_at: 1 } });
  });

  it.each(["null", "5", '"text"', "[]"])("ignores a key holding %s", async (value) => {
    const file = join(home, "cache.json");
    await writeFile(file, `{"a": ${value}}`);

    await expect(new Cache(file).get("a")).resolves.toBeUndefined();
  });

  it("drops the keys of the older flat format the first time it keeps something", async () => {
    const file = join(home, "cache.json");
    await writeFile(
      file,
      JSON.stringify({
        checked_at: 1,
        dist_tag: "latest",
        registry: "https://r",
        version: "1.0.0",
      }),
    );

    await new Cache(file).set("a", { checked_at: 2 });

    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ a: { checked_at: 2 } });
  });

  it("leaves no temporary file behind", async () => {
    const file = join(home, "cache.json");

    await new Cache(file).set("a", { checked_at: 1 });

    expect(await readdir(home)).toEqual(["cache.json"]);
  });
});
