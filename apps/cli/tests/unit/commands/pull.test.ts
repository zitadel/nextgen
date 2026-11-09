import { http } from "msw";
import { describe, expect, it } from "vitest";

import Pull from "@/commands/pull";
import { parseArg } from "@tests/helpers/inputs";
import {
  aProjectWithTwoDeploys,
  liveAcrossTwoPages,
  PLATFORM_URL,
  usePlatformServer,
} from "@tests/helpers/platform-project";
import { runCliForTest } from "@tests/helpers/run-cli";

describe("pull latest", () => {
  const { server, dirs } = usePlatformServer();

  it("pulls the release of the primary that is live, past the first page", async () => {
    const project = await aProjectWithTwoDeploys("zitadel-pull-");
    dirs.push(project.cwd);
    server.use(liveAcrossTwoPages({ id: "dep_live_primary", release_id: "rel_live" }));
    const read: string[] = [];
    server.use(
      http.get(`${PLATFORM_URL}/api/v1/releases/:id`, ({ params }) => {
        read.push(params.id as string);
        return undefined;
      }),
    );

    await runCliForTest([
      "pull",
      "latest",
      "--cwd",
      project.cwd,
      "--server",
      PLATFORM_URL,
      "--json",
    ]);

    expect(read).toEqual(["rel_live"]);
  });
});

describe("the pull target argument", () => {
  it.each([
    ["latest", { kind: "latest" }],
    ["rel_01KX3RG8A7F0N9WD3P2E4YM5C1", { kind: "release", id: "rel_01KX3RG8A7F0N9WD3P2E4YM5C1" }],
    [
      "dep_01KX5N7C9D2E7F0N9WD3P2E4YM6",
      { kind: "deployment", id: "dep_01KX5N7C9D2E7F0N9WD3P2E4YM6" },
    ],
  ])("classifies %j", async (value, target) => {
    await expect(parseArg(Pull.args.target, value, "target")).resolves.toEqual(target);
  });

  it("pulls the live release when no target is given", () => {
    expect(Pull.args.target.default).toEqual({ kind: "latest" });
  });

  it.each(["newest", "rel", "01KX3RG8A7F0N9WD3P2E4YM5C1"])(
    "refuses %j, saying what it takes",
    async (value) => {
      await expect(parseArg(Pull.args.target, value, "target")).rejects.toMatchObject({
        code: "E_VALIDATION",
        message: `Don't know how to pull "${value}".`,
        hint: "Pass 'latest', a release id (rel_…), or a deployment id (dep_…).",
      });
    },
  );
});
