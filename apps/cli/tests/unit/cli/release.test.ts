import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { updateCheckDisabled, zitadelChannel } from "@/cli/release";

const REGISTRY = "https://registry.npmjs.org/-/package/@zitadel%2fcli/dist-tags";

const server = setupServer();
let home: string;

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "zitadel-release-channel-"));
});
afterEach(async () => {
  server.resetHandlers();
  await rm(home, { recursive: true, force: true });
});

describe("zitadelChannel", () => {
  it("reads the version on the dist-tag of the CLI's own channel", async () => {
    server.use(
      http.get(REGISTRY, () => HttpResponse.json({ latest: "2.0.0", alpha: "3.0.0-alpha.1" })),
    );

    const stable = await zitadelChannel("1.0.0", { XDG_CONFIG_HOME: home }).latest({ fresh: true });
    const alpha = await zitadelChannel("3.0.0-alpha.0", { XDG_CONFIG_HOME: home }).latest({
      fresh: true,
    });

    expect([stable?.version, alpha?.version]).toEqual(["2.0.0", "3.0.0-alpha.1"]);
  });
});

describe("zitadelChannel cache", () => {
  it("keeps the answer in the CLI's config directory, where the next run reads it", async () => {
    server.use(http.get(REGISTRY, () => HttpResponse.json({ latest: "2.0.0" })));

    await zitadelChannel("1.0.0", { XDG_CONFIG_HOME: home }).latest({ fresh: true });

    const cached = JSON.parse(
      await readFile(join(home, "zitadel", "cli", "update-check.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(Object.values(cached)).toMatchObject([{ version: "2.0.0" }]);
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
