import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { StepContext } from "../../../../../src/lib/release/pipeline";
import { diffStep } from "../../../../../src/lib/release/steps/diff";
import type { SuggestedCommand } from "../../../../../src/lib/suggestion";

type Live = {
  targets: { origin: string; expires_at: string | null }[];
  sha?: string;
  release?: string;
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

function ctx(live: Live[], json = false): StepContext {
  return {
    cwd,
    client: {
      listDeployments: async () => ({
        deployments: live.map((deployment) => ({
          targets: deployment.targets,
          release_id: deployment.release ?? "rel_1",
          release: { metadata: { git_sha: deployment.sha } },
        })),
      }),
    } as never,
    projectId: "proj_1",
    env: {},
    mode: "deploy",
    dryRun: false,
    json,
    color: false,
    bundle: { schemas: [], flow_definitions: [], brandings: [] },
    brandingSources: [],
    suggest: (args) => `${args} --env staging` as SuggestedCommand,
  };
}

const PRIMARY = { origin: "https://app.acme.com", expires_at: null };
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
        {
          targets: [{ origin: "https://www.acme.com", expires_at: null }],
          sha: "fedcba9876543210",
          release: "rel_1",
        },
      ]),
    );

    expect(written.join("")).toContain("The primary origins serve 2 different releases");
  });

  it("writes nothing to stdout under --json", async () => {
    await diffStep.run(ctx([], true));

    expect(written).toEqual([]);
  });
});
