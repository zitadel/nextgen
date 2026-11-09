import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { beforeEach, describe, expect, vi } from "vitest";

import { it } from "@tests/helpers/fixtures";

import type { StepContext, StepResult } from "@/lib/publish/pipeline";
import { diffStep } from "@/lib/publish/steps/diff";
import { DeploymentService, VariableService, SchemaService, UserService } from "@/lib/backend";
import { fakeClient } from "@tests/helpers/fake-client";
import type { SuggestedCommand } from "@/lib/suggestion";
import { DiskStore, ZitadelConfig } from "@/lib/zitadel";

const run = promisify(execFile);

type Live = {
  targets: { origin: string; expires_at?: string }[];
  sha?: string;
  release?: string;
  dirty?: boolean;
};

const written: string[] = [];
const asked: unknown[] = [];

beforeEach(async () => {
  written.length = 0;
  asked.length = 0;
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    written.push(String(chunk));
    return true;
  });
});

/** What the step told the person, as the pipeline would print it. */
function shown(result: StepResult | undefined): string {
  return result?.notices?.join("") ?? "";
}

function ctx(
  cwd: string,
  live: Live[],
  json = false,
  env: Record<string, string> = {},
  learned?: StepContext["learned"],
): StepContext {
  return {
    cwd,
    deployments: new DeploymentService(
      fakeClient({
        listDeployments: {
          all: async (params) => {
            asked.push(params);
            return live.map((deployment, index) => {
              return {
                id: `dep_${index}`,
                project_id: "proj_1",
                kind: "primary" as const,
                status: "live" as const,
                deployed_at: "2026-01-01T00:00:00Z",
                metadata: { reason: "deploy" as const },
                targets: deployment.targets,
                release_id: deployment.release ?? "rel_1",
                release: {
                  metadata: { git_sha: deployment.sha, git_dirty: deployment.dirty ?? false },
                },
              };
            });
          },
        },
      }),
      "proj_1",
    ),
    variables: new VariableService(fakeClient({}), "proj_1"),
    schemas: new SchemaService(fakeClient({}), "proj_1"),
    users: new UserService(fakeClient({})),
    env,
    mode: "deploy",
    dryRun: false,
    json,
    color: false,
    bundle: { schemas: [], flow_definitions: [], idps: [], policies: [] },
    config: ZitadelConfig.empty(),
    store: new DiskStore(cwd),
    suggest: (args) => `${args} --env staging` as SuggestedCommand,
    learned,
  };
}

/** Commits a user schema in `cwd`, as the live release was built, and returns the commit. */
async function liveCommit(cwd: string): Promise<string> {
  const git = (args: string[]) => run("git", args, { cwd });
  await mkdir(join(cwd, ".zitadel", "schemas"), { recursive: true });
  await writeFile(join(cwd, ".zitadel", "schemas", "user.json"), '{ "type": "object" }\n');
  await git(["init", "-q"]);
  await git(["config", "user.email", "test@example.com"]);
  await git(["config", "user.name", "Test"]);
  await git(["add", "."]);
  await git(["commit", "-q", "-m", "initial"]);
  return (await git(["rev-parse", "HEAD"])).stdout.trim();
}

/** Edits the committed user schema, as a developer would before deploying. */
function editSchema(cwd: string): Promise<void> {
  return writeFile(join(cwd, ".zitadel", "schemas", "user.json"), '{ "type": "string" }\n');
}

const PRIMARY = { origin: "https://app.acme.com" };
const SECOND_PRIMARY = { origin: "https://www.acme.com" };
const PREVIEW = { origin: "https://pr-7.acme.com", expires_at: "2026-12-01T00:00:00Z" };

