#!/usr/bin/env node
// What the artifacts workflow (.github/workflows/artifacts.yml) tests, from
// the event that started it:
//
// - schedule, pull_request, or a dispatch without `version`: `build`, the
//   artifacts built from the checked-out ref;
// - a dispatch with `version`: `published`, that release from npm and the
//   registry;
// - workflow_run after a successful release-publish run: `published`, the
//   @zitadel/server version npm says was published while that run ran, or
//   `none` when it published nothing (a version PR update, a dry run).
//
// Writes `mode`, `version` and `image` (whether the release's container
// image exists) to $GITHUB_OUTPUT and a line to $GITHUB_STEP_SUMMARY.
// Inputs come from the environment: GITHUB_EVENT_NAME, VERSION (the
// dispatch input), RELEASE_RUN_STARTED_AT and RELEASE_RUN_UPDATED_AT (the
// workflow_run's times).
import { appendFileSync } from "node:fs";

import { isDirectRun, runCapture } from "./dev-process.mjs";
import { SERVER_IMAGE } from "./release-manifest.mjs";
import { previousRelease } from "./smoke-upgrade.mjs";

/** The newest version whose npm publish time falls inside [startedAt, updatedAt]. */
export function publishedDuring(times, startedAt, updatedAt) {
  const from = new Date(startedAt).getTime();
  const to = new Date(updatedAt).getTime();
  const inside = Object.entries(times).filter(([version, time]) => {
    if (["created", "modified"].includes(version)) return false;
    const at = new Date(time).getTime();
    return at >= from && at <= to;
  });
  if (inside.length === 0) return undefined;
  return inside.reduce((latest, entry) => (entry[1] > latest[1] ? entry : latest))[0];
}

/** Whether the registry serves `${SERVER_IMAGE}:${version}` to an anonymous pull. */
async function imageExists(version) {
  const [registry, ...path] = SERVER_IMAGE.split("/");
  const repository = path.join("/");
  const auth = await fetch(`https://${registry}/token?scope=repository:${repository}:pull`);
  if (!auth.ok) return false;
  const { token } = await auth.json();
  const manifest = await fetch(`https://${registry}/v2/${repository}/manifests/${version}`, {
    method: "HEAD",
    headers: {
      authorization: `Bearer ${token}`,
      accept:
        "application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json",
    },
  });
  return manifest.ok;
}

export async function artifactsTarget(env = process.env) {
  const event = env.GITHUB_EVENT_NAME;
  const wanted = env.VERSION?.trim();
  if (event !== "workflow_run" && !wanted) {
    return { mode: "build", summary: "Built from this ref." };
  }
  const { stdout } = await runCapture("npm", ["view", "@zitadel/server", "time", "--json"]);
  const times = JSON.parse(stdout);
  let version = wanted;
  if (event === "workflow_run") {
    version = publishedDuring(times, env.RELEASE_RUN_STARTED_AT, env.RELEASE_RUN_UPDATED_AT);
    if (!version) {
      return {
        mode: "none",
        summary: "The release-publish run published no @zitadel/server version: nothing to test.",
      };
    }
  } else if (!times[version]) {
    throw new Error(`@zitadel/server@${version} is not published`);
  }
  const image = await imageExists(version);
  const from = previousRelease(version, times);
  return {
    mode: "published",
    version,
    image,
    summary:
      `Published @zitadel/server@${version}: installed from npm on each runner, upgraded from ${from}; ` +
      (image
        ? `container ${SERVER_IMAGE}:${version}.`
        : `the container smoke is skipped: the release pushed no ${SERVER_IMAGE}:${version}.`),
  };
}

if (isDirectRun(import.meta.url)) {
  try {
    const target = await artifactsTarget();
    const output = `mode=${target.mode}\nversion=${target.version ?? ""}\nimage=${target.image ?? false}\n`;
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, output);
    if (process.env.GITHUB_STEP_SUMMARY) {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${target.summary}\n`);
    }
    process.stdout.write(`${output}${target.summary}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
