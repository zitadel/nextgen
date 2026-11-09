import { describe, expect, vi } from "vitest";

import type { StepContext, StepResult } from "@/lib/publish/pipeline";
import { diffStep } from "@/lib/publish/steps/diff";
import { DiskStore } from "@/lib/zitadel";
import { aConfig } from "@tests/helpers/config";
import { it } from "@tests/helpers/fixtures";
import { commitAll, git, write } from "@tests/helpers/git-repo";
import { aDeployment, PROJECT_ID } from "@tests/helpers/records";
import { aStepContext } from "@tests/helpers/step-context";

/**
 * A deployment live on the project, as far as the diff reads one.
 */
type Live = Readonly<{
  /**
   * Where it is live; a target with an expiry is a preview.
   */
  targets: { origin: string; expires_at?: string }[];
  /**
   * The commit its release was built from.
   */
  sha?: string;
  /**
   * The release it serves.
   */
  release?: string;
  /**
   * Whether its release was built from an uncommitted tree.
   */
  dirty?: boolean;
}>;

/**
 * A primary origin.
 */
const PRIMARY = { origin: "https://app.acme.com" };

/**
 * Another primary origin.
 */
const SECOND_PRIMARY = { origin: "https://www.acme.com" };

/**
 * A preview origin, which expires.
 */
const PREVIEW = { origin: "https://pr-7.acme.com", expires_at: "2026-12-01T00:00:00Z" };

/**
 * A commit that is in no repository.
 */
const FOREIGN_SHA = "0123456789abcdef";

/**
 * The user schema the live commit holds.
 */
const SCHEMA = ".zitadel/schemas/user.json";

/**
 * The context of a run in `cwd` against a project on which `live` is deployed.
 *
 * @param cwd - The project directory, whose disk is the store.
 * @param live - The deployments live on the project.
 * @param overrides - Fields to set in place of the defaults.
 * @returns The context.
 */
function aRunIn(
  cwd: string,
  live: readonly Live[],
  overrides: Partial<StepContext> = {},
): StepContext {
  return aStepContext({
    cwd,
    store: new DiskStore(cwd),
    json: false,
    client: {
      listDeployments: {
        all: async () => {
          return live.map((deployment, index) => {
            return aDeployment({
              id: `dep_${index}`,
              targets: deployment.targets,
              release_id: deployment.release ?? "rel_1",
              release: {
                metadata: { git_sha: deployment.sha, git_dirty: deployment.dirty ?? false },
              },
            });
          });
        },
      },
    },
    ...overrides,
  });
}

/**
 * Makes `cwd` a repository whose one commit holds a user schema, as the live
 * release was built.
 *
 * @param cwd - The project directory.
 * @returns The commit.
 */
async function aLiveCommit(cwd: string): Promise<string> {
  await git(cwd, "init", "--quiet");
  await write(cwd, { [SCHEMA]: '{ "type": "object" }\n' });
  await commitAll(cwd, "initial");
  return (await git(cwd, "rev-parse", "HEAD")).trim();
}

/**
 * What the step told the person, as the pipeline would print it.
 *
 * @param result - What the step reported.
 * @returns Its notices, joined.
 */
function shown(result: StepResult | undefined): string {
  return result?.notices?.join("") ?? "";
}

