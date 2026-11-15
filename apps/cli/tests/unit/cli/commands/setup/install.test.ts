import { beforeEach, describe, expect, vi } from "vitest";

import type { SetupFlags } from "@/cli/commands/setup";
import { InstallDependencies } from "@/cli/commands/setup/steps/install-dependencies";
import type { BoxAction } from "@/lib/box";
import { ZitadelError } from "@/lib/errors";
import { installLogSink } from "@/lib/log";
import { createOrca } from "@/lib/orca";
import type { PackageCommand, runPackageCommand } from "@/lib/package-manager";
import type { Suggest } from "@/lib/suggestion";
import { Ui } from "@/lib/ui";
import { it } from "@tests/helpers/fixtures";
import { writeJson } from "@tests/helpers/local-project";
import { recordLog, type Said } from "@tests/helpers/log";
import { aSuggest } from "@tests/helpers/suggestions";
import { rejectionOf } from "@tests/helpers/thrown-value";
import { takeReportedWarnings } from "@/lib/warnings";

/**
 * The selector the follow-up commands carry, pinning the project setup created.
 */
const SELECTOR = " --env-file .env.development.local";

/**
 * Renders the follow-ups as setup's run does, pinned to the project setup created.
 */
const SUGGEST = aSuggest({ envFile: ".env.development.local" }, "1.2.3");

/**
 * The command that previews a deploy of the project setup created.
 */
const PLAN_COMMAND = `npx @zitadel/cli@1.2.3 deploy --dry-run${SELECTOR}`;

/**
 * The command the box points at for the next steps once login works.
 */
const STATUS_COMMAND = `npx @zitadel/cli@1.2.3 status${SELECTOR}`;

/**
 * The directory `--cwd` names, as typed.
 */
const CWD_FLAG = "shop";

/**
 * The ways setup leaves the install to the reader: the flag, the input that
 * sets it, and what the outcome reports: skipped with its reason, or, for a
 * dry run, the install it would run.
 */
const SKIPS = [
  ["--skip-install", { skipInstall: true }, { status: "skipped", reason: "skip-install" }],
  [
    "--dry-run",
    { dryRun: true },
    { status: "would-run", package_manager: "npm", command: "npm install" },
  ],
] as const;

/**
 * Writes a `package.json` for a project named `demo` into `dir`.
 *
 * @param dir - The project directory.
 * @param packageJson - What the manifest declares besides its name.
 * @returns Nothing; the file is written.
 */
async function aProject(dir: string, packageJson: Record<string, unknown> = {}): Promise<void> {
  await writeJson(dir, "package.json", { name: "demo", ...packageJson });
}

/**
 * A package-command runner that succeeds without running anything.
 *
 * @returns The runner, recording each call.
 */
function aRunner() {
  return vi.fn<typeof runPackageCommand>(async () => {
    return undefined;
  });
}

/**
 * A package-command runner whose command exits with code 1.
 *
 * @returns The runner, recording each call.
 */
function aFailingRunner() {
  return vi.fn<typeof runPackageCommand>(async () => {
    throw Object.assign(new Error("boom"), { code: 1 });
  });
}

/**
 * A package-command runner whose install succeeds and whose next command exits
 * with code 1, its captured output on the error as `runPackageCommand` puts it.
 *
 * @param output - What the failed command printed.
 * @returns The runner, recording each call.
 */
function aRunnerFailingAfterInstall(output = "") {
  return vi.fn<typeof runPackageCommand>(async (command) => {
    if (command.verb === "run") {
      throw Object.assign(new Error(`${command.display} failed with exit 1`), { output });
    }
  });
}

/**
 * A package-command runner whose install succeeds and whose next command is
 * stopped by Ctrl-C: the run's signal aborts, then the child dies of SIGINT.
 *
 * @param controller - The run's interrupt, aborted as Ctrl-C aborts it.
 * @returns The runner.
 */
