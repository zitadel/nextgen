import { join, relative, sep } from "node:path";
import { Flags } from "@oclif/core";

import { pathExists } from "@/lib/fs";
import { isObject } from "@/lib/json";
import { log } from "@/lib/ui";
import { CommandGroups } from "@/cli/commands/groups";
import type { Admitted, CommandResult } from "@/cli/core";
import { dryRunResult } from "@/cli/core/crud/shared";
import { prose } from "@/lib/oclif/rendering";
import { type Refusal, refusalError } from "@/cli/core/refusal";
import { createOrca } from "@/lib/orca";
import { LocalRuntime } from "@/lib/server";
import { FileWriter } from "@/lib/orca/patchers/rule/file-writer";
import type { ScaffoldPlan, ScaffoldResult } from "@/lib/orca/patchers/rule/file-writer/types";
import { type PackageCommand, PM, PmCommandFailedError } from "@/lib/pm";
import { type SuggestedCommand, suggestedCommandOf } from "@/lib/suggestion";
import { escapeControlCharacters } from "@/lib/terminal-text";
import { Project } from "@/lib/project";
import { TestKit } from "@/lib/test-kit";
import { Previewable } from "@/cli/core/previewable";
import { BaseCommand } from "@/cli/core";
import { Telemetered } from "@/cli/telemetry/telemetered";

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
  hint: `With a second config, Playwright's lookup order would pick which one runs. Add withZitadel() from ${TestKit.PACKAGE}/playwright to {config} by hand: ${GUIDE_URL}`,
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
  details: {
    command: "{command}",
    cwd: "{cwd}",
    message: "{message}",
  },
} as const satisfies Refusal;

/** What the app's `package.json` declares, as far as the suite cares. */
type Manifest = Readonly<{
  dependencies: ReadonlySet<string>;
  scripts: Readonly<Record<string, unknown>>;
}>;

/** Whether the app's `test:e2e` runs the suite: absent, it is the one this command adds. */
function runsTheSuite(ownScript: unknown): boolean {
  return ownScript === undefined || ownScript === TestKit.SCRIPT.command;
}

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
export default class TestsAdd extends Telemetered(Previewable(BaseCommand)) {
  static override description =
    `Add end-to-end tests of the sign-in to this app.\n\nWrites playwright.config.mts, a test of the sign-in (e2e/sign-in.spec.ts) and a test that starts signed in (e2e/signed-in.spec.ts), wired to ${TestKit.PACKAGE}. Adds it and @playwright/test as dev dependencies, and a test:e2e script unless the app has one. Each test run boots its own Zitadel server and project. Supports Next.js apps. A file that differs from this CLI's version of it, including one an earlier CLI wrote, is refused unless --force replaces it.`;
  static override group = CommandGroups.gettingStarted;
  static override groupOrder = 5;

  static override examples = [
    "<%= config.bin %> tests add",
    "<%= config.bin %> tests add --skip-install",
  ];
  static override flags = {
    force: Flags.boolean({
      char: "f",
      description: "Replace a test file that differs from this CLI's version of it.",
    }),
    "skip-install": Flags.boolean({
      description: "Do not install the new dev dependencies.",
    }),
  };

  /**
   * Says which files the test suite would add, without writing any.
   *
   * @param input - The flags the command accepts.
   * @returns The envelope of the dry run.
   */
  protected async preview({ flags }: Admitted<typeof TestsAdd>): Promise<CommandResult> {
    const { framework, manifest, planned } = await this.planned();
    const packageManager = await PM.detect(this.cwd);
    const { install } = await packageManager.installDependencies(
      {
        needed: planned.depsAdded.length > 0,
        dryRun: true,
        skipInstall: flags.skipInstall,
      },
      {
        cwd: this.cwd,
        env: this.env,
        task: (label, work, done) => {
          return this.ui.task(label, work, done);
        },
        log,
      },
    );

    const written = planned.filesWritten.map((file) => {
      return relative(this.cwd, file).split(sep).join("/");
    });
    const suite = `${createOrca(LocalRuntime.DIR).displayName(framework)} test suite on ${TestKit.PACKAGE}`;
    const result = dryRunResult({
      verb: "add",
      topic: "tests",
      noun: `a ${suite}`,
      next: await this.realRun(),
    });
    const ownScript = manifest.scripts[TestKit.SCRIPT.name];
    const lines = [
      result.summary.title,
      ...(written.length === 0
        ? []
        : [
            "Would write:",
            ...written.map((file) => {
              return `  ${file}`;
            }),
          ]),
      ...(ownScript === undefined || ownScript === TestKit.SCRIPT.command
        ? []
        : [`Left the app's own ${TestKit.SCRIPT.name} script as it is: ${String(ownScript)}`]),
      "Each run boots its own Zitadel server; the browser it drives is Chromium.",
    ];

    return {
      ...result,
      data: {
        ...(result.data as object),
        framework,
        files_written: written,
        install,
      },
      pretty: prose(lines.join("\n")),
      summary: {
        ...result.summary,
        lines: lines.slice(1).map((line) => {
          return escapeControlCharacters(line);
        }),
      },
    };
  }

