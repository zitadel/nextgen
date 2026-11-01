import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";

import {
  aProjectWithTwoDeploys,
  PLATFORM_URL,
  usePlatformServer,
} from "../../../helpers/platform-project";
import { runCliForTest } from "../../../helpers/run-cli";

const SERVER = PLATFORM_URL;
const { server, dirs } = usePlatformServer();

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

  it("follows a cursor back as the server wrote it with --all", async () => {
    const cwd = await twoDeploys();
    const tokens: (string | null)[] = [];
    server.use(
      http.get(`${SERVER}/api/v1/deployments`, ({ request }) => {
        const token = new URL(request.url).searchParams.get("page_token");
        tokens.push(token);
        return HttpResponse.json({
          deployments: [],
          next_page_token: token === null ? "p\u001b2" : null,
        });
      }),
    );

    await runCliForTest([
      "deployment",
      "list",
      "--all",
      "--json",
      "--cwd",
      cwd,
      "--server",
      SERVER,
    ]);

    expect(tokens).toEqual([null, "p\u001b2"]);
  });
});
