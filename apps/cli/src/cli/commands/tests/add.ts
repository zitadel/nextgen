import { join, relative, sep } from "node:path";
import { Flags } from "@oclif/core";

import { pathExists } from "@/lib/fs";
import { type DependencyInstall, installDependencies } from "@/lib/install";
import { isObject } from "@/lib/json";
import { readPackageJson } from "@/lib/npm";
import { type Admitted, BaseCommand, CommandGroups, type JsonEnvelope } from "@/lib/oclif";
import { prose } from "@/lib/oclif/rendering";
import { type Refusal, refusalError } from "@/lib/oclif/refusal";
import { createOrca } from "@/lib/orca";
import { FileWriter } from "@/lib/orca/patchers/rule/file-writer";
import type { ScaffoldPlan, ScaffoldResult } from "@/lib/orca/patchers/rule/file-writer/types";
import {
  detectPackageManager,
  inDirectory,
  type PackageCommand,
  type PackageManager,
  runScriptCommandFor,
} from "@/lib/package-manager";
import { hasZitadelConfig, readFrameworkId, readZitadelConfig } from "@/lib/project";
import { type SuggestedCommand, suggestedCommandOf } from "@/lib/suggestion";
import { escapeControlCharacters } from "@/lib/terminal-text";
import {
  PLAYWRIGHT_CONFIG,
  PLAYWRIGHT_CONFIG_NAMES,
  supportsTestSuite,
  TEST_KIT_PACKAGE,
  TEST_SCRIPT,
  TEST_SUITE_FRAMEWORKS,
  testSuitePlan,
} from "@/lib/test-kit";

/** Where the guide to the kit lives, for a refusal to point at. */
const GUIDE_URL = "https://preview.zitadel.com/docs/guides/test-your-app";

/** How a directory that `setup` has not made a project is refused. */
const NOT_A_PROJECT_REFUSAL = {
  message: "This directory is not a Zitadel project",
  hint: "Run setup first; the test suite runs against the app it wires up.",
  next: [{ id: "setup" }],
} as const satisfies Refusal;

/** How a project whose framework has no suite yet is refused. */
const FRAMEWORK_REFUSAL = {
  message: "tests add does not support {framework} apps yet",
  hint: `It writes a suite for: {supported}. For another framework, see ${GUIDE_URL}#other-frameworks`,
  details: { framework: "{framework}", frameworks: "{frameworks}" },
} as const satisfies Refusal;

/** How an app that already has a Playwright config is refused. */
const PLAYWRIGHT_CONFIG_REFUSAL = {
  code: "E_CONFLICT",
  message: "This app already has a Playwright config, {config}",
  hint: `With a second config, Playwright's lookup order would pick which one runs. Add withZitadel() from ${TEST_KIT_PACKAGE}/playwright to {config} by hand: ${GUIDE_URL}`,
  details: { path: "{config}" },
} as const satisfies Refusal;

/** How a directory without a `package.json` is refused. */
const MANIFEST_REFUSAL = {
  message: "package.json is required to add the test suite",
  hint: "Run tests add in the app's own directory, where setup ran.",
} as const satisfies Refusal;

/** How a failed install is refused; the files are written by then. */
const INSTALL_REFUSAL = {
  message: "Dependency install failed: {command}",
  hint: "The test files are written. Run {command} in {cwd} to install their dependencies.",
  next: ["{install}"],
  details: { command: "{command}", cwd: "{cwd}", message: "{message}" },
} as const satisfies Refusal;

/** What the app's `package.json` declares, as far as the suite cares. */
type Manifest = Readonly<{
  dependencies: ReadonlySet<string>;
  scripts: Readonly<Record<string, unknown>>;
}>;

/**
 * `zitadel tests add` — add end-to-end tests to an app setup wired up.
 *
 * Writes a Playwright config on `@zitadel/testing`, which boots a Zitadel
 * server of its own for every run, a test that signs a seeded user in, a test
 * that starts signed in, and a `test:e2e` script that runs them. The files
 * are the app's from then on: they are in no scaffold manifest, so a file
 * that no longer matches this CLI's template, edited or written by another
 * version, is refused unless `--force` replaces it.
 */
