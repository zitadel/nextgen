#!/usr/bin/env node
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { forwardedArgs, isDirectRun, run, runCapture } from "./dev-process.mjs";
import { readServerRelease, releaseDir } from "./release-artifacts.mjs";
import { PUBLIC_PACKAGE_NAMES } from "./release-manifest.mjs";
import { planSkipMessage, readPublishPlan } from "./release-plan.mjs";

const defaultRepoRoot = fileURLToPath(new URL("..", import.meta.url));
export const DEFAULT_REGISTRY_URL = "https://registry.npmjs.org";

// Tarball promotion: the build job packed every public package once
// (prepack hooks included), so publishing means promoting those exact .tgz
// files. Idempotency comes from an explicit registry existence check instead
// of `changeset publish` — a re-run publishes only what is still missing.
export async function publishNpmTarballs(options = {}) {
  const repoRoot = options.repoRoot ?? defaultRepoRoot;
  const log = options.log ?? console.log;
  const runFn = options.run ?? run;
  const runCaptureFn = options.runCapture ?? runCapture;
  const plan = options.plan ?? (await readPublishPlan(repoRoot));

  if (!plan.shouldPublish) {
    log(planSkipMessage("publish-npm", plan));
    return { skipped: true, results: [] };
  }

  const registryUrl = options.registryUrl ?? DEFAULT_REGISTRY_URL;
  const tarballsDir =
    options.tarballsDir ?? join(releaseDir(repoRoot, plan.version), "npm");
  const distTag = options.distTag ?? (await resolveDistTag(repoRoot));
  const tarballs = (await readdir(tarballsDir)).filter((file) => file.endsWith(".tgz")).sort();
  if (tarballs.length === 0) {
    throw new Error(`no .tgz files found in ${tarballsDir}`);
  }

  const publicNames = new Set(options.publicPackageNames ?? PUBLIC_PACKAGE_NAMES);
  const results = [];
  for (const file of tarballs) {
    const tarball = join(tarballsDir, file);
    const manifest = await readTarballManifest(tarball, runCaptureFn);
    if (manifest.private === true) {
      throw new Error(`refusing to publish private package ${manifest.name} from ${tarball}`);
    }
    if (!publicNames.has(manifest.name)) {
      throw new Error(`${tarball} contains unexpected package ${manifest.name}`);
    }

    const spec = `${manifest.name}@${manifest.version}`;
    if (await versionExistsOnRegistry({ spec, registryUrl, runCapture: runCaptureFn })) {
      log(`release publish-npm: ${spec} already on ${registryUrl} - skipping`);
      results.push({ name: manifest.name, version: manifest.version, action: "exists" });
      continue;
    }

    if (plan.dryRun) {
      log(`release publish-npm: dry run - would publish ${spec} with dist-tag ${distTag}`);
      results.push({ name: manifest.name, version: manifest.version, action: "would-publish" });
      continue;
    }

    await runFn(
      "npm",
      [
        "publish",
        tarball,
        "--registry",
        registryUrl,
        "--tag",
        distTag,
        "--access",
        "public",
        "--ignore-scripts",
        "--loglevel",
        "warn",
      ],
      { cwd: repoRoot, env: options.env ?? process.env },
    );
    log(`release publish-npm: published ${spec} with dist-tag ${distTag}`);
    results.push({ name: manifest.name, version: manifest.version, action: "published" });
  }

  const published = results.filter((entry) => entry.action === "published").length;
  const existing = results.filter((entry) => entry.action === "exists").length;
  const pending = results.filter((entry) => entry.action === "would-publish").length;
  log(
    `release publish-npm: ${published} published, ${existing} already on registry` +
      (plan.dryRun ? `, ${pending} would publish` : ""),
  );
  return { skipped: false, distTag, registryUrl, results };
}

export async function versionExistsOnRegistry(options) {
  const runCaptureFn = options.runCapture ?? runCapture;
  try {
    await runCaptureFn("npm", [
      "view",
      options.spec,
      "version",
      "--registry",
      options.registryUrl,
      "--loglevel",
      "error",
    ]);
    return true;
  } catch (error) {
    const output = `${error?.stdout ?? ""}${error?.stderr ?? ""}${error?.message ?? ""}`;
    if (/E404|404 Not Found|is not in this registry|No match found/i.test(output)) {
      return false;
    }
    throw new Error(
      `failed to check ${options.spec} on ${options.registryUrl}: ${error?.message ?? error}`,
    );
  }
}

// Changesets publishes prereleases under the pre-mode tag (.changeset/pre.json)
// and stable versions as latest; tarball promotion must match that behavior.
export async function resolveDistTag(repoRoot = defaultRepoRoot) {
  try {
    const source = await readFile(join(repoRoot, ".changeset", "pre.json"), "utf8");
    const parsed = JSON.parse(source);
    if (parsed?.mode === "pre" && typeof parsed.tag === "string" && parsed.tag.length > 0) {
      return parsed.tag;
    }
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
  return "latest";
}

export async function readTarballManifest(tarball, runCaptureFn = runCapture) {
  const result = await runCaptureFn("tar", ["-xOf", tarball, "package/package.json"]);
  const manifest = JSON.parse(result.stdout);
  if (typeof manifest.name !== "string" || typeof manifest.version !== "string") {
    throw new Error(`${tarball} has invalid package metadata`);
  }
  return manifest;
}

export function parseArgs(args) {
  const parsed = { registryUrl: "", tarballsDir: "", distTag: "", help: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case "--registry":
        parsed.registryUrl = args[++index] ?? "";
        if (!parsed.registryUrl) throw new Error("--registry requires a value");
        break;
      case "--tarballs-dir":
        parsed.tarballsDir = args[++index] ?? "";
        if (!parsed.tarballsDir) throw new Error("--tarballs-dir requires a value");
        break;
      case "--dist-tag":
        parsed.distTag = args[++index] ?? "";
        if (!parsed.distTag) throw new Error("--dist-tag requires a value");
        break;
      case "--help":
      case "-h":
        parsed.help = true;
        break;
      default:
        throw new Error(`unknown option: ${arg}`);
    }
  }
  return parsed;
}

export async function main(args = forwardedArgs()) {
  const parsed = parseArgs(args);
  if (parsed.help) {
    console.log(`usage: node scripts/release-npm.mjs [--registry <url>] [--tarballs-dir <dir>] [--dist-tag <tag>]

Publishes the prebuilt release tarballs (dist/release/<version>/npm) that are
not yet on the target registry. Honors the publish plan written by the
release gate; dry-run plans only report what a real run would publish.
`);
    return;
  }

  // The version check below is a sanity guard: the plan version and the
  // checked-out server version must agree before promoting tarballs.
  const release = await readServerRelease(defaultRepoRoot);
  const plan = await readPublishPlan(defaultRepoRoot);
  if (plan.shouldPublish && plan.version !== release.version) {
    throw new Error(
      `publish plan version ${plan.version} does not match checked-out server version ${release.version}`,
    );
  }

  await publishNpmTarballs({
    repoRoot: defaultRepoRoot,
    plan,
    registryUrl: parsed.registryUrl || undefined,
    tarballsDir: parsed.tarballsDir || undefined,
    distTag: parsed.distTag || undefined,
  });
}

if (isDirectRun(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(error?.code ?? 1);
  }
}
