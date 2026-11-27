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
 * A value as a workflow command reads it: `%`, line breaks, and in a property
 * also `:` and `,`, are percent-encoded, or GitHub drops the properties.
 *
 * @param {string} value - The text to encode.
 * @param {boolean} property - Whether it is a property value, not the message.
 * @returns {string} The encoded text.
 */
function encode(value, property) {
  const message = value.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
  if (!property) {
    return message;
  }
  return message.replaceAll(":", "%3A").replaceAll(",", "%2C");
}

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
        const params = [`file=${encode(relative(cwd, issue.filePath), true)}`];
        if (issue.line !== undefined) {
          params.push(`line=${issue.line}`);
        }
        if (issue.col !== undefined) {
          params.push(`col=${issue.col}`);
        }
        params.push(`title=${encode(`knip: ${TITLES[type]}`, true)}`);
        return `::${level} ${params.join(",")}::${encode(`${TITLES[type]}: ${issue.symbol}`, false)}`;
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
