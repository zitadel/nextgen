import { readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect } from "vitest";

import { isNewerVersion, latestCliVersion, updateCheckDisabled } from "@/lib/update-check";
import { it } from "@tests/helpers/fixtures";

const REGISTRY = "https://registry.npmjs.org/-/package/@zitadel%2fcli/dist-tags";

const server = setupServer();

/**
 * Has the registry answer with `tags`.
 *
 * @param tags - The dist-tags it answers with.
 * @returns The URLs it was asked for, as they come in.
 */
function publishes(tags: Record<string, string>): string[] {
  const requests: string[] = [];
  server.use(
    http.get(REGISTRY, ({ request }) => {
      requests.push(request.url);
      return HttpResponse.json(tags);
    }),
  );
  return requests;
}

function env(configHome: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return { XDG_CONFIG_HOME: configHome, ...extra };
}

async function cacheHolds(configHome: string, lookup: Record<string, unknown>): Promise<void> {
  const file = join(configHome, "zitadel", "cli", "update-check.json");
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(lookup));
}

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
afterEach(() => {
  server.resetHandlers();
});

describe("latestCliVersion", () => {
  it("reads the version on the CLI's own dist-tag", async ({ dir: configHome }) => {
    publishes({ latest: "2.0.0", alpha: "3.0.0-alpha.1" });

    await expect(latestCliVersion({ cliVersion: "1.0.0", env: env(configHome) })).resolves.toBe(
      "2.0.0",
    );
    await rm(join(configHome, "zitadel"), { recursive: true });
    await expect(
      latestCliVersion({ cliVersion: "3.0.0-alpha.0", env: env(configHome) }),
    ).resolves.toBe("3.0.0-alpha.1");
  });

  it("asks the registry npm itself was pointed at", async ({ dir: configHome }) => {
    server.use(
      http.get("https://mirror.example/npm/-/package/@zitadel%2fcli/dist-tags", () =>
        HttpResponse.json({ latest: "2.0.0" }),
      ),
    );

    await expect(
      latestCliVersion({
        cliVersion: "1.0.0",
        env: env(configHome, { npm_config_registry: "https://mirror.example/npm/" }),
      }),
    ).resolves.toBe("2.0.0");
  });

  it("asks at most once a day", async ({ dir: configHome }) => {
    const requests = publishes({ latest: "2.0.0" });

    await latestCliVersion({ cliVersion: "1.0.0", env: env(configHome) });
    await latestCliVersion({ cliVersion: "1.0.0", env: env(configHome) });

    expect(requests).toHaveLength(1);
  });

  it("asks again once the answer is a day old", async ({ dir: configHome }) => {
    await cacheHolds(configHome, {
      checked_at: Date.now() - 25 * 60 * 60 * 1000,
      dist_tag: "latest",
      registry: "https://registry.npmjs.org",
      version: "1.5.0",
    });
    publishes({ latest: "2.0.0" });

    await expect(latestCliVersion({ cliVersion: "1.0.0", env: env(configHome) })).resolves.toBe(
      "2.0.0",
    );
  });

  it("does not take another dist-tag's answer", async ({ dir: configHome }) => {
    await cacheHolds(configHome, {
      checked_at: Date.now(),
      dist_tag: "alpha",
      registry: "https://registry.npmjs.org",
      version: "9.0.0-alpha.1",
    });
    publishes({ latest: "2.0.0" });

    await expect(latestCliVersion({ cliVersion: "1.0.0", env: env(configHome) })).resolves.toBe(
      "2.0.0",
    );
  });

  it("does not take another registry's answer", async ({ dir: configHome }) => {
    await cacheHolds(configHome, {
      checked_at: Date.now(),
      dist_tag: "latest",
      registry: "https://mirror.example/npm",
      version: "9.0.0",
    });
    publishes({ latest: "2.0.0" });

    await expect(latestCliVersion({ cliVersion: "1.0.0", env: env(configHome) })).resolves.toBe(
      "2.0.0",
    );
  });

  it("does not carry another registry's answer past a failed lookup", async ({
    dir: configHome,
  }) => {
    await cacheHolds(configHome, {
      checked_at: Date.now(),
      dist_tag: "latest",
      registry: "https://mirror.example/npm",
      version: "9.0.0",
    });
    server.use(http.get(REGISTRY, () => HttpResponse.error()));

    await expect(
      latestCliVersion({ cliVersion: "1.0.0", env: env(configHome) }),
    ).resolves.toBeUndefined();
  });

  it("does not take another registry's failure", async ({ dir: configHome }) => {
    await cacheHolds(configHome, {
      checked_at: Date.now(),
      dist_tag: "latest",
      registry: "https://mirror.example/npm",
    });
    publishes({ latest: "2.0.0" });

    await expect(latestCliVersion({ cliVersion: "1.0.0", env: env(configHome) })).resolves.toBe(
      "2.0.0",
    );
  });

  it("keeps what it knew when the registry stops answering", async ({ dir: configHome }) => {
    await cacheHolds(configHome, {
      checked_at: Date.now() - 25 * 60 * 60 * 1000,
      dist_tag: "latest",
      registry: "https://registry.npmjs.org",
      version: "1.5.0",
    });
    server.use(http.get(REGISTRY, () => HttpResponse.error()));

    await expect(latestCliVersion({ cliVersion: "1.0.0", env: env(configHome) })).resolves.toBe(
      "1.5.0",
    );
  });

  it("remembers a failed lookup, so an offline machine waits only once a day", async ({
    dir: configHome,
  }) => {
    const requests: string[] = [];
    server.use(
      http.get(REGISTRY, () => {
        requests.push("asked");
        return HttpResponse.error();
      }),
    );

    await expect(
      latestCliVersion({ cliVersion: "1.0.0", env: env(configHome) }),
    ).resolves.toBeUndefined();
    await latestCliVersion({ cliVersion: "1.0.0", env: env(configHome) });

    expect(requests).toHaveLength(1);
  });

  it("skips the cache when asked for a fresh answer", async ({ dir: configHome }) => {
    await cacheHolds(configHome, {
      checked_at: Date.now(),
      dist_tag: "latest",
      registry: "https://registry.npmjs.org",
      version: "1.5.0",
    });
    publishes({ latest: "2.0.0" });

    await expect(
      latestCliVersion({ cliVersion: "1.0.0", env: env(configHome), fresh: true }),
    ).resolves.toBe("2.0.0");
  });

  it("answers nothing fresh when the registry is down, whatever it knew", async ({
    dir: configHome,
  }) => {
    await cacheHolds(configHome, {
      checked_at: Date.now(),
      dist_tag: "latest",
      registry: "https://registry.npmjs.org",
      version: "1.5.0",
    });
    server.use(http.get(REGISTRY, () => HttpResponse.error()));

    await expect(
      latestCliVersion({ cliVersion: "1.0.0", env: env(configHome), fresh: true }),
    ).resolves.toBeUndefined();
  });

  it("does not take a value that is not a version", async ({ dir: configHome }) => {
    publishes({ latest: "not-a-version" });

    await expect(
      latestCliVersion({ cliVersion: "1.0.0", env: env(configHome) }),
    ).resolves.toBeUndefined();
  });

  // A file is as much an answer from outside as the response was, so it is held
  // to what the registry would have had to answer to get there.
  it("does not take a cached value that is not a version", async ({ dir: configHome }) => {
    await cacheHolds(configHome, {
      checked_at: Date.now(),
      dist_tag: "latest",
      registry: "https://registry.npmjs.org",
      version: "\u001b[2Jwiped",
    });

    await expect(
      latestCliVersion({ cliVersion: "1.0.0", env: env(configHome) }),
    ).resolves.toBeUndefined();
  });

  it("survives a home it cannot write to", async ({ dir: configHome }) => {
    const file = join(configHome, "taken");
    await writeFile(file, "");
    publishes({ latest: "2.0.0" });

    await expect(
      latestCliVersion({ cliVersion: "1.0.0", env: env(configHome, { XDG_CONFIG_HOME: file }) }),
    ).resolves.toBe("2.0.0");
  });

  it("writes the answer where the next run reads it", async ({ dir: configHome }) => {
    publishes({ latest: "2.0.0" });

    await latestCliVersion({ cliVersion: "1.0.0", env: env(configHome) });

    const cached = JSON.parse(
      await readFile(join(configHome, "zitadel", "cli", "update-check.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(cached).toMatchObject({ dist_tag: "latest", version: "2.0.0" });
  });
});

describe("updateCheckDisabled", () => {
  it.each([
    [{ ZITADEL_UPDATE_CHECK: "0" }, true],
    [{ CI: "true" }, true],
    [{ CI: "false" }, false],
    [{}, false],
  ])("for %o is %s", (environment, disabled) => {
    expect(updateCheckDisabled(environment)).toBe(disabled);
  });
});

describe("isNewerVersion", () => {
  it.each([
    ["2.0.0", "1.0.0", true],
    ["1.0.0", "1.0.0", false],
    ["1.0.0", "2.0.0", false],
    ["1.0.0", "1.0.0-alpha.1", true],
    [undefined, "1.0.0", false],
    ["2.0.0", "dev", false],
  ])("%s over %s is %s", (latest, current, newer) => {
    expect(isNewerVersion(latest, current)).toBe(newer);
  });
});
