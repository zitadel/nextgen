import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ZitadelClient } from "@zitadel/api/client";
import defaultHumanUser from "@zitadel/config/defaults/default-human-user.json" with {
  type: "json",
};
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  INITIAL_DEPLOY_MESSAGE,
  runInitialDeploy,
} from "../../../../src/commands/setup/initial-deploy";
import { unscopedCommand } from "../../../../src/lib/suggestion";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/** The variables the default schema's `${...}` references resolve against. */
const ENV = {
  SERVER_URL: "http://localhost:8080",
  USER_SCHEMA_URL: "http://localhost:8080/schemas/human-user.json",
};

/** A project with the `.zitadel/` setup writes, outside any repository. */
async function aConfiguredProject(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "zitadel-initial-deploy-"));
  dirs.push(dir);
  await mkdir(join(dir, ".zitadel/schemas"), { recursive: true });
  // As setup leaves it on disk: the shipped default carries environment
  // references, and what is written out has them resolved.
  const schema = Object.entries(ENV).reduce(
    (json, [name, value]) => json.replaceAll(`\${${name}}`, value),
    JSON.stringify(defaultHumanUser),
  );
  await writeFile(join(dir, ".zitadel/schemas/human-user.json"), schema);
  return dir;
}

/** A platform that accepts the release and the deployment. */
function aWorkingPlatform(overrides: Partial<Record<string, unknown>> = {}): ZitadelClient {
  return {
    listDeployments: vi.fn().mockResolvedValue({ deployments: [] }),
    buildRelease: vi.fn().mockResolvedValue({ id: "rel_1", content_hash: "sha256:abc" }),
    createDeployment: vi
      .fn()
      .mockResolvedValue({ id: "dep_1", targets: [{ origin: "http://localhost:3000" }] }),
    ...overrides,
  } as unknown as ZitadelClient;
}

function deployIn(cwd: string, client: ZitadelClient): ReturnType<typeof runInitialDeploy> {
  return runInitialDeploy({
    cwd,
    client,
    projectId: "prj_1",
    env: ENV,
    json: true,
    color: false,
    suggest: (args) => unscopedCommand(args, "1.2.3"),
  });
}

describe("runInitialDeploy", () => {
  describe("against a platform that accepts the release", () => {
    it("reports the release and the deployment it made", async () => {
      const cwd = await aConfiguredProject();

      const outcome = await deployIn(cwd, aWorkingPlatform());

      expect(outcome).toEqual({
        kind: "deployed",
        releaseId: "rel_1",
        contentHash: "sha256:abc",
        deploymentId: "dep_1",
        origins: ["http://localhost:3000"],
        resources: 1,
      });
    });

    it("names the release after setup, so the history says where it came from", async () => {
      const cwd = await aConfiguredProject();
      const client = aWorkingPlatform();

      await deployIn(cwd, client);

      expect(client.buildRelease).toHaveBeenCalledWith(
        expect.objectContaining({ message: INITIAL_DEPLOY_MESSAGE }),
        { project_id: "prj_1" },
      );
    });

    it("records the commit the project was committed at", async () => {
      const cwd = await aConfiguredProject();
      const client = aWorkingPlatform();

      await deployIn(cwd, client);

      // No repository here, so there is no commit to record: the field is
      // omitted rather than sent empty, and `git_dirty` is false.
      expect(client.buildRelease).toHaveBeenCalledWith(
        expect.not.objectContaining({ git_sha: expect.anything() }),
        { project_id: "prj_1" },
      );
    });

    it("looks for no baseline to diff against, nothing having been deployed", async () => {
      const cwd = await aConfiguredProject();
      const client = aWorkingPlatform();

      await deployIn(cwd, client);

      expect(client.listDeployments).not.toHaveBeenCalled();
    });

    it("deploys to every primary origin, never a named one", async () => {
      const cwd = await aConfiguredProject();
      const client = aWorkingPlatform();

      await deployIn(cwd, client);

      expect(client.createDeployment).toHaveBeenCalledWith(
        expect.objectContaining({ targets: ["primary"] }),
        { project_id: "prj_1" },
      );
    });

    it("sends no concurrency guard, nothing having been deployed before", async () => {
      const cwd = await aConfiguredProject();
      const client = aWorkingPlatform();

      await deployIn(cwd, client);

      expect(client.createDeployment).toHaveBeenCalledWith(
        expect.not.objectContaining({ expected_deployment_id: expect.anything() }),
        { project_id: "prj_1" },
      );
    });
  });

  describe("against a platform that refuses it", () => {
    it("reports the failure instead of throwing, so setup keeps what it wrote", async () => {
      const cwd = await aConfiguredProject();
      const client = aWorkingPlatform({
        buildRelease: vi.fn().mockRejectedValue(new Error("the release was refused")),
      });

      const outcome = await deployIn(cwd, client);

      expect(outcome).toEqual({ kind: "failed", message: "the release was refused" });
    });

    it("deploys nothing when the release could not be built", async () => {
      const cwd = await aConfiguredProject();
      const client = aWorkingPlatform({
        buildRelease: vi.fn().mockRejectedValue(new Error("the release was refused")),
      });

      await deployIn(cwd, client);

      expect(client.createDeployment).not.toHaveBeenCalled();
    });
  });

  describe("with nothing to publish", () => {
    it("reports the failure rather than building an empty release", async () => {
      const cwd = await mkdtemp(join(tmpdir(), "zitadel-initial-deploy-empty-"));
      dirs.push(cwd);
      const client = aWorkingPlatform();

      const outcome = await deployIn(cwd, client);

      expect(outcome.kind).toBe("failed");
    });
  });
});
