import { rm } from "node:fs/promises";

import { resetPlatformStore, setupPlatformHandlers } from "@zitadel/api-mock/platform";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { aProjectWithTwoDeploys, PLATFORM_URL } from "../../../helpers/platform-project";
import { runCliForTest } from "../../../helpers/run-cli";

const SERVER = PLATFORM_URL;
const server = setupServer(...setupPlatformHandlers());
const dirs: string[] = [];

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
afterEach(async () => {
  server.resetHandlers();
  resetPlatformStore();
  for (const dir of dirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

/** A project on the mock with two deploys to one primary origin, and its directory. */
async function twoDeploys(): Promise<string> {
  const { cwd } = await aProjectWithTwoDeploys("zitadel-deployment-list-");
  dirs.push(cwd);
  return cwd;
}

/** One page of the history, as the plain rows a pipe gets. */
async function firstPagePiped(cwd: string) {
  return runCliForTest([
    "deployment",
    "list",
    "--limit",
    "1",
    "--plain",
    "--cwd",
    cwd,
    "--server",
    SERVER,
  ]);
}

describe("deployment list", () => {
  it("leaves a piped page's rows as the only thing on stdout", async () => {
    const cwd = await twoDeploys();

    const { stdout } = await firstPagePiped(cwd);

    expect(stdout).toMatch(/^dep_\S+\trel_[^\n]*\n$/);
  });

  it("prints a piped page's next page on stderr", async () => {
    const cwd = await twoDeploys();

    const { stderr } = await firstPagePiped(cwd);

    expect(stderr).toContain("deployment list --limit 1 --page-token");
  });
});
