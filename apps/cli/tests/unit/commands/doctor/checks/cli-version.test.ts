import { HttpResponse, http } from "msw";
import { describe, expect } from "vitest";

import { checkCliVersion } from "@/commands/doctor/checks/cli-version";
import { it } from "@tests/helpers/fixtures";

/**
 * Where the CLI asks npm for its newest release.
 */
const REGISTRY = "https://registry.npmjs.org/-/package/@zitadel%2fcli/dist-tags";

/**
 * The version the check runs as.
 */
const CURRENT = "1.0.0";

/**
 * How the registry answers when `latest` is the newest release.
 *
 * @param latest - The version npm tags `latest`.
 * @returns The handler.
 */
function latestIs(latest: string) {
  return http.get(REGISTRY, () => {
    return HttpResponse.json({ latest });
  });
}

describe("checkCliVersion", () => {
  describe("when a newer release exists", () => {
    it("warns with the upgrade command", async ({ server, dir }) => {
      server.use(latestIs("2.0.0"));

      const outcome = await checkCliVersion({ cliVersion: CURRENT, env: { XDG_CONFIG_HOME: dir } });

      expect(outcome).toMatchObject({
        name: "cli-version",
        status: "warn",
        details: {
          current: CURRENT,
          latest: "2.0.0",
          remedy_command: "npx @zitadel/cli@latest upgrade",
        },
      });
    });

    it("carries --cwd in the suggested command", async ({ server, dir }) => {
      server.use(latestIs("2.0.0"));

      const outcome = await checkCliVersion({
        cliVersion: CURRENT,
        env: { XDG_CONFIG_HOME: dir },
        typedCwd: "apps/web",
      });

      expect(outcome.details).toMatchObject({
        remedy_command: "npx @zitadel/cli@latest upgrade --cwd apps/web",
      });
    });
  });

  it("passes on the latest release", async ({ server, dir }) => {
    server.use(latestIs(CURRENT));

    const outcome = await checkCliVersion({ cliVersion: CURRENT, env: { XDG_CONFIG_HOME: dir } });

    expect(outcome).toMatchObject({ status: "pass" });
  });

  it("passes when the registry does not answer", async ({ server, dir }) => {
    server.use(
      http.get(REGISTRY, () => {
        return HttpResponse.error();
      }),
    );

    const outcome = await checkCliVersion({ cliVersion: CURRENT, env: { XDG_CONFIG_HOME: dir } });

    expect(outcome).toMatchObject({
      status: "pass",
      message: expect.stringContaining("could not look up"),
    });
  });

  it("does not ask when the check is off", async ({ dir }) => {
    const outcome = await checkCliVersion({
      cliVersion: CURRENT,
      env: { XDG_CONFIG_HOME: dir, ZITADEL_UPDATE_CHECK: "0" },
    });

    expect(outcome).toMatchObject({
      status: "pass",
      message: expect.stringContaining("update check is off"),
    });
  });
});
