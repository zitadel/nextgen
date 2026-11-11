import { HttpResponse, http } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@clack/prompts", async () => (await import("@tests/helpers/clack")).clackDouble());

import * as prompts from "@clack/prompts";
import { confirm, isCancel } from "@clack/prompts";

import PreviewRm from "@/commands/preview/rm";
import { answering, type clackDouble } from "@tests/helpers/clack";
import { asTerminal as asPerson } from "@tests/helpers/terminal";
import {
  aProjectDirectory,
  PLATFORM_URL,
  usePlatformServer,
} from "@tests/helpers/platform-project";
import { parseJson, runCliForTest } from "@tests/helpers/run-cli";

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
    http.get("*/api/v1/projects/:project_id/previews", ({ request }) =>
      HttpResponse.json(
        new URL(request.url).searchParams.get("page_token") === "p2"
          ? { previews: [preview("https://pr-2.app.acme.com")], next_page_token: null }
          : { previews: [preview("https://pr-1.app.acme.com")], next_page_token: "p2" },
      ),
    ),
    http.post<{ project_id: string }, { origin: string }>(
      "*/api/v1/projects/:project_id/previews/remove",
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

describe("preview rm asked about a URL with a control character", () => {
  it("spells the character out in the question it asks a person", async () => {
    const { cwd } = await aProjectWithPreviewsOnTwoPages();

    const result = await runCliForTest([
      "preview",
      "rm",
      "https://pr-1\u001b[31m.app.acme.com",
      "--cwd",
      cwd,
      "--server",
      SERVER,
      "--non-interactive",
      "--json",
    ]);

    const envelope = parseJson(result.stdout) as { code: string; hint: string };
    expect(envelope.code).toBe("E_CONFIRMATION_REQUIRED");
    expect(envelope.hint).toContain("\\x1b[31m");
    expect(envelope.hint).not.toContain("\u001b");
  });
});

describe("preview rm asked on a terminal", () => {
  const removingOn = async (serverUrl: string) => {
    const { cwd } = await aProjectWithPreviewsOnTwoPages();
    const talk = answering(prompts as unknown as ReturnType<typeof clackDouble>, false);
    await asPerson(() =>
      PreviewRm.run(["https://pr-1.app.acme.com", "--cwd", cwd, "--server", serverUrl]),
    );
    return talk;
  };

  afterEach(() => {
    vi.mocked(confirm).mockReset();
    vi.mocked(isCancel).mockReset();
    vi.mocked(isCancel).mockReturnValue(false);
  });

  it("asks whether to stop serving the preview, naming the project and a remote server", async () => {
    const talk = await removingOn(SERVER);

    expect(talk.asked()).toEqual([
      "Stop serving https://pr-1.app.acme.com for project proj_test on preview.zitadel.com?",
    ]);
  });

  it("names a local server by its host and port", async () => {
    const talk = await removingOn("http://localhost:8112");

    expect(talk.asked()).toEqual([
      "Stop serving https://pr-1.app.acme.com for project proj_test on localhost:8112?",
    ]);
  });
});
