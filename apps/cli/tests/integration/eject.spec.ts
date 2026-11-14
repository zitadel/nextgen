import { describe, expect, it } from "vitest";

import { usePlatformMock } from "@tests/helpers/platform";
import { anApp, type ScaffoldedApp } from "@tests/helpers/project";
import { cliVersion, expectedPublicCliCommand } from "@tests/helpers/run-cli";

const platform = usePlatformMock();

/**
 * What eject takes out of a Next 15 app setup patched, the developer's own
 * files aside.
 */
const REMOVED = [
  "app/login/page.tsx",
  "app/register/page.tsx",
  "app/profile/page.tsx",
  "middleware.ts",
  "custom-elements.d.ts",
  "zitadel.json",
  ".zitadel",
  "AGENTS.md",
  "README.md (managed section)",
];

/**
 * The two env files eject moves aside, as it names them.
 */
const BACKED_UP = [
  expect.stringMatching(/^\.env\.local -> \.env\.local\.ejected-[\dTZ-]+$/),
  expect.stringMatching(
    /^\.env\.development\.local -> \.env\.development\.local\.ejected-[\dTZ-]+$/,
  ),
];

/**
 * The step eject leaves to the developer, since it edits no `package.json`.
 */
const MANUAL_STEP =
  'Restore the scripts in package.json: setup added the "dev" script or pinned its dev-server port, and an Angular app\'s scripts run "node zitadel-ng.cjs" where they ran "ng"';

/**
 * The steps eject leaves to the developer.
 */
const MANUAL_STEPS = [MANUAL_STEP];

/**
 * The headline of an ejection.
 */
const REMOVED_TITLE = "Removed Zitadel from this app, leaving the remote project untouched";

/**
 * The headline of an ejection previewed.
 */
const WOULD_REMOVE_TITLE =
  "Would remove Zitadel from this app, leaving the remote project untouched (dry run)";

/**
 * A page the developer wrote where setup would have put its own.
 */
const OWN_PAGE = "export default function Page() { return null; }\n";

/** A Next 15 app through setup, carrying a README the developer wrote. */
async function aPatchedApp(): Promise<ScaffoldedApp> {
  const app = await anApp({ nextVersion: "^15.0.0" });
  await app.writeProjectFile("README.md", "# demo-next-app\n\nDeploy notes.\n");
  expect(await app.setup()).toSucceed();
  return app;
}

/** A project's declared package manager that is not npm. */
const PNPM = "pnpm@10.0.0";

