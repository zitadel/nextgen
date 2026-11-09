import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { HttpResponse, http } from "msw";
import { describe, expect, it, vi } from "vitest";

import Pull from "@/commands/pull";
import { ZitadelError } from "@/lib/errors";
import { parseArg } from "@tests/helpers/inputs";
import {
  aProjectWithTwoDeploys,
  liveAcrossTwoPages,
  PLATFORM_URL,
  usePlatformServer,
} from "@tests/helpers/platform-project";
import { runCliForTest } from "@tests/helpers/run-cli";
import { rejectionOf } from "@tests/helpers/thrown-value";

/**
 * The release the live primary deployment serves, found only past the first
 * page of live deployments.
 */
const LIVE_RELEASE = "rel_live";

/**
 * The live primary deployment.
 */
const LIVE_PRIMARY = { id: "dep_live_primary", release_id: LIVE_RELEASE };

/**
 * A release id as the platform mints it.
 */
const RELEASE_ID = "rel_01KX3RG8A7F0N9WD3P2E4YM5C1";

/**
 * A deployment id as the platform mints it.
 */
const DEPLOYMENT_ID = "dep_01KX5N7C9D2E7F0N9WD3P2E4YM6";

const { server, dirs } = usePlatformServer();

/**
 * Answers a read of {@link LIVE_RELEASE} with a release that pins nothing, so
 * a pull of it succeeds and reports which release it read.
 *
 * @returns The handler.
 */
function answersTheLiveRelease() {
  return http.get(`${PLATFORM_URL}/api/v1/releases/${LIVE_RELEASE}`, ({ request }) => {
    return HttpResponse.json({
      id: LIVE_RELEASE,
      project_id: new URL(request.url).searchParams.get("project_id"),
      content_hash: `sha256:${"0".repeat(64)}`,
      metadata: {
        message: null,
        git_sha: null,
        git_dirty: null,
        created_at: "2026-01-01T00:00:00.000Z",
        created_by: null,
        created_by_type: "service",
      },
      revoked_at: null,
      pointers: [],
    });
  });
}

describe("pull", () => {
  describe("with latest as the target", () => {
    it("pulls the release of the primary that is live, past the first page", async () => {
      const project = await aProjectWithTwoDeploys("zitadel-pull-");
      dirs.push(project.cwd);
      server.use(liveAcrossTwoPages(LIVE_PRIMARY), answersTheLiveRelease());

      const result = await runCliForTest([
        "pull",
        "latest",
        "--cwd",
        project.cwd,
        "--server",
        PLATFORM_URL,
        "--json",
      ]);

      expect(JSON.parse(result.stdout)).toMatchObject({ data: { release_id: LIVE_RELEASE } });
    });

    it("is not stopped by a branding file it cannot read", async () => {
      const project = await aProjectWithTwoDeploys("zitadel-pull-");
      dirs.push(project.cwd);
      await mkdir(join(project.cwd, ".zitadel/branding/unreadable.json"), { recursive: true });
      server.use(liveAcrossTwoPages(LIVE_PRIMARY), answersTheLiveRelease());

      const envelope = await Pull.run([
        "latest",
        "--cwd",
        project.cwd,
        "--server",
        PLATFORM_URL,
        "--json",
      ]);

      expect(JSON.parse(JSON.stringify(envelope))).toMatchObject({
        data: { release_id: LIVE_RELEASE },
      });
    });
  });
});

