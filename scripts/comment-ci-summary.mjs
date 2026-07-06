#!/usr/bin/env node
import { readFile } from "node:fs/promises";

import { forwardedArgs } from "./dev-process.mjs";

const MARKER = "<!-- zitadel-ci-diagnostics -->";
const MAX_COMMENT_LENGTH = 60_000;

const options = parseArgs(forwardedArgs());
const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, "utf8"));
const token = process.env.GITHUB_TOKEN;
const repo = process.env.GITHUB_REPOSITORY || event.repository?.full_name;
const run = event.workflow_run;
const pr = run?.pull_requests?.[0];

if (!token) {
  throw new Error("GITHUB_TOKEN is required");
}
if (!repo) {
  throw new Error("GITHUB_REPOSITORY is required");
}
if (!run || run.event !== "pull_request" || !pr?.number) {
  console.log("No pull request workflow run found; skipping CI diagnostics comment.");
  process.exit(0);
}

const headRepo = run.head_repository?.full_name || pr.head?.repo?.full_name || "";
if (headRepo !== repo) {
  console.log(`Skipping CI diagnostics comment for untrusted head repository: ${headRepo || "unknown"}`);
  process.exit(0);
}

const body = await commentBody({ pr, run, summaryPath: options.summaryPath });
await upsertComment({ body, prNumber: pr.number, repo, token });
console.log(`Updated CI diagnostics comment on PR #${pr.number}.`);

function parseArgs(args) {
  const parsed = { summaryPath: "ci-diagnostics/pr-comment.md" };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case "--summary":
        parsed.summaryPath = args[++index] ?? "";
        if (!parsed.summaryPath) usage("--summary requires a path");
        break;
      case "--help":
      case "-h":
        usage();
        break;
      default:
        usage(`unknown argument: ${arg}`);
    }
  }
  return parsed;
}

async function commentBody(input) {
  let summary;
  try {
    summary = await readFile(input.summaryPath, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
    summary = fallbackSummary(input.run);
  }

  const withMarker = summary.includes(MARKER) ? summary : `${MARKER}\n${summary}`;
  if (withMarker.length <= MAX_COMMENT_LENGTH) {
    return withMarker;
  }
  return `${withMarker.slice(0, MAX_COMMENT_LENGTH - 200)}\n\n...truncated. Open the workflow run for the full summary.\n`;
}

function fallbackSummary(run) {
  return `${MARKER}
### CI diagnostics

Status: ${run.conclusion || "unknown"}
Run: [open workflow run](${run.html_url})

No diagnostics artifact was available. Open the workflow run for logs.
`;
}

async function upsertComment(input) {
  const comments = await githubJson({
    method: "GET",
    path: `/repos/${input.repo}/issues/${input.prNumber}/comments?per_page=100`,
    token: input.token,
  });
  const existing = comments.find((comment) => comment.body?.includes(MARKER));
  if (existing) {
    await githubJson({
      method: "PATCH",
      path: `/repos/${input.repo}/issues/comments/${existing.id}`,
      token: input.token,
      body: { body: input.body },
    });
    return;
  }
  await githubJson({
    method: "POST",
    path: `/repos/${input.repo}/issues/${input.prNumber}/comments`,
    token: input.token,
    body: { body: input.body },
  });
}

async function githubJson(input) {
  const response = await fetch(`https://api.github.com${input.path}`, {
    method: input.method,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${input.token}`,
      "content-type": "application/json",
      "x-github-api-version": "2022-11-28",
    },
    body: input.body ? JSON.stringify(input.body) : undefined,
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub API ${input.method} ${input.path} failed: ${response.status} ${text}`);
  }
  if (response.status === 204) {
    return null;
  }
  return await response.json();
}

function usage(error) {
  if (error) {
    console.error(error);
    console.error("");
  }
  console.log("usage: node scripts/comment-ci-summary.mjs [--summary <path>]");
  process.exit(error ? 1 : 0);
}
