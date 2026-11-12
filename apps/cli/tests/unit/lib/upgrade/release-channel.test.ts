import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { ReleaseChannel, ZITADEL } from "@/lib/upgrade";

const REGISTRY = "https://registry.npmjs.org/-/package/@zitadel%2fcli/dist-tags";

const server = setupServer();
let configHome: string;
let requests: string[];

function publishes(tags: Record<string, string>): void {
  server.use(
    http.get(REGISTRY, ({ request }) => {
      requests.push(request.url);
      return HttpResponse.json(tags);
    }),
  );
}

function env(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return { XDG_CONFIG_HOME: configHome, ...extra };
}

async function cacheHolds(lookup: Record<string, unknown>): Promise<void> {
  const file = join(configHome, "zitadel", "cli", "update-check.json");
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(lookup));
}

async function latestVersion(cliVersion: string, environment: NodeJS.ProcessEnv) {
  return (await new ReleaseChannel(ZITADEL, cliVersion, environment).latest())?.version;
}

async function freshVersion(cliVersion: string, environment: NodeJS.ProcessEnv) {
  return (await new ReleaseChannel(ZITADEL, cliVersion, environment).latestFresh())?.version;
}

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
beforeEach(async () => {
  configHome = await mkdtemp(join(tmpdir(), "zitadel-update-check-"));
  requests = [];
});
afterEach(async () => {
  server.resetHandlers();
  await rm(configHome, { recursive: true, force: true });
});

describe("ReleaseChannel", () => {
  it("reads the version on the CLI's own dist-tag", async () => {
    publishes({ latest: "2.0.0", alpha: "3.0.0-alpha.1" });

    await expect(latestVersion("1.0.0", env())).resolves.toBe("2.0.0");
    await rm(join(configHome, "zitadel"), { recursive: true });
    await expect(latestVersion("3.0.0-alpha.0", env())).resolves.toBe("3.0.0-alpha.1");
  });

  it("asks the registry npm itself was pointed at", async () => {
    server.use(
      http.get("https://mirror.example/npm/-/package/@zitadel%2fcli/dist-tags", () =>
        HttpResponse.json({ latest: "2.0.0" }),
      ),
    );

    await expect(
      latestVersion("1.0.0", env({ npm_config_registry: "https://mirror.example/npm/" })),
    ).resolves.toBe("2.0.0");
  });

  it("asks at most once a day", async () => {
    publishes({ latest: "2.0.0" });

    await latestVersion("1.0.0", env());
    await latestVersion("1.0.0", env());

    expect(requests).toHaveLength(1);
  });

  it("asks again once the answer is a day old", async () => {
    await cacheHolds({
      checked_at: Date.now() - 25 * 60 * 60 * 1000,
      dist_tag: "latest",
      registry: "https://registry.npmjs.org",
      version: "1.5.0",
    });
    publishes({ latest: "2.0.0" });

    await expect(latestVersion("1.0.0", env())).resolves.toBe("2.0.0");
  });

  it("does not take another dist-tag's answer", async () => {
    await cacheHolds({
      checked_at: Date.now(),
      dist_tag: "alpha",
      registry: "https://registry.npmjs.org",
      version: "9.0.0-alpha.1",
    });
    publishes({ latest: "2.0.0" });

    await expect(latestVersion("1.0.0", env())).resolves.toBe("2.0.0");
  });

  it("does not take another registry's answer", async () => {
    await cacheHolds({
      checked_at: Date.now(),
      dist_tag: "latest",
      registry: "https://mirror.example/npm",
      version: "9.0.0",
    });
    publishes({ latest: "2.0.0" });

    await expect(latestVersion("1.0.0", env())).resolves.toBe("2.0.0");
  });

  it("does not carry another registry's answer past a failed lookup", async () => {
    await cacheHolds({
      checked_at: Date.now(),
      dist_tag: "latest",
      registry: "https://mirror.example/npm",
      version: "9.0.0",
    });
    server.use(http.get(REGISTRY, () => HttpResponse.error()));

    await expect(latestVersion("1.0.0", env())).resolves.toBeUndefined();
  });

  it("does not take another registry's failure", async () => {
    await cacheHolds({
      checked_at: Date.now(),
      dist_tag: "latest",
      registry: "https://mirror.example/npm",
    });
    publishes({ latest: "2.0.0" });

    await expect(latestVersion("1.0.0", env())).resolves.toBe("2.0.0");
  });

  it("keeps what it knew when the registry stops answering", async () => {
    await cacheHolds({
      checked_at: Date.now() - 25 * 60 * 60 * 1000,
      dist_tag: "latest",
      registry: "https://registry.npmjs.org",
      version: "1.5.0",
    });
    server.use(http.get(REGISTRY, () => HttpResponse.error()));

    await expect(latestVersion("1.0.0", env())).resolves.toBe("1.5.0");
  });

  it("remembers a failed lookup, so an offline machine waits only once a day", async () => {
    server.use(
      http.get(REGISTRY, () => {
        requests.push("asked");
        return HttpResponse.error();
      }),
    );

    await expect(latestVersion("1.0.0", env())).resolves.toBeUndefined();
    await latestVersion("1.0.0", env());

    expect(requests).toHaveLength(1);
  });

  it("skips the cache when asked for a fresh answer", async () => {
    await cacheHolds({
      checked_at: Date.now(),
      dist_tag: "latest",
      registry: "https://registry.npmjs.org",
      version: "1.5.0",
    });
    publishes({ latest: "2.0.0" });

    await expect(freshVersion("1.0.0", env())).resolves.toBe("2.0.0");
  });

  it("answers nothing fresh when the registry is down, whatever it knew", async () => {
    await cacheHolds({
      checked_at: Date.now(),
      dist_tag: "latest",
      registry: "https://registry.npmjs.org",
      version: "1.5.0",
    });
    server.use(http.get(REGISTRY, () => HttpResponse.error()));

    await expect(freshVersion("1.0.0", env())).resolves.toBeUndefined();
  });

  it("does not take a value that is not a version", async () => {
    publishes({ latest: "not-a-version" });

    await expect(latestVersion("1.0.0", env())).resolves.toBeUndefined();
  });

  // A file is as much an answer from outside as the response was, so it is held
  // to what the registry would have had to answer to get there.
  it("does not take a cached value that is not a version", async () => {
    await cacheHolds({
      checked_at: Date.now(),
      dist_tag: "latest",
      registry: "https://registry.npmjs.org",
      version: "\u001b[2Jwiped",
    });

    await expect(latestVersion("1.0.0", env())).resolves.toBeUndefined();
  });

  it("survives a home it cannot write to", async () => {
    const file = join(configHome, "taken");
    await writeFile(file, "");
    publishes({ latest: "2.0.0" });

    await expect(latestVersion("1.0.0", env({ XDG_CONFIG_HOME: file }))).resolves.toBe("2.0.0");
  });

  it("writes the answer where the next run reads it", async () => {
    publishes({ latest: "2.0.0" });

    await latestVersion("1.0.0", env());

    const cached = JSON.parse(
      await readFile(join(configHome, "zitadel", "cli", "update-check.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(cached).toMatchObject({ dist_tag: "latest", version: "2.0.0" });
  });
});

describe("ReleaseChannel.isDisabled", () => {
  it.each([
    [{ ZITADEL_UPDATE_CHECK: "0" }, true],
    [{ CI: "true" }, true],
    [{ CI: "false" }, false],
    [{}, false],
  ])("for %o is %s", (environment, disabled) => {
    expect(new ReleaseChannel(ZITADEL, "1.0.0", environment).isDisabled()).toBe(disabled);
  });
});
