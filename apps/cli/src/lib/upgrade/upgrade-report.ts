import { arrow, command, dim, mark } from "@/lib/style";
import { escapeControlCharacters } from "@/lib/terminal-text";
import { RELEASE_NOTES_URL } from "@/lib/release-notes";

import type { Refresh } from "./project-installer";
import type { UpgradePlan } from "./upgrade-plan";

/** What an upgrade run did, as the lines a person reads and the data a script parses. */
export class UpgradeReport {
  /** What was decided. */
  private readonly plan: UpgradePlan;
  /** How the run ended. */
  private readonly outcome: Readonly<{
    refresh: Refresh;
    dryRun: boolean;
    installCommand: string | undefined;
  }>;

  /**
   * @param plan - What was decided.
   * @param outcome.refresh - How the refresh ended.
   * @param outcome.dryRun - Whether nothing was changed.
   * @param outcome.installCommand - The install as the shell reads it, when one was needed.
   */
  constructor(
    plan: UpgradePlan,
    outcome: Readonly<{
      refresh: Refresh;
      dryRun: boolean;
      installCommand: string | undefined;
    }>,
  ) {
    this.plan = plan;
    this.outcome = outcome;
  }

  /** The headline, the one sentence both renderings draw. */
  get title(): string {
    return `${this.said()}${this.outcome.dryRun ? " (dry run)" : ""}`;
  }

  /** The report's lines under the headline. */
  rows(): readonly string[] {
    const { refresh, dryRun, installCommand } = this.outcome;
    const done = dryRun ? arrow : mark.pass;
    return [
      // A package's name and versions are what the registry answered, and this
      // line colours only the mark in front of them, so they are spelled out
      // here rather than by whatever prints the report.
      ...this.plan.packages.map((pkg) => {
        return `  ${done} ${escapeControlCharacters(`${pkg.name} ${pkg.from} → ${pkg.to}`)}`;
      }),
      ...(dryRun && installCommand !== undefined ? [`  Would run ${command(installCommand)}`] : []),
      ...(refresh === "done" ? [`  ${done} Refreshed generated files with doctor --fix`] : []),
      ...(refresh === "issues"
        ? [`  ${mark.warn} Refreshed generated files; doctor still reports issues`]
        : []),
      ...(refresh === "failed" ? [`  ${mark.warn} Could not refresh generated files`] : []),
      ...this.plan.leftAlone.map((dependency) => {
        return `  ${dim(escapeControlCharacters(`- ${dependency.name} left at "${dependency.specifier}", not an exact version`))}`;
      }),
    ];
  }

  /** The envelope's `data`. */
  data(): Readonly<Record<string, unknown>> {
    const { plan, outcome } = this;
    return {
      title: this.title,
      ...(outcome.dryRun ? { dry_run: true } : {}),
      current_version: plan.cliVersion,
      latest_version: plan.target,
      up_to_date: plan.upToDate,
      packages: plan.packages,
      left_alone: plan.leftAlone.map((dependency) => {
        return {
          name: dependency.name,
          specifier: dependency.specifier,
        };
      }),
      breaking_changes: plan.breaking,
      release_notes_url: RELEASE_NOTES_URL,
      refresh: outcome.refresh,
      ...(outcome.installCommand === undefined ? {} : { install_command: outcome.installCommand }),
    };
  }

  /** The headline before any dry-run suffix. */
  private said(): string {
    if (this.plan.upToDate) {
      return `Zitadel is up to date at ${this.plan.target}`;
    }
    if (this.outcome.dryRun) {
      return `Zitadel can be upgraded to ${this.plan.target}`;
    }
    return `Zitadel upgraded to ${this.plan.target}`;
  }
}
