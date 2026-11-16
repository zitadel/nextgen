import { asTerminal } from "@tests/helpers/terminal";
import { http, HttpResponse } from "msw";
import { describe, expect } from "vitest";
import { it } from "@tests/helpers/fixtures";
import {
  aProjectWithTwoDeploys,
  aReleaseServedOn,
  PLATFORM_URL,
  usePlatformServer,
} from "@tests/helpers/platform-project";
import { runCliForTest } from "@tests/helpers/run-cli";
import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import type { ListDeployments200DeploymentsItem } from "@zitadel/api/generated/model";
import type { Answer } from "@tests/helpers/fake-client";
import { aDeployment, PREVIEW_URL, PRIMARY_ORIGIN } from "@tests/helpers/records";

const SERVER = PLATFORM_URL;
const { server: platformServer } = usePlatformServer();

/** A project on the mock with two deploys to one primary origin, and its directory. */
async function twoDeploys(): Promise<string> {
  const { cwd } = await aProjectWithTwoDeploys("zitadel-deployment-list-");
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
    platformServer.use(
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
    const TIME = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/;

    /** What `--plain` prints for a preview deployment, its expiry cell left to the test. */
    const previewRow = (
      id: string,
      releaseId: string,
      expires: string | RegExp,
      origins = PREVIEW_URL,
    ) => {
      return [id, releaseId, "deploy", origins, TIME, "preview", expires];
    };

    /** A preview deployment, live unless a later one replaced it. */
    const previewDeployment = (id: string, status: "live" | "inactive" = "live") => {
      return aDeployment({
        id,
        kind: "preview",
        status,
        targets: [{ origin: PREVIEW_URL }],
      });
    };

    /** A project on the mock with one preview deployment live, and the row it prints. */
    async function aLivePreview() {
      const served = await aReleaseServedOn("zitadel-deployment-list-", {
        primary: false,
        preview: true,
      });
      return {
        cwd: served.cwd,
        row: (expires: string | RegExp) => {
          return previewRow(served.deploymentOn("preview"), served.releaseId, expires);
        },
      };
    }

    /** Records every read of the previews and lets the mock answer it. */
    const watchingPreviews = (): string[] => {
      const asked: string[] = [];
      platformServer.use(
        http.get(`${SERVER}/api/v1/projects/:projectId/previews`, ({ request }) => {
          asked.push(request.url);
        }),
      );
      return asked;
    };

    /** Makes the mock refuse to list the previews. */
    const refusingPreviews = () => {
      platformServer.use(
        http.get(`${SERVER}/api/v1/projects/:projectId/previews`, () => {
          return HttpResponse.json({ code: "forbidden", message: "no" }, { status: 403 });
        }),
      );
    };

    /** Makes the mock list `deployments` as the history, and `served` as the live view. */
    const listingInstead = (
      deployments: readonly Answer<ListDeployments200DeploymentsItem>[],
      served = deployments,
    ) => {
      platformServer.use(
        http.get(`${SERVER}/api/v1/deployments`, ({ request }) => {
          const live = new URL(request.url).searchParams.get("live") === "true";
          return HttpResponse.json({
            deployments: live ? served : deployments,
            next_page_token: null,
          });
        }),
      );
    };

    /** Makes the mock refuse the live view and answer the history as it does. */
    const refusingLiveView = () => {
      platformServer.use(
        http.get(`${SERVER}/api/v1/deployments`, ({ request }) => {
          const live = new URL(request.url).searchParams.get("live") === "true";
          return live
            ? HttpResponse.json({ code: "forbidden", message: "no" }, { status: 403 })
            : undefined;
        }),
      );
    };

    /** Records every read of the deployments and lets the mock answer it. */
    const watchingDeployments = (): string[] => {
      const asked: string[] = [];
      platformServer.use(
        http.get(`${SERVER}/api/v1/deployments`, ({ request }) => {
          asked.push(request.url);
        }),
      );
      return asked;
    };

    /** Makes the mock list a live preview for each origin, expiring as given. */
    const previewsExpiring = (expiries: Readonly<Record<string, string>>) => {
      platformServer.use(
        http.get(`${SERVER}/api/v1/projects/:projectId/previews`, () => {
          return HttpResponse.json({
            previews: Object.entries(expiries).map(([origin, expiresAt]) => {
              return { origin, expires_at: expiresAt, created_at: "2026-01-01T00:00:00Z" };
            }),
            next_page_token: null,
          });
        }),
      );
    };

    /** The command as a script reads it, piped. */
    const plain = (cwd: string) => {
      return runCliForTest(["deployment", "list", "--plain", "--cwd", cwd, "--server", SERVER]);
    };

    /** The command as a program reads it. */
    const json = (cwd: string) => {
      return runCliForTest(["deployment", "list", "--json", "--cwd", cwd, "--server", SERVER]);
    };

    it("prints the expiry of the live preview", async () => {
      const { cwd, row } = await aLivePreview();

      const result = await plain(cwd);

      expect(result).toPrintPlainRow(...row(TIME));
    });

    it("reads the previews once for a page that has a live preview", async () => {
      const { cwd } = await aLivePreview();
      const asked = watchingPreviews();

      await plain(cwd);

      expect(asked).toHaveLength(1);
    });

    it("prints nothing for a deployment a later one replaced", async () => {
      const { cwd } = await aLivePreview();
      listingInstead([previewDeployment("dep_2"), previewDeployment("dep_1", "inactive")]);

      const result = await plain(cwd);

      expect(result).toPrintPlainRow(...previewRow("dep_1", "rel_1", ""));
    });

    it("prints a partly replaced deployment the expiry of the origin it still serves", async () => {
      const kept = "https://x-acme.vercel.app";
      const lost = "https://y-acme.vercel.app";
      const { cwd } = await aLivePreview();
      listingInstead(
        [
          aDeployment({ id: "dep_2", kind: "preview", targets: [{ origin: lost }] }),
          aDeployment({
            id: "dep_1",
            kind: "preview",
            targets: [{ origin: kept }, { origin: lost }],
          }),
        ],
        [
          aDeployment({ id: "dep_2", kind: "preview", targets: [{ origin: lost }] }),
          aDeployment({ id: "dep_1", kind: "preview", targets: [{ origin: kept }] }),
        ],
      );
      previewsExpiring({ [kept]: "2026-02-08T00:00:00Z", [lost]: "2026-02-01T01:00:00Z" });

      const result = await plain(cwd);

      expect(result).toPrintPlainRow(
        ...previewRow("dep_1", "rel_1", "2026-02-08T00:00:00Z", `${kept}, ${lost}`),
      );
    });

    it("still lists the deployments when the live view cannot be read", async () => {
      const { cwd, row } = await aLivePreview();
      refusingLiveView();

      const result = await plain(cwd);

      expect(result).toPrintPlainRow(...row(""));
    });

    it("warns when the live view cannot be read", async () => {
      const { cwd } = await aLivePreview();
      refusingLiveView();

      const result = await plain(cwd);

      expect(result.stderr).toContain("Could not read when the previews expire");
    });

    it("reads the live view beside the history", async () => {
      const { cwd } = await aLivePreview();
      const asked = watchingDeployments();

      await plain(cwd);

      expect(asked).toHaveLength(2);
    });

    it("reads no live view beside --live, which already is one", async () => {
      const { cwd } = await aLivePreview();
      const asked = watchingDeployments();

      await runCliForTest([
        "deployment",
        "list",
        "--live",
        "--plain",
        "--cwd",
        cwd,
        "--server",
        SERVER,
      ]);

      expect(asked).toHaveLength(1);
    });

    it.each([
      [
        "a page of primary deployments",
        async () => {
          return twoDeploys();
        },
      ],
      [
        "a page of replaced preview deployments",
        async () => {
          const { cwd } = await aLivePreview();
          listingInstead([previewDeployment("dep_1", "inactive")]);
          return cwd;
        },
      ],
    ])("does not read the previews for %s", async (_page, arrange) => {
      const asked = watchingPreviews();
      const cwd = await arrange();

      const result = await plain(cwd);

      expect(result).toSucceed();
      expect(asked).toEqual([]);
    });

    it("still lists the deployments when the previews cannot be read", async () => {
      const { cwd, row } = await aLivePreview();
      refusingPreviews();

      const result = await plain(cwd);

      expect(result).toPrintPlainRow(...row(""));
    });

    it("warns when the previews cannot be read", async () => {
      const { cwd } = await aLivePreview();
      refusingPreviews();

      const result = await plain(cwd);

      expect(result.stderr).toContain("Could not read when the previews expire");
    });

    it("still lists the preview under --json", async () => {
      const { cwd } = await aLivePreview();

      const result = await json(cwd);

      expect(result.stdout).toContain(PREVIEW_URL);
    });

    it("does not read the previews under --json", async () => {
      const { cwd } = await aLivePreview();
      const asked = watchingPreviews();

      const result = await json(cwd);

      expect(result).toSucceed();
      expect(asked).toEqual([]);
    });
  });
});

describe("deployment list at a terminal", () => {
  const SERVER = "https://api.zitadel.cloud";

  const deployment = (id: string) => ({
    id,
    release_id: "rel_1",
    targets: [{ origin: PRIMARY_ORIGIN }],
    metadata: { reason: "deploy" },
    deployed_at: "2026-01-01T00:00:00.000Z",
  });

  /**
   * Binds a temp directory to a project through `.zitadel/secret`.
   *
   * @param cwd - The directory to bind.
   * @returns The directory.
   */
  async function aProject(cwd: string): Promise<string> {
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
    it("says so, as the closing clause beside the place it ran, when it finds nothing", async ({
      dir,
      server,
    }) => {
      const cwd = await aProject(dir);
      server.use(
        http.get(`${SERVER}/api/v1/deployments`, () =>
          HttpResponse.json({ deployments: [], next_page_token: null }),
        ),
      );

      const res = await listed(cwd);

      expect(res.exitCode).toBe(0);
      expect(res.stdout).toContain("No deployments found ·");
    });

    it("counts what it found in the same words every other list counts in", async ({
      dir,
      server,
    }) => {
      const cwd = await aProject(dir);
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
