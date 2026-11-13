import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { releaseChannel, updateCheckDisabled } from "@/lib/upgrade/config";
import { test } from "@tests/helpers/fixtures";

const REGISTRY = "https://registry.npmjs.org/-/package/@zitadel%2fcli/dist-tags";

describe("releaseChannel", () => {
  test("reads the version on the dist-tag of the CLI's own channel", async ({ dir, server }) => {
    server.use(
      http.get(REGISTRY, () => HttpResponse.json({ latest: "2.0.0", alpha: "3.0.0-alpha.1" })),
    );

    const stable = await releaseChannel("1.0.0", { XDG_CONFIG_HOME: dir }).latest({ fresh: true });
    const alpha = await releaseChannel("3.0.0-alpha.0", { XDG_CONFIG_HOME: dir }).latest({
      fresh: true,
    });

    expect([stable?.version, alpha?.version]).toEqual(["2.0.0", "3.0.0-alpha.1"]);
  });
});

describe("releaseChannel cache", () => {
  test("keeps the answer in the CLI's config directory, where the next run reads it", async ({
    dir,
    server,
  }) => {
    server.use(http.get(REGISTRY, () => HttpResponse.json({ latest: "2.0.0" })));

    await releaseChannel("1.0.0", { XDG_CONFIG_HOME: dir }).latest({ fresh: true });

    expect(await readFile(join(dir, "zitadel", "cli", "update-check.json"), "utf8")).toContain(
      '"version":"2.0.0"',
    );
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
