import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";

import {
  aProjectDirectory,
  PLATFORM_URL,
  usePlatformServer,
} from "../../../helpers/platform-project";
import { runCliForTest } from "../../../helpers/run-cli";

const SERVER = PLATFORM_URL;
const { server, dirs } = usePlatformServer();

/** A project directory whose server answers with one page of previews and a cursor to the next. */
async function aProjectWithTwoPagesOfPreviews(): Promise<string> {
  server.use(
    http.get(`${SERVER}/api/v1/projects/:project_id/previews`, () =>
      HttpResponse.json({
        previews: [
          {
            origin: "https://pr-1.app.acme.com",
            expires_at: "2026-02-01T00:00:00.000Z",
            created_at: "2026-01-01T00:00:00.000Z",
          },
        ],
        next_page_token: "p2",
      }),
    ),
  );
  const cwd = await aProjectDirectory("zitadel-preview-list-", { id: "proj_test", secret: "ps" });
  dirs.push(cwd);
  return cwd;
}

/** One page of previews, as the plain rows a pipe gets. */
async function firstPagePiped(cwd: string) {
  return runCliForTest([
    "preview",
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

describe("preview list", () => {
  it("leaves a piped page's rows as the only thing on stdout", async () => {
    const cwd = await aProjectWithTwoPagesOfPreviews();

    const { stdout } = await firstPagePiped(cwd);

    expect(stdout).toMatch(/^https:\/\/pr-1\.app\.acme\.com\t[^\n]*\n$/);
  });

  it("prints a piped page's next page on stderr", async () => {
    const cwd = await aProjectWithTwoPagesOfPreviews();

    const { stderr } = await firstPagePiped(cwd);

    expect(stderr).toContain("preview list --limit 1 --page-token p2");
  });
});
