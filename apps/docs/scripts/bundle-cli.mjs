import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const docsRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
// The CLI's commands as data, which the CLI's reference test writes from its
// command table (apps/cli/tests/unit/lib/oclif/reference.test.ts).
const input = require.resolve("@zitadel/cli/command-reference.json");
// The CLI's changelog, which Changesets writes on every release.
const changelog = require.resolve("@zitadel/cli/CHANGELOG.md");
const outputDir = resolve(docsRoot, ".generated");

const { $comment: _marker, ...reference } = JSON.parse(await readFile(input, "utf8"));
if (!Array.isArray(reference.commands) || !Array.isArray(reference.globalFlags)) {
  throw new Error(`${input} lists no commands and no global flags`);
}

const releases = parseChangelog(await readFile(changelog, "utf8"));
if (releases.length === 0) throw new Error(`${changelog} lists no release`);

// lib/cli-reference.ts imports the reference as a module, as lib/openapi.ts
// does the API (scripts/bundle-openapi.mjs), and the declaration types it.
await mkdir(outputDir, { recursive: true });
await writeFile(
  resolve(outputDir, "cli.mjs"),
  [
    `export default ${JSON.stringify(reference, null, 2)};`,
    "",
    `export const releases = ${JSON.stringify(releases, null, 2)};`,
    "",
  ].join("\n"),
);
await writeFile(
  resolve(outputDir, "cli.d.mts"),
  [
    'import type { CliReference, CliRelease } from "../lib/cli-reference.ts";',
    "",
    "declare const reference: CliReference;",
    "export default reference;",
    "",
    "export declare const releases: CliRelease[];",
    "",
  ].join("\n"),
);

/**
 * The releases of a changelog in the format @changesets/changelog-github
 * writes, newest first: a `## <version>` heading, a `### <kind> Changes`
 * heading per kind, and a change per list item, whose further lines are
 * indented two spaces. A change's text drops the item's credit, its pull
 * request, commit and author, and keeps the pull request as `pull`; an
 * "Updated dependencies" item keeps the versions and drops the commits.
 */
function parseChangelog(markdown) {
  const releases = [];
  let changes;
  let lines;
  const close = () => {
    if (lines) changes.push(change(lines));
    lines = undefined;
  };
  for (const line of markdown.split("\n")) {
    const version = /^## (\S+)\s*$/.exec(line)?.[1];
    const kind = /^### (\w+) Changes\s*$/.exec(line)?.[1];
    if (version) {
      close();
      releases.push({ version, sections: [] });
    } else if (kind && releases.length > 0) {
      close();
      changes = [];
      releases.at(-1).sections.push({ kind: kind.toLowerCase(), changes });
    } else if (line.startsWith("- ") && changes) {
      close();
      lines = [line.slice(2)];
    } else if (lines && (line === "" || line.startsWith("  "))) {
      lines.push(line.slice(2));
    } else if (line.trim() !== "") {
      close();
    }
  }
  close();
  return releases;
}

function change(lines) {
  const [first = "", ...rest] = lines;
  if (/^Updated dependencies \[.*\]:$/.test(first)) {
    const versions = rest.flatMap((line) => /^- (\S+)$/.exec(line)?.[1] ?? []);
    return { text: `Updated dependencies: ${versions.map((name) => `\`${name}\``).join(", ")}.` };
  }
  // `[#2157](…) [`adf6453`](…) Thanks [@user](…)! - `, each part optional.
  const credit =
    /^(?:\[#(\d+)\]\((\S+)\) )?(?:\[`[0-9a-f]+`\]\(\S+\) )?(?:Thanks \[@[^\]]+\]\(\S+\)! )?- /;
  const match = credit.exec(first);
  const text = [match ? first.slice(match[0].length) : first, ...rest].join("\n").trim();
  return match?.[1] ? { text, pull: { number: Number(match[1]), url: match[2] } } : { text };
}
