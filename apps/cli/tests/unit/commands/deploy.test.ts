import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  DEFAULT_SCHEMA_CONFIG_PATH,
  getDefaultHumanUserSchemaBody,
} from "@zitadel/config/defaults";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";

import { noPrimaryOriginError } from "../../../src/commands/deploy";
import { environmentSelectorSuffix } from "../../../src/lib/oclif/environment-flags";
import {
  aProjectWithTwoDeploys,
  liveAcrossTwoPages,
  PLATFORM_URL,
  usePlatformServer,
} from "../../helpers/platform-project";
import {
  cliVersion,
  expectedPublicCliCommand,
  parseJson,
  runCliForTest,
} from "../../helpers/run-cli";

const ISSUER = "http://localhost:3000";
const PREVIEW_ISSUER = [{ pattern: ISSUER, kind: "preview" }];

function errorFor(
  input: Partial<Parameters<typeof noPrimaryOriginError>[0]>,
): ReturnType<typeof noPrimaryOriginError> {
  return noPrimaryOriginError({
    origins: [],
    issuer: ISSUER,
    setupProject: true,
    selector: environmentSelectorSuffix({}),
    cliVersion: cliVersion.version,
    ...input,
  });
}

describe("noPrimaryOriginError", () => {
  it("is a validation error", () => {
    expect(errorFor({}).code).toBe("E_VALIDATION");
  });

  it("suggests doctor --fix for setup's project holding its issuer as a preview origin", () => {
    const error = errorFor({
      origins: PREVIEW_ISSUER,
      selector: environmentSelectorSuffix({ cwd: "web" }),
    });

    expect(error.nextCommands).toEqual([expectedPublicCliCommand("doctor --fix --cwd web")]);
  });

  it("says why adding the preview issuer as primary does not work", () => {
    const error = errorFor({ origins: PREVIEW_ISSUER });

    expect(error.hint).toContain(`holds its issuer ${ISSUER} as a preview origin`);
  });

  it("suggests removing and re-adding the issuer for a project doctor does not repair", () => {
    const error = errorFor({
      origins: PREVIEW_ISSUER,
      setupProject: false,
      selector: environmentSelectorSuffix({ envName: "staging" }),
    });

    expect(error.nextCommands).toEqual([
      expectedPublicCliCommand(`origin rm ${ISSUER} --force --env staging`),
      expectedPublicCliCommand(`origin add ${ISSUER} --kind primary --env staging`),
    ]);
  });

  it("suggests adding the issuer as primary when the project does not hold it", () => {
    const error = errorFor({
      origins: [{ pattern: "https://*-acme.vercel.app", kind: "preview" }],
    });

    expect(error.nextCommands).toEqual([
      expectedPublicCliCommand(`origin add ${ISSUER} --kind primary`),
    ]);
  });

  it("adds the issuer as its origin, without a trailing slash", () => {
    const error = errorFor({ issuer: `${ISSUER}/` });

    expect(error.nextCommands).toEqual([
      expectedPublicCliCommand(`origin add ${ISSUER} --kind primary`),
    ]);
  });

  it("names origin add with a URL to fill in when no issuer resolves", () => {
    const error = errorFor({
      issuer: undefined,
      selector: environmentSelectorSuffix({ envName: "prod" }),
    });

    expect(error.hint).toContain("zitadel origin add <url> --kind primary --env prod");
  });

  it("suggests origin list when no issuer resolves", () => {
    const error = errorFor({ issuer: undefined });

    expect(error.nextCommands).toEqual([expectedPublicCliCommand("origin list")]);
  });
});

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
      http.post(`${PLATFORM_URL}/api/v1/deployments`, async ({ request }) => {
        const body: { expected_deployment_id?: string } = await request.clone().json();
        guards.push(body.expected_deployment_id);
        return undefined;
      }),
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
