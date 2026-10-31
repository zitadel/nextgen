import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { StepContext } from "../../../../../src/lib/release/pipeline";
import { diffStep } from "../../../../../src/lib/release/steps/diff";
import type { SuggestedCommand } from "../../../../../src/lib/suggestion";

const run = promisify(execFile);

type Live = {
  targets: { origin: string; expires_at: string | null }[];
  sha?: string;
  release?: string;
  dirty?: boolean;
};

let cwd: string;
let written: string[];

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), "zitadel-diff-step-"));
  written = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    written.push(String(chunk));
    return true;
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(cwd, { recursive: true, force: true });
});

function ctx(live: Live[], json = false, env: Record<string, string> = {}): StepContext {
  return {
    cwd,
    client: {
      listDeployments: async () => ({
        deployments: live.map((deployment) => ({
          targets: deployment.targets,
          release_id: deployment.release ?? "rel_1",
          release: { metadata: { git_sha: deployment.sha, git_dirty: deployment.dirty ?? false } },
        })),
      }),
    } as never,
    projectId: "proj_1",
    env,
    mode: "deploy",
    dryRun: false,
    json,
    color: false,
    bundle: { schemas: [], flow_definitions: [], idps: [], policies: [] },
    brandingSources: [],
    idpFiles: [],
    policyFiles: [],
    suggest: (args) => `${args} --env staging` as SuggestedCommand,
  };
}

/** Commits a user schema in `cwd`, as the live release was built, and returns the commit. */
async function liveCommit(): Promise<string> {
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
function editSchema(): Promise<void> {
  return writeFile(join(cwd, ".zitadel", "schemas", "user.json"), '{ "type": "string" }\n');
}

const PRIMARY = { origin: "https://app.acme.com", expires_at: null };
const SECOND_PRIMARY = { origin: "https://www.acme.com", expires_at: null };
const PREVIEW = { origin: "https://pr-7.acme.com", expires_at: "2026-12-01T00:00:00Z" };

describe("diffStep", () => {
  it("says there is nothing to diff against before the first deploy", async () => {
    await diffStep.run(ctx([]));

    expect(written.join("")).toContain("No diff available: nothing is deployed yet");
  });

  it("says so when the live commit is not in this repository", async () => {
    await diffStep.run(ctx([{ targets: [PRIMARY], sha: "0123456789abcdef" }]));

    expect(written.join("")).toContain("0123456789ab is not in this repository's history");
  });

  it("refuses to diff against a release built from an uncommitted tree", async () => {
    await diffStep.run(ctx([{ targets: [PRIMARY], sha: "0123456789abcdef", dirty: true }]));

    expect(written.join("")).toContain("No reliable diff available");
  });

  it("names the uncommitted baseline's commit, so the reader can check it", async () => {
    await diffStep.run(ctx([{ targets: [PRIMARY], sha: "0123456789abcdef", dirty: true }]));

    expect(written.join("")).toContain("0123456789ab");
  });

  it("never takes a live preview as the baseline", async () => {
    await diffStep.run(
      ctx([
        { targets: [PREVIEW], sha: "ffffffffffffffff" },
        { targets: [PRIMARY], sha: "0123456789abcdef" },
      ]),
    );

    expect(written.join("")).toContain("0123456789ab");
  });

  it("says so when the primary origins serve different releases", async () => {
    await diffStep.run(
      ctx([
        { targets: [PRIMARY], sha: "0123456789abcdef", release: "rel_2" },
        { targets: [SECOND_PRIMARY], sha: "fedcba9876543210", release: "rel_1" },
      ]),
    );

    expect(written.join("")).toContain("The primary origins serve 2 different releases");
  });

  it("prints the diff against the live commit", async () => {
    const sha = await liveCommit();
    await editSchema();

    await diffStep.run(ctx([{ targets: [PRIMARY], sha }]));

    expect(written.join("")).toContain('+{ "type": "string" }');
  });

  it("says when nothing changed since the live commit", async () => {
    const sha = await liveCommit();

    await diffStep.run(ctx([{ targets: [PRIMARY], sha }]));

    expect(written.join("")).toContain(`No changes to .zitadel/ since ${sha.slice(0, 12)}`);
  });

  describe("--json", () => {
    it("writes nothing to stdout", async () => {
      await diffStep.run(ctx([], true));

      expect(written).toEqual([]);
    });

    it("reports each changed file against the live commit", async () => {
      const sha = await liveCommit();
      await editSchema();

      const report = await diffStep.run(ctx([{ targets: [PRIMARY], sha }], true));

      expect(report).toEqual({
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

    it("reports no files when nothing changed since the live commit", async () => {
      const sha = await liveCommit();

      const report = await diffStep.run(ctx([{ targets: [PRIMARY], sha }], true));

      expect(report).toEqual({ diff: { against: sha, files: [] } });
    });

    it("shows a variable reference as written, never the value it resolves to", async () => {
      const sha = await liveCommit();
      await mkdir(join(cwd, ".zitadel", "idps"), { recursive: true });
      await writeFile(
        join(cwd, ".zitadel", "idps", "google.json"),
        '{ "client_secret": "${{ GOOGLE_CLIENT_SECRET }}" }\n',
      );

      const report = await diffStep.run(
        ctx([{ targets: [PRIMARY], sha }], true, { GOOGLE_CLIENT_SECRET: "the-client-secret" }),
      );

      const reported = JSON.stringify(report);
      expect(reported).toContain("${{ GOOGLE_CLIENT_SECRET }}");
      expect(reported).not.toContain("the-client-secret");
    });

    it("notes that the primary origins serve different releases beside the diff", async () => {
      const sha = await liveCommit();

      const report = await diffStep.run(
        ctx(
          [
            { targets: [PRIMARY], sha, release: "rel_2" },
            { targets: [SECOND_PRIMARY], sha: "fedcba9876543210", release: "rel_1" },
          ],
          true,
        ),
      );

      expect(report).toEqual({
        diff: {
          against: sha,
          files: [],
          note: expect.stringContaining("The primary origins serve 2 different releases"),
        },
      });
    });

    it("reports why there is no diff before the first deploy", async () => {
      const report = await diffStep.run(ctx([], true));

      expect(report).toEqual({
        diff: {
          against: null,
          files: null,
          note: expect.stringContaining("nothing is deployed yet"),
        },
      });
    });

    it("reports the live commit it cannot find in this repository", async () => {
      const report = await diffStep.run(
        ctx([{ targets: [PRIMARY], sha: "0123456789abcdef" }], true),
      );

      expect(report).toEqual({
        diff: {
          against: "0123456789abcdef",
          files: null,
          note: expect.stringContaining("is not in this repository's history"),
        },
      });
    });

    it("reports no diff against a release built from an uncommitted tree", async () => {
      const report = await diffStep.run(
        ctx([{ targets: [PRIMARY], sha: "0123456789abcdef", dirty: true }], true),
      );

      expect(report).toEqual({
        diff: {
          against: "0123456789abcdef",
          files: null,
          note: expect.stringContaining("No reliable diff available"),
        },
      });
    });
  });
});