describe("diffStep", () => {
  it("reads what is live, with the release each deployment serves", async ({ dir }) => {
    const all = vi.fn(async () => {
      return [];
    });
    const context = aStepContext({
      cwd: dir,
      store: new DiskStore(dir),
      client: { listDeployments: { all } },
    });

    await diffStep.run(context);

    expect(all).toHaveBeenCalledWith({ project_id: PROJECT_ID, live: true, expand: ["release"] });
  });

  describe("rendered for a terminal", () => {
    it("says there is nothing to diff against before the first deploy", async ({ dir }) => {
      const result = await diffStep.run(aRunIn(dir, []));

      expect(shown(result)).toContain("No diff available: nothing is deployed yet");
    });

    it("says so when the live commit is not in this repository", async ({ dir }) => {
      const result = await diffStep.run(aRunIn(dir, [{ targets: [PRIMARY], sha: FOREIGN_SHA }]));

      expect(shown(result)).toContain("0123456789ab is not in this repository's history");
    });

    it("refuses to diff against a release built from an uncommitted tree", async ({ dir }) => {
      const result = await diffStep.run(
        aRunIn(dir, [{ targets: [PRIMARY], sha: FOREIGN_SHA, dirty: true }]),
      );

      expect(shown(result)).toContain("No reliable diff available");
    });

    it("names the uncommitted baseline's commit, so the reader can check it", async ({ dir }) => {
      const result = await diffStep.run(
        aRunIn(dir, [{ targets: [PRIMARY], sha: FOREIGN_SHA, dirty: true }]),
      );

      expect(shown(result)).toContain("0123456789ab");
    });

    it("never takes a live preview as the baseline", async ({ dir }) => {
      const result = await diffStep.run(
        aRunIn(dir, [
          { targets: [PREVIEW], sha: "ffffffffffffffff" },
          { targets: [PRIMARY], sha: FOREIGN_SHA },
        ]),
      );

      expect(shown(result)).toContain("0123456789ab");
    });

    it("says so when the primary origins serve different releases", async ({ dir }) => {
      const result = await diffStep.run(
        aRunIn(dir, [
          { targets: [PRIMARY], sha: FOREIGN_SHA, release: "rel_2" },
          { targets: [SECOND_PRIMARY], sha: "fedcba9876543210", release: "rel_1" },
        ]),
      );

      expect(shown(result)).toContain("The primary origins serve 2 different releases");
    });

    it("prints the diff against the live commit", async ({ dir }) => {
      const sha = await aLiveCommit(dir);
      await write(dir, { [SCHEMA]: '{ "type": "string" }\n' });

      const result = await diffStep.run(aRunIn(dir, [{ targets: [PRIMARY], sha }]));

      expect(shown(result)).toContain('+{ "type": "string" }');
    });

    it("says when nothing changed since the live commit", async ({ dir }) => {
      const sha = await aLiveCommit(dir);

      const result = await diffStep.run(aRunIn(dir, [{ targets: [PRIMARY], sha }]));

      expect(shown(result)).toContain(`No changes to .zitadel/ since ${sha.slice(0, 12)}`);
    });
  });

  describe("what it records for the later steps", () => {
    it("records that a schema changed since the live commit", async ({ dir }) => {
      const sha = await aLiveCommit(dir);
      await write(dir, { [SCHEMA]: '{ "type": "string" }\n' });

      const result = await diffStep.run(aRunIn(dir, [{ targets: [PRIMARY], sha }]));

      expect(result?.learned?.schemasOrFlowsChanged).toBe(true);
    });

    it("records that no schema or flow changed when only branding did", async ({ dir }) => {
      const sha = await aLiveCommit(dir);
      await write(dir, { ".zitadel/branding/brand.json": "{}\n" });

      const result = await diffStep.run(aRunIn(dir, [{ targets: [PRIMARY], sha }]));

      expect(result?.learned?.schemasOrFlowsChanged).toBe(false);
    });

    it("records nothing when the primary origins serve different releases", async ({ dir }) => {
      const sha = await aLiveCommit(dir);
      const live = [
        { targets: [PRIMARY], sha, release: "rel_2" },
        { targets: [SECOND_PRIMARY], sha, release: "rel_1" },
      ];

      const result = await diffStep.run(aRunIn(dir, live));

      expect(result?.learned?.schemasOrFlowsChanged).toBeUndefined();
    });

    it("records nothing when there is no diff to read", async ({ dir }) => {
      const result = await diffStep.run(aRunIn(dir, []));

      expect(result?.learned?.schemasOrFlowsChanged).toBeUndefined();
    });
  });

  describe("--json", () => {
    it("writes nothing to stdout", async ({ dir }) => {
      const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);

      await diffStep.run(aRunIn(dir, [], { json: true }));

      expect(stdout).not.toHaveBeenCalled();
    });

    it("reports each changed file against the live commit", async ({ dir }) => {
      const sha = await aLiveCommit(dir);
      await write(dir, { [SCHEMA]: '{ "type": "string" }\n' });

      const report = await diffStep.run(aRunIn(dir, [{ targets: [PRIMARY], sha }], { json: true }));

      expect(report?.data).toEqual({
        diff: {
          against: sha,
          files: [
            {
              path: SCHEMA,
              status: "modified",
              patch: expect.stringContaining('+{ "type": "string" }'),
            },
          ],
        },
      });
    });

    it("reports no files when nothing changed since the live commit", async ({ dir }) => {
      const sha = await aLiveCommit(dir);

      const report = await diffStep.run(aRunIn(dir, [{ targets: [PRIMARY], sha }], { json: true }));

      expect(report?.data).toEqual({ diff: { against: sha, files: [] } });
    });

    it("shows a variable reference as written", async ({ dir }) => {
      const sha = await aLiveCommit(dir);
      await write(dir, {
        ".zitadel/idps/google.json": '{ "client_secret": "${{ GOOGLE_CLIENT_SECRET }}" }\n',
      });

      const report = await diffStep.run(
        aRunIn(dir, [{ targets: [PRIMARY], sha }], {
          json: true,
          env: { GOOGLE_CLIENT_SECRET: "the-client-secret" },
        }),
      );

      expect(JSON.stringify(report)).toContain("${{ GOOGLE_CLIENT_SECRET }}");
    });

    it("never shows the value a variable reference resolves to", async ({ dir }) => {
      const sha = await aLiveCommit(dir);
      await write(dir, {
        ".zitadel/idps/google.json": '{ "client_secret": "${{ GOOGLE_CLIENT_SECRET }}" }\n',
      });

      const report = await diffStep.run(
        aRunIn(dir, [{ targets: [PRIMARY], sha }], {
          json: true,
          env: { GOOGLE_CLIENT_SECRET: "the-client-secret" },
        }),
      );

      expect(JSON.stringify(report)).not.toContain("the-client-secret");
    });

    it("reports a branding template edited outside .zitadel/", async ({ dir }) => {
      await write(dir, { "templates/login.liquid": "<main></main>\n" });
      const sha = await aLiveCommit(dir);
      await write(dir, { "templates/login.liquid": "<main>edited</main>\n" });
      const config = aConfig({
        branding: { "brand.json": { liquid_template: { $file: "../../templates/login.liquid" } } },
      });

      const report = await diffStep.run(
        aRunIn(dir, [{ targets: [PRIMARY], sha }], { json: true, config }),
      );

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
      dir,
    }) => {
      const sha = await aLiveCommit(dir);
      const live = [
        { targets: [PRIMARY], sha, release: "rel_2" },
        { targets: [SECOND_PRIMARY], sha: "fedcba9876543210", release: "rel_1" },
      ];

      const report = await diffStep.run(aRunIn(dir, live, { json: true }));

      expect(report?.data).toEqual({
        diff: {
          against: sha,
          files: [],
          note: expect.stringContaining("The primary origins serve 2 different releases"),
        },
      });
    });

    it("reports why there is no diff before the first deploy", async ({ dir }) => {
      const report = await diffStep.run(aRunIn(dir, [], { json: true }));

      expect(report?.data).toEqual({
        diff: {
          against: null,
          files: null,
          note: expect.stringContaining("nothing is deployed yet"),
        },
      });
    });

    it("reports the live commit it cannot find in this repository", async ({ dir }) => {
      const report = await diffStep.run(
        aRunIn(dir, [{ targets: [PRIMARY], sha: FOREIGN_SHA }], { json: true }),
      );

      expect(report?.data).toEqual({
        diff: {
          against: FOREIGN_SHA,
          files: null,
          note: expect.stringContaining("is not in this repository's history"),
        },
      });
    });

    it("reports no diff against a release built from an uncommitted tree", async ({ dir }) => {
      const report = await diffStep.run(
        aRunIn(dir, [{ targets: [PRIMARY], sha: FOREIGN_SHA, dirty: true }], { json: true }),
      );

      expect(report?.data).toEqual({
        diff: {
          against: FOREIGN_SHA,
          files: null,
          note: expect.stringContaining("No reliable diff available"),
        },
      });
    });
  });
});