export default class TestsAdd extends BaseCommand {
  static override description =
    `Add end-to-end tests of the sign-in to this app.\n\nWrites playwright.config.mts, a test of the sign-in (e2e/sign-in.spec.ts) and a test that starts signed in (e2e/signed-in.spec.ts), wired to ${TEST_KIT_PACKAGE}. Adds it and @playwright/test as dev dependencies, and a test:e2e script unless the app has one. Each test run boots its own Zitadel server and project. Supports Next.js apps. A file that differs from this CLI's version of it, including one an earlier CLI wrote, is refused unless --force replaces it.`;
  static override group = CommandGroups.localDevelopment;

  static override flags = {
    force: Flags.boolean({
      char: "f",
      description: "Replace a test file that differs from this CLI's version of it.",
    }),
    "skip-install": Flags.boolean({
      description: "Do not install the new dev dependencies.",
    }),
  };

  static override examples = [
    "<%= config.bin %> <%= command.id %>",
    "<%= config.bin %> <%= command.id %> --skip-install",
  ];

  static override meta = {
    resolveServer: false,
  };

  protected async execute({ flags }: Admitted<typeof TestsAdd>): Promise<JsonEnvelope> {
    const framework = await this.projectFramework();
    await this.refuseAnotherPlaywrightConfig();
    const manifest = await this.manifest();
    const plan = testSuitePlan({
      framework,
      cliVersion: this.cliVersion,
      declared: manifest.dependencies,
      scripts: new Set(Object.keys(manifest.scripts)),
    });

    // A dry run first, so a conflict refuses the run before any file is written.
    const planned = await this.scaffold(plan, true);
    const result = this.dryRun ? planned : await this.scaffold(plan, false);
    const packageManager = await detectPackageManager(this.cwd);
    const { install, command: installCommand } = await installDependencies({
      cwd: this.cwd,
      needed: result.depsAdded.length > 0,
      dryRun: this.dryRun,
      skipInstall: flags.skipInstall,
      env: this.env,
      json: this.isJson,
      task: (label, work, done) => {
        return this.ui.task(label, work, done);
      },
      failed: (error, command) => {
        return refusalError(
          INSTALL_REFUSAL,
          { command: command.display, cwd: this.cwd, message: String(error) },
          { install: this.shown(command, flags.cwd) },
        );
      },
    });

    const written = result.filesWritten.map((file) => {
      return relative(this.cwd, file).split(sep).join("/");
    });
    const suite = `${createOrca().displayName(framework)} test suite on ${TEST_KIT_PACKAGE}`;
    const title = this.dryRun
      ? `Would add a ${suite} (dry run)`
      : written.length === 0
        ? `The ${suite} is already in place`
        : `Added a ${suite}`;
    const ownScript = manifest.scripts[TEST_SCRIPT.name];
    const lines = [
      title,
      ...(written.length === 0
        ? []
        : [
            this.dryRun ? "Would write:" : "Wrote:",
            ...written.map((file) => {
              return `  ${file}`;
            }),
          ]),
      ...(ownScript === undefined || ownScript === TEST_SCRIPT.command
        ? []
        : [`Left the app's own ${TEST_SCRIPT.name} script as it is: ${String(ownScript)}`]),
      "Each run boots its own Zitadel server; the browser it drives is Chromium.",
    ];

    return this.emit({
      status: "ok",
      data: {
        title,
        ...(this.dryRun ? { dry_run: true } : {}),
        framework,
        files_written: written,
        install,
      },
      pretty: prose(lines.join("\n")),
      summary: {
        title: escapeControlCharacters(title),
        sections: [],
        lines: lines.slice(1).map((line) => {
          return escapeControlCharacters(line);
        }),
      },
      next: this.dryRun
        ? { commands: [await this.realRun()] }
        : {
            actions: this.nextActions(ownScript),
            commands: this.nextCommands(
              packageManager,
              install,
              installCommand,
              ownScript,
              flags.cwd,
            ),
          },
    });
  }

