import wrapAnsi from "wrap-ansi";

import type { NextSteps } from "../../lib/oclif/next-steps";
import { publicCliCommand } from "../../lib/public-cli";
import { arrow, command, dim, mark, statusColor, strong } from "../../lib/style";
import type { CheckOutcome } from "./checks";

/** The question a check answers, which also tells who fixes it and how. On the wire, so `snake_case`. */
export type CheckCategory =
  | "versions"
  | "local_server"
  | "project"
  | "credentials"
  | "app_integration"
  | "environment";

/** Every category in display order, with the checks that answer it. */
export const CHECK_CATEGORIES: ReadonlyArray<{
  id: CheckCategory;
  label: string;
  checks: readonly string[];
}> = [
  {
    id: "versions",
    label: "Versions",
    checks: ["cli-version", "dependency-version", "meta-schemas"],
  },
  {
    id: "local_server",
    label: "Local server",
    checks: [
      "server-binary",
      "docker-cli",
      "image",
      "state-dir",
      "port",
      "runtime",
      "managed-runtime-processes",
    ],
  },
  {
    id: "project",
    label: "Project",
    checks: ["config", "schema", "issuer-origin", "claim"],
  },
  {
    id: "credentials",
    label: "Credentials",
    checks: ["secret", "secret-permissions", "project-match", "gitignore", "env-example"],
  },
  {
    id: "app_integration",
    label: "App integration",
    checks: ["framework", "dependency", "managed-files"],
  },
  {
    id: "environment",
    label: "Environment",
    checks: ["environment"],
  },
];

const LABEL_WIDTH = Math.max(...CHECK_CATEGORIES.map((category) => category.label.length));
/** Under a category's row: four columns of indent, the mark, and a space. */
const DETAIL_INDENT = 6;

/** The category a check belongs to. A test holds every check the command runs to this table. */
export function categoryOf(checkName: string): CheckCategory {
  return CHECK_CATEGORIES.find((category) => category.checks.includes(checkName))?.id ?? "project";
}

/** The checks as the envelope carries them. */
export function withCategories(
  checks: readonly CheckOutcome[],
): Array<CheckOutcome & { category: CheckCategory }> {
  return checks.map((check) => ({ ...check, category: categoryOf(check.name) }));
}

type RowStatus = CheckOutcome["status"] | "skip";

const ROW_MARK: Record<RowStatus, string> = {
  pass: statusColor.pass("[✓]"),
  warn: statusColor.warn("[!]"),
  fail: statusColor.fail("[✗]"),
  skip: dim("[-]"),
};

export type DoctorReportInput = {
  checks: readonly CheckOutcome[];
  cliVersion: string;
  /** Whether this directory has a `zitadel.json`; without one no project check ran. */
  projectConfigured: boolean;
  /** The project's hosted server, when it uses no local one and no local check ran. */
  hostedServer?: string;
  runtime: string;
  port: number;
  next: NextSteps;
  /** Also list every check that passed. */
  verbose: boolean;
  /** Terminal width to wrap messages to; none for piped output or a pty of no size, not wrapped. */
  columns?: number;
};

/**
 * Renders doctor's result the way `flutter doctor` does: one row per category,
 * collapsed when everything in it passed, with what needs attention indented
 * below its row and the command that repairs it pulled out to copy. `--verbose`
 * expands every row. Only for people: the envelope carries the same checks.
 */
export function renderDoctorReport(input: DoctorReportInput): string {
  const lines = [
    input.verbose
      ? strong("Zitadel doctor")
      : `${strong("Zitadel doctor")} ${dim("(run with -v to see every check)")}`,
    "",
  ];
  const shownCommands = new Set<string>();
  for (const category of CHECK_CATEGORIES) {
    const checks = input.checks.filter((check) => categoryOf(check.name) === category.id);
    const skipped = skipReason(category.id, input);
    if (skipped !== undefined) {
      lines.push(row("skip", category.label, skipped.reason));
      if (skipped.command !== undefined) {
        lines.push(remedyLine(skipped.command));
        shownCommands.add(skipped.command);
      }
      continue;
    }
    if (checks.length === 0) {
      continue;
    }
    lines.push(row(worstOf(checks), category.label, summaryOf(category.id, checks, input)));
    lines.push(...detailLines(checks, input));
    for (const remedy of remediesOf(category.id, checks)) {
      lines.push(remedyLine(remedy));
      shownCommands.add(remedy);
    }
  }
  lines.push("", conclusion(input.checks));
  const remaining = nextLines(input.next, shownCommands);
  return [...lines, ...remaining].join("\n");
}

/** Why a category has no checks to show this run, and what to do about it, if anything. */
function skipReason(
  category: CheckCategory,
  input: DoctorReportInput,
): { reason?: string; command?: string } | undefined {
  if (category === "local_server" && input.hostedServer !== undefined) {
    return { reason: `not used, this project's server is ${input.hostedServer}` };
  }
  if (category === "project" && !input.projectConfigured) {
    return {
      reason: "no zitadel.json in this directory",
      command: publicCliCommand("setup", input.cliVersion),
    };
  }
  return undefined;
}

