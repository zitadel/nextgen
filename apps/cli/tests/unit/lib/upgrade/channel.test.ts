import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { http, HttpResponse } from "msw";
import { describe, expect } from "vitest";

import { Cache } from "@/lib/upgrade/cache";
import { ReleaseChannel } from "@/lib/upgrade/channel";
import { test } from "@tests/helpers/fixtures";

const REGISTRY = "https://registry.npmjs.org";
const MIRROR = "https://mirror.example/npm";

const DAY = 25 * 60 * 60 * 1000;
const KEY = `${REGISTRY}/@acme/cli#latest`;

/** `it` with the registry the channel asks, what it was asked, and the cache file it keeps. */
const it = test.extend<{
  requests: string[];
  publishes: (tags: Record<string, string>, registry?: string) => void;
  down: () => void;
  channel: (options?: { distTag?: string; registry?: string; file?: string }) => ReleaseChannel;
  cacheHolds: (entries: Record<string, unknown>) => Promise<void>;
}>({
  // biome-ignore lint/correctness/noEmptyPattern: Vitest requires a destructured first argument.
  requests: ({}, use) => {
    return use([]);
  },
  publishes: ({ requests, server }, use) => {
    return use((tags, registry = REGISTRY) => {
      server.use(
        http.get(`${registry}/-/package/@acme%2fcli/dist-tags`, ({ request }) => {
          requests.push(request.url);
          return HttpResponse.json(tags);
        }),
      );
    });
  },
  down: ({ requests, server }, use) => {
    return use(() => {
      server.use(
        http.get(`${REGISTRY}/-/package/@acme%2fcli/dist-tags`, () => {
          requests.push("asked");
          return HttpResponse.error();
        }),
      );
    });
  },
  channel: ({ dir }, use) => {
    return use((options = {}) => {
      return new ReleaseChannel({
        packageName: "@acme/cli",
        distTag: options.distTag ?? "latest",
        registry: options.registry ?? REGISTRY,
        cache: new Cache(options.file ?? join(dir, "cache.json")),
      });
    });
  },
  cacheHolds: ({ dir }, use) => {
    return use(async (entries) => {
      await writeFile(join(dir, "cache.json"), JSON.stringify(entries));
    });
  },
});

