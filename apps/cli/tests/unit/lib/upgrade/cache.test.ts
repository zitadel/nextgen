import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Cache } from "@/lib/upgrade/cache";

let home: string;

const ONE = Date.now();
const TWO = ONE + 1;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "zitadel-cache-"));
});
afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

describe("Cache", () => {
  it("gives back what was set, to a later cache on the same file", async () => {
    const file = join(home, "cache.json");

    await new Cache(file).set("a", { checked_at: ONE, version: "1.0.0" });

    await expect(new Cache(file).get("a")).resolves.toEqual({ checked_at: ONE, version: "1.0.0" });
  });

  it("keeps the other keys when one is set", async () => {
    const cache = new Cache(join(home, "cache.json"));

    await cache.set("a", { checked_at: ONE });
    await cache.set("b", { checked_at: TWO });

    await expect(cache.get("a")).resolves.toEqual({ checked_at: ONE });
  });

  it("keeps both keys when two are set at once, and leaves no temporary file", async () => {
    const file = join(home, "cache.json");
    const cache = new Cache(file);

    await Promise.all([cache.set("a", { checked_at: ONE }), cache.set("b", { checked_at: TWO })]);

    expect([
      await new Cache(file).get("a"),
      await new Cache(file).get("b"),
      await readdir(home),
    ]).toEqual([{ checked_at: ONE }, { checked_at: TWO }, ["cache.json"]]);
  });

  it("has nothing for a key it was never given", async () => {
    await expect(new Cache(join(home, "cache.json")).get("a")).resolves.toBeUndefined();
  });

  it("remembers for the life of the instance without a file", async () => {
    const cache = new Cache(undefined);

    await cache.set("a", { checked_at: Date.now() });

    await expect(cache.get("a")).resolves.toBeDefined();
  });

  it("remembers nothing for a later instance without a file", async () => {
    await new Cache(undefined).set("a", { checked_at: Date.now() });

    await expect(new Cache(undefined).get("a")).resolves.toBeUndefined();
  });

  it("leaves out of the rewrite an entry older than a month", async () => {
    const file = join(home, "cache.json");
    const old = Date.now() - 40 * 24 * 60 * 60 * 1000;
    await writeFile(file, JSON.stringify({ stale: { checked_at: old } }));

    await new Cache(file).set("fresh", { checked_at: Date.now() });

    expect(Object.keys(JSON.parse(await readFile(file, "utf8")))).toEqual(["fresh"]);
  });

  it("removes its temporary file when the file cannot be replaced", async () => {
    await mkdir(join(home, "cache.json"));

    await new Cache(join(home, "cache.json")).set("a", { checked_at: ONE });

    expect(await readdir(home)).toEqual(["cache.json"]);
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
      new Cache(join(file, "cache.json")).set("a", { checked_at: ONE }),
    ).resolves.toBeUndefined();
  });

  it("writes JSON where it was told to", async () => {
    const file = join(home, "cache.json");

    await new Cache(file).set("a", { checked_at: ONE });

    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ a: { checked_at: ONE } });
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
        checked_at: ONE,
        dist_tag: "latest",
        registry: "https://r",
        version: "1.0.0",
      }),
    );

    await new Cache(file).set("a", { checked_at: TWO });

    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ a: { checked_at: TWO } });
  });

  it("leaves no temporary file behind", async () => {
    const file = join(home, "cache.json");

    await new Cache(file).set("a", { checked_at: ONE });

    expect(await readdir(home)).toEqual(["cache.json"]);
  });
});
