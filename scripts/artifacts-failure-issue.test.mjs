import assert from "node:assert/strict";
import { test } from "vitest";

import { brokenJobs, failureIssue, reportFailure } from "./artifacts-failure-issue.mjs";

const NIGHTLY_TITLE = "The nightly artifacts run failed";
const RUN_URL = "https://github.com/zitadel/nextgen/actions/runs/1";

const needs = {
  target: { result: "success" },
  binaries: { result: "success" },
  start: { result: "failure" },
  linux: { result: "cancelled" },
  published: { result: "skipped" },
};

function env(extra = {}) {
  return {
    GITHUB_REPOSITORY: "zitadel/nextgen",
    ASSIGNEE: "someone",
    RUN_URL,
    EVENT_NAME: "schedule",
    NEEDS: JSON.stringify(needs),
    ...extra,
  };
}

/** A `gh` that answers the issue list with `open` and records every call. */
function fakeGh(open = []) {
  const calls = [];
  const gh = async (args) => {
    calls.push(args);
    return { stdout: args[1] === "list" ? JSON.stringify(open) : "" };
  };
  return { gh, calls };
}

const flag = (args, name) => args[args.indexOf(name) + 1];

test("names the jobs that failed or were cancelled, and no other", () => {
  assert.deepEqual(brokenJobs(needs), [
    { name: "start", result: "failure" },
    { name: "linux", result: "cancelled" },
  ]);
});

test("a nightly failure opens an issue assigned to the assignee, with the run and its jobs", async () => {
  const { gh, calls } = fakeGh();

  const done = await reportFailure(env(), gh);

  assert.deepEqual(done, { action: "created" });
  const create = calls.at(-1);
  assert.deepEqual(create.slice(0, 2), ["issue", "create"]);
  assert.equal(flag(create, "--repo"), "zitadel/nextgen");
  assert.equal(flag(create, "--title"), NIGHTLY_TITLE);
  assert.equal(flag(create, "--assignee"), "someone");
  const body = flag(create, "--body");
  assert.match(body, new RegExp(RUN_URL.replaceAll(".", "\\.")));
  assert.match(body, /- `start`: failure\n- `linux`: cancelled/);
  assert.doesNotMatch(body, /published|binaries/);
});

test("a second failed night comments on the open issue and opens none", async () => {
  const { gh, calls } = fakeGh([{ number: 7, title: NIGHTLY_TITLE }]);

  const done = await reportFailure(env(), gh);

  assert.deepEqual(done, { action: "commented", number: 7 });
  assert.deepEqual(calls.at(-1).slice(0, 3), ["issue", "comment", "7"]);
  assert.equal(
    calls.some((args) => args[1] === "create"),
    false,
  );
});

test("an open issue whose title only contains the words is not taken for it", async () => {
  const { gh, calls } = fakeGh([{ number: 9, title: `${NIGHTLY_TITLE} again and again` }]);

  const done = await reportFailure(env(), gh);

  assert.deepEqual(done, { action: "created" });
  assert.equal(
    calls.some((args) => args[1] === "comment"),
    false,
  );
});

test("a release's failure has an issue of its own, named after the version", () => {
  const issue = failureIssue({ event: "release", releaseTag: "v0.7.0", needs, runUrl: RUN_URL });

  assert.equal(issue.title, "The artifacts run for release 0.7.0 failed");
  assert.match(issue.body, /gh workflow run artifacts\.yml -f version=0\.7\.0/);
});

test("a tag that is no release version is not echoed into the issue", () => {
  const tag = "v1.0.0`; rm -rf";
  const issue = failureIssue({ event: "release", releaseTag: tag, needs, runUrl: RUN_URL });

  assert.equal(issue.title, "The artifacts run for a release failed");
  assert.doesNotMatch(issue.body, /rm -rf/);
});

test("refuses to run without a repository, an assignee and a run", async () => {
  const { gh, calls } = fakeGh();

  await assert.rejects(() => reportFailure(env({ ASSIGNEE: "" }), gh), /ASSIGNEE/);
  assert.equal(calls.length, 0);
});