  /**
   * The framework `zitadel.json` records for the project.
   *
   * @throws The not-a-project refusal without `zitadel.json` or a framework in it.
   * @throws The framework refusal when the framework has no suite.
   */
  private async projectFramework(): Promise<string> {
    if (!(await hasZitadelConfig(this.cwd))) {
      throw refusalError(NOT_A_PROJECT_REFUSAL, {});
    }
    const framework = readFrameworkId(await readZitadelConfig(this.cwd));
    if (framework === undefined) {
      throw refusalError(NOT_A_PROJECT_REFUSAL, {});
    }
    if (!supportsTestSuite(framework)) {
      const orca = createOrca();
      throw refusalError(FRAMEWORK_REFUSAL, {
        framework,
        supported: TEST_SUITE_FRAMEWORKS.map((id) => {
          return orca.displayName(id);
        }).join(", "),
        frameworks: TEST_SUITE_FRAMEWORKS,
      });
    }
    return framework;
  }

  /**
   * Refuses an app with a Playwright config under another name than the
   * suite's; one under the suite's own name is the file writer's to compare.
   */
  private async refuseAnotherPlaywrightConfig(): Promise<void> {
    for (const config of PLAYWRIGHT_CONFIG_NAMES) {
      if (config !== PLAYWRIGHT_CONFIG && (await pathExists(join(this.cwd, config)))) {
        throw refusalError(PLAYWRIGHT_CONFIG_REFUSAL, { config });
      }
    }
  }

  /** The dependencies `package.json` declares, in any section, and its scripts. */
  private async manifest(): Promise<Manifest> {
    const manifest = await readPackageJson(this.cwd).catch(() => undefined);
    if (manifest === undefined) {
      throw refusalError(MANIFEST_REFUSAL, {});
    }
    return {
      dependencies: new Set(
        [manifest.dependencies, manifest.devDependencies].flatMap((section) => {
          return section === undefined ? [] : Object.keys(section);
        }),
      ),
      scripts: isObject(manifest.scripts) ? manifest.scripts : {},
    };
  }

  private scaffold(plan: ScaffoldPlan, dryRun: boolean): Promise<ScaffoldResult> {
    return new FileWriter({ cwd: this.cwd, dryRun, force: this.force }).scaffold(plan);
  }

  /**
   * The steps no suggested command may take: a package manager's suggestion
   * only installs, removes or runs a project's script, so installing
   * Playwright's browser, and running Playwright when the app's own
   * `test:e2e` runs something else, are said in prose, run in the app.
   */
  private nextActions(ownScript: unknown): string[] {
    return [
      `Install Playwright's Chromium once, in ${this.cwd}: npx playwright install chromium`,
      ...(runsTheSuite(ownScript)
        ? []
        : [
            `The app's own ${TEST_SCRIPT.name} script runs ${String(ownScript)}, so run the suite with Playwright in ${this.cwd}: npx playwright test`,
          ]),
    ];
  }

  /**
   * What the reader runs next, from the shell's directory, with the app's
   * package manager: the install when this run skipped it, then the suite,
   * through the project's script when that script is the suite's.
   */
  private nextCommands(
    packageManager: PackageManager,
    install: DependencyInstall,
    installCommand: PackageCommand,
    ownScript: unknown,
    cwdFlag: string | undefined,
  ): SuggestedCommand[] {
    return [
      ...(install.status === "skipped" ? [this.shown(installCommand, cwdFlag)] : []),
      ...(runsTheSuite(ownScript)
        ? [this.shown(runScriptCommandFor(packageManager, TEST_SCRIPT.name), cwdFlag)]
        : []),
    ];
  }

  /** A package manager command as the reader runs it, from the shell's directory. */
  private shown(command: PackageCommand, cwdFlag: string | undefined): SuggestedCommand {
    return suggestedCommandOf(inDirectory(command, cwdFlag, this.cwd));
  }
}

/** Whether the app's `test:e2e` runs the suite: absent, it is the one this command adds. */
function runsTheSuite(ownScript: unknown): boolean {
  return ownScript === undefined || ownScript === TEST_SCRIPT.command;
}
