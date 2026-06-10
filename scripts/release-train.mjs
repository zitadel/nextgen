import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = fileURLToPath(new URL("..", import.meta.url));

export const productPackage = {
  name: "@zitadel/product",
  path: "packages/product",
  title: "Product",
};

export const publicPackages = [
  { name: "@zitadel/cli", path: "apps/cli", title: "CLI" },
  { name: "@zitadel/api", path: "packages/api", title: "API client" },
  { name: "@zitadel/components", path: "packages/components", title: "Web components" },
  { name: "@zitadel/sdk-core", path: "packages/sdk-core", title: "Core SDK" },
  { name: "@zitadel/sdk-next", path: "packages/sdk-next", title: "Next.js SDK" },
  { name: "@zitadel/sdk-nuxt", path: "packages/sdk-nuxt", title: "Nuxt SDK" },
  { name: "@zitadel/sdk-react", path: "packages/sdk-react", title: "React SDK" },
  { name: "@zitadel/sdk-vue", path: "packages/sdk-vue", title: "Vue SDK" },
  { name: "@zitadel/sdk-angular", path: "packages/sdk-angular", title: "Angular SDK" },
];

export const lockstepPackages = [productPackage, ...publicPackages];

const releaseTagPattern = /^v(?<version>\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/;

export function normalizeReleaseVersion(input) {
  const match = releaseTagPattern.exec(input ?? "");
  if (!match?.groups?.version) {
    throw new Error(`version must look like v5.0.0-alpha.1, got ${input || "<empty>"}`);
  }
  return {
    tag: input,
    version: match.groups.version,
    baseVersion: match.groups.version.split("-")[0],
  };
}

export function readJson(relativePath) {
  return JSON.parse(readFileSync(join(repoRoot, relativePath), "utf8"));
}

export function readPackage(manifestPackage) {
  return readJson(`${manifestPackage.path}/package.json`);
}

export function readChangelog(manifestPackage) {
  return readFileSync(join(repoRoot, manifestPackage.path, "CHANGELOG.md"), "utf8");
}

export function extractChangelogSection(markdown, version) {
  const lines = markdown.split(/\r?\n/);
  const heading = `## ${version}`;
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start === -1) {
    return "";
  }

  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^##\s+/.test(lines[index])) {
      end = index;
      break;
    }
  }

  return lines.slice(start + 1, end).join("\n").trim();
}

export function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      throw new Error(`Unexpected argument ${arg}`);
    }
    const key = arg.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${arg}`);
    }
    parsed[key] = value;
    index += 1;
  }
  return parsed;
}
