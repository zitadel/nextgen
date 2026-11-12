import wrapAnsi from "wrap-ansi";

import { type NextSteps, renderNextSteps } from "@/lib/oclif/next-steps";
import type { Suggest } from "@/lib/suggestion";
import { arrow, command, dim, mark, statusColor, strong } from "@/lib/style";
import { escapeControlCharacters } from "@/lib/terminal-text";

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

const LABEL_WIDTH = Math.max(
  ...CHECK_CATEGORIES.map((category) => {
    return category.label.length;
  }),
);
/** Under a category's row: four columns of indent, the mark, and a space. */
const DETAIL_INDENT = 6;

/** The category a check belongs to. A test holds every check the command runs to this table. */
export function categoryOf(checkName: string): CheckCategory {
  return (
    CHECK_CATEGORIES.find((category) => {
      return category.checks.includes(checkName);
    })?.id ?? "project"
  );
}

/** The checks as the envelope carries them. */
export function withCategories(
  checks: readonly CheckOutcome[],
): Array<CheckOutcome & { category: CheckCategory }> {
  return checks.map((check) => {
    return {
      ...check,
      category: categoryOf(check.name),
    };
  });
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
  /** Renders the commands the report suggests, with the run's own scope. */
  suggest: Suggest;
  /** Whether this directory has a `zitadel.json`; without one no project check ran. */
  projectConfigured: boolean;
  /** The project's hosted server, when it uses no local one and no local check ran. */
  hostedServer?: string;
  runtime: string;
  port: number;
  next: NextSteps;
  /** Each warning's one repair, shown under its check instead of among the next steps. */
  fixes?: ReadonlyArray<{ check: string; action: string; command: string }>;
  /** Also list every check that passed. */
  verbose: boolean;
  /** Terminal width to wrap messages to; none for piped output or a pty of no size, not wrapped. */
  columns?: number;
};

/** What the report says under its title: the rows and the next steps no row already shows. */
export type DoctorReport = {
  /** The rows, what needs attention under them, and the conclusion of a failed run. */
  readonly lines: string[];
  /** The next steps not already shown under a row. */
  readonly next: NextSteps;
};

/**
 * Builds doctor's result the way `flutter doctor` does: one row per category,
 * collapsed when everything in it passed, with what needs attention indented
 * below its row and the command that repairs it pulled out to copy. `--verbose`
 * expands every row. Only for people: the envelope carries the same checks.
 */
export function doctorReport(input: DoctorReportInput): DoctorReport {
  const lines: string[] = [];
  const shownCommands = new Set<string>();
  for (const category of CHECK_CATEGORIES) {
    const checks = input.checks.filter((check) => {
      return categoryOf(check.name) === category.id;
    });
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
    lines.push(...detailLines(checks, input, shownCommands));
    for (const remedy of remediesOf(category.id, checks)) {
      if (!shownCommands.has(remedy)) {
        lines.push(remedyLine(remedy));
        shownCommands.add(remedy);
      }
    }
  }
  // A run that passed closes on its title, so only a failure, which has
  // none, says its verdict here.
  const failed = input.checks.some((check) => {
    return check.status === "fail";
  });
  const showsHint = !input.verbose && input.checks.length > 0;
  if (failed || showsHint) {
    lines.push("");
  }
  if (failed) {
    lines.push(conclusion(input.checks));
  }
  if (showsHint) {
    lines.push(dim(`  Run with -v to see all ${checksCount(input.checks.length)}.`));
  }
  const shownActions = new Set(
    (input.fixes ?? [])
      .filter((fix) => {
        return shownCommands.has(fix.command);
      })
      .map((fix) => {
        return fix.action;
      }),
  );
  return {
    lines,
    next: {
      actions: input.next.actions?.filter((action) => {
        return !shownActions.has(action);
      }),
      commands: input.next.commands?.filter((suggested) => {
        return !shownCommands.has(suggested);
      }),
    },
  };
}

