import { relative } from "node:path";

/** What each kind of knip finding says about the symbol it names. */
const TITLES = {
  files: "Unused file",
  dependencies: "Unused dependency",
  devDependencies: "Unused devDependency",
  optionalPeerDependencies: "Referenced optional peerDependency",
  unlisted: "Unlisted dependency",
  binaries: "Unlisted binary",
  unresolved: "Unresolved import",
  exports: "Unused export",
  types: "Unused exported type",
  nsExports: "Unused export in namespace",
  nsTypes: "Unused exported type in namespace",
  enumMembers: "Unused enum member",
  namespaceMembers: "Unused namespace member",
  duplicates: "Duplicate export",
  catalog: "Unused catalog entry",
};

/**
 * The GitHub Actions annotations for knip's findings: one `::error` (or
 * `::warning` for a finding set to warn) per finding, on the file and line it
 * names, so a failed lint shows on the pull request before the run's logs are.
 *
 * @param {import("knip").ReporterOptions} options - What knip found, and where it ran.
 * @returns {string[]} One workflow command per finding.
 */
export function annotations({ issues, cwd }) {
  return Object.entries(issues).flatMap(([type, records]) => {
    if (!(type in TITLES)) {
      return [];
    }
    return Object.values(records).flatMap((byFile) => {
      return Object.values(byFile).map((issue) => {
        const level = issue.severity === "warn" ? "warning" : "error";
        const params = [`file=${relative(cwd, issue.filePath)}`];
        if (issue.line !== undefined) {
          params.push(`line=${issue.line}`);
        }
        if (issue.col !== undefined) {
          params.push(`col=${issue.col}`);
        }
        params.push(`title=knip: ${TITLES[type]}`);
        return `::${level} ${params.join(",")}::${TITLES[type]}: ${issue.symbol}`;
      });
    });
  });
}

/**
 * A knip reporter that runs next to the default one: in GitHub Actions it
 * prints {@link annotations}, and anywhere else it prints nothing.
 *
 * @param {import("knip").ReporterOptions} options - What knip found, and where it ran.
 * @returns {void}
 */
export default function report(options) {
  if (process.env.GITHUB_ACTIONS !== "true") {
    return;
  }
  for (const line of annotations(options)) {
    console.log(line);
  }
}
