import { join, relative, sep } from "node:path";
import { Flags } from "@oclif/core";

import { pathExists } from "@/lib/fs";
import { isObject } from "@/lib/json";
import { log } from "@/lib/log";
import { readPackageJson } from "@/lib/npm";
import { type Admitted, BaseCommand, CommandGroups, type JsonEnvelope } from "@/lib/oclif";
import { prose } from "@/lib/oclif/rendering";
import { type Refusal, refusalError } from "@/lib/oclif/refusal";
import { FileWriter } from "@/lib/orca/patchers/rule/file-writer";
import type { ScaffoldPlan, ScaffoldResult } from "@/lib/orca/patchers/rule/file-writer/types";
import {
  detectPackageManager,
  execCommandFor,
  inDirectory,
  installCommandFor,
  type PackageCommand,
  type PackageManager,
  runPackageCommand,
  runScriptCommandFor,
} from "@/lib/package-manager";
import { hasZitadelConfig } from "@/lib/project";
import { shellCommand, type SuggestedCommand } from "@/lib/suggestion";
import { readState } from "@/lib/sync/state";
import { escapeControlCharacters } from "@/lib/terminal-text";
import {
  frameworkName,
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
const NOT_A_PROJECT_REFUSAL: Refusal = {
  message: "This directory is not a Zitadel project",
  hint: "Run setup first; the test suite runs against the app it wires up.",
  next: [{ id: "setup" }],
};

/** How a project whose framework has no suite yet is refused. */
const FRAMEWORK_REFUSAL: Refusal = {
  message: "tests add does not support {framework} apps yet",
  hint: `It writes a suite for: {supported}. For another framework, configure ${TEST_KIT_PACKAGE} by hand: ${GUIDE_URL}#other-frameworks`,
  details: { framework: "{framework}", frameworks: "{frameworks}" },
};

/** How an app that already runs Playwright from another config is refused. */
const PLAYWRIGHT_CONFIG_REFUSAL: Refusal = {
  code: "E_CONFLICT",
  message: "This app already has a Playwright config, {config}",
  hint: `Playwright would run it instead of the suite's. Add withZitadel() from ${TEST_KIT_PACKAGE}/playwright to it by hand: ${GUIDE_URL}`,
  details: { path: "{config}" },
};

/** How a directory without a `package.json` is refused. */
const MANIFEST_REFUSAL: Refusal = {
  message: "package.json is required to add the test suite",
  hint: "Run tests add in the app's own directory, where setup ran.",
};

/** How a failed install is refused; the files are written by then. */
const INSTALL_REFUSAL: Refusal = {
  message: "Dependency install failed: {command}",
  hint: "The test files are written. Run {command} in {cwd} to install their dependencies.",
  next: ["{install}"],
  details: { command: "{command}", cwd: "{cwd}", message: "{message}" },
};

/** What the app's `package.json` declares, as far as the suite cares. */
type Manifest = Readonly<{
  dependencies: ReadonlySet<string>;
  scripts: Readonly<Record<string, unknown>>;
}>;

/** The script that runs the suite, and whether this run added it. */
type TestScript = {
  name: string;
  command: string;
  status: "added" | "would-add" | "exists";
};

/** What the dependency install did. */
type TestsInstall = {
  status: "completed" | "would-run" | "skipped";
  package_manager: PackageManager;
  command: string;
};

/**
 * `zitadel tests add` — add a first end-to-end test to an app setup wired up.
 *
 * Writes a Playwright config on `@zitadel/testing`, which boots a Zitadel
 * server of its own for every run, a test that signs a seeded user in, a test
 * that starts signed in, and a `test:e2e` script that runs them.
 * Nothing else adds them: `setup` installs no test tooling. Files that already
 * hold something else are refused unless `--force` is given; a rerun that
 * finds its own files writes nothing.
 */
export default class TestsAdd extends BaseCommand {
  static override description =
    `Add a first end-to-end test of the sign-in to this app.\n\nWrites playwright.config.mts, a test of the sign-in (e2e/sign-in.spec.ts) and a test that starts signed in (e2e/signed-in.spec.ts), wired to ${TEST_KIT_PACKAGE}. Adds it and @playwright/test as dev dependencies, and a test:e2e script unless the app has one. Each test run boots its own Zitadel server and project, so the test never touches the project setup created. Supports Next.js apps.`;
  static override group = CommandGroups.localDevelopment;

  static override flags = {
    force: Flags.boolean({
      char: "f",
      description: "Overwrite a test file that holds something else.",
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
      kitVersion: this.cliVersion,
      declared: manifest.dependencies,
      scripts: new Set(Object.keys(manifest.scripts)),
    });
    const packageManager = await detectPackageManager(this.cwd);

    // A dry run first, so a conflict refuses the run before any file is written.
    const planned = await this.scaffold(plan, true);
    const result = this.dryRun ? planned : await this.scaffold(plan, false);
    const install = await this.install(result, packageManager, flags.skipInstall, flags.cwd);
    const script = this.testScript(manifest);

    const written = result.filesWritten.map((file) => {
      return relative(this.cwd, file).split(sep).join("/");
    });
    const suite = `${frameworkName(framework)} test suite on ${TEST_KIT_PACKAGE}`;
    const title = this.dryRun
      ? `Would add a ${suite} (dry run)`
      : written.length === 0
        ? `The ${suite} is already in place`
        : `Added a ${suite}`;
    const next = this.nextCommands(packageManager, install, script, flags.cwd);
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
      ...(install === undefined ? [] : [`Dependencies: ${installLine(install)}`]),
      ...scriptLines(script),
      "Each run boots its own Zitadel server; the browser it drives is Chromium.",
    ];

    return this.emit({
      status: "ok",
      data: {
        title,
        ...(this.dryRun ? { dry_run: true } : {}),
        framework,
        files_written: written,
        dependencies_added: result.depsAdded,
        test_script: script,
        install: install ?? null,
      },
      pretty: prose(lines.join("\n")),
      summary: {
        title: escapeControlCharacters(title),
        sections: [],
        lines: lines.slice(1).map((line) => {
          return escapeControlCharacters(line);
        }),
      },
      next: { commands: this.dryRun ? [await this.realRun()] : next },
    });
  }

  /**
   * The framework setup recorded for the project.
   *
   * @throws The not-a-project refusal without `zitadel.json` or its state.
   * @throws The framework refusal when the framework has no suite.
   */
  private async projectFramework(): Promise<string> {
    if (!(await hasZitadelConfig(this.cwd))) {
      throw refusalError(NOT_A_PROJECT_REFUSAL, {});
    }
    const framework = await readState(this.cwd).then(
      (state) => (typeof state.framework === "string" ? state.framework : undefined),
      () => undefined,
    );
    if (framework === undefined) {
      throw refusalError(NOT_A_PROJECT_REFUSAL, {});
    }
    if (!supportsTestSuite(framework)) {
      throw refusalError(FRAMEWORK_REFUSAL, {
        framework,
        supported: TEST_SUITE_FRAMEWORKS.map(frameworkName).join(", "),
        frameworks: TEST_SUITE_FRAMEWORKS,
      });
    }
    return framework;
  }

  /**
   * Refuses an app with a Playwright config under another name than the
   * suite's, which Playwright would pick instead; one under the suite's own
   * name is the file writer's to compare.
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

  /**
   * The script that runs the suite: the one this run adds, or the one of that
   * name the app already had, which it leaves as it is.
   */
  private testScript(manifest: Manifest): TestScript {
    const existing = manifest.scripts[TEST_SCRIPT.name];
    if (existing !== undefined) {
      return { name: TEST_SCRIPT.name, command: String(existing), status: "exists" };
    }
    return {
      name: TEST_SCRIPT.name,
      command: TEST_SCRIPT.command,
      status: this.dryRun ? "would-add" : "added",
    };
  }

  private scaffold(plan: ScaffoldPlan, dryRun: boolean): Promise<ScaffoldResult> {
    return new FileWriter({ cwd: this.cwd, dryRun, force: this.force }).scaffold(plan);
  }

  /**
   * Installs the dev dependencies the run added, with the package manager the
   * app uses. A run that added none installs nothing.
   */
  private async install(
    result: ScaffoldResult,
    packageManager: PackageManager,
    skip: boolean,
    cwdFlag: string | undefined,
  ): Promise<TestsInstall | undefined> {
    if (result.depsAdded.length === 0) {
      return undefined;
    }
    const command = installCommandFor(packageManager);
    const shown = inDirectory(command, cwdFlag, this.cwd).display;
    if (this.dryRun || skip) {
      return {
        status: this.dryRun ? "would-run" : "skipped",
        package_manager: packageManager,
        command: shown,
      };
    }
    log.start(`Installing the test dependencies with ${command.display}`);
    try {
      await runPackageCommand(command, {
        cwd: this.cwd,
        env: this.env,
        redirectStdoutToStderr: true,
      });
    } catch (error) {
      throw refusalError(
        INSTALL_REFUSAL,
        { command: command.display, cwd: this.cwd, message: String(error) },
        { install: shellCommand(shown) },
      );
    }
    log.done("Installed the test dependencies");
    return { status: "completed", package_manager: packageManager, command: shown };
  }

  /**
   * What the reader runs next, from the shell's directory, with the app's
   * package manager: the install when this run skipped it, Playwright's
   * browser, then the suite, through the project's script when it is the
   * suite's.
   */
  private nextCommands(
    packageManager: PackageManager,
    install: TestsInstall | undefined,
    script: TestScript,
    cwdFlag: string | undefined,
  ): SuggestedCommand[] {
    const shown = (command: PackageCommand) => {
      return shellCommand(inDirectory(command, cwdFlag, this.cwd).display);
    };
    const runsTheSuite = script.status !== "exists" || script.command === TEST_SCRIPT.command;
    return [
      ...(install?.status === "skipped" ? [shellCommand(install.command)] : []),
      shown(execCommandFor(packageManager, "playwright", ["install", "chromium"])),
      shown(
        runsTheSuite
          ? runScriptCommandFor(packageManager, script.name)
          : execCommandFor(packageManager, "playwright", ["test"]),
      ),
    ];
  }
}

function scriptLines(script: TestScript): string[] {
  switch (script.status) {
    case "added":
      return [`Added the ${script.name} script: ${script.command}`];
    case "would-add":
      return [`Would add the ${script.name} script: ${script.command}`];
    case "exists":
      return script.command === TEST_SCRIPT.command
        ? []
        : [`Left the existing ${script.name} script as it is: ${script.command}`];
  }
}

function installLine(install: TestsInstall): string {
  switch (install.status) {
    case "completed":
      return `installed with ${install.command}`;
    case "would-run":
      return `would install with ${install.command}`;
    case "skipped":
      return `not installed (--skip-install)`;
  }
}
