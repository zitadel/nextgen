import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { mapWithConcurrency, runCapture } from "./dev-process.mjs";

// In prerelease mode, `changeset publish` puts a package on `latest` instead of
// the prerelease tag when every version of it on npm is already a prerelease
// of that tag ("there has not been a regular release of it yet"). From then
// on `latest` moves with every release while the prerelease tag stays on the
// package's first build, so `@alpha` installs an old version, and so do the
// apps the CLI scaffolds, which depend on `alpha`. A package with any other
// version on npm (the `0.0.0` placeholders, the server's
// `0.0.0-oidc-bootstrap.0`) is published to the prerelease tag, as is one
// that was never published. The publish preflight stops on the first case.

/** The prerelease tag from `.changeset/pre.json`, or undefined outside pre mode. */
export async function readPrereleaseTag(root) {
  let pre;
  try {
    pre = JSON.parse(await readFile(join(root, ".changeset/pre.json"), "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
  return pre.mode === "pre" && typeof pre.tag === "string" ? pre.tag : undefined;
}

/** The first prerelease identifier of a semver version (`alpha` in `1.0.0-alpha.25`). */
export function prereleaseIdentifier(version) {
  return /^\d+\.\d+\.\d+-([0-9A-Za-z-]+)/.exec(version.split("+")[0])?.[1];
}

/** Whether npm holds versions of a package and all of them are `tag` prereleases. */
export function isPrereleaseOnly(versions, tag) {
  return versions.length > 0 && versions.every((version) => prereleaseIdentifier(version) === tag);
}

/** Every version of `name` on npm; empty when the package was never published. */
export async function readPublishedVersions(name, { capture = runCapture } = {}) {
  let stdout;
  try {
    ({ stdout } = await capture("npm", ["view", name, "versions", "--json"]));
  } catch (error) {
    if (typeof error?.stdout === "string" && error.stdout.includes('"E404"')) {
      return [];
    }
    throw error;
  }
  const versions = JSON.parse(stdout);
  return Array.isArray(versions) ? versions : [versions];
}

/** The packages `changeset publish` would put on `latest` rather than `tag`. */
export async function findPrereleaseOnlyPackages(names, tag, options = {}) {
  const versions = await mapWithConcurrency(names, 4, (name) =>
    readPublishedVersions(name, options),
  );
  return names.filter((_, index) => isPrereleaseOnly(versions[index], tag));
}

/** The preflight failure: what is wrong, and the one-time commands that fix it. */
export function prereleaseOnlyMessage(names, tag) {
  return [
    `release publish preflight failed: ${names.join(", ")} only ${names.length === 1 ? "has" : "have"} \`${tag}\` prereleases on npm, so \`changeset publish\` would put the new version on \`latest\` and leave \`${tag}\` on an old build.`,
    `Give each package one version outside \`${tag}\`, once, from an account that can publish @zitadel packages, then rerun the release:`,
    "",
    ...names.flatMap((name) => [
      `dir=$(mktemp -d) && printf '{"name":"%s","version":"0.0.0-bootstrap.0","license":"MIT","description":"Placeholder. Install %s@${tag}."}\\n' "${name}" "${name}" > "$dir/package.json" && (cd "$dir" && npm publish --access public --tag bootstrap)`,
    ]),
  ].join("\n");
}
