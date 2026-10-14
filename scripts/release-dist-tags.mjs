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
// server's `0.0.0-oidc-bootstrap.0`. The publish preflight stops a release
// that would hit the rule. It skips a package whose local version is already
// on npm, as `changeset publish` does.
//
// The preflight also stops a release that would publish a package npm has
// never seen. Releases publish through npm trusted publishing, which cannot
// create a package: a maintainer publishes a placeholder once and adds the
// trusted publisher (.changeset/README.md, "Publishing"). The same placeholder
// gives the package its version outside the prerelease tag.

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
 * The packages `changeset publish` would publish, because their local version
 * isn't on npm yet, that it cannot publish as they are: `unpublished` were
 * never published, so trusted publishing cannot create them; `prereleaseOnly`
 * only have `tag` prereleases on npm, so the new version would go to `latest`.
 * Without a prerelease `tag` (outside pre mode) only `unpublished` applies.
 */
export async function findPublishBlockers(packages, tag, options = {}) {
  const versions = await mapWithConcurrency(packages, 4, (pkg) =>
    readPublishedVersions(pkg.name, options),
  );
  const pending = packages
    .map((pkg, index) => ({ pkg, published: versions[index] }))
    .filter(({ pkg, published }) => !published.includes(pkg.version));
  return {
    unpublished: pending.filter(({ published }) => published.length === 0).map(({ pkg }) => pkg),
    prereleaseOnly:
      tag === undefined
        ? []
        : pending.filter(({ published }) => isPrereleaseOnly(published, tag)).map(({ pkg }) => pkg),
  };
}

/** The one-time placeholder publish that puts a version of `pkg` outside `tag`. */
function bootstrapCommand(pkg, tag) {
  const install = tag === undefined ? pkg.name : `${pkg.name}@${tag}`;
  return `dir=$(mktemp -d) && printf '{"name":"%s","version":"0.0.0-bootstrap.0","license":"%s","description":"Placeholder. Install %s."}\\n' "${pkg.name}" "${pkg.license}" "${install}" > "$dir/package.json" && (cd "$dir" && npm publish --access public --tag bootstrap)`;
}

function nameList(packages) {
  return packages.map((pkg) => pkg.name).join(", ");
}

/** The preflight failure: what is wrong, and the one-time steps that fix it. */
export function publishBlockersMessage({ unpublished, prereleaseOnly }, tag) {
  const lines = ["release publish preflight failed:"];
  if (unpublished.length > 0) {
    lines.push(
      `- ${nameList(unpublished)} ${unpublished.length === 1 ? "has" : "have"} never been published to npm. Releases publish through npm trusted publishing, which cannot create a package.`,
    );
  }
  if (prereleaseOnly.length > 0) {
    lines.push(
      `- ${nameList(prereleaseOnly)} only ${prereleaseOnly.length === 1 ? "has" : "have"} \`${tag}\` prereleases on npm, so \`changeset publish\` would put the new version on \`latest\` and leave \`${tag}\` on an old build.`,
    );
  }
  lines.push(
    "",
    `Once, from an account that can publish @zitadel packages, publish a placeholder version${tag === undefined ? "" : ` outside \`${tag}\``} of each package:`,
    "",
    ...[...unpublished, ...prereleaseOnly].map((pkg) => bootstrapCommand(pkg, tag)),
  );
  if (unpublished.length > 0) {
    lines.push(
      "",
      `Then add a trusted publisher for ${nameList(unpublished)} on npmjs.com (package Settings → Trusted Publishing: GitHub Actions, repository zitadel/nextgen, workflow release-publish.yml), as .changeset/README.md describes under "Publishing".`,
    );
  }
  lines.push("", "Then rerun the release.");
  return lines.join("\n");
}
