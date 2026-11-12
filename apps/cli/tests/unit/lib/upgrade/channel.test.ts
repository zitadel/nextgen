import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { Cache } from "@/lib/upgrade/cache";
import { ReleaseChannel } from "@/lib/upgrade/channel";

const REGISTRY = "https://registry.npmjs.org";
const MIRROR = "https://mirror.example/npm";

const server = setupServer();
let home: string;
let requests: string[];

function publishes(tags: Record<string, string>, registry = REGISTRY): void {
  server.use(
    http.get(`${registry}/-/package/@acme%2fcli/dist-tags`, ({ request }) => {
      requests.push(request.url);
      return HttpResponse.json(tags);
    }),
  );
}

function down(): void {
  server.use(
    http.get(`${REGISTRY}/-/package/@acme%2fcli/dist-tags`, () => {
      requests.push("asked");
      return HttpResponse.error();
    }),
  );
}

function channel(options: { distTag?: string; registry?: string; file?: string } = {}) {
  return new ReleaseChannel({
    packageName: "@acme/cli",
    distTag: options.distTag ?? "latest",
    registry: options.registry ?? REGISTRY,
    cache: new Cache(options.file ?? join(home, "cache.json")),
  });
}

async function cacheHolds(entries: Record<string, unknown>): Promise<void> {
  await writeFile(join(home, "cache.json"), JSON.stringify(entries));
}

const DAY = 25 * 60 * 60 * 1000;
const KEY = `${REGISTRY}/@acme/cli#latest`;

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "zitadel-channel-"));
  requests = [];
});
afterEach(async () => {
  server.resetHandlers();
  await rm(home, { recursive: true, force: true });
});

describe("ReleaseChannel.latest", () => {
  it("reads the version on the dist-tag it is given", async () => {
    publishes({ latest: "2.0.0", alpha: "3.0.0-alpha.1" });

    const stable = await channel().latest();
    const alpha = await channel({ distTag: "alpha", file: join(home, "other.json") }).latest();

    expect([stable?.version, alpha?.version]).toEqual(["2.0.0", "3.0.0-alpha.1"]);
  });

  it("asks the registry it is given", async () => {
    publishes({ latest: "2.0.0" }, MIRROR);

    const release = await channel({ registry: MIRROR }).latest();

    expect(release?.version).toBe("2.0.0");
  });

  it("asks at most once a day", async () => {
    publishes({ latest: "2.0.0" });

    await channel().latest();
    await channel().latest();

    expect(requests).toHaveLength(1);
  });

  it("asks again once the answer is a day old", async () => {
    await cacheHolds({ [KEY]: { checked_at: Date.now() - DAY, version: "1.5.0" } });
    publishes({ latest: "2.0.0" });

    expect((await channel().latest())?.version).toBe("2.0.0");
  });

  it("asks again when the answer claims to be from the future", async () => {
    await cacheHolds({ [KEY]: { checked_at: Date.now() + DAY, version: "1.5.0" } });
    publishes({ latest: "2.0.0" });

    expect((await channel().latest())?.version).toBe("2.0.0");
  });

  it("does not take another dist-tag's or another registry's answer", async () => {
    await cacheHolds({
      [`${REGISTRY}/@acme/cli#alpha`]: { checked_at: Date.now(), version: "9.0.0-alpha.1" },
      [`${MIRROR}/@acme/cli#latest`]: { checked_at: Date.now(), version: "9.0.0" },
    });
    publishes({ latest: "2.0.0" });

    expect((await channel().latest())?.version).toBe("2.0.0");
  });

  it("keeps what it knew when the registry stops answering", async () => {
    await cacheHolds({ [KEY]: { checked_at: Date.now() - DAY, version: "1.5.0" } });
    down();

    expect((await channel().latest())?.version).toBe("1.5.0");
  });

  it("remembers a failed lookup, so an offline machine waits only once a day", async () => {
    down();

    const first = await channel().latest();
    await channel().latest();

    expect([first, requests]).toEqual([undefined, ["asked"]]);
  });

  it("skips the cache when asked for a fresh answer", async () => {
    await cacheHolds({ [KEY]: { checked_at: Date.now(), version: "1.5.0" } });
    publishes({ latest: "2.0.0" });

    expect((await channel().latest({ fresh: true }))?.version).toBe("2.0.0");
  });

  it("answers nothing fresh when the registry is down, whatever it knew", async () => {
    await cacheHolds({ [KEY]: { checked_at: Date.now(), version: "1.5.0" } });
    down();

    await expect(channel().latest({ fresh: true })).resolves.toBeUndefined();
  });

  it("does not take a value that is not a version", async () => {
    publishes({ latest: "not-a-version" });

    await expect(channel().latest()).resolves.toBeUndefined();
  });

  it("does not take a cached value that is not a version, nor write it back", async () => {
    await cacheHolds({ [KEY]: { checked_at: Date.now() - DAY, version: "\u001b[2Jwiped" } });
    down();

    const release = await channel().latest();

    expect(release).toBeUndefined();
    expect(await readFile(join(home, "cache.json"), "utf8")).not.toContain("wiped");
  });

  it("survives a home it cannot write to", async () => {
    const file = join(home, "taken");
    await writeFile(file, "");
    publishes({ latest: "2.0.0" });

    const release = await channel({ file: join(file, "cache.json") }).latest();

    expect(release?.version).toBe("2.0.0");
  });
});