  /**
   * Writes the test suite and installs what it needs. The steps no suggested
   * command may take are said in prose, run in the app: a package manager's
   * suggestion only installs, removes or runs a project's script, so
   * installing Playwright's browser, and running Playwright when the app's own
   * `test:e2e` runs something else, are not commands. The commands are what the
   * reader runs next, from the shell's directory, with the app's package
   * manager: the install when this run skipped it, then the suite, through the
   * project's script when that script is the suite's.
   *
   * @param input - The flags the command accepts.
   * @returns The envelope of the run.
   */
  protected async apply({ flags }: Admitted<typeof TestsAdd>): Promise<CommandResult> {
    const { framework, manifest, plan } = await this.planned();
    const result = await new FileWriter({
      cwd: this.cwd,
      dryRun: false,
      force: this.force,
    }).scaffold(plan);
    const packageManager = await PM.detect(this.cwd);
    const { install, command: installCommand } = await packageManager
      .installDependencies(
        {
          needed: result.depsAdded.length > 0,
          dryRun: false,
          skipInstall: flags.skipInstall,
        },
        {
          cwd: this.cwd,
          env: this.env,
          task: (label, work, done) => {
            return this.ui.task(label, work, done);
          },
          log,
        },
      )
      .catch((error: unknown) => {
        if (!(error instanceof PmCommandFailedError)) {
          throw error;
        }
        throw refusalError(
          INSTALL_REFUSAL,
          {
            command: packageManager.install().display,
            cwd: this.cwd,
            message: String(error.cause ?? error),
          },
          {
            install: this.shown(packageManager.install(), flags.cwd),
          },
        );
      });

    const written = result.filesWritten.map((file) => {
      return relative(this.cwd, file).split(sep).join("/");
    });
    const suite = `${createOrca(LocalRuntime.DIR).displayName(framework)} test suite on ${TestKit.PACKAGE}`;
    const title = written.length === 0 ? `The ${suite} is already in place` : `Added a ${suite}`;
    const ownScript = manifest.scripts[TestKit.SCRIPT.name];
    const lines = [
      title,
      ...(written.length === 0
        ? []
        : [
            "Wrote:",
            ...written.map((file) => {
              return `  ${file}`;
            }),
          ]),
      ...(ownScript === undefined || ownScript === TestKit.SCRIPT.command
        ? []
        : [`Left the app's own ${TestKit.SCRIPT.name} script as it is: ${String(ownScript)}`]),
      "Each run boots its own Zitadel server; the browser it drives is Chromium.",
    ];

    return {
      status: "ok",
      data: {
        title,
        framework,
        files_written: written,
        install,
      },
      pretty: prose(lines.join("\n")),
      summary: {
        title,
        sections: [],
        lines: lines.slice(1).map((line) => {
          return escapeControlCharacters(line);
        }),
      },
      next: {
        actions: [
          `Install Playwright's Chromium once, in ${this.cwd}: npx playwright install chromium`,
          ...(runsTheSuite(ownScript)
            ? []
            : [
                `The app's own ${TestKit.SCRIPT.name} script runs ${String(ownScript)}, so run the suite with Playwright in ${this.cwd}: npx playwright test`,
              ]),
        ],
        commands: [
          ...(install.status === "skipped" ? [this.shown(installCommand, flags.cwd)] : []),
          ...(runsTheSuite(ownScript)
            ? [this.shown(packageManager.script(TestKit.SCRIPT.name), flags.cwd)]
            : []),
        ],
      },
    };
  }

  /**
   * Plans the test suite against the project: both runs judge the same plan,
   * so a conflict refuses either before a file is written.
   *
   * The framework is the one `zitadel.json` records for the project. An app with
   * a Playwright config under another name than the suite's is refused; one
   * under the suite's own name is the file writer's to compare. The manifest is
   * the dependencies `package.json` declares, in any section, and its scripts.
   *
   * @returns The project's framework and manifest, the plan, and what writing it would do.
   * @throws The not-a-project refusal without `zitadel.json` or a framework in it.
   * @throws The framework refusal when the framework has no suite.
   */
  private async planned(): Promise<{
    framework: string;
    manifest: Manifest;
    plan: ScaffoldPlan;
    planned: ScaffoldResult;
  }> {
    if (!(await Project.at(this.cwd).hasConfig())) {
      throw refusalError(NOT_A_PROJECT_REFUSAL, {});
    }
    const framework = (await Project.at(this.cwd).config()).frameworkId;
    if (framework === undefined) {
      throw refusalError(NOT_A_PROJECT_REFUSAL, {});
    }
    if (!new TestKit(framework).supported()) {
      const orca = createOrca(LocalRuntime.DIR);
      throw refusalError(FRAMEWORK_REFUSAL, {
        framework,
        supported: TestKit.FRAMEWORKS.map((id) => {
          return orca.displayName(id);
        }).join(", "),
        frameworks: TestKit.FRAMEWORKS,
      });
    }
    for (const config of TestKit.CONFIG_NAMES) {
      if (config !== TestKit.CONFIG && (await pathExists(join(this.cwd, config)))) {
        throw refusalError(PLAYWRIGHT_CONFIG_REFUSAL, { config });
      }
    }
    const packageJson = await PM.manifest(this.cwd).catch(() => undefined);
    if (packageJson === undefined) {
      throw refusalError(MANIFEST_REFUSAL, {});
    }
    const manifest: Manifest = {
      dependencies: new Set(
        [packageJson.dependencies, packageJson.devDependencies].flatMap((section) => {
          return section === undefined ? [] : Object.keys(section);
        }),
      ),
      scripts: isObject(packageJson.scripts) ? packageJson.scripts : {},
    };
    const plan = new TestKit(framework).plan({
      cliVersion: this.cliVersion,
      declared: manifest.dependencies,
      scripts: new Set(Object.keys(manifest.scripts)),
    });
    const planned = await new FileWriter({
      cwd: this.cwd,
      dryRun: true,
      force: this.force,
    }).scaffold(plan);

    return {
      framework,
      manifest,
      plan,
      planned,
    };
  }

  /** A package manager command as the reader runs it, from the shell's directory. */
  private shown(command: PackageCommand, cwdFlag: string | undefined): SuggestedCommand {
    return suggestedCommandOf(command.inDirectory(cwdFlag, this.cwd));
  }
}
