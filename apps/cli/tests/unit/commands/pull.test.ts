import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { http } from "msw";
import { afterEach, describe, expect, it } from "vitest";

import Pull, { fileList, RECONSTRUCTABLE, relPathForHandle } from "../../../src/commands/pull";
import { parseArg } from "../../helpers/inputs";
import {
  aProjectWithTwoDeploys,
  liveAcrossTwoPages,
  PLATFORM_URL,
  usePlatformServer,
} from "../../helpers/platform-project";
import { runCliForTest } from "../../helpers/run-cli";

describe("fileList", () => {
  it("says what the paths under it are", () => {
    expect(fileList([".zitadel/schemas/human-user.json"], false)).toBe(
      "\nFiles written:\n  .zitadel/schemas/human-user.json",
    );
  });

  it("says a dry run would write them, rather than that it did", () => {
    expect(fileList([".zitadel/schemas/human-user.json"], true)).toBe(
      "\nFiles it would write:\n  .zitadel/schemas/human-user.json",
    );
  });

  it("lists nothing, and leads nothing, when no file was written", () => {
    expect(fileList([], false)).toBe("");
  });
});

describe("relPathForHandle", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    while (dirs.length > 0) {
      const dir = dirs.pop();
      if (dir !== undefined) {
        await rm(dir, { recursive: true, force: true });
      }
    }
  });

  async function aProjectWith(relPath: string, body: object): Promise<string> {
    const cwd = await mkdtemp(join(tmpdir(), "zitadel-pull-unit-"));
    dirs.push(cwd);
    await mkdir(join(cwd, RECONSTRUCTABLE.schema.dir), { recursive: true });
    await writeFile(join(cwd, relPath), JSON.stringify(body));
    return cwd;
  }

  it("overwrites the existing file that already holds the handle, whatever its name", async () => {
    const cwd = await aProjectWith(".zitadel/schemas/default-human-user.json", {
      objectType: "human-user",
    });

    const relPath = await relPathForHandle(cwd, RECONSTRUCTABLE.schema, "human-user");

    expect(relPath).toBe(".zitadel/schemas/default-human-user.json");
  });

  it("writes <handle>.json when no existing file holds the handle", async () => {
    const cwd = await aProjectWith(".zitadel/schemas/default-human-user.json", {
      objectType: "human-user",
    });

    const relPath = await relPathForHandle(cwd, RECONSTRUCTABLE.schema, "machine-user");

    expect(relPath).toBe(".zitadel/schemas/machine-user.json");
  });

  it("writes <handle>.json when the directory does not exist yet", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "zitadel-pull-unit-"));
    dirs.push(cwd);

    const relPath = await relPathForHandle(cwd, RECONSTRUCTABLE.flow_definition, "default-login");

    expect(relPath).toBe(".zitadel/flows/default-login.json");
  });
});

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
