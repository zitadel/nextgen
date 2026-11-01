import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";

import {
  aProjectDirectory,
  PLATFORM_URL,
  usePlatformServer,
} from "../../../helpers/platform-project";
import { parseJson, runCliForTest } from "../../../helpers/run-cli";

const SERVER = PLATFORM_URL;
const { server, dirs } = usePlatformServer();

/** A project whose live previews come in two pages, `pr-2` only behind the cursor. */
async function aProjectWithPreviewsOnTwoPages(): Promise<{ cwd: string; removed: string[] }> {
  const removed: string[] = [];
  const preview = (origin: string) => ({
    origin,
    expires_at: "2026-02-01T00:00:00.000Z",
    created_at: "2026-01-01T00:00:00.000Z",
  });
  server.use(
    http.get(`${SERVER}/api/v1/projects/:project_id/previews`, ({ request }) =>
      HttpResponse.json(
        new URL(request.url).searchParams.get("page_token") === "p2"
          ? { previews: [preview("https://pr-2.app.acme.com")], next_page_token: null }
          : { previews: [preview("https://pr-1.app.acme.com")], next_page_token: "p2" },
      ),
    ),
    http.post<{ project_id: string }, { origin: string }>(
      `${SERVER}/api/v1/projects/:project_id/previews/remove`,
      async ({ request }) => {
        const body = await request.json();
        removed.push(body.origin);
        return new HttpResponse(null, { status: 204 });
      },
    ),
  );
  const cwd = await aProjectDirectory("zitadel-preview-rm-", { id: "proj_test", secret: "ps" });
  dirs.push(cwd);
  return { cwd, removed };
}

describe("preview rm", () => {
  it("removes a live preview listed past the first page", async () => {
    const { cwd, removed } = await aProjectWithPreviewsOnTwoPages();

    const res = await runCliForTest([
      "preview",
      "rm",
      "https://pr-2.app.acme.com",
      "--force",
      "--cwd",
      cwd,
      "--server",
      SERVER,
      "--json",
    ]);

    expect([parseJson(res.stdout), removed]).toEqual([
      expect.objectContaining({ status: "ok" }),
      ["https://pr-2.app.acme.com"],
    ]);
  });
});
