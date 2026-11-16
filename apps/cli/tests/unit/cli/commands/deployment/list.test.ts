import { asTerminal } from "@tests/helpers/terminal";
import { http, HttpResponse } from "msw";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  aProjectWithTwoDeploys,
  PLATFORM_URL,
  usePlatformServer,
} from "@tests/helpers/platform-project";
import { runCliForTest } from "@tests/helpers/run-cli";
import { join } from "node:path";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { setupServer } from "msw/node";
import { tmpdir } from "node:os";
import type { ListDeployments200DeploymentsItem } from "@zitadel/api/generated/model";
import type { Answer } from "@tests/helpers/fake-client";
import { aDeployment, PREVIEW_URL, PRIMARY_ORIGIN } from "@tests/helpers/records";

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

    expect(stderr).toContain("deployment list --limit 1 --plain --page-token");
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

  describe("the expiry of a preview", () => {
    const EXPIRES = "2026-02-01T00:00:00Z";

    /** A preview deployment, live unless a later one replaced it. */
    const previewDeployment = (id: string, status: "live" | "inactive" = "live") => {
      return aDeployment({
        id,
        kind: "preview",
        status,
        targets: [{ origin: PREVIEW_URL }],
      });
    };

    /** The previews the API lists: the one under test, still live. */
    const livePreviews = () => {
      return HttpResponse.json({
        previews: [
          { origin: PREVIEW_URL, expires_at: EXPIRES, created_at: "2026-01-01T00:00:00Z" },
        ],
        next_page_token: null,
      });
    };

    /** The previews the API refuses to list. */
    const refusedPreviews = () => {
      return HttpResponse.json({ code: "forbidden", message: "no" }, { status: 403 });
    };

    /** A project whose deployments list answers `deployments`; returns the previews reads. */
    async function listing(
      deployments: readonly Answer<ListDeployments200DeploymentsItem>[],
      previews: () => Response = livePreviews,
    ): Promise<{ cwd: string; asked: string[] }> {
      const cwd = await twoDeploys();
      const asked: string[] = [];
      server.use(
        http.get(`${SERVER}/api/v1/deployments`, () => {
          return HttpResponse.json({ deployments, next_page_token: null });
        }),
        http.get(`${SERVER}/api/v1/projects/:projectId/previews`, ({ request }) => {
          asked.push(request.url);
          return previews();
        }),
      );
      return { cwd, asked };
    }

    /** The command as a script reads it, piped. */
    const plain = (cwd: string) => {
      return runCliForTest(["deployment", "list", "--plain", "--cwd", cwd, "--server", SERVER]);
    };

    /** The command as a program reads it. */
    const json = (cwd: string) => {
      return runCliForTest(["deployment", "list", "--json", "--cwd", cwd, "--server", SERVER]);
    };

    it("prints the expiry of the live preview", async () => {
      const { cwd } = await listing([previewDeployment("dep_1")]);

      const result = await plain(cwd);

      expect(result).toPrintPlainRow(
        "dep_1",
        "rel_1",
        "deploy",
        PREVIEW_URL,
        /^2026-01-01T/,
        "preview",
        EXPIRES,
      );
    });

    it("reads the previews once for a page of live and replaced previews", async () => {
      const { cwd, asked } = await listing([
        previewDeployment("dep_2"),
        previewDeployment("dep_1", "inactive"),
      ]);

      await plain(cwd);

      expect(asked).toHaveLength(1);
    });

    it("prints nothing for a deployment a later one replaced", async () => {
      const { cwd } = await listing([
        previewDeployment("dep_2"),
        previewDeployment("dep_1", "inactive"),
      ]);

      const result = await plain(cwd);

      expect(result).toPrintPlainRow(
        "dep_1",
        "rel_1",
        "deploy",
        PREVIEW_URL,
        /^2026-01-01T/,
        "preview",
        "",
      );
    });

    it.each([
      ["a page of primary deployments", [aDeployment()]],
      ["a page of replaced preview deployments", [previewDeployment("dep_1", "inactive")]],
    ])("does not read the previews for %s", async (_page, deployments) => {
      const { cwd, asked } = await listing(deployments);

      const result = await plain(cwd);

      expect(result).toSucceed();
      expect(asked).toEqual([]);
    });

    it("still lists the deployments when the previews cannot be read", async () => {
      const { cwd } = await listing([previewDeployment("dep_1")], refusedPreviews);

      const result = await plain(cwd);

      expect(result).toPrintPlainRow(
        "dep_1",
        "rel_1",
        "deploy",
        PREVIEW_URL,
        /^2026-01-01T/,
        "preview",
        "",
      );
    });

    it("warns when the previews cannot be read", async () => {
      const { cwd } = await listing([previewDeployment("dep_1")], refusedPreviews);

      const result = await plain(cwd);

      expect(result.stderr).toContain("Could not read when the previews expire");
    });

    it("still lists the preview under --json", async () => {
      const { cwd } = await listing([previewDeployment("dep_1")]);

      const result = await json(cwd);

      expect(result.stdout).toContain(PREVIEW_URL);
    });

    it("does not read the previews under --json", async () => {
      const { cwd, asked } = await listing([previewDeployment("dep_1")]);

      const result = await json(cwd);

      expect(result).toSucceed();
      expect(asked).toEqual([]);
    });
  });
});

describe("deployment list at a terminal", () => {
  const SERVER = "https://api.zitadel.cloud";
  const server = setupServer();
  const dirs: string[] = [];

  beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
  afterAll(() => server.close());
  afterEach(async () => {
    server.resetHandlers();
    for (const dir of dirs.splice(0)) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  const deployment = (id: string) => ({
    id,
    release_id: "rel_1",
    targets: [{ origin: PRIMARY_ORIGIN }],
    metadata: { reason: "deploy" },
    deployed_at: "2026-01-01T00:00:00.000Z",
  });

  async function aProject(): Promise<string> {
    const cwd = await mkdtemp(join(tmpdir(), "zitadel-deployment-list-"));
    dirs.push(cwd);
    await mkdir(join(cwd, ".zitadel"), { recursive: true });
    await writeFile(
      join(cwd, ".zitadel/secret"),
      JSON.stringify({
        project_id: "proj_test",
        project_secret: "sk_test",
        preview_secret: "pk_test",
        preview_origins: [],
        created_at: "2026-01-01T00:00:00.000Z",
      }),
    );
    return cwd;
  }

  const listed = (cwd: string) =>
    asTerminal(() =>
      runCliForTest([
        "deployment",
        "list",
        "--cwd",
        cwd,
        "--server",
        SERVER,
        "--non-interactive",
        "--no-telemetry",
      ]),
    );

  describe("deployment list", () => {
    it("says so, as the closing clause beside the place it ran, when it finds nothing", async () => {
      const cwd = await aProject();
      server.use(
        http.get(`${SERVER}/api/v1/deployments`, () =>
          HttpResponse.json({ deployments: [], next_page_token: null }),
        ),
      );

      const res = await listed(cwd);

      expect(res.exitCode).toBe(0);
      expect(res.stdout).toContain("No deployments found ·");
    });

    it("counts what it found in the same words every other list counts in", async () => {
      const cwd = await aProject();
      server.use(
        http.get(`${SERVER}/api/v1/deployments`, () =>
          HttpResponse.json({
            deployments: [deployment("dep_1"), deployment("dep_2")],
            next_page_token: null,
          }),
        ),
      );

      const res = await listed(cwd);

      expect(res.stdout).toContain("2 deployments");
    });
  });
});
