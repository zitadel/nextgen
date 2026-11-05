import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";

import {
  aProjectDirectory,
  PLATFORM_URL,
  usePlatformServer,
} from "@tests/helpers/platform-project";
import { parseJson, runCliForTest } from "@tests/helpers/run-cli";

const SERVER = PLATFORM_URL;
const { server, dirs } = usePlatformServer();

/** One deployment as the live list answers it. */
function aDeployment(id: string, origin: string) {
  return {
    id,
    release_id: `rel_${id}`,
    targets: [
      {
        origin,
        expires_at: null,
      },
    ],
    metadata: {
      reason: "deploy",
    },
    deployed_at: "2026-01-01T00:00:00.000Z",
  };
}

/**
 * A project directory, with the live deployments, the project's origins and the
 * frozen variables the run will read.
 */
async function aProject(options: {
  deployments: ReturnType<typeof aDeployment>[];
  origins?: { kind: string; pattern: string }[];
  variables?: Record<string, { value?: string; secret?: boolean }>;
}): Promise<string> {
  const cwd = await aProjectDirectory("zitadel-variable-resolve-", {
    id: "proj_1",
    secret: "sk_proj_1",
  });
  dirs.push(cwd);
  server.use(
    http.get(`${SERVER}/api/v1/deployments`, () => {
      return HttpResponse.json({
        deployments: options.deployments,
        next_page_token: null,
      });
    }),
    http.get(`${SERVER}/api/v1/projects/proj_1`, () => {
      return HttpResponse.json({
        id: "proj_1",
        origins: options.origins ?? [],
      });
    }),
    http.get(`${SERVER}/api/v1/deployments/:id/variables`, () => {
      return HttpResponse.json(options.variables ?? {});
    }),
  );
  return cwd;
}

/** Runs `variable resolve` with `--json`, as a script reads it. */
async function resolve(cwd: string, ...args: string[]) {
  return runCliForTest([
    "variable",
    "resolve",
    "--cwd",
    cwd,
    "--server",
    SERVER,
    "--json",
    ...args,
  ]);
}

describe("variable resolve", () => {
  it("shows the variables the one live deployment froze", async () => {
    const cwd = await aProject({
      deployments: [aDeployment("dep_1", "https://app.acme.com")],
      variables: {
        API_URL: {
          value: "https://api.acme.com",
        },
      },
    });

    const { exitCode, stdout } = await resolve(cwd);
    const envelope = parseJson(stdout) as {
      data: { deployment_id: string; items: { name: string }[] };
    };

    expect(exitCode).toBe(0);
    expect(envelope.data.deployment_id).toBe("dep_1");
    expect(envelope.data.items).toMatchObject([
      {
        name: "API_URL",
      },
    ]);
  });

  it("names the live origins when several deployments are live and none is chosen", async () => {
    const cwd = await aProject({
      deployments: [
        aDeployment("dep_b", "https://b.acme.com"),
        aDeployment("dep_a", "https://a.acme.com"),
      ],
    });

    const { exitCode, stdout } = await resolve(cwd);

    expect(exitCode).toBe(3);
    expect(parseJson(stdout)).toMatchObject({
      status: "error",
      code: "E_VALIDATION",
      hint: "Live origins: https://a.acme.com, https://b.acme.com.",
    });
  });

  it("says nothing is deployed to the project", async () => {
    const cwd = await aProject({
      deployments: [],
    });

    const { stdout } = await resolve(cwd);

    expect(parseJson(stdout)).toMatchObject({
      status: "error",
      code: "E_NOT_FOUND",
      message: "Nothing is deployed to the project.",
    });
  });

  it("says how to reach a primary origin nothing is deployed to", async () => {
    const cwd = await aProject({
      deployments: [],
      origins: [
        {
          kind: "primary",
          pattern: "https://app.acme.com",
        },
      ],
    });

    const { stdout } = await resolve(cwd, "--origin", "https://app.acme.com");

    expect(parseJson(stdout)).toMatchObject({
      status: "error",
      message: "Nothing is deployed to https://app.acme.com.",
      hint: expect.stringContaining("Deploy to it first"),
    });
  });

  it("explains that a preview origin is served by a pull-request build", async () => {
    const cwd = await aProject({
      deployments: [],
      origins: [
        {
          kind: "preview",
          pattern: "https://pr-*.acme.com",
        },
      ],
    });

    const { stdout } = await resolve(cwd, "--origin", "https://pr-1.acme.com");

    expect(parseJson(stdout)).toMatchObject({
      status: "error",
      hint: expect.stringContaining("pull-request build"),
    });
  });

  it("refuses an origin the project does not have", async () => {
    const cwd = await aProject({
      deployments: [],
    });

    const { stdout } = await resolve(cwd, "--origin", "https://typo.acme.com");

    expect(parseJson(stdout)).toMatchObject({
      status: "error",
      message: "https://typo.acme.com is not an origin of the project.",
    });
  });
});
