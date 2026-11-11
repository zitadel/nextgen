import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";

import ResolveCommand from "@/commands/variable/resolve";
import { parseArg } from "@tests/helpers/inputs";
import {
  aProjectDirectory,
  PLATFORM_URL,
  usePlatformServer,
} from "@tests/helpers/platform-project";
import { parseJson, runCliForTest } from "@tests/helpers/run-cli";
import { onTerminalReadingAFile } from "@tests/helpers/terminal";

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
  frozen?: Record<string, Record<string, string>>;
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
    http.get(`${SERVER}/api/v1/deployments/:id/variables`, ({ params }) => {
      if (options.frozen === undefined) {
        return HttpResponse.json(options.variables ?? {});
      }
      const held = options.frozen[String(params.id)];
      return held === undefined
        ? HttpResponse.json({ code: "not_found", message: "no such deployment" }, { status: 404 })
        : HttpResponse.json(held);
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
      data: { deployment_id: string; origins: string[]; items: { name: string }[] };
    };

    expect(exitCode).toBe(0);
    expect(envelope.data.deployment_id).toBe("dep_1");
    expect(envelope.data.origins).toEqual(["https://app.acme.com"]);
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

  it("reads the variables of the deployment it is given, not another one's", async () => {
    const cwd = await aProject({
      deployments: [
        aDeployment("dep_b", "https://b.acme.com"),
        aDeployment("dep_a", "https://a.acme.com"),
      ],
      frozen: {
        dep_a: {
          FROM_A: "a",
        },
        dep_b: {
          FROM_B: "b",
        },
      },
    });

    const { exitCode, stdout } = await resolve(cwd, "dep_a");
    const envelope = parseJson(stdout) as {
      data: { deployment_id: string; items: { name: string; value?: string }[] };
    };

    expect(exitCode).toBe(0);
    expect(envelope.data.deployment_id).toBe("dep_a");
    expect(envelope.data).not.toHaveProperty("origins");
    expect(envelope.data.items).toMatchObject([
      {
        name: "FROM_A",
        value: "a",
      },
    ]);
  });

  it("reads a deployment that is not live", async () => {
    const cwd = await aProject({
      deployments: [aDeployment("dep_new", "https://app.acme.com")],
      frozen: {
        dep_old: {
          OLD: "kept",
        },
      },
    });

    const { exitCode, stdout } = await resolve(cwd, "dep_old");
    const envelope = parseJson(stdout) as {
      data: { deployment_id: string; items: { name: string; value?: string }[] };
    };

    expect(exitCode).toBe(0);
    expect(envelope.data.deployment_id).toBe("dep_old");
    expect(envelope.data.items).toMatchObject([
      {
        name: "OLD",
        value: "kept",
      },
    ]);
  });

  it("says in the empty line that the deployment froze no variables", async () => {
    const cwd = await aProject({
      deployments: [],
      frozen: {
        dep_old: {},
      },
    });

    const { exitCode, stdout } = await onTerminalReadingAFile(() => {
      return runCliForTest(["variable", "resolve", "dep_old", "--cwd", cwd, "--server", SERVER]);
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("dep_old froze no variables · project");
  });

  it("says a deployment the project does not have is not found", async () => {
    const cwd = await aProject({
      deployments: [],
      frozen: {},
    });

    const { exitCode, stdout } = await resolve(cwd, "dep_missing");

    expect(exitCode).not.toBe(0);
    expect(parseJson(stdout)).toMatchObject({
      status: "error",
      code: "E_NOT_FOUND",
    });
  });

  it("refuses a deployment together with an origin", async () => {
    const cwd = await aProject({
      deployments: [aDeployment("dep_a", "https://a.acme.com")],
    });

    const { exitCode, stdout } = await resolve(cwd, "dep_a", "--origin", "https://a.acme.com");

    expect(exitCode).toBe(3);
    expect(parseJson(stdout)).toMatchObject({
      status: "error",
      code: "E_VALIDATION",
      message: "Name a deployment or an origin, not both.",
    });
  });
});

const DEPLOYMENT = "dep_01KX5N7C9D2E7F0N9WD3P2E4YM6";

describe("deployment_id", () => {
  it("takes a deployment id, trimmed", async () => {
    await expect(
      parseArg(ResolveCommand.args.deployment_id, ` ${DEPLOYMENT}\n`, "deployment_id"),
    ).resolves.toBe(DEPLOYMENT);
  });

  it.each([
    ["a release id", "rel_01M6KPFXAE68N6G2X1HN5XD29R"],
    ["a blank", "   "],
    ["a prefix alone", "dep_"],
    ["a space inside", "dep_has space"],
  ])("refuses %s, saying what a deployment id is and where to list them", async (_, value) => {
    await expect(
      parseArg(ResolveCommand.args.deployment_id, value, "deployment_id"),
    ).rejects.toMatchObject({
      code: "E_VALIDATION",
      message: expect.stringContaining("must be a deployment ID"),
      hint: "Find one with `zitadel deployment list`, or omit it to read the live deployment.",
    });
  });
});
