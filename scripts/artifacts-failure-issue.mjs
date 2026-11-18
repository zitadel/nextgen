#!/usr/bin/env node
// A failed nightly or release run of the artifacts workflow
// (.github/workflows/artifacts.yml, job `report`) reaches a person: this
// opens an issue assigned to ASSIGNEE, or comments on the one already open
// under the same title, so a run of red nights stays one issue.
//
// Reads EVENT_NAME (`schedule` or `release`), RELEASE_TAG, NEEDS (the
// workflow's `needs` context as JSON), RUN_URL, ASSIGNEE and
// GITHUB_REPOSITORY, and calls `gh` with GH_TOKEN. Imports only Node
// built-ins: the workflow runs it without an install.
import { isDirectRun, runCapture } from "./dev-process.mjs";

// A release version as the release scripts write it. A tag that is not one
// is not echoed into the issue.
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

// A job that timed out ends `cancelled`, and a server that hangs on start is
// what this workflow is there to catch.
const BROKEN = new Set(["failure", "cancelled"]);

/** The jobs of the `needs` context that did not finish, in its order. */
export function brokenJobs(needs) {
  return Object.entries(needs)
    .filter(([, job]) => BROKEN.has(job?.result))
    .map(([name, job]) => ({ name, result: job.result }));
}

/** The issue for one failed run: one title per kind of run, so it is found again. */
export function failureIssue({ event, releaseTag, needs, runUrl }) {
  const version = releaseTag?.trim().replace(/^v/, "");
  const released = event === "release";
  const named = released && version && VERSION_PATTERN.test(version) ? version : undefined;
  const title = released
    ? `The artifacts run for ${named ? `release ${named}` : "a release"} failed`
    : "The nightly artifacts run failed";
  const jobs = brokenJobs(needs);
  const lines = [
    released
      ? `The \`artifacts\` workflow failed for ${named ? `the published release ${named}` : "a published release"}.`
      : "The `artifacts` workflow failed on its nightly run on `main`.",
    "",
    `Run: ${runUrl}`,
    "",
    ...(jobs.length > 0
      ? ["Jobs that did not finish:", ...jobs.map(({ name, result }) => `- \`${name}\`: ${result}`)]
      : ["No job reported a failure; see the run."]),
    "",
    "What each job tests is in the header of `.github/workflows/artifacts.yml`.",
    `Run it again with \`gh workflow run artifacts.yml${named ? ` -f version=${named}` : ""}\`, and close this issue once a run passes.`,
  ];
  return { title, body: lines.join("\n") };
}

async function ghJson(gh, args) {
  const { stdout } = await gh(args);
  return JSON.parse(stdout);
}

/**
 * Opens the issue, or comments on the open one with the same title.
 *
 * @returns What was done: `{ action: "created" | "commented", number? }`.
 */
export async function reportFailure(
  env = process.env,
  gh = (args) => runCapture("gh", args, { env }),
) {
  const repo = env.GITHUB_REPOSITORY;
  const assignee = env.ASSIGNEE;
  if (!repo || !assignee || !env.RUN_URL) {
    throw new Error("GITHUB_REPOSITORY, ASSIGNEE and RUN_URL must be set");
  }
  const { title, body } = failureIssue({
    event: env.EVENT_NAME,
    releaseTag: env.RELEASE_TAG,
    needs: JSON.parse(env.NEEDS || "{}"),
    runUrl: env.RUN_URL,
  });
  // The search matches words, so a longer title can come back too.
  const open = await ghJson(gh, [
    "issue",
    "list",
    "--repo",
    repo,
    "--state",
    "open",
    "--search",
    `"${title}" in:title`,
    "--json",
    "number,title",
    "--limit",
    "50",
  ]);
  const existing = open.find((issue) => issue.title === title);
  if (existing) {
    await gh(["issue", "comment", String(existing.number), "--repo", repo, "--body", body]);
    return { action: "commented", number: existing.number };
  }
  await gh([
    "issue",
    "create",
    "--repo",
    repo,
    "--title",
    title,
    "--body",
    body,
    "--assignee",
    assignee,
  ]);
  return { action: "created" };
}

if (isDirectRun(import.meta.url)) {
  try {
    const done = await reportFailure();
    process.stdout.write(
      done.action === "created"
        ? "Opened an issue for this failed run.\n"
        : `Commented on issue ${done.number} for this failed run.\n`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
