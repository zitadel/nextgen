import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  DEFAULT_SCHEMA_CONFIG_PATH,
  getDefaultHumanUserSchemaBody,
} from "@zitadel/config/defaults";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";

import {
  aProjectWithTwoDeploys,
  liveAcrossTwoPages,
  PLATFORM_URL,
  usePlatformServer,
} from "@tests/helpers/platform-project";
import { parseJson, runCliForTest } from "@tests/helpers/run-cli";

describe("deploy", () => {
  const { server, dirs } = usePlatformServer();

  it("guards the deploy with the primary that is live, past the first page", async () => {
    const project = await aProjectWithTwoDeploys("zitadel-deploy-");
    dirs.push(project.cwd);
    await mkdir(join(project.cwd, ".zitadel/schemas"), { recursive: true });
    await writeFile(
      join(project.cwd, DEFAULT_SCHEMA_CONFIG_PATH),
      JSON.stringify(getDefaultHumanUserSchemaBody()),
    );
    server.use(liveAcrossTwoPages({ id: "dep_live_primary", release_id: "rel_live" }));
    const guards: unknown[] = [];
    server.use(
      http.post<never, { expected_deployment_id?: string }>(
        `${PLATFORM_URL}/api/v1/deployments`,
        async ({ request }) => {
          const body = await request.clone().json();
          guards.push(body.expected_deployment_id);
          return undefined;
        },
      ),
    );

    await runCliForTest([
      "deploy",
      "-m",
      "test",
      "--cwd",
      project.cwd,
      "--server",
      PLATFORM_URL,
      "--json",
    ]);

    expect(guards).toEqual(["dep_live_primary"]);
  });

  it("reports the primary that raced in on a conflict, past the first page", async () => {
    const project = await aProjectWithTwoDeploys("zitadel-deploy-");
    dirs.push(project.cwd);
    await mkdir(join(project.cwd, ".zitadel/schemas"), { recursive: true });
    await writeFile(
      join(project.cwd, DEFAULT_SCHEMA_CONFIG_PATH),
      JSON.stringify(getDefaultHumanUserSchemaBody()),
    );
    server.use(
      liveAcrossTwoPages({ id: "dep_live_primary", release_id: "rel_live" }),
      http.post(`${PLATFORM_URL}/api/v1/deployments`, () =>
        HttpResponse.json(
          { code: "dep.expected_mismatch", message: "the targets changed" },
          { status: 409 },
        ),
      ),
    );

    const res = await runCliForTest([
      "deploy",
      "-m",
      "test",
      "--cwd",
      project.cwd,
      "--server",
      PLATFORM_URL,
      "--json",
    ]);

    expect(parseJson(res.stdout)).toMatchObject({
      code: "E_CONFLICT",
      details: { current_deployment: { id: "dep_live_primary" } },
    });
  });
});