function row(status: RowStatus, label: string, summary: string | undefined): string {
  const title = status === "pass" || status === "skip" ? label : strong(label);
  return [
    `${ROW_MARK[status]} ${title}${" ".repeat(LABEL_WIDTH - label.length)}`,
    ...(summary === undefined || summary === "" ? [] : [dim(summary)]),
  ]
    .join("  ")
    .trimEnd();
}

function worstOf(checks: readonly CheckOutcome[]): CheckOutcome["status"] {
  if (checks.some((check) => check.status === "fail")) {
    return "fail";
  }
  return checks.some((check) => check.status === "warn") ? "warn" : "pass";
}

/** The one-line summary a row shows; what needs attention is listed below it instead. */
function summaryOf(
  category: CheckCategory,
  checks: readonly CheckOutcome[],
  input: DoctorReportInput,
): string | undefined {
  if (category === "versions") {
    const latest = detailsOf(checks.find((check) => check.name === "cli-version"))?.latest;
    return typeof latest === "string"
      ? `CLI ${input.cliVersion}, ${latest} available`
      : `CLI ${input.cliVersion}`;
  }
  if (category === "local_server") {
    return `${input.runtime}, port ${String(input.port)}`;
  }
  const passed = checks.filter((check) => check.status === "pass").length;
  if (passed !== checks.length) {
    return undefined;
  }
  return passed === 1 ? "1 check passed" : `${String(passed)} checks passed`;
}

function detailsOf(check: CheckOutcome | undefined): Record<string, unknown> | undefined {
  const details = check?.details;
  return typeof details === "object" && details !== null
    ? (details as Record<string, unknown>)
    : undefined;
}

/**
 * What a row expands to. Several checks can fail for one cause, as every check
 * that reads a missing `.zitadel/secret` does, so a message is said only once.
 */
function detailLines(checks: readonly CheckOutcome[], input: DoctorReportInput): string[] {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const check of checks) {
    if (check.status === "pass" && !input.verbose) {
      continue;
    }
    if (seen.has(check.message)) {
      continue;
    }
    seen.add(check.message);
    const text = input.verbose ? `${check.name}: ${check.message}` : check.message;
    lines.push(detailLine(check.status, check.status === "pass" ? dim(text) : text, input));
  }
  return lines;
}

function detailLine(
  status: CheckOutcome["status"],
  text: string,
  input: DoctorReportInput,
): string {
  const wrapped = !input.columns
    ? text
    : wrapAnsi(text, Math.max(20, input.columns - DETAIL_INDENT), { hard: false });
  const [first = "", ...rest] = wrapped.split("\n");
  return [
    `    ${mark[status]} ${first}`,
    ...rest.map((line) => `${" ".repeat(DETAIL_INDENT)}${line}`),
  ].join("\n");
}

/**
 * The commands that repair what a category reports. `upgrade` re-pins the app's
 * packages too, so it stands in for the pin check's own command, which would
 * align them with this older CLI.
 */
function remediesOf(category: CheckCategory, checks: readonly CheckOutcome[]): string[] {
  const remedies = checks
    .filter((check) => check.status !== "pass")
    .map((check) => detailsOf(check)?.remedy_command)
    .filter((remedy): remedy is string => typeof remedy === "string");
  return category === "versions" ? remedies.slice(0, 1) : [...new Set(remedies)];
}

function remedyLine(remedy: string): string {
  return `    ${arrow} ${command(remedy)}`;
}

function conclusion(checks: readonly CheckOutcome[]): string {
  const affected = (status: CheckOutcome["status"]): number =>
    new Set(checks.filter((check) => check.status === status).map((c) => categoryOf(c.name))).size;
  const categories = (count: number): string =>
    count === 1 ? "1 category" : `${String(count)} categories`;
  if (checks.some((check) => check.status === "fail")) {
    return `${mark.fail} Zitadel doctor found issues in ${categories(affected("fail"))}.`;
  }
  if (checks.some((check) => check.status === "warn")) {
    return `${mark.warn} Zitadel doctor passed with warnings in ${categories(affected("warn"))}.`;
  }
  return `${mark.pass} Zitadel doctor passed.`;
}

/** The next steps not already shown under a row, which is why doctor draws them itself. */
function nextLines(next: NextSteps, shownCommands: ReadonlySet<string>): string[] {
  const actions = next.actions ?? [];
  const commands = (next.commands ?? []).filter((suggested) => !shownCommands.has(suggested));
  if (actions.length === 0 && commands.length === 0) {
    return [];
  }
  return [
    "",
    "Next:",
    ...actions.map((action) => `  ${action}`),
    ...commands.map((suggested) => `  ${dim("$")} ${command(suggested)}`),
  ];
}
