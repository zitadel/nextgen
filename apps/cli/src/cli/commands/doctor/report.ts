import wrapAnsi from "wrap-ansi";

import { type NextSteps, renderNextSteps } from "@/cli/core/next-steps";
import type { Suggest } from "@/lib/suggestion";
import { style } from "@/lib/ui";
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

/**
 * The checks as the envelope carries them: each with its category, and a
 * warning's remedy written into its details as `remedy_command`, after what
 * the check found. Each branch destructures the check it narrowed: a remedy
 * comes only with details that are an object, which destructuring both at once
 * would forget.
 *
 * @param checks - The checks, as they ran.
 * @returns The checks for the envelope.
 */
export function withCategories(
  checks: readonly CheckOutcome[],
): Array<Omit<CheckOutcome, "remedy"> & { category: CheckCategory }> {
  return checks.map((check) => {
    const category = categoryOf(check.name);
    if (check.remedy === undefined) {
      const { remedy: _none, ...found } = check;
      return { ...found, category };
    }
    const { remedy, ...found } = check;
    return {
      ...found,
      details: { ...found.details, remedy_command: remedy },
      category,
    };
  });
}

type RowStatus = CheckOutcome["status"] | "skip";

const ROW_MARK: Record<RowStatus, string> = {
  pass: style.statusColor.pass("[✓]"),
  warn: style.statusColor.warn("[!]"),
  fail: style.statusColor.fail("[✗]"),
  skip: style.dim("[-]"),
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
 * A category with no checks to show this run says why, and what to do about it,
 * if anything. The commands that repair what a category reports are its
 * non-passing checks' remedies; `upgrade` re-pins the app's packages too, so it
 * stands in for the pin check's own command, which would align them with this
 * older CLI. A run that passed closes on its title, so only a failure, which has none,
 * says its verdict at the end.
 */
export function doctorReport(input: DoctorReportInput): DoctorReport {
  const lines: string[] = [];
  const shownCommands = new Set<string>();
  for (const category of CHECK_CATEGORIES) {
    const checks = input.checks.filter((check) => {
      return categoryOf(check.name) === category.id;
    });
    const skipped =
      category.id === "local_server" && input.hostedServer !== undefined
        ? { reason: `not used, this project's server is ${input.hostedServer}` }
        : category.id === "project" && !input.projectConfigured
          ? {
              reason: "no zitadel.json in this directory",
              command: input.suggest({ id: "setup" }),
            }
          : undefined;
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
    const worst = checks.some((check) => {
      return check.status === "fail";
    })
      ? "fail"
      : checks.some((check) => {
            return check.status === "warn";
          })
        ? "warn"
        : "pass";
    lines.push(row(worst, category.label, summaryOf(category.id, checks, input)));
    lines.push(...detailLines(checks, input, shownCommands));
    const remedies = checks
      .filter((check) => {
        return check.status !== "pass";
      })
      .flatMap((check) => {
        return check.remedy === undefined ? [] : [check.remedy];
      });
    for (const remedy of category.id === "versions"
      ? remedies.slice(0, 1)
      : [...new Set(remedies)]) {
      if (!shownCommands.has(remedy)) {
        lines.push(remedyLine(remedy));
        shownCommands.add(remedy);
      }
    }
  }
  const failed = input.checks.some((check) => {
    return check.status === "fail";
  });
  const showsHint = !input.verbose && input.checks.length > 0;
  if (failed || showsHint) {
    lines.push("");
  }
  if (failed) {
    const affected = (status: CheckOutcome["status"]): number => {
      return new Set(
        input.checks
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
    lines.push(
      `${style.mark.fail} Zitadel doctor found issues in ${categories(affected("fail"))}.`,
    );
  }
  if (showsHint) {
    lines.push(style.dim(`  Run with -v to see all ${checksCount(input.checks.length)}.`));
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
  return [style.strong("Zitadel doctor"), "", ...lines, ...(block === "" ? [] : ["", block])].join(
    "\n",
  );
}

function row(status: RowStatus, label: string, summary: string | undefined): string {
  const title = status === "pass" || status === "skip" ? label : style.strong(label);
  return [
    `${ROW_MARK[status]} ${title}${" ".repeat(LABEL_WIDTH - label.length)}`,
    ...(summary === undefined || summary === "" ? [] : [style.dim(summary)]),
  ]
    .join("  ")
    .trimEnd();
}

/** The one-line summary a row shows; what needs attention is listed below it instead. */
function summaryOf(
  category: CheckCategory,
  checks: readonly CheckOutcome[],
  input: DoctorReportInput,
): string | undefined {
  if (category === "versions") {
    const versionDetails = checks.find((check) => {
      return check.name === "cli-version";
    })?.details;
    const latest = (
      typeof versionDetails === "object" && versionDetails !== null
        ? (versionDetails as Record<string, unknown>)
        : undefined
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

/**
 * What a row expands to. Several checks can fail for one cause, as every check
 * that reads a missing `.zitadel/secret` does, so a collapsed row says a message
 * only once; `--verbose` lists every check, by name. Each line's control
 * characters are spelled out because only a passing check's line is dimmed, and
 * a check that failed names what it read — a server's answer, a registry's
 * version, a path — in a line nothing else would spell out.
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
    const text = escapeControlCharacters(
      input.verbose ? `${check.name}: ${check.message}` : check.message,
    );
    const shown = check.status === "pass" ? style.dim(text) : text;
    const wrapped = !input.columns
      ? shown
      : wrapAnsi(shown, Math.max(20, input.columns - DETAIL_INDENT), { hard: false });
    const [first = "", ...rest] = wrapped.split("\n");
    lines.push(
      [
        `    ${style.mark[check.status]} ${first}`,
        ...rest.map((line) => {
          return `${" ".repeat(DETAIL_INDENT)}${line}`;
        }),
      ].join("\n"),
    );
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

function remedyLine(remedy: string): string {
  return `    ${style.arrow} ${style.command(remedy)}`;
}
