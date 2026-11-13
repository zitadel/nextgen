import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect } from "vitest";

import { updateNotice } from "@/lib/update-notice";
import { test } from "@tests/helpers/fixtures";
import { aSuggest } from "@tests/helpers/suggestions";

const REGISTRY = "https://registry.npmjs.org/-/package/@zitadel%2fcli/dist-tags";

const server = setupServer();

/** `it` with the project directory the notice is read for, and the two ways a test sets it up. */
const it = test.extend<{
  notice: (cliVersion: string, env?: NodeJS.ProcessEnv) => ReturnType<typeof updateNotice>;
  pins: (dependencies: Record<string, string>) => Promise<void>;
}>({
  notice: ({ dir }, use) => {
    return use((cliVersion, env = {}) => {
      return updateNotice({
        cliVersion,
        upgrade: aSuggest({}, cliVersion)({ id: "upgrade" }),
        cwd: dir,
        env: { XDG_CONFIG_HOME: dir, ...env },
        columns: 80,
      });
    });
  },
  pins: ({ dir }, use) => {
    return use((dependencies) => {
      return writeFile(join(dir, "package.json"), JSON.stringify({ dependencies }));
    });
  },
});

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
beforeEach(() => {
  server.use(http.get(REGISTRY, () => HttpResponse.json({ latest: "2.0.0" })));
});
afterEach(() => {
  server.resetHandlers();
});

describe("updateNotice", () => {
  it("boxes the new version and the command, on the dist-tag", async ({ notice }) => {
    const box = await notice("1.0.0");

    expect(box).toContain("Update available");
    expect(box).toContain("CLI 1.0.0 → 2.0.0");
    expect(box).toContain("npx @zitadel/cli@latest upgrade");
  });

  it("names a pinned package that is behind, even with the newest CLI", async ({
    notice,
    pins,
  }) => {
    await pins({ "@zitadel/sdk-next": "1.0.0" });

    const box = await notice("2.0.0");

    expect(box).toContain("@zitadel/sdk-next 1.0.0 → 2.0.0");
    expect(box).not.toContain("CLI 2.0.0");
  });

  // The box goes straight to stderr rather than through `emit`, and a name is
  // only known to start with `@zitadel/`.
  it("spells out a pinned package's name, which the project's package.json carries", async ({
    notice,
    pins,
  }) => {
    await pins({ "@zitadel/sdk-next\u001b[2Jwiped": "1.0.0" });

    const box = await notice("2.0.0");

    expect(box).not.toContain("\u001b[2J");
    expect(box).toContain("@zitadel/sdk-next\\x1b[2Jwiped 1.0.0 → 2.0.0");
  });

  it("leaves a range alone", async ({ notice, pins }) => {
    await pins({ "@zitadel/sdk-next": "^1.0.0" });

    await expect(notice("2.0.0")).resolves.toBeUndefined();
  });

  it("says nothing when everything is current", async ({ notice, pins }) => {
    await pins({ "@zitadel/sdk-next": "2.0.0" });

    await expect(notice("2.0.0")).resolves.toBeUndefined();
  });

  it("says nothing when the lookup found nothing", async ({ notice }) => {
    server.use(http.get(REGISTRY, () => HttpResponse.error()));

    await expect(notice("1.0.0")).resolves.toBeUndefined();
  });

  it("does not ask when the check is off", async ({ notice }) => {
    server.use(
      http.get(REGISTRY, () => {
        throw new Error("the registry was asked");
      }),
    );

    await expect(notice("1.0.0", { ZITADEL_UPDATE_CHECK: "0" })).resolves.toBeUndefined();
  });

  it("carries on past a package.json that does not parse", async ({ dir, notice }) => {
    await writeFile(join(dir, "package.json"), "{ not json");

    await expect(notice("1.0.0")).resolves.toContain("CLI 1.0.0 → 2.0.0");
  });
});
