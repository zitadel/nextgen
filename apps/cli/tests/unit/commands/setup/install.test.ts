import { describe, expect, vi } from "vitest";

import { installDependenciesForSetup, type SetupInstallInput } from "@/commands/setup/install";
import type { BoxAction } from "@/lib/box";
import { ZitadelError } from "@/lib/errors";
import { installLogSink } from "@/lib/log";
import type { runPackageCommand } from "@/lib/package-manager";
import { it } from "@tests/helpers/fixtures";
import { writeJson } from "@tests/helpers/local-project";
import { aSuggest } from "@tests/helpers/suggestions";
import { rejectionOf } from "@tests/helpers/thrown-value";

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
 * A stand-in for the command's `this.ui.task`: it runs the work and remembers
 * the label it was given and the line the step settled on.
 *
 * @param steps - Where the labels are kept, in the order they were said.
 * @returns The task.
 */
function recordingTask(steps: string[]): SetupInstallInput["task"] {
  return async (label, work, done) => {
    steps.push(label);
    const result = await work();
    steps.push(done?.(result) ?? label);
    return result;
  };
}

/**
 * Setup's install input for CLI 1.2.3, having added the Next.js SDK to the
 * project in `cwd`, as a `--json` run reads it.
 *
 * @param overrides - What the input differs in from the default.
 * @returns The input.
 */
function anInstallInput(overrides: Partial<SetupInstallInput> = {}): SetupInstallInput {
  return {
    cwd: "",
    depsAdded: ["@zitadel/sdk-next"],
    dryRun: false,
    env: {},
    issuer: "http://localhost:3000",
    json: true,
    suggest: SUGGEST,
    scaffoldedFramework: false,
    skipInstall: false,
    task: recordingTask([]),
    ...overrides,
  };
}

/**
 * The box's actions as one text, each command after its prose.
 *
 * @param actions - The box's actions.
 * @returns The text.
 */
function textOf(actions: BoxAction[]): string {
  return actions
    .map((action) => {
      return [action.text, action.command].filter(Boolean).join(" ");
    })
    .join("\n");
}