describe("ReleaseChannel.latest", () => {
  it("reads the version on the dist-tag it is given", async ({ channel, publishes, dir }) => {
    publishes({ latest: "2.0.0", alpha: "3.0.0-alpha.1" });

    const stable = await channel().latest();
    const alpha = await channel({ distTag: "alpha", file: join(dir, "other.json") }).latest();

    expect([stable?.version, alpha?.version]).toEqual(["2.0.0", "3.0.0-alpha.1"]);
  });

  it("writes every slash of the package name as %2f", async ({ dir, server }) => {
    server.use(
      http.get(`${REGISTRY}/-/package/@acme%2fcli%2fextra/dist-tags`, () => {
        return HttpResponse.json({ latest: "2.0.0" });
      }),
    );
    const nested = new ReleaseChannel({
      packageName: "@acme/cli/extra",
      distTag: "latest",
      registry: REGISTRY,
      cache: new Cache(join(dir, "nested.json")),
    });

    expect((await nested.latest())?.version).toBe("2.0.0");
  });

  it("asks the registry it is given", async ({ channel, publishes }) => {
    publishes({ latest: "2.0.0" }, MIRROR);

    const release = await channel({ registry: MIRROR }).latest();

    expect(release?.version).toBe("2.0.0");
  });

  it("asks at most once a day", async ({ channel, publishes, requests }) => {
    publishes({ latest: "2.0.0" });

    await channel().latest();
    await channel().latest();

    expect(requests).toHaveLength(1);
  });

  it("asks again once the answer is a day old", async ({ channel, publishes, cacheHolds }) => {
    await cacheHolds({ [KEY]: { checked_at: Date.now() - DAY, version: "1.5.0" } });
    publishes({ latest: "2.0.0" });

    expect((await channel().latest())?.version).toBe("2.0.0");
  });

  it("asks again when the answer claims to be from the future", async ({
    channel,
    publishes,
    cacheHolds,
  }) => {
    await cacheHolds({ [KEY]: { checked_at: Date.now() + DAY, version: "1.5.0" } });
    publishes({ latest: "2.0.0" });

    expect((await channel().latest())?.version).toBe("2.0.0");
  });

  it("does not take another dist-tag's or another registry's answer", async ({
    channel,
    publishes,
    cacheHolds,
  }) => {
    await cacheHolds({
      [`${REGISTRY}/@acme/cli#alpha`]: { checked_at: Date.now(), version: "9.0.0-alpha.1" },
      [`${MIRROR}/@acme/cli#latest`]: { checked_at: Date.now(), version: "9.0.0" },
    });
    publishes({ latest: "2.0.0" });

    expect((await channel().latest())?.version).toBe("2.0.0");
  });

  it("keeps what it knew when the registry stops answering", async ({
    channel,
    down,
    cacheHolds,
  }) => {
    await cacheHolds({ [KEY]: { checked_at: Date.now() - DAY, version: "1.5.0" } });
    down();

    expect((await channel().latest())?.version).toBe("1.5.0");
  });

  it("remembers a failed lookup, so an offline machine waits only once an hour", async ({
    channel,
    down,
    requests,
  }) => {
    down();

    const first = await channel().latest();
    await channel().latest();

    expect([first, requests]).toEqual([undefined, ["asked"]]);
  });

  it("asks again once a remembered failure is an hour old", async ({
    channel,
    publishes,
    cacheHolds,
  }) => {
    await cacheHolds({ [KEY]: { checked_at: Date.now() - 2 * 60 * 60 * 1000, failed: true } });
    publishes({ latest: "2.0.0" });

    expect((await channel().latest())?.version).toBe("2.0.0");
  });

  it("does not make an old answer look current when the lookup that followed it failed", async ({
    channel,
    down,
    cacheHolds,
    dir,
  }) => {
    await cacheHolds({ [KEY]: { checked_at: Date.now() - DAY, version: "1.5.0" } });
    down();

    await channel().latest();

    expect(JSON.parse(await readFile(join(dir, "cache.json"), "utf8"))[KEY]).toMatchObject({
      version: "1.5.0",
      failed: true,
    });
  });

  it("asks again within a day when what it knows came from a failed lookup", async ({
    channel,
    publishes,
    cacheHolds,
  }) => {
    await cacheHolds({
      [KEY]: { checked_at: Date.now() - 2 * 60 * 60 * 1000, version: "1.5.0", failed: true },
    });
    publishes({ latest: "2.0.0" });

    expect((await channel().latest())?.version).toBe("2.0.0");
  });

  it("does not carry another registry's answer past a failed lookup", async ({
    channel,
    down,
    cacheHolds,
  }) => {
    await cacheHolds({
      [`${MIRROR}/@acme/cli#latest`]: { checked_at: Date.now() - DAY, version: "9.0.0" },
    });
    down();

    await expect(channel().latest()).resolves.toBeUndefined();
  });

  it("does not take another registry's failure", async ({ channel, publishes, cacheHolds }) => {
    await cacheHolds({ [`${MIRROR}/@acme/cli#latest`]: { checked_at: Date.now(), failed: true } });
    publishes({ latest: "2.0.0" });

    expect((await channel().latest())?.version).toBe("2.0.0");
  });

  it("skips the cache when asked for a fresh answer", async ({
    channel,
    publishes,
    cacheHolds,
  }) => {
    await cacheHolds({ [KEY]: { checked_at: Date.now(), version: "1.5.0" } });
    publishes({ latest: "2.0.0" });

    expect((await channel().latest({ fresh: true }))?.version).toBe("2.0.0");
  });

  it("answers nothing fresh when the registry is down, whatever it knew", async ({
    channel,
    down,
    cacheHolds,
  }) => {
    await cacheHolds({ [KEY]: { checked_at: Date.now(), version: "1.5.0" } });
    down();

    await expect(channel().latest({ fresh: true })).resolves.toBeUndefined();
  });

  it("leaves the cache as it was when a fresh lookup fails", async ({
    channel,
    down,
    cacheHolds,
    dir,
  }) => {
    const held = { [KEY]: { checked_at: DAY, version: "1.5.0" } };
    await cacheHolds(held);
    down();

    await channel().latest({ fresh: true });

    expect(JSON.parse(await readFile(join(dir, "cache.json"), "utf8"))).toEqual(held);
  });

  it("does not take a value that is not a version", async ({ channel, publishes }) => {
    publishes({ latest: "not-a-version" });

    await expect(channel().latest()).resolves.toBeUndefined();
  });

  it("does not take a cached value that is not a version, nor write it back", async ({
    channel,
    down,
    cacheHolds,
    dir,
  }) => {
    await cacheHolds({ [KEY]: { checked_at: Date.now() - DAY, version: "\u001b[2Jwiped" } });
    down();

    const release = await channel().latest();

    expect(release).toBeUndefined();
    expect(await readFile(join(dir, "cache.json"), "utf8")).not.toContain("wiped");
  });

  it("survives a home it cannot write to", async ({ channel, publishes, dir }) => {
    const file = join(dir, "taken");
    await writeFile(file, "");
    publishes({ latest: "2.0.0" });

    const release = await channel({ file: join(file, "cache.json") }).latest();

    expect(release?.version).toBe("2.0.0");
  });
});