describe("diffStep", () => {
  it("reads what is live, with the release each deployment serves", async ({ dir: cwd }) => {
    await diffStep.run(ctx(cwd, []));

    expect(asked).toEqual([{ project_id: "proj_1", live: true, expand: ["release"] }]);
  });

  it("says there is nothing to diff against before the first deploy", async ({ dir: cwd }) => {
    const result = await diffStep.run(ctx(cwd, []));

    expect(shown(result)).toContain("No diff available: nothing is deployed yet");
  });

  it("says so when the live commit is not in this repository", async ({ dir: cwd }) => {
    const result = await diffStep.run(ctx(cwd, [{ targets: [PRIMARY], sha: "0123456789abcdef" }]));

    expect(shown(result)).toContain("0123456789ab is not in this repository's history");
  });

  it("refuses to diff against a release built from an uncommitted tree", async ({ dir: cwd }) => {
    const result = await diffStep.run(
      ctx(cwd, [{ targets: [PRIMARY], sha: "0123456789abcdef", dirty: true }]),
    );

    expect(shown(result)).toContain("No reliable diff available");
  });

  it("names the uncommitted baseline's commit, so the reader can check it", async ({
    dir: cwd,
  }) => {
    const result = await diffStep.run(
      ctx(cwd, [{ targets: [PRIMARY], sha: "0123456789abcdef", dirty: true }]),
    );

    expect(shown(result)).toContain("0123456789ab");
  });

  it("never takes a live preview as the baseline", async ({ dir: cwd }) => {
    const result = await diffStep.run(
      ctx(cwd, [
        { targets: [PREVIEW], sha: "ffffffffffffffff" },
        { targets: [PRIMARY], sha: "0123456789abcdef" },
      ]),
    );

    expect(shown(result)).toContain("0123456789ab");
  });

  it("says so when the primary origins serve different releases", async ({ dir: cwd }) => {
    const result = await diffStep.run(
      ctx(cwd, [
        { targets: [PRIMARY], sha: "0123456789abcdef", release: "rel_2" },
        { targets: [SECOND_PRIMARY], sha: "fedcba9876543210", release: "rel_1" },
      ]),
    );

    expect(shown(result)).toContain("The primary origins serve 2 different releases");
  });

  it("prints the diff against the live commit", async ({ dir: cwd }) => {
    const sha = await liveCommit(cwd);
    await editSchema(cwd);

    const result = await diffStep.run(ctx(cwd, [{ targets: [PRIMARY], sha }]));

    expect(shown(result)).toContain('+{ "type": "string" }');
  });

  it("records that a schema changed since the live commit", async ({ dir: cwd }) => {
    const sha = await liveCommit(cwd);
    await editSchema(cwd);
    const learned: StepContext["learned"] = {};

    await diffStep.run(ctx(cwd, [{ targets: [PRIMARY], sha }], false, {}, learned));

    expect(learned.schemasOrFlowsChanged).toBe(true);
  });

  it("records that no schema or flow changed when only branding did", async ({ dir: cwd }) => {
    const sha = await liveCommit(cwd);
    await mkdir(join(cwd, ".zitadel", "branding"), { recursive: true });
    await writeFile(join(cwd, ".zitadel", "branding", "brand.json"), "{}\n");
    const learned: StepContext["learned"] = {};

    await diffStep.run(ctx(cwd, [{ targets: [PRIMARY], sha }], false, {}, learned));

    expect(learned.schemasOrFlowsChanged).toBe(false);
  });

  it("records nothing when the primary origins serve different releases", async ({ dir: cwd }) => {
    const sha = await liveCommit(cwd);
    const learned: StepContext["learned"] = {};

    await diffStep.run(
      ctx(
        cwd,
        [
          { targets: [PRIMARY], sha, release: "rel_2" },
          { targets: [SECOND_PRIMARY], sha, release: "rel_1" },
        ],
        false,
        {},
        learned,
      ),
    );

    expect(learned.schemasOrFlowsChanged).toBeUndefined();
  });

  it("records nothing when there is no diff to read", async ({ dir: cwd }) => {
    const learned: StepContext["learned"] = {};

    await diffStep.run(ctx(cwd, [], false, {}, learned));

    expect(learned.schemasOrFlowsChanged).toBeUndefined();
  });

  it("says when nothing changed since the live commit", async ({ dir: cwd }) => {
    const sha = await liveCommit(cwd);

    const result = await diffStep.run(ctx(cwd, [{ targets: [PRIMARY], sha }]));

    expect(shown(result)).toContain(`No changes to .zitadel/ since ${sha.slice(0, 12)}`);
  });

  describe("--json", () => {
    it("writes nothing to stdout", async ({ dir: cwd }) => {
      await diffStep.run(ctx(cwd, [], true));

      expect(written).toEqual([]);
    });

    it("reports each changed file against the live commit", async ({ dir: cwd }) => {
      const sha = await liveCommit(cwd);
      await editSchema(cwd);

      const report = await diffStep.run(ctx(cwd, [{ targets: [PRIMARY], sha }], true));

      expect(report?.data).toEqual({
        diff: {
          against: sha,
          files: [
            {
              path: ".zitadel/schemas/user.json",
              status: "modified",
              patch: expect.stringContaining('+{ "type": "string" }'),
            },
          ],
        },
      });
    });

    it("reports no files when nothing changed since the live commit", async ({ dir: cwd }) => {
      const sha = await liveCommit(cwd);

      const report = await diffStep.run(ctx(cwd, [{ targets: [PRIMARY], sha }], true));

      expect(report?.data).toEqual({ diff: { against: sha, files: [] } });
    });

    it("shows a variable reference as written, never the value it resolves to", async ({
      dir: cwd,
    }) => {
      const sha = await liveCommit(cwd);
      await mkdir(join(cwd, ".zitadel", "idps"), { recursive: true });
      await writeFile(
        join(cwd, ".zitadel", "idps", "google.json"),
        '{ "client_secret": "${{ GOOGLE_CLIENT_SECRET }}" }\n',
      );

      const report = await diffStep.run(
        ctx(cwd, [{ targets: [PRIMARY], sha }], true, {
          GOOGLE_CLIENT_SECRET: "the-client-secret",
        }),
      );

      const reported = JSON.stringify(report);
      expect(reported).toContain("${{ GOOGLE_CLIENT_SECRET }}");
      expect(reported).not.toContain("the-client-secret");
    });

    it("reports a branding template edited outside .zitadel/", async ({ dir: cwd }) => {
      await mkdir(join(cwd, "templates"), { recursive: true });
      await writeFile(join(cwd, "templates", "login.liquid"), "<main></main>\n");
      const sha = await liveCommit(cwd);
      await writeFile(join(cwd, "templates", "login.liquid"), "<main>edited</main>\n");
      const config = ZitadelConfig.of({
        schemas: [],
        flows: [],
        connections: [],
        policies: [],
        branding: [
          {
            path: ".zitadel/branding/brand.json",
            body: { liquid_template: { $file: "../../templates/login.liquid" } },
          },
        ],
      });

      const report = await diffStep.run({
        ...ctx(cwd, [{ targets: [PRIMARY], sha }], true),
        config,
      });

      expect(report?.data).toEqual({
        diff: {
          against: sha,
          files: [
            {
              path: "templates/login.liquid",
              status: "modified",
              patch: expect.stringContaining("+<main>edited</main>"),
            },
          ],
        },
      });
    });

    it("notes that the primary origins serve different releases beside the diff", async ({
      dir: cwd,
    }) => {
      const sha = await liveCommit(cwd);

      const report = await diffStep.run(
        ctx(
          cwd,
          [
            { targets: [PRIMARY], sha, release: "rel_2" },
            { targets: [SECOND_PRIMARY], sha: "fedcba9876543210", release: "rel_1" },
          ],
          true,
        ),
      );

      expect(report?.data).toEqual({
        diff: {
          against: sha,
          files: [],
          note: expect.stringContaining("The primary origins serve 2 different releases"),
        },
      });
    });

    it("reports why there is no diff before the first deploy", async ({ dir: cwd }) => {
      const report = await diffStep.run(ctx(cwd, [], true));

      expect(report?.data).toEqual({
        diff: {
          against: null,
          files: null,
          note: expect.stringContaining("nothing is deployed yet"),
        },
      });
    });

    it("reports the live commit it cannot find in this repository", async ({ dir: cwd }) => {
      const report = await diffStep.run(
        ctx(cwd, [{ targets: [PRIMARY], sha: "0123456789abcdef" }], true),
      );

      expect(report?.data).toEqual({
        diff: {
          against: "0123456789abcdef",
          files: null,
          note: expect.stringContaining("is not in this repository's history"),
        },
      });
    });

    it("reports no diff against a release built from an uncommitted tree", async ({ dir: cwd }) => {
      const report = await diffStep.run(
        ctx(cwd, [{ targets: [PRIMARY], sha: "0123456789abcdef", dirty: true }], true),
      );

      expect(report?.data).toEqual({
        diff: {
          against: "0123456789abcdef",
          files: null,
          note: expect.stringContaining("No reliable diff available"),
        },
      });
    });
  });
});