describe("pull of a release pinning a handle that has no file", () => {
  /**
   * Answers a release pinning a good schema and then one by an unsafe handle.
   *
   * @returns The handlers.
   */
  function pinningAGoodSchemaThenABadHandle() {
    return [
      http.get(`${PLATFORM_URL}/api/v1/releases/${RELEASE_ID}`, ({ request }) => {
        return HttpResponse.json({
          id: RELEASE_ID,
          project_id: new URL(request.url).searchParams.get("project_id"),
          content_hash: `sha256:${"0".repeat(64)}`,
          metadata: {
            message: null,
            git_sha: null,
            git_dirty: null,
            created_at: "2026-01-01T00:00:00.000Z",
            created_by: null,
            created_by_type: "service",
          },
          revoked_at: null,
          pointers: [
            { kind: "schema", handle: "good", revision_id: "sch_good" },
            { kind: "schema", handle: "../x", revision_id: "sch_bad" },
          ],
        });
      }),
      http.get(`${PLATFORM_URL}/api/v1/schemas/:id`, ({ params }) => {
        return HttpResponse.json({ id: params.id, schema: { objectType: "human-user" } });
      }),
    ];
  }

  it.each([[[]], [["--dry-run"]]])("writes no file, with flags %j", async (flags) => {
    const project = await aProjectWithTwoDeploys("zitadel-pull-");
    dirs.push(project.cwd);
    server.use(...pinningAGoodSchemaThenABadHandle());

    await runCliForTest([
      "pull",
      RELEASE_ID,
      "--cwd",
      project.cwd,
      "--server",
      PLATFORM_URL,
      "--json",
      ...flags,
    ]);

    expect(existsSync(join(project.cwd, ".zitadel/schemas/good.json"))).toBe(false);
  });
});

describe("pull of a release whose revisions cannot be fetched", () => {
  it("raises the first failure in the order the release pins them", async () => {
    const project = await aProjectWithTwoDeploys("zitadel-pull-");
    dirs.push(project.cwd);
    server.use(
      http.get(`${PLATFORM_URL}/api/v1/releases/${RELEASE_ID}`, ({ request }) => {
        return HttpResponse.json({
          id: RELEASE_ID,
          project_id: new URL(request.url).searchParams.get("project_id"),
          content_hash: `sha256:${"0".repeat(64)}`,
          metadata: {
            message: null,
            git_sha: null,
            git_dirty: null,
            created_at: "2026-01-01T00:00:00.000Z",
            created_by: null,
            created_by_type: "service",
          },
          revoked_at: null,
          pointers: [
            { kind: "schema", handle: "first", revision_id: "sch_first" },
            { kind: "schema", handle: "second", revision_id: "sch_second" },
          ],
        });
      }),
      http.get(`${PLATFORM_URL}/api/v1/schemas/:id`, async ({ params }) => {
        if (params.id === "sch_first") {
          await new Promise((resolve) => {
            setTimeout(resolve, 100);
          });
        }
        return HttpResponse.json(
          { code: "internal", message: `${String(params.id)} failed` },
          { status: 400 },
        );
      }),
    );

    const printed = vi.spyOn(console, "log").mockImplementation(() => {
      return undefined;
    });
    await rejectionOf(() => {
      return Pull.run([RELEASE_ID, "--cwd", project.cwd, "--server", PLATFORM_URL, "--json"]);
    });
    const said = printed.mock.calls.flat().join("\n");
    printed.mockRestore();

    expect(JSON.parse(said)).toMatchObject({
      status: "error",
      message: "sch_first failed",
    });
  });
});

describe("Pull.args.target", () => {
  it.each([
    ["latest", { kind: "latest" }],
    [RELEASE_ID, { kind: "release", id: RELEASE_ID }],
    [DEPLOYMENT_ID, { kind: "deployment", id: DEPLOYMENT_ID }],
  ])("classifies %j", async (value, expected) => {
    const target = await parseArg(Pull.args.target, value, "target");

    expect(target).toEqual(expected);
  });

  it("pulls the live release when no target is given", () => {
    const fallback = Pull.args.target.default;

    expect(fallback).toEqual({ kind: "latest" });
  });

  it.each(["newest", "rel", "01KX3RG8A7F0N9WD3P2E4YM5C1"])(
    "refuses %j, saying what it takes",
    async (value) => {
      const error = await rejectionOf(() => {
        return parseArg(Pull.args.target, value, "target");
      });

      expect(error).toBeInstanceOf(ZitadelError);
      expect(error).toMatchObject({
        code: "E_VALIDATION",
        message: `Don't know how to pull "${value}".`,
        hint: "Pass 'latest', a release id (rel_…), or a deployment id (dep_…).",
      });
    },
  );
});
