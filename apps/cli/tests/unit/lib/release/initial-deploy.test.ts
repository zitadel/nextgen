import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { runInitialDeploy } from "../../../../src/lib/release/initial-deploy";
import type { SuggestedCommand } from "../../../../src/lib/suggestion";

let dir: string;

afterEach(async () => {
  if (dir) {
    await rm(dir, { recursive: true, force: true });
  }
});

const DEFAULTS = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../../../packages/config/defaults",
);

const SERVER = "https://api.zitadel.example";

/** One default resource, with the placeholders a scaffolded project has filled in. */
async function resolved(name: string): Promise<string> {
  return (await readFile(join(DEFAULTS, name), "utf8"))
    .replaceAll("${SERVER_URL}", SERVER)
    .replaceAll("${USER_SCHEMA_URL}", `${SERVER}/schemas/human-user.json`);
}

/** A project holding the resources setup scaffolds, which validate cleanly. */
async function project(): Promise<string> {
  dir = await mkdtemp(join(tmpdir(), "zitadel-initial-deploy-"));
  await mkdir(join(dir, ".zitadel", "schemas"), { recursive: true });
  await mkdir(join(dir, ".zitadel", "flows"), { recursive: true });
  await writeFile(
    join(dir, ".zitadel", "schemas", "human-user.json"),
    await resolved("default-human-user.json"),
  );
  await writeFile(
    join(dir, ".zitadel", "flows", "default-login.json"),
    await resolved("default-login.json"),
  );
  return dir;
}

/** A platform that accepts the release and the deployment. */
function acceptingClient(calls: Array<Record<string, unknown>> = []) {
  return {
    calls,
    client: {
      buildRelease: async (body: Record<string, unknown>) => {
        calls.push({ release: body });
        return { id: "rel_1", content_hash: "sha256:abc" };
      },
      createDeployment: async (body: Record<string, unknown>) => {
        calls.push({ deployment: body });
        return { id: "dep_1", targets: [{ origin: "https://app.acme.com" }] };
      },
    } as never,
  };
}

async function deploy(client: unknown, cwd: string) {
  return runInitialDeploy({
    cwd,
    client: client as never,
    projectId: "proj_1",
    env: {
      SERVER_URL: "https://api.zitadel.example",
      USER_SCHEMA_URL: "https://api.zitadel.example/user-schema.json",
    },
    json: true,
    color: false,
    message: "Initial deployment",
    suggest: (args) => args as SuggestedCommand,
  });
}

describe("runInitialDeploy", () => {
  it("reports the release and the origins it deployed to", async () => {
    const cwd = await project();

    const outcome = await deploy(acceptingClient().client, cwd);

    expect(outcome).toMatchObject({
      kind: "deployed",
      releaseId: "rel_1",
      contentHash: "sha256:abc",
      deploymentId: "dep_1",
      origins: ["https://app.acme.com"],
    });
  });

  it("deploys the release it created, to the primary origins", async () => {
    const cwd = await project();
    const { client, calls } = acceptingClient();

    await deploy(client, cwd);

    expect(calls.at(-1)).toMatchObject({
      deployment: { release_id: "rel_1", targets: ["primary"] },
    });
  });

  it("reports a failure rather than throwing, so the caller can carry on", async () => {
    const cwd = await project();
    const client = {
      buildRelease: async () => {
        throw new Error("the platform said no");
      },
    };

    const outcome = await deploy(client, cwd);

    expect(outcome).toMatchObject({ kind: "failed", message: "the platform said no" });
  });

  it("reports a project with nothing in .zitadel/ as a failure", async () => {
    dir = await mkdtemp(join(tmpdir(), "zitadel-initial-deploy-empty-"));

    const outcome = await deploy(acceptingClient().client, dir);

    expect(outcome).toMatchObject({ kind: "failed" });
  });
});