/** The report as one block of text, with its title and the steps under it. */
export function renderDoctorReport(input: DoctorReportInput): string {
  const { lines, next } = doctorReport(input);
  const block = renderNextSteps(next);
  return [strong("Zitadel doctor"), "", ...lines, ...(block === "" ? [] : ["", block])].join("\n");
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
      command: input.suggest("setup"),
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
  if (
    checks.some((check) => {
      return check.status === "fail";
    })
  ) {
    return "fail";
  }
  return checks.some((check) => {
    return check.status === "warn";
  })
    ? "warn"
    : "pass";
}

/** The one-line summary a row shows; what needs attention is listed below it instead. */
function summaryOf(
  category: CheckCategory,
  checks: readonly CheckOutcome[],
  input: DoctorReportInput,
): string | undefined {
  if (category === "versions") {
    const latest = detailsOf(
      checks.find((check) => {
        return check.name === "cli-version";
      }),
    )?.latest;
    return typeof latest === "string"
      ? `CLI ${input.cliVersion}, ${latest} available`
      : `CLI ${input.cliVersion}`;
  }
  if (category === "local_server") {
    const running =
      checks.find((check) => {
        return check.name === "runtime";
      })?.status === "pass";
    return `${running ? "running on " : ""}port ${String(input.port)} (${input.runtime})`;
  }
  const passed = checks.filter((check) => {
    return check.status === "pass";
  }).length;
  if (passed !== checks.length) {
    return undefined;
  }
  return `${checksCount(passed)} passed`;
}

function checksCount(count: number): string {
  return new Intl.PluralRules("en").select(count) === "one" ? "1 check" : `${String(count)} checks`;
}

function detailsOf(check: CheckOutcome | undefined): Record<string, unknown> | undefined {
  const details = check?.details;
  return typeof details === "object" && details !== null
    ? (details as Record<string, unknown>)
    : undefined;
}

/**
 * What a row expands to. Several checks can fail for one cause, as every check
 * that reads a missing `.zitadel/secret` does, so a collapsed row says a message
 * only once; `--verbose` lists every check, by name.
 */
function detailLines(
  checks: readonly CheckOutcome[],
  input: DoctorReportInput,
  shownCommands: Set<string>,
): string[] {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const check of checks) {
    if (check.status === "pass" && !input.verbose) {
      continue;
    }
    if (!input.verbose && seen.has(check.message)) {
      continue;
    }
    seen.add(check.message);
    // Spelled out here because only a passing check's line is dimmed, and a
    // check that failed names what it read — a server's answer, a registry's
    // version, a path — in a line nothing else would spell out.
    const text = escapeControlCharacters(
      input.verbose ? `${check.name}: ${check.message}` : check.message,
    );
    lines.push(detailLine(check.status, check.status === "pass" ? dim(text) : text, input));
    const fix = input.fixes?.find((candidate) => {
      return candidate.check === check.name;
    });
    if (check.status !== "pass" && fix !== undefined && !shownCommands.has(fix.command)) {
      lines.push(remedyLine(fix.command));
      shownCommands.add(fix.command);
    }
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
    ...rest.map((line) => {
      return `${" ".repeat(DETAIL_INDENT)}${line}`;
    }),
  ].join("\n");
}

/**
 * The commands that repair what a category reports. `upgrade` re-pins the app's
 * packages too, so it stands in for the pin check's own command, which would
 * align them with this older CLI.
 */
function remediesOf(category: CheckCategory, checks: readonly CheckOutcome[]): string[] {
  const remedies = checks
    .filter((check) => {
      return check.status !== "pass";
    })
    .map((check) => {
      return detailsOf(check)?.remedy_command;
    })
    .filter((remedy): remedy is string => {
      return typeof remedy === "string";
    });
  return category === "versions" ? remedies.slice(0, 1) : [...new Set(remedies)];
}

function remedyLine(remedy: string): string {
  return `    ${arrow} ${command(remedy)}`;
}

function conclusion(checks: readonly CheckOutcome[]): string {
  const affected = (status: CheckOutcome["status"]): number => {
    return new Set(
      checks
        .filter((check) => {
          return check.status === status;
        })
        .map((c) => {
          return categoryOf(c.name);
        }),
    ).size;
  };
  const categories = (count: number): string => {
    return new Intl.PluralRules("en").select(count) === "one"
      ? "1 category"
      : `${String(count)} categories`;
  };
  return `${mark.fail} Zitadel doctor found issues in ${categories(affected("fail"))}.`;
}
