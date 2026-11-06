import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { checkCliVersion } from "@/commands/doctor/checks/cli-version";

const REGISTRY = "https://registry.npmjs.org/-/package/@zitadel%2fcli/dist-tags";

const server = setupServer();
let configHome: string;

function check(env: NodeJS.ProcessEnv = {}, typedCwd?: string) {
  return checkCliVersion({
    cliVersion: "1.0.0",
    env: { XDG_CONFIG_HOME: configHome, ...env },
    typedCwd,
  });
}

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
beforeEach(async () => {
  configHome = await mkdtemp(join(tmpdir(), "zitadel-cli-version-"));
});
afterEach(async () => {
  server.resetHandlers();
  await rm(configHome, { recursive: true, force: true });
});

describe("checkCliVersion", () => {
  it("warns with the upgrade command when a newer release exists", async () => {
    server.use(http.get(REGISTRY, () => HttpResponse.json({ latest: "2.0.0" })));

    await expect(check()).resolves.toMatchObject({
      name: "cli-version",
      status: "warn",
      details: {
        current: "1.0.0",
        latest: "2.0.0",
        remedy_command: "npx @zitadel/cli@latest upgrade",
      },
    });
  });

  it("carries --cwd in the suggested command", async () => {
    server.use(http.get(REGISTRY, () => HttpResponse.json({ latest: "2.0.0" })));

    const outcome = await check({}, "apps/web");

    expect(outcome.details).toMatchObject({
      remedy_command: "npx @zitadel/cli@latest upgrade --cwd apps/web",
    });
  });

  it("passes on the latest release", async () => {
    server.use(http.get(REGISTRY, () => HttpResponse.json({ latest: "1.0.0" })));

    await expect(check()).resolves.toMatchObject({ status: "pass" });
  });

  it("passes when the registry does not answer", async () => {
    server.use(http.get(REGISTRY, () => HttpResponse.error()));

    await expect(check()).resolves.toMatchObject({
      status: "pass",
      message: expect.stringContaining("could not look up"),
    });
  });

  it("does not ask when the check is off", async () => {
    await expect(check({ ZITADEL_UPDATE_CHECK: "0" })).resolves.toMatchObject({
      status: "pass",
      message: expect.stringContaining("update check is off"),
    });
  });
});
