import { http } from "msw";
import { describe, expect, it } from "vitest";

import Pull, { documentForHandle, RECONSTRUCTABLE } from "@/commands/pull";
import { type ConfigFiles, ZitadelConfig } from "@/lib/zitadel";
import { parseArg } from "@tests/helpers/inputs";
import {
  aProjectWithTwoDeploys,
  liveAcrossTwoPages,
  PLATFORM_URL,
  usePlatformServer,
} from "@tests/helpers/platform-project";
import { runCliForTest } from "@tests/helpers/run-cli";

function configOf(files: Partial<ConfigFiles>): ZitadelConfig {
  return ZitadelConfig.of({
    schemas: [],
    flows: [],
    connections: [],
    policies: [],
    branding: [],
    ...files,
  });
}

describe("documentForHandle", () => {
  it("finds the schema file that holds the handle, whatever its name", () => {
    const config = configOf({
      schemas: [
        { path: ".zitadel/schemas/default-human-user.json", body: { objectType: "human-user" } },
      ],
    });

    const document = documentForHandle(config, RECONSTRUCTABLE.schema, "human-user");

    expect(document?.path).toBe(".zitadel/schemas/default-human-user.json");
  });

  it("finds the flow file that holds the handle by its name", () => {
    const config = configOf({
      flows: [{ path: ".zitadel/flows/login.json", body: { name: "default-login" } }],
    });

    const document = documentForHandle(config, RECONSTRUCTABLE.flow_definition, "default-login");

    expect(document?.path).toBe(".zitadel/flows/login.json");
  });

  it("finds nothing when no file holds the handle", () => {
    const config = configOf({
      schemas: [
        { path: ".zitadel/schemas/default-human-user.json", body: { objectType: "human-user" } },
      ],
    });

    expect(documentForHandle(config, RECONSTRUCTABLE.schema, "machine-user")).toBeUndefined();
  });

  it("finds nothing in an empty configuration", () => {
    expect(
      documentForHandle(ZitadelConfig.empty(), RECONSTRUCTABLE.flow_definition, "default-login"),
    ).toBeUndefined();
  });

  it("never takes a file of another kind that happens to carry the handle", () => {
    const config = configOf({
      schemas: [{ path: ".zitadel/schemas/odd.json", body: { name: "default-login" } }],
    });

    expect(
      documentForHandle(config, RECONSTRUCTABLE.flow_definition, "default-login"),
    ).toBeUndefined();
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
