import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { mapWithConcurrency, runCapture } from "./dev-process.mjs";

// In pre mode, `changeset publish` puts a package on `latest` instead of the
// pre tag when every version of it on npm is a prerelease of that tag ("there
// has not been a regular release of it yet"). From then on every release moves
// `latest`, and the pre tag stays on the package's first build, so `@alpha`
// installs an old version, and so do the apps the CLI scaffolds for every
// framework but Next.js, which pins the exact version. One version outside the
// tag avoids this: the early `0.0.0` builds most packages have, or the
// server's `0.0.0-oidc-bootstrap.0`. A package that isn't on npm yet goes to
// the tag on its first publish, but npm points `latest` at that version too,
// so the next release would hit the rule. The publish preflight stops that
// release. It skips a package whose local version is already on npm, as
// `changeset publish` does.

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

/** The name, version, and license of the package in each of `dirs`. */
export async function readLocalPackages(root, dirs) {
  return Promise.all(
    dirs.map(async (dir) => {
      const { name, version, license } = JSON.parse(
        await readFile(join(root, dir, "package.json"), "utf8"),
      );
      for (const [field, value] of Object.entries({ name, version, license })) {
        if (typeof value !== "string" || value === "") {
          throw new Error(`${join(dir, "package.json")} has no ${field}`);
        }
      }
      return { name, version, license };
    }),
  );
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

/**
 * The packages `changeset publish` would put on `latest` rather than `tag`:
 * those it would publish, because their local version isn't on npm yet, that
 * only have `tag` prereleases there.
 */
export async function findPrereleaseOnlyPackages(packages, tag, options = {}) {
  const versions = await mapWithConcurrency(packages, 4, (pkg) =>
    readPublishedVersions(pkg.name, options),
  );
  return packages.filter(
    (pkg, index) =>
      !versions[index].includes(pkg.version) && isPrereleaseOnly(versions[index], tag),
  );
}

/** The preflight failure: what is wrong, and the one-time commands that fix it. */
export function prereleaseOnlyMessage(packages, tag) {
  const names = packages.map((pkg) => pkg.name);
  return [
    `release publish preflight failed: ${names.join(", ")} only ${names.length === 1 ? "has" : "have"} \`${tag}\` prereleases on npm, so \`changeset publish\` would put the new version on \`latest\` and leave \`${tag}\` on an old build.`,
    `Give each package one version outside \`${tag}\`, once, from an account that can publish @zitadel packages, then rerun the release:`,
    "",
    ...packages.map(
      (pkg) =>
        `dir=$(mktemp -d) && printf '{"name":"%s","version":"0.0.0-bootstrap.0","license":"%s","description":"Placeholder. Install %s@${tag}."}\\n' "${pkg.name}" "${pkg.license}" "${pkg.name}" > "$dir/package.json" && (cd "$dir" && npm publish --access public --tag bootstrap)`,
    ),
  ].join("\n");
}
