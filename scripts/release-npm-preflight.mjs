import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { mapWithConcurrency, runCapture } from "./dev-process.mjs";

// Releases publish through npm trusted publishing, which cannot create a
// package: a maintainer publishes a placeholder once and adds the trusted
// publisher (.changeset/README.md, "Publishing"). The publish preflight stops
// a release that would publish a package npm has never seen, and prints those
// one-time steps.
//
// The preflight asks the npm registry before `release publish --dry-run`
// returns, so an offline dry run fails closed instead of passing unchecked.
//
// ci.yml runs the same check on the version PR and its merge group
// (`release.mjs check-npm`), so a version it would stop fails there, before
// the version commit is on main.

/**
 * The name, version, and license of the package in each of `dirs`. A private
 * package is skipped: it is never published, so it has nothing to check.
 */
export async function readLocalPackages(root, dirs) {
  const read = await Promise.all(
    dirs.map(async (dir) => {
      const {
        name,
        version,
        license,
        private: isPrivate,
      } = JSON.parse(await readFile(join(root, dir, "package.json"), "utf8"));
      if (isPrivate === true) {
        return undefined;
      }
      for (const [field, value] of Object.entries({ name, version, license })) {
        if (typeof value !== "string" || value === "") {
          throw new Error(`${join(dir, "package.json")} has no ${field}`);
        }
      }
      return { name, version, license };
    }),
  );
  return read.filter((pkg) => pkg !== undefined);
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

/** The packages trusted publishing cannot publish: npm has never seen them. */
export async function findPublishBlockers(packages, options = {}) {
  const versions = await mapWithConcurrency(packages, 4, (pkg) =>
    readPublishedVersions(pkg.name, options),
  );
  return { unpublished: packages.filter((_, index) => versions[index].length === 0) };
}

/** The one-time placeholder publish that creates `pkg` on npm. */
function bootstrapCommand(pkg) {
  return `dir=$(mktemp -d) && printf '{"name":"%s","version":"0.0.0-bootstrap.0","license":"%s","description":"Placeholder. Install %s."}\\n' "${pkg.name}" "${pkg.license}" "${pkg.name}" > "$dir/package.json" && (cd "$dir" && npm publish --access public --tag bootstrap)`;
}

/** The npmjs.com trusted publisher setting for `pkg`, made from a terminal (npm 11.15 or later). */
function trustCommand(pkg) {
  return `npm trust github ${pkg.name} --repo zitadel/nextgen --file release-publish.yml --allow-publish --yes`;
}

function nameList(packages) {
  return packages.map((pkg) => pkg.name).join(", ");
}

/** The preflight failure: what is wrong, and the one-time steps that fix it. */
export function publishBlockersMessage({ unpublished }) {
  return [
    "release publish preflight failed:",
    `- ${nameList(unpublished)} ${unpublished.length === 1 ? "has" : "have"} never been published to npm. Releases publish through npm trusted publishing, which cannot create a package.`,
    "",
    "Once, from an account that can publish @zitadel packages, publish a placeholder version of each package:",
    "",
    ...unpublished.map(bootstrapCommand),
    "",
    `Then add a trusted publisher for ${nameList(unpublished)} on npmjs.com (package Settings → Trusted Publishing: GitHub Actions, repository zitadel/nextgen, workflow release-publish.yml), as .changeset/README.md describes under "Publishing". With npm 11.15 or later, the same account can do it from a terminal:`,
    "",
    ...unpublished.map(trustCommand),
    "",
    "Then rerun this job.",
  ].join("\n");
}