function aRunnerInterruptedAfterInstall(controller: AbortController) {
  return vi.fn<typeof runPackageCommand>(async (command) => {
    if (command.verb === "run") {
      controller.abort(new ZitadelError("E_CANCELLED", "Cancelled"));
      throw new Error(`${command.display} failed with signal SIGINT`);
    }
  });
}

/**
 * The options the runner was given for the command shown as `display`.
 *
 * @param run - The runner.
 * @param display - The command, as it reads.
 * @returns The options, or `undefined` when it never ran.
 */
function optionsOf(run: ReturnType<typeof aRunner>, display: string) {
  return run.mock.calls.find(([command]: [PackageCommand, unknown]) => {
    return command.display === display;
  })?.[1];
}

/**
 * What the run is given besides the project's files.
 */
type InstallInput = Readonly<{
  cwd: string;
  cwdFlag?: string;
  depsAdded: ReadonlyArray<string>;
  dryRun: boolean;
  env: NodeJS.ProcessEnv;
  issuer: string;
  json: boolean;
  suggest: Suggest;
  scaffoldedFramework: boolean;
  framework: string;
  skipInstall: boolean;
  signal: AbortSignal;
  run?: typeof runPackageCommand;
}>;

/**
 * Setup's install input for CLI 1.2.3, having added the Next.js SDK to the
 * project in `cwd`, as a `--json` run reads it.
 *
 * @param overrides - What the input differs in from the default.
 * @returns The input.
 */
function anInstallInput(overrides: Partial<InstallInput> = {}): InstallInput {
  return {
    cwd: "",
    depsAdded: ["@zitadel/sdk-next"],
    dryRun: false,
    env: {},
    issuer: "http://localhost:3000",
    json: true,
    suggest: SUGGEST,
    scaffoldedFramework: false,
    framework: "next",
    skipInstall: false,
    signal: new AbortController().signal,
    ...overrides,
  };
}

/**
 * Runs setup's install step for `input`.
 *
 * @param input - What the run knows and how it is run.
 * @returns What installing did, and what the reader runs next.
 */
async function installWith(input: InstallInput) {
  const { installOutcome } = await new InstallDependencies({
    cwd: input.cwd,
    dryRun: input.dryRun,
    env: input.env,
    isJson: input.json,
    signal: input.signal,
    suggest: input.suggest,
    ui: new Ui({ interactive: false, force: false }),
    ...(input.run === undefined ? {} : { run: input.run }),
  }).run({
    flags: {
      ...(input.cwdFlag === undefined ? {} : { cwd: input.cwdFlag }),
      skipInstall: input.skipInstall,
    } as SetupFlags,
    orca: createOrca(),
    app: { framework: input.framework, devPort: 3000 },
    patched: {
      dryRun: input.dryRun,
      files: [],
      filesWritten: [],
      filesSkipped: [],
      depsAdded: input.depsAdded,
    },
    scaffoldedFramework: input.scaffoldedFramework,
    issuer: input.issuer,
  });
  return installOutcome;
}

/**
 * The steps a run narrated: what it began and how it ended, in order.
 *
 * @param said - Everything the run said.
 * @returns The lines that open and close a step.
 */
function stepsOf(said: ReadonlyArray<Said>): string[] {
  return said
    .filter(({ level }) => {
      return level === "start" || level === "done";
    })
    .map(({ text }) => {
      return text;
    });
}

beforeEach(({ onTestFinished }) => {
  onTestFinished(installLogSink(() => {}));
});

/**
 * The box's actions as one text, each command after its prose.
 *
 * @param actions - The box's actions.
 * @returns The text.
 */
function textOf(actions: ReadonlyArray<BoxAction>): string {
  return actions
    .map((action) => {
      return [action.text, action.command].filter(Boolean).join(" ");
    })
    .join("\n");
}