describe("eject", () => {
  describe("against an invalid server", () => {
    describe("that is not a zitadel api", () => {
      it("still succeeds", async () => {
        const app = await aPatchedApp();
        platform.isNotZitadel();

        const result = await app.run(["eject", "--force", "--json"]);

        expect(app.envelopeOf(result)).toEqual({
          cli_version: cliVersion.version,
          command: "eject",
          source: "",
          status: "ok",
          data: {
            title: REMOVED_TITLE,
            files_removed: REMOVED,
            files_preserved: [],
            backed_up: BACKED_UP,
            manual_steps: MANUAL_STEPS,
            next_commands: [
              `cd ${app.path} && rm -f .env.local.ejected-* .env.development.local.ejected-*`,
              `cd ${app.path} && npm uninstall @zitadel/sdk-next`,
            ],
          },
          warnings: [],
        });
      });
    });

    describe("that is down", () => {
      it("still succeeds", async () => {
        const app = await aPatchedApp();
        platform.isUnavailable();

        const result = await app.run(["eject", "--force", "--json"]);

        expect(app.envelopeOf(result)).toEqual({
          cli_version: cliVersion.version,
          command: "eject",
          source: "",
          status: "ok",
          data: {
            title: REMOVED_TITLE,
            files_removed: REMOVED,
            files_preserved: [],
            backed_up: BACKED_UP,
            manual_steps: MANUAL_STEPS,
            next_commands: [
              `cd ${app.path} && rm -f .env.local.ejected-* .env.development.local.ejected-*`,
              `cd ${app.path} && npm uninstall @zitadel/sdk-next`,
            ],
          },
          warnings: [],
        });
      });
    });

    describe("that refuses connections", () => {
      it("still succeeds", async () => {
        const app = await aPatchedApp();
        platform.refusesConnections();

        const result = await app.run(["eject", "--force", "--json"]);

        expect(app.envelopeOf(result)).toEqual({
          cli_version: cliVersion.version,
          command: "eject",
          source: "",
          status: "ok",
          data: {
            title: REMOVED_TITLE,
            files_removed: REMOVED,
            files_preserved: [],
            backed_up: BACKED_UP,
            manual_steps: MANUAL_STEPS,
            next_commands: [
              `cd ${app.path} && rm -f .env.local.ejected-* .env.development.local.ejected-*`,
              `cd ${app.path} && npm uninstall @zitadel/sdk-next`,
            ],
          },
          warnings: [],
        });
      });
    });
  });

  describe("against a valid server", () => {
    it("holds its invariants in every rendering", async () => {
      const app = await aPatchedApp();
      const args = ["eject", "--force"];

      await app.inEveryRendering((how) => app.run(how.json ? [...args, "--json"] : args, how.env));
    });

    describe("--json", () => {
      it("reports the managed files it removed", async () => {
        const app = await aPatchedApp();

        const result = await app.run(["eject", "--force", "--json"]);

        expect(app.envelopeOf(result)).toEqual({
          cli_version: cliVersion.version,
          command: "eject",
          source: "",
          status: "ok",
          data: {
            title: REMOVED_TITLE,
            files_removed: REMOVED,
            files_preserved: [],
            backed_up: BACKED_UP,
            manual_steps: MANUAL_STEPS,
            next_commands: [
              `cd ${app.path} && rm -f .env.local.ejected-* .env.development.local.ejected-*`,
              `cd ${app.path} && npm uninstall @zitadel/sdk-next`,
            ],
          },
          warnings: [],
        });
      });

      it("reports the developer's own file as preserved", async () => {
        const app = await aPatchedApp();
        await app.writeProjectFile("app/register/page.tsx", OWN_PAGE);

        const result = await app.run(["eject", "--force", "--json"]);

        expect(app.envelopeOf(result)).toEqual({
          cli_version: cliVersion.version,
          command: "eject",
          source: "",
          status: "ok",
          data: {
            title: REMOVED_TITLE,
            files_removed: REMOVED.filter((file) => file !== "app/register/page.tsx"),
            files_preserved: ["app/register/page.tsx"],
            backed_up: BACKED_UP,
            manual_steps: MANUAL_STEPS,
            next_commands: [
              `cd ${app.path} && rm -f .env.local.ejected-* .env.development.local.ejected-*`,
              `cd ${app.path} && npm uninstall @zitadel/sdk-next`,
            ],
          },
          warnings: [],
        });
      });

      it("suggests removing the SDK with the project's own package manager", async () => {
        const app = await aPatchedApp();
        await app.usePackageManager(PNPM);

        const result = await app.run(["eject", "--force", "--json"]);

        expect(result).toSuggest("pnpm remove @zitadel/sdk-next");
      });

      it("removes the managed files from the project", async () => {
        const app = await aPatchedApp();
        const before = await app.snapshot();

        await app.run(["eject", "--force", "--json"]);

        const { removed } = await before.changes();
        expect(removed).toEqual(
          expect.arrayContaining(["zitadel.json", "app/login/page.tsx", "middleware.ts"]),
        );
      });

      it("leaves the developer's own file in the project", async () => {
        const app = await aPatchedApp();
        await app.writeProjectFile("app/register/page.tsx", OWN_PAGE);
        const before = await app.snapshot();

        await app.run(["eject", "--force", "--json"]);

        const { unchanged } = await before.changes();
        expect(unchanged).toContain("app/register/page.tsx");
      });

      it("takes its own guidance file away and edits the developer's in place", async () => {
        const app = await aPatchedApp();
        const before = await app.snapshot();

        await app.run(["eject", "--force", "--json"]);

        const { removed, modified } = await before.changes();
        expect(removed).toContain("AGENTS.md");
        expect(modified).toContain("README.md");
      });

      it("backs up the CLI secret env file away from the tree", async () => {
        const app = await aPatchedApp();
        const before = await app.snapshot();

        await app.run(["eject", "--force", "--json"]);

        const { removed } = await before.changes();
        expect(removed).toContain(".env.development.local");
      });

      it("skips an app Zitadel was never set up in", async () => {
        const app = await anApp({ nextVersion: "^15.0.0" });

        const result = await app.run(["eject", "--force", "--json"]);

        expect(app.envelopeOf(result)).toEqual({
          cli_version: cliVersion.version,
          command: "eject",
          source: "",
          status: "skipped",
          reason: "nothing-to-eject",
          data: { title: "Nothing to remove", cwd: app.path },
          next_commands: [expectedPublicCliCommand(`setup --cwd ${app.path}`)],
        });
      });

      it("skips a second ejection, since the first took everything", async () => {
        const app = await aPatchedApp();
        await app.run(["eject", "--force", "--json"]);

        const result = await app.run(["eject", "--force", "--json"]);

        expect(app.envelopeOf(result)).toEqual({
          cli_version: cliVersion.version,
          command: "eject",
          source: "",
          status: "skipped",
          reason: "nothing-to-eject",
          data: { title: "Nothing to remove", cwd: app.path },
          next_commands: [expectedPublicCliCommand(`setup --cwd ${app.path}`)],
        });
      });
    });

    describe("on a dry run", () => {
      it("reports what it would remove, with the real command to run next", async () => {
        const app = await aPatchedApp();

        const result = await app.run(["eject", "--force", "--dry-run", "--json"]);

        expect(app.envelopeOf(result)).toEqual({
          cli_version: cliVersion.version,
          command: "eject",
          source: "",
          status: "ok",
          data: {
            dry_run: true,
            title: WOULD_REMOVE_TITLE,
            files_removed: REMOVED,
            files_preserved: [],
            backed_up: [
              ".env.local -> .env.local.ejected-<timestamp>",
              ".env.development.local -> .env.development.local.ejected-<timestamp>",
            ],
            manual_steps: MANUAL_STEPS,
            next_commands: [expectedPublicCliCommand(app.againAsRun("eject --force"))],
          },
          warnings: [],
        });
      });

      it("changes nothing", async () => {
        const app = await aPatchedApp();
        const before = await app.snapshot();

        await app.run(["eject", "--force", "--dry-run", "--json"]);

        expect(await before.changes()).toMatchObject({ added: [], modified: [], removed: [] });
      });

      it("reports an app Zitadel was never set up in as having nothing to remove", async () => {
        const app = await anApp({ nextVersion: "^15.0.0" });

        const result = await app.run(["eject", "--force", "--dry-run", "--json"]);

        expect(app.envelopeOf(result)).toEqual({
          cli_version: cliVersion.version,
          command: "eject",
          source: "",
          status: "ok",
          data: {
            dry_run: true,
            title: "Nothing would be removed (dry run)",
            next_commands: [expectedPublicCliCommand(`setup --cwd ${app.path}`)],
          },
          warnings: [],
        });
      });
    });

    describe("without --force when no one can be asked", () => {
      it("is refused", async () => {
        const app = await aPatchedApp();

        const result = await app.run(["eject", "--json"]);

        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "eject",
          source: "",
          code: "E_CONFIRMATION_REQUIRED",
          message:
            "Cannot remove the managed files and local state without --force in non-interactive mode",
          hint: "Ask a person first: Remove the managed files and local Zitadel state? Pass --force only once they agree.",
          next_commands: [expectedPublicCliCommand(app.againAsRun("eject --force"))],
          details: { question: "Remove the managed files and local Zitadel state?" },
        });
      });

      it("exits as a refused confirmation does", async () => {
        const app = await aPatchedApp();

        const result = await app.run(["eject", "--json"]);

        expect(result).toFailWith("E_CONFIRMATION_REQUIRED");
      });

      it("removes nothing", async () => {
        const app = await aPatchedApp();
        const before = await app.snapshot();

        await app.run(["eject", "--json"]);

        expect(await before.changes()).toMatchObject({ added: [], modified: [], removed: [] });
      });
    });

    describe("rendered for a terminal", () => {
      it("heads the text with the headline the envelope carries", async () => {
        const app = await aPatchedApp();

        const result = await app.run(["eject", "--force"]);

        expect(result.stdout.split("\n")[0]).toBe(REMOVED_TITLE);
      });

      it("heads a dry run with the headline the envelope carries", async () => {
        const app = await aPatchedApp();

        const result = await app.run(["eject", "--force", "--dry-run"]);

        expect(result.stdout.split("\n")[0]).toBe(WOULD_REMOVE_TITLE);
      });

      it("names each file it removed", async () => {
        const app = await aPatchedApp();

        const result = await app.run(["eject", "--force"]);

        expect(result).toPrint("Removed app/login/page.tsx");
      });

      it("names the file it kept as the developer's own", async () => {
        const app = await aPatchedApp();
        await app.writeProjectFile("app/register/page.tsx", OWN_PAGE);

        const result = await app.run(["eject", "--force"]);

        expect(result).toPrint("Kept app/register/page.tsx");
      });

      it("names the step it leaves to the developer", async () => {
        const app = await aPatchedApp();

        const result = await app.run(["eject", "--force"]);

        expect(result).toPrint(MANUAL_STEP);
      });

      it("says each command to run next once", async () => {
        const app = await aPatchedApp();

        const result = await app.run(["eject", "--force"]);

        expect(result).toSayOnce(`cd ${app.path} && npm uninstall @zitadel/sdk-next`);
      });

      it("names the real command after a dry run", async () => {
        const app = await aPatchedApp();

        const result = await app.run(["eject", "--force", "--dry-run"]);

        expect(result).toSay(expectedPublicCliCommand(app.againAsRun("eject --force")));
      });

      it("heads a skip with the headline the envelope carries", async () => {
        const app = await anApp({ nextVersion: "^15.0.0" });

        const result = await app.run(["eject", "--force"]);

        expect(result.stdout.split("\n")[0]).toBe("Nothing to remove");
      });

      it("names the command to ask again, as a refusal does on stderr", async () => {
        const app = await aPatchedApp();

        const result = await app.run(["eject"]);

        expect(result).toSay(expectedPublicCliCommand(app.againAsRun("eject --force")));
      });
    });
  });
});
