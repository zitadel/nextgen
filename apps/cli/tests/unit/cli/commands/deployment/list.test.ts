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
import { aDeployment, PRIMARY_ORIGIN } from "@tests/helpers/records";

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

  const deployment = (id: string) => aDeployment({ id });

  const previewDeployment = (id: string) =>
    aDeployment({
      id,
      kind: "preview",
      targets: [{ origin: "https://pr-7.preview.acme.com", expires_at: "2030-01-01T00:00:00Z" }],
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
    it("ends each row with its kind and expiry, after deployed_at, piped", async () => {
      const cwd = await aProject();
      server.use(
        http.get(`${SERVER}/api/v1/deployments`, () =>
          HttpResponse.json({
            deployments: [deployment("dep_1"), previewDeployment("dep_2")],
            next_page_token: null,
          }),
        ),
      );

      const { stdout } = await runCliForTest([
        "deployment",
        "list",
        "--plain",
        "--cwd",
        cwd,
        "--server",
        SERVER,
        "--non-interactive",
        "--no-telemetry",
      ]);

      expect(stdout.split("\n").filter(Boolean)).toEqual([
        `dep_1\trel_1\tdeploy\t${PRIMARY_ORIGIN}\t2026-01-01T00:00:00Z\tprimary\t`,
        "dep_2\trel_1\tdeploy\thttps://pr-7.preview.acme.com\t2026-01-01T00:00:00Z\tpreview\t2030-01-01T00:00:00Z",
      ]);
    });

    it("heads the columns with kind and expires last, at a terminal", async () => {
      const cwd = await aProject();
      server.use(
        http.get(`${SERVER}/api/v1/deployments`, () =>
          HttpResponse.json({ deployments: [previewDeployment("dep_2")], next_page_token: null }),
        ),
      );

      const res = await listed(cwd);

      expect(res.stdout).toMatch(/id.*release_id.*reason.*origins.*deployed_at.*kind.*expires/);
    });

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