describe("InstallDependencies", () => {
  describe("when setup added a dependency", () => {
    it("reports the install as a step of the command's own chain", async ({ dir }) => {
      await aProject(dir);
      const log = recordLog();

      await installWith(anInstallInput({ cwd: dir, run: aRunner() }));
      log.stop();

      expect(stepsOf(log.said)).toEqual([
        "Installing dependencies with npm install",
        "Installed dependencies",
      ]);
    });

    it("reports no step when there is nothing to install", async ({ dir }) => {
      await aProject(dir);
      const log = recordLog();

      await installWith(anInstallInput({ cwd: dir, run: aRunner(), skipInstall: true }));
      log.stop();

      expect(stepsOf(log.said)).toEqual([]);
    });

    it("runs the install once", async ({ dir }) => {
      await aProject(dir);
      const run = aRunner();

      await installWith(anInstallInput({ cwd: dir, run }));

      expect(run).toHaveBeenCalledOnce();
    });

    it("runs npm install", async ({ dir }) => {
      await aProject(dir);
      const run = aRunner();

      await installWith(anInstallInput({ cwd: dir, run }));

      expect(run.mock.calls[0]?.[0]).toMatchObject({ display: "npm install" });
    });

    it("runs it in the project directory with its output on stderr", async ({ dir }) => {
      await aProject(dir);
      const run = aRunner();

      await installWith(anInstallInput({ cwd: dir, run }));

      expect(run.mock.calls[0]?.[1]).toMatchObject({ cwd: dir, redirectStdoutToStderr: true });
    });

    it("reports the install completed", async ({ dir }) => {
      await aProject(dir);

      const result = await installWith(anInstallInput({ cwd: dir, run: aRunner() }));

      expect(result.install).toMatchObject({
        status: "completed",
        package_manager: "npm",
        command: "npm install",
      });
    });

    it.for([
      "Start your project: npm run dev (then open http://localhost:3000/register)",
      "register a user",
      "sign in again",
      ".zitadel/schemas/",
      ".zitadel/flows/",
      `See your changes before they go live: ${PLAN_COMMAND} to preview, then npx @zitadel/cli@1.2.3 deploy --message '<what changed>'${SELECTOR} to publish.`,
    ])("says %s in the next actions", async (said, { dir }) => {
      await aProject(dir);

      const result = await installWith(anInstallInput({ cwd: dir, run: aRunner() }));

      expect(result.nextActions.join("\n")).toContain(said);
    });

    it("does not send the reader to the issuer's root", async ({ dir }) => {
      await aProject(dir);

      const result = await installWith(anInstallInput({ cwd: dir, run: aRunner() }));

      expect(result.nextActions.join("\n")).not.toContain(
        "Start your project: npm run dev (then open http://localhost:3000)",
      );
    });

    it("suggests starting the project, then previewing a deploy", async ({ dir }) => {
      await aProject(dir);

      const result = await installWith(anInstallInput({ cwd: dir, run: aRunner() }));

      expect(result.nextCommands).toEqual(["npm run dev", PLAN_COMMAND, STATUS_COMMAND]);
    });
  });

  describe("when the box is staged to verifying the login", () => {
    it("ends the box on one breadcrumb to status", async ({ dir }) => {
      await aProject(dir);

      const result = await installWith(anInstallInput({ cwd: dir, run: aRunner() }));

      // One sentence per fact: the step that introduces a command says when to
      // run it, and where customizing is written up is a sentence of its own
      // rather than a parenthesis inside that one.
      expect(result.boxActions.at(-2)).toEqual({
        text: "Once login works, this shows your next steps:",
        command: `npx @zitadel/cli@1.2.3 status${SELECTOR}`,
      });
      expect(result.boxActions.at(-1)).toEqual({
        text: "Customizing the login is covered in your README's Zitadel section.",
      });
    });

    it.for(["register a user", "Open a second terminal in this directory"])(
      "says %s in the box",
      async (said, { dir }) => {
        await aProject(dir);

        const result = await installWith(anInstallInput({ cwd: dir, run: aRunner() }));

        expect(textOf(result.boxActions)).toContain(said);
      },
    );

    it.for([".zitadel/schemas/", PLAN_COMMAND])(
      "leaves %s out of the box until login works",
      async (left, { dir }) => {
        await aProject(dir);

        const result = await installWith(anInstallInput({ cwd: dir, run: aRunner() }));

        expect(textOf(result.boxActions)).not.toContain(left);
      },
    );

    it("quotes the box's verify mission verbatim in the next actions", async ({ dir }) => {
      await aProject(dir);

      const result = await installWith(anInstallInput({ cwd: dir, run: aRunner() }));

      expect(result.nextActions).toContain(
        result.boxActions.find((action) => {
          return !action.command;
        })?.text,
      );
    });
  });

  describe("when setup scaffolded a fresh app that pins pnpm", () => {
    it("installs though no Zitadel dependency changed", async ({ dir }) => {
      await aProject(dir, { packageManager: "pnpm@10.33.2" });
      const run = aRunner();

      await installWith(
        anInstallInput({ cwd: dir, depsAdded: [], scaffoldedFramework: true, run }),
      );

      expect(run.mock.calls[0]?.[0]).toMatchObject({ display: "pnpm install" });
    });

    it("suggests starting the project with pnpm", async ({ dir }) => {
      await aProject(dir, { packageManager: "pnpm@10.33.2" });

      const result = await installWith(
        anInstallInput({ cwd: dir, depsAdded: [], scaffoldedFramework: true, run: aRunner() }),
      );

      expect(result.nextCommands).toEqual(["pnpm dev", PLAN_COMMAND, STATUS_COMMAND]);
    });
  });

  describe("when the install is skipped", () => {
    it.for(SKIPS)("does not install with %s", async ([, skip], { dir }) => {
      await aProject(dir);
      const run = aRunner();

      await installWith(anInstallInput({ cwd: dir, run, ...skip }));

      expect(run).not.toHaveBeenCalled();
    });

    it.for(SKIPS)(
      "reports the install it left to the reader with %s",
      async ([, skip, reported], { dir }) => {
        await aProject(dir);

        const result = await installWith(anInstallInput({ cwd: dir, run: aRunner(), ...skip }));

        expect(result.install).toMatchObject(reported);
      },
    );

    it.for(SKIPS)("suggests installing first with %s", async ([, skip], { dir }) => {
      await aProject(dir);

      const result = await installWith(anInstallInput({ cwd: dir, run: aRunner(), ...skip }));

      expect(result.nextCommands).toEqual([
        "npm install",
        "npm run dev",
        PLAN_COMMAND,
        STATUS_COMMAND,
      ]);
    });

    it("keeps the install step first in the box", async ({ dir }) => {
      await aProject(dir);

      const result = await installWith(
        anInstallInput({ cwd: dir, run: aRunner(), skipInstall: true }),
      );

      // A sentence, not a second label: it says why the step is there at all,
      // which `Next:` — the one label — cannot.
      expect(result.boxActions[0]).toEqual({
        text: "Setup did not install the new dependencies, so install them first:",
        command: "npm install",
      });
    });

    it("keeps the install step first in the next actions", async ({ dir }) => {
      await aProject(dir);

      const result = await installWith(
        anInstallInput({ cwd: dir, run: aRunner(), skipInstall: true }),
      );

      expect(result.nextActions[0]).toBe("Install dependencies: npm install");
    });
  });

  describe("with --cwd", () => {
    it("names the directory in the suggested install and dev commands", async ({ dir }) => {
      await aProject(dir);

      const result = await installWith(
        anInstallInput({ cwd: dir, cwdFlag: CWD_FLAG, run: aRunner(), skipInstall: true }),
      );

      expect(result.nextCommands.slice(0, 2)).toEqual([
        "npm --prefix shop install",
        "npm --prefix shop run dev",
      ]);
    });

    it("runs the install itself in the project directory, as typed nowhere", async ({ dir }) => {
      await aProject(dir);
      const run = aRunner();

      await installWith(anInstallInput({ cwd: dir, cwdFlag: CWD_FLAG, run }));

      expect(run.mock.calls[0]?.[0]).toMatchObject({ display: "npm install" });
    });
  });

  describe("when no dependency changed", () => {
    it("does not install", async ({ dir }) => {
      await aProject(dir);
      const run = aRunner();

      await installWith(anInstallInput({ cwd: dir, depsAdded: [], run }));

      expect(run).not.toHaveBeenCalled();
    });

    it("reports the install not needed", async ({ dir }) => {
      await aProject(dir);

      const result = await installWith(anInstallInput({ cwd: dir, depsAdded: [], run: aRunner() }));

      expect(result.install).toMatchObject({ status: "not-needed" });
    });

    it("suggests starting the project, then previewing a deploy", async ({ dir }) => {
      await aProject(dir);

      const result = await installWith(anInstallInput({ cwd: dir, depsAdded: [], run: aRunner() }));

      expect(result.nextCommands).toEqual(["npm run dev", PLAN_COMMAND, STATUS_COMMAND]);
    });
  });

  describe("when the install writes to the terminal itself", () => {
    // A spinner redrawing over the package manager's own output mixes the two,
    // and its raw mode keeps Ctrl-C from reaching the child.
    it("says a plain line first and runs no step around it", async ({ dir }) => {
      await aProject(dir);
      const log = recordLog();

      await installWith(anInstallInput({ cwd: dir, json: false, run: aRunner() }));
      log.stop();

      expect(log.said).toEqual([
        { level: "start", text: "Installing dependencies with npm install" },
        { level: "done", text: "Installed dependencies" },
      ]);
    });
  });

  describe("when the new app has an after-install script", () => {
    /** The input for a new app whose scaffolder names `generate-routes`. */
    function aNewAppInput(dir: string, overrides: Partial<InstallInput> = {}) {
      return anInstallInput({
        cwd: dir,
        scaffoldedFramework: true,
        framework: "tanstack-start",
        ...overrides,
      });
    }

    it("runs it after the install, with the project's package manager", async ({ dir }) => {
      await aProject(dir, { packageManager: "pnpm@10.33.2" });
      const run = aRunner();

      await installWith(aNewAppInput(dir, { run }));

      expect(
        run.mock.calls.map(([command]) => {
          return command.display;
        }),
      ).toEqual(["pnpm install", "pnpm run generate-routes"]);
    });

    it("runs it in the project directory with its output kept back", async ({ dir }) => {
      await aProject(dir);
      const run = aRunner();

      await installWith(aNewAppInput(dir, { run }));

      expect(optionsOf(run, "npm run generate-routes")).toMatchObject({
        cwd: dir,
        captureOutput: true,
      });
    });

    it("reports it as a step of the command's own chain", async ({ dir }) => {
      await aProject(dir);
      const log = recordLog();

      await installWith(aNewAppInput(dir, { run: aRunner() }));
      log.stop();

      expect(stepsOf(log.said).slice(2)).toEqual([
        "Running npm run generate-routes",
        "Ran npm run generate-routes",
      ]);
    });

    // Its output is kept back, so a spinner draws over nothing, unlike the
    // install's, which writes to the terminal itself.
    it("reports it as a step without --json too", async ({ dir }) => {
      await aProject(dir);
      const log = recordLog();

      await installWith(aNewAppInput(dir, { json: false, run: aRunner() }));
      log.stop();

      expect(stepsOf(log.said).slice(2)).toEqual([
        "Running npm run generate-routes",
        "Ran npm run generate-routes",
      ]);
    });

    it.for(SKIPS)("does not run it with %s", async ([, skip], { dir }) => {
      await aProject(dir);
      const run = aRunner();

      await installWith(aNewAppInput(dir, { run, ...skip }));

      expect(run).not.toHaveBeenCalled();
    });

    it("still reports the install completed when it fails", async ({ dir }) => {
      await aProject(dir);

      const result = await installWith(aNewAppInput(dir, { run: aRunnerFailingAfterInstall() }));
      takeReportedWarnings();

      expect(result.install).toMatchObject({ status: "completed" });
    });

    it("warns, naming the script to rerun, when it fails", async ({ dir }) => {
      await aProject(dir);
      takeReportedWarnings();

      await installWith(aNewAppInput(dir, { run: aRunnerFailingAfterInstall() }));

      expect(takeReportedWarnings()).toEqual([
        "npm run generate-routes failed after the install, so setup's commit may leave out the files it writes; run it, then commit them: npm run generate-routes failed with exit 1",
      ]);
    });

    it("names the directory in the script to rerun with --cwd", async ({ dir }) => {
      await aProject(dir);
      takeReportedWarnings();

      await installWith(
        aNewAppInput(dir, { cwdFlag: CWD_FLAG, run: aRunnerFailingAfterInstall() }),
      );

      expect(takeReportedWarnings()[0]).toMatch(/^npm --prefix shop run generate-routes failed/);
    });

    it("quotes the last lines of its output when it fails", async ({ dir }) => {
      await aProject(dir);
      takeReportedWarnings();
      const output = Array.from({ length: 30 }, (_, line) => {
        return `line ${String(line + 1)}`;
      }).join("\n");

      await installWith(aNewAppInput(dir, { run: aRunnerFailingAfterInstall(`${output}\n`) }));

      expect(takeReportedWarnings()[0]?.split("\n").slice(1)).toEqual(
        output.split("\n").slice(-20),
      );
    });

    // Setup awaits this before its commit and deploy, so the rejection is
    // what keeps a Ctrl-C from committing.
    it("stops setup with the cancellation when Ctrl-C stops it", async ({ dir }) => {
      await aProject(dir);
      takeReportedWarnings();
      const controller = new AbortController();

      const error = await rejectionOf(() => {
        return installWith(
          aNewAppInput(dir, {
            run: aRunnerInterruptedAfterInstall(controller),
            signal: controller.signal,
          }),
        );
      });

      expect(error).toMatchObject({ code: "E_CANCELLED" });
      expect(takeReportedWarnings()).toEqual([]);
    });
  });

  describe("which after-install script it runs", () => {
    it("names the scaffolder's script for an app setup scaffolded", async ({ dir }) => {
      await aProject(dir);
      const run = aRunner();

      await installWith(
        anInstallInput({ cwd: dir, framework: "tanstack-start", scaffoldedFramework: true, run }),
      );

      expect(
        run.mock.calls.map(([command]) => {
          return command.display;
        }),
      ).toEqual(["npm install", "npm run generate-routes"]);
    });

    it("names none for an app that was already there", async ({ dir }) => {
      await aProject(dir);
      const run = aRunner();

      await installWith(
        anInstallInput({ cwd: dir, framework: "tanstack-start", scaffoldedFramework: false, run }),
      );

      expect(
        run.mock.calls.map(([command]) => {
          return command.display;
        }),
      ).toEqual(["npm install"]);
    });

    it("names none for a scaffolder without one", async ({ dir }) => {
      await aProject(dir);
      const run = aRunner();

      await installWith(
        anInstallInput({ cwd: dir, framework: "next", scaffoldedFramework: true, run }),
      );

      expect(
        run.mock.calls.map(([command]) => {
          return command.display;
        }),
      ).toEqual(["npm install"]);
    });
  });

  describe("when the install fails", () => {
    it("refuses, naming the install to rerun", async ({ dir }) => {
      await aProject(dir);

      const error = await rejectionOf(() => {
        return installWith(anInstallInput({ cwd: dir, run: aFailingRunner() }));
      });

      expect(error).toBeInstanceOf(ZitadelError);
      expect(error).toMatchObject({
        code: "E_VALIDATION",
        message: "Dependency install failed: npm install",
        nextCommands: ["npm install"],
      });
    });
  });
});