describe("installDependenciesForSetup", () => {
  describe("when setup added a dependency", () => {
    it("reports the install as a step of the command's own chain", async ({ dir }) => {
      await aProject(dir);
      const steps: string[] = [];

      await installDependenciesForSetup(
        anInstallInput({ cwd: dir, run: aRunner(), task: recordingTask(steps) }),
      );

      expect(steps).toEqual(["Installing dependencies with npm install", "Installed dependencies"]);
    });

    it("reports no step when there is nothing to install", async ({ dir }) => {
      await aProject(dir);
      const steps: string[] = [];

      await installDependenciesForSetup(
        anInstallInput({
          cwd: dir,
          run: aRunner(),
          skipInstall: true,
          task: recordingTask(steps),
        }),
      );

      expect(steps).toEqual([]);
    });

    it("runs the install once", async ({ dir }) => {
      await aProject(dir);
      const run = aRunner();

      await installDependenciesForSetup(anInstallInput({ cwd: dir, run }));

      expect(run).toHaveBeenCalledOnce();
    });

    it("runs npm install", async ({ dir }) => {
      await aProject(dir);
      const run = aRunner();

      await installDependenciesForSetup(anInstallInput({ cwd: dir, run }));

      expect(run.mock.calls[0]?.[0]).toMatchObject({ display: "npm install" });
    });

    it("runs it in the project directory with its output on stderr", async ({ dir }) => {
      await aProject(dir);
      const run = aRunner();

      await installDependenciesForSetup(anInstallInput({ cwd: dir, run }));

      expect(run.mock.calls[0]?.[1]).toMatchObject({ cwd: dir, redirectStdoutToStderr: true });
    });

    it("reports the install completed", async ({ dir }) => {
      await aProject(dir);

      const result = await installDependenciesForSetup(
        anInstallInput({ cwd: dir, run: aRunner() }),
      );

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

      const result = await installDependenciesForSetup(
        anInstallInput({ cwd: dir, run: aRunner() }),
      );

      expect(result.nextActions.join("\n")).toContain(said);
    });

    it("does not send the reader to the issuer's root", async ({ dir }) => {
      await aProject(dir);

      const result = await installDependenciesForSetup(
        anInstallInput({ cwd: dir, run: aRunner() }),
      );

      expect(result.nextActions.join("\n")).not.toContain(
        "Start your project: npm run dev (then open http://localhost:3000)",
      );
    });

    it("suggests starting the project, then previewing a deploy", async ({ dir }) => {
      await aProject(dir);

      const result = await installDependenciesForSetup(
        anInstallInput({ cwd: dir, run: aRunner() }),
      );

      expect(result.nextCommands).toEqual(["npm run dev", PLAN_COMMAND, STATUS_COMMAND]);
    });
  });

  describe("when the box is staged to verifying the login", () => {
    it("ends the box on one breadcrumb to status", async ({ dir }) => {
      await aProject(dir);

      const result = await installDependenciesForSetup(
        anInstallInput({ cwd: dir, run: aRunner() }),
      );

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

        const result = await installDependenciesForSetup(
          anInstallInput({ cwd: dir, run: aRunner() }),
        );

        expect(textOf(result.boxActions)).toContain(said);
      },
    );

    it.for([".zitadel/schemas/", PLAN_COMMAND])(
      "leaves %s out of the box until login works",
      async (left, { dir }) => {
        await aProject(dir);

        const result = await installDependenciesForSetup(
          anInstallInput({ cwd: dir, run: aRunner() }),
        );

        expect(textOf(result.boxActions)).not.toContain(left);
      },
    );

    it("quotes the box's verify mission verbatim in the next actions", async ({ dir }) => {
      await aProject(dir);

      const result = await installDependenciesForSetup(
        anInstallInput({ cwd: dir, run: aRunner() }),
      );

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

      await installDependenciesForSetup(
        anInstallInput({ cwd: dir, depsAdded: [], scaffoldedFramework: true, run }),
      );

      expect(run.mock.calls[0]?.[0]).toMatchObject({ display: "pnpm install" });
    });

    it("suggests starting the project with pnpm", async ({ dir }) => {
      await aProject(dir, { packageManager: "pnpm@10.33.2" });

      const result = await installDependenciesForSetup(
        anInstallInput({ cwd: dir, depsAdded: [], scaffoldedFramework: true, run: aRunner() }),
      );

      expect(result.nextCommands).toEqual(["pnpm dev", PLAN_COMMAND, STATUS_COMMAND]);
    });
  });

  describe("when the install is skipped", () => {
    it.for(SKIPS)("does not install with %s", async ([, skip], { dir }) => {
      await aProject(dir);
      const run = aRunner();

      await installDependenciesForSetup(anInstallInput({ cwd: dir, run, ...skip }));

      expect(run).not.toHaveBeenCalled();
    });

    it.for(SKIPS)(
      "reports the install it left to the reader with %s",
      async ([, skip, reported], { dir }) => {
        await aProject(dir);

        const result = await installDependenciesForSetup(
          anInstallInput({ cwd: dir, run: aRunner(), ...skip }),
        );

        expect(result.install).toMatchObject(reported);
      },
    );

    it.for(SKIPS)("suggests installing first with %s", async ([, skip], { dir }) => {
      await aProject(dir);

      const result = await installDependenciesForSetup(
        anInstallInput({ cwd: dir, run: aRunner(), ...skip }),
      );

      expect(result.nextCommands).toEqual([
        "npm install",
        "npm run dev",
        PLAN_COMMAND,
        STATUS_COMMAND,
      ]);
    });

    it("keeps the install step first in the box", async ({ dir }) => {
      await aProject(dir);

      const result = await installDependenciesForSetup(
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

      const result = await installDependenciesForSetup(
        anInstallInput({ cwd: dir, run: aRunner(), skipInstall: true }),
      );

      expect(result.nextActions[0]).toBe("Install dependencies: npm install");
    });
  });

  describe("with --cwd", () => {
    it("names the directory in the suggested install and dev commands", async ({ dir }) => {
      await aProject(dir);

      const result = await installDependenciesForSetup(
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

      await installDependenciesForSetup(anInstallInput({ cwd: dir, cwdFlag: CWD_FLAG, run }));

      expect(run.mock.calls[0]?.[0]).toMatchObject({ display: "npm install" });
    });
  });

  describe("when no dependency changed", () => {
    it("does not install", async ({ dir }) => {
      await aProject(dir);
      const run = aRunner();

      await installDependenciesForSetup(anInstallInput({ cwd: dir, depsAdded: [], run }));

      expect(run).not.toHaveBeenCalled();
    });

    it("reports the install not needed", async ({ dir }) => {
      await aProject(dir);

      const result = await installDependenciesForSetup(
        anInstallInput({ cwd: dir, depsAdded: [], run: aRunner() }),
      );

      expect(result.install).toMatchObject({ status: "not-needed" });
    });

    it("suggests starting the project, then previewing a deploy", async ({ dir }) => {
      await aProject(dir);

      const result = await installDependenciesForSetup(
        anInstallInput({ cwd: dir, depsAdded: [], run: aRunner() }),
      );

      expect(result.nextCommands).toEqual(["npm run dev", PLAN_COMMAND, STATUS_COMMAND]);
    });
  });

  describe("when the install writes to the terminal itself", () => {
    // A spinner redrawing over the package manager's own output mixes the two,
    // and its raw mode keeps Ctrl-C from reaching the child.
    it("says a plain line first and runs no step around it", async ({ dir }) => {
      await aProject(dir);
      const steps: string[] = [];
      const said: string[] = [];
      const restore = installLogSink((level, text) => {
        said.push(`${level} ${text}`);
      });

      await installDependenciesForSetup(
        anInstallInput({ cwd: dir, json: false, run: aRunner(), task: recordingTask(steps) }),
      );
      restore();

      expect(steps).toEqual([]);
      expect(said).toEqual([
        "start Installing dependencies with npm install",
        "done Installed dependencies",
      ]);
    });
  });

  describe("when the install fails", () => {
    it("refuses, naming the install to rerun", async ({ dir }) => {
      await aProject(dir);

      const error = await rejectionOf(() => {
        return installDependenciesForSetup(anInstallInput({ cwd: dir, run: aFailingRunner() }));
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
