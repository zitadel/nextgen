import { newestCliCommand } from "@/lib/public-cli";
import { describe, expect, it } from "vitest";

import { usePlatformMock } from "@tests/helpers/platform";
import { aSetUpApp, type ScaffoldedApp, MOCK_SERVER_URL } from "@tests/helpers/project";
import { cliVersion } from "@tests/helpers/run-cli";
import { asTerminal, offTerminal } from "@tests/helpers/terminal";

const platform = usePlatformMock();

const CLI_VERSION = cliVersion.version;

const NEWEST = "99.0.0";

const RELEASE_NOTES = "https://github.com/zitadel/nextgen/releases";

const STILL_THIS_CLI = `This CLI is still ${CLI_VERSION}. Run the newest with npx @zitadel/cli@latest <command>, or if you installed it globally, update it with npm install --global @zitadel/cli@${NEWEST}.`;

/** The two ways a person reads a run, which must say the same thing. */
const SHOWN = [
  ["on a terminal", asTerminal],
  ["piped", offTerminal],
] as const;

function floatTheSdk(app: ScaffoldedApp): Promise<void> {
  return app.editPackageJson((pkg) => {
    for (const name of Object.keys(pkg.dependencies)) {
      if (name.startsWith("@zitadel/")) {
        pkg.dependencies[name] = "^0.0.1";
      }
    }
  });
}

describe("upgrade", () => {
  describe("against an invalid server", () => {
    describe("that is not a zitadel api", () => {
      it("still succeeds, because it never asks the server", async () => {
        const app = await aSetUpApp();
        platform.isNotZitadel();
        platform.publishesCli(NEWEST);

        const result = await app.upgrade();

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: CLI_VERSION,
          command: "upgrade",
          source: "",
          data: {
            title: `Zitadel upgraded to ${NEWEST}`,
            current_version: CLI_VERSION,
            latest_version: NEWEST,
            up_to_date: false,
            packages: [{ name: "@zitadel/sdk-next", from: CLI_VERSION, to: NEWEST }],
            left_alone: [],
            breaking_changes: [],
            release_notes_url: RELEASE_NOTES,
            refresh: "done",
            install_command: `npm --prefix ${app.path} install --save-exact @zitadel/sdk-next@${NEWEST}`,
            next_actions: [STILL_THIS_CLI],
          },
          warnings: [],
        });
      });
    });

    describe("that is down", () => {
      it("still succeeds, because it never asks the server", async () => {
        const app = await aSetUpApp();
        platform.isUnavailable();
        platform.publishesCli(NEWEST);

        const result = await app.upgrade();

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: CLI_VERSION,
          command: "upgrade",
          source: "",
          data: {
            title: `Zitadel upgraded to ${NEWEST}`,
            current_version: CLI_VERSION,
            latest_version: NEWEST,
            up_to_date: false,
            packages: [{ name: "@zitadel/sdk-next", from: CLI_VERSION, to: NEWEST }],
            left_alone: [],
            breaking_changes: [],
            release_notes_url: RELEASE_NOTES,
            refresh: "done",
            install_command: `npm --prefix ${app.path} install --save-exact @zitadel/sdk-next@${NEWEST}`,
            next_actions: [STILL_THIS_CLI],
          },
          warnings: [],
        });
      });
    });
  });

  describe("against a valid server", () => {
    it("holds its invariants in every rendering", async () => {
      const app = await aSetUpApp();
      platform.publishesCli(NEWEST);

      await app.inEveryRendering((how) =>
        how.json ? app.upgrade([], {}, how.env) : app.upgradeRendered(how.env),
      );
    });

    describe("--json", () => {
      it("moves the pinned packages to the latest release", async () => {
        const app = await aSetUpApp();
        platform.publishesCli(NEWEST);

        const result = await app.upgrade();

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: CLI_VERSION,
          command: "upgrade",
          source: "",
          data: {
            title: `Zitadel upgraded to ${NEWEST}`,
            current_version: CLI_VERSION,
            latest_version: NEWEST,
            up_to_date: false,
            packages: [{ name: "@zitadel/sdk-next", from: CLI_VERSION, to: NEWEST }],
            left_alone: [],
            breaking_changes: [],
            release_notes_url: RELEASE_NOTES,
            refresh: "done",
            install_command: `npm --prefix ${app.path} install --save-exact @zitadel/sdk-next@${NEWEST}`,
            next_actions: [STILL_THIS_CLI],
          },
          warnings: [],
        });
      });

      it("installs them at exact versions with the project's package manager", async () => {
        const app = await aSetUpApp();
        platform.publishesCli(NEWEST);

        const result = await app.upgrade();

        expect(app.envelopeOf(result)).toMatchObject({
          data: {
            install_command: `npm --prefix ${app.path} install --save-exact @zitadel/sdk-next@${NEWEST}`,
          },
        });
        const { args } = await app.installInvocation();
        expect(args).toEqual(["install", "--save-exact", `@zitadel/sdk-next@${NEWEST}`]);
      });

      it("has the new release refresh the generated files", async () => {
        const app = await aSetUpApp();
        platform.publishesCli(NEWEST);

        const result = await app.upgrade();

        expect(app.envelopeOf(result)).toMatchObject({ data: { refresh: "done" } });
        await expect(app.refreshInvocation()).resolves.toEqual([
          "--yes",
          `@zitadel/cli@${NEWEST}`,
          "doctor",
          "--fix",
          "--non-interactive",
          "--json",
        ]);
      });

      it("passes --no-telemetry on to the new release's doctor", async () => {
        const app = await aSetUpApp();
        platform.publishesCli(NEWEST);

        const result = await app.upgrade(["--no-telemetry"]);

        expect(app.envelopeOf(result)).toMatchObject({ status: "ok" });
        await expect(app.refreshInvocation()).resolves.toEqual([
          "--yes",
          `@zitadel/cli@${NEWEST}`,
          "doctor",
          "--fix",
          "--non-interactive",
          "--json",
          "--no-telemetry",
        ]);
      });

      it("keeps the upgrade and suggests doctor when the refresh finds issues", async () => {
        const app = await aSetUpApp();
        platform.publishesCli(NEWEST);

        const result = await app.upgrade([], { refresh: "issues" });

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: CLI_VERSION,
          command: "upgrade",
          source: "",
          data: {
            title: `Zitadel upgraded to ${NEWEST}`,
            current_version: CLI_VERSION,
            latest_version: NEWEST,
            up_to_date: false,
            packages: [{ name: "@zitadel/sdk-next", from: CLI_VERSION, to: NEWEST }],
            left_alone: [],
            breaking_changes: [],
            release_notes_url: RELEASE_NOTES,
            refresh: "issues",
            install_command: `npm --prefix ${app.path} install --save-exact @zitadel/sdk-next@${NEWEST}`,
            next_actions: [STILL_THIS_CLI],
            next_commands: [
              `npx @zitadel/cli@${NEWEST} doctor --server ${MOCK_SERVER_URL} --cwd ${app.path}`,
            ],
          },
          warnings: [],
        });
      });

      it("keeps the upgrade and suggests the repair when the refresh cannot run", async () => {
        const app = await aSetUpApp();
        platform.publishesCli(NEWEST);

        const result = await app.upgrade([], { refresh: "broken" });

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: CLI_VERSION,
          command: "upgrade",
          source: "",
          data: {
            title: `Zitadel upgraded to ${NEWEST}`,
            current_version: CLI_VERSION,
            latest_version: NEWEST,
            up_to_date: false,
            packages: [{ name: "@zitadel/sdk-next", from: CLI_VERSION, to: NEWEST }],
            left_alone: [],
            breaking_changes: [],
            release_notes_url: RELEASE_NOTES,
            refresh: "failed",
            install_command: `npm --prefix ${app.path} install --save-exact @zitadel/sdk-next@${NEWEST}`,
            next_actions: [STILL_THIS_CLI],
            next_commands: [
              `npx @zitadel/cli@${NEWEST} doctor --fix --server ${MOCK_SERVER_URL} --cwd ${app.path}`,
            ],
          },
          warnings: [],
        });
      });

      it("plans the upgrade as a dry run and suggests the real one", async () => {
        const app = await aSetUpApp();
        platform.publishesCli(NEWEST);

        const result = await app.upgrade(["--dry-run"]);

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: CLI_VERSION,
          command: "upgrade",
          source: "",
          data: {
            title: `Zitadel can be upgraded to ${NEWEST} (dry run)`,
            dry_run: true,
            current_version: CLI_VERSION,
            latest_version: NEWEST,
            up_to_date: false,
            packages: [{ name: "@zitadel/sdk-next", from: CLI_VERSION, to: NEWEST }],
            left_alone: [],
            breaking_changes: [],
            release_notes_url: RELEASE_NOTES,
            refresh: "planned",
            install_command: `npm --prefix ${app.path} install --save-exact @zitadel/sdk-next@${NEWEST}`,
            next_actions: [STILL_THIS_CLI],
            next_commands: [newestCliCommand(app.againAsRun("upgrade"), CLI_VERSION)],
          },
          warnings: [],
        });
      });

      it("changes nothing under --dry-run", async () => {
        const app = await aSetUpApp();
        platform.publishesCli(NEWEST);

        const result = await app.upgrade(["--dry-run"]);

        expect(app.envelopeOf(result)).toMatchObject({ data: { dry_run: true } });
        await expect(app.installWasRun()).resolves.toBe(false);
      });

      it("ends cancelled when Ctrl-C lands in the install", async () => {
        const app = await aSetUpApp();
        platform.publishesCli(NEWEST);

        const result = await app.upgradeInterrupted("install");

        expect(result).toExitWith(130);
        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: CLI_VERSION,
          command: "upgrade",
          source: "",
          code: "E_CANCELLED",
          message: "Cancelled",
          hint: "The command was cancelled with Ctrl-C.",
        });
      });

      it("ends cancelled when Ctrl-C lands in the refresh", async () => {
        const app = await aSetUpApp();
        platform.publishesCli(NEWEST);

        const result = await app.upgradeInterrupted("refresh");

        expect(result).toExitWith(130);
        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: CLI_VERSION,
          command: "upgrade",
          source: "",
          code: "E_CANCELLED",
          message: "Cancelled",
          hint: "The command was cancelled with Ctrl-C.",
        });
      });

      it("reports a range as left alone instead of moving it", async () => {
        const app = await aSetUpApp();
        await floatTheSdk(app);
        platform.publishesCli(NEWEST);

        const result = await app.upgrade();

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: CLI_VERSION,
          command: "upgrade",
          source: "",
          data: {
            title: `Zitadel upgraded to ${NEWEST}`,
            current_version: CLI_VERSION,
            latest_version: NEWEST,
            up_to_date: false,
            packages: [],
            left_alone: [{ name: "@zitadel/sdk-next", specifier: "^0.0.1" }],
            breaking_changes: [],
            release_notes_url: RELEASE_NOTES,
            refresh: "skipped",
            next_actions: [STILL_THIS_CLI],
          },
          warnings: [],
        });
      });

      it("has nothing to do on the latest release", async () => {
        const app = await aSetUpApp();
        platform.publishesCli("0.0.1");

        const result = await app.upgrade();

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: CLI_VERSION,
          command: "upgrade",
          source: "",
          data: {
            title: `Zitadel is up to date at ${CLI_VERSION}`,
            current_version: CLI_VERSION,
            latest_version: CLI_VERSION,
            up_to_date: true,
            packages: [],
            left_alone: [],
            breaking_changes: [],
            release_notes_url: RELEASE_NOTES,
            refresh: "skipped",
          },
          warnings: [],
        });
        await expect(app.installWasRun()).resolves.toBe(false);
      });

      it("reports the breaking changes on the way", async () => {
        const app = await aSetUpApp();
        platform.publishesCli(NEWEST, { [NEWEST]: "it broke" });

        const result = await app.upgrade();

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: CLI_VERSION,
          command: "upgrade",
          source: "",
          data: {
            title: `Zitadel upgraded to ${NEWEST}`,
            current_version: CLI_VERSION,
            latest_version: NEWEST,
            up_to_date: false,
            packages: [{ name: "@zitadel/sdk-next", from: CLI_VERSION, to: NEWEST }],
            left_alone: [],
            breaking_changes: [{ version: NEWEST, note: "it broke" }],
            release_notes_url: RELEASE_NOTES,
            refresh: "done",
            install_command: `npm --prefix ${app.path} install --save-exact @zitadel/sdk-next@${NEWEST}`,
            next_actions: [STILL_THIS_CLI],
          },
          warnings: [],
        });
      });

      it("hands a breaking change over raw, control characters and all", async () => {
        const app = await aSetUpApp();
        platform.publishesCli(NEWEST, { [NEWEST]: "it \u001b[31mbroke" });

        const result = await app.upgrade();

        expect(app.envelopeOf(result)).toMatchObject({
          data: { breaking_changes: [{ version: NEWEST, note: "it \u001b[31mbroke" }] },
        });
      });

      it("fails when the registry cannot say what the latest release is", async () => {
        const app = await aSetUpApp();
        platform.npmRegistryIsDown();

        const result = await app.upgrade();

        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: CLI_VERSION,
          command: "upgrade",
          source: "",
          code: "E_NETWORK",
          message: "Could not look up the latest Zitadel release",
          hint: "Check the connection to the npm registry, and that it serves this release's dist-tag, then rerun.",
          next_commands: [newestCliCommand(app.againAsRun("upgrade"), CLI_VERSION)],
        });
      });

      it("fails when the install does, offering the install and the upgrade again", async () => {
        const app = await aSetUpApp();
        platform.publishesCli(NEWEST);

        const result = await app.upgrade([], { install: "fails" });

        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: CLI_VERSION,
          command: "upgrade",
          source: "",
          code: "E_VALIDATION",
          message: "Could not install the new packages",
          hint: `npm install --save-exact @zitadel/sdk-next@${NEWEST} failed with exit 1. Nothing else changed; fix that and rerun.`,
          next_commands: [
            `npm --prefix ${app.path} install --save-exact @zitadel/sdk-next@${NEWEST}`,
            newestCliCommand(app.againAsRun("upgrade"), CLI_VERSION),
          ],
        });
      });
    });

    describe.each(SHOWN)("rendered %s", (_how, shown) => {
      it("says what moved", async () => {
        const app = await aSetUpApp();
        platform.publishesCli(NEWEST);

        const result = await shown(() => app.upgradeRendered());

        expect(result).toPrint(`Zitadel upgraded to ${NEWEST}`);
        expect(result).toPrint(`@zitadel/sdk-next ${CLI_VERSION} → ${NEWEST}`);
      });

      it("says its title once, as --json does, with no full stop added", async () => {
        const app = await aSetUpApp();
        platform.publishesCli(NEWEST);

        const result = await shown(() => app.upgradeRendered());

        expect(result).toSayOnce(`Zitadel upgraded to ${NEWEST}`);
        expect(result).not.toPrint(`Zitadel upgraded to ${NEWEST}.`);
      });

      it("says the generated files were refreshed", async () => {
        const app = await aSetUpApp();
        platform.publishesCli(NEWEST);

        const result = await shown(() => app.upgradeRendered());

        expect(result).toSayOnce("Refreshed generated files with doctor --fix");
      });

      it("says how to get the newest CLI, once", async () => {
        const app = await aSetUpApp();
        platform.publishesCli(NEWEST);

        const result = await shown(() => app.upgradeRendered());

        expect(result).toSayOnce(STILL_THIS_CLI);
      });

      it("shows a breaking change before it installs", async () => {
        const app = await aSetUpApp();
        platform.publishesCli(NEWEST, { [NEWEST]: "it broke" });

        const result = await shown(() => app.upgradeRendered());

        expect(result).toSayOnce("it broke");
        expect(result.stdout.indexOf("it broke")).toBeLessThan(
          result.stdout.indexOf("Zitadel upgraded"),
        );
      });

      it("spells a control character in a breaking change out", async () => {
        const app = await aSetUpApp();
        platform.publishesCli(NEWEST, { [NEWEST]: "it \u001b[31mbroke" });

        const result = await shown(() => app.upgradeRendered());

        expect(result).toPrint("it \\x1b[31mbroke");
        expect(result.stdout).not.toContain("\u001b[31m");
      });

      it("links the release notes", async () => {
        const app = await aSetUpApp();
        platform.publishesCli(NEWEST);

        const result = await shown(() => app.upgradeRendered());

        expect(result).toSayOnce(RELEASE_NOTES);
      });

      it("says it is up to date when it is", async () => {
        const app = await aSetUpApp();
        platform.publishesCli("0.0.1");

        const result = await shown(() => app.upgradeRendered());

        expect(result).toSayOnce(`Zitadel is up to date at ${CLI_VERSION}`);
      });

      it("says what a range left alone is", async () => {
        const app = await aSetUpApp();
        await floatTheSdk(app);
        platform.publishesCli(NEWEST);

        const result = await shown(() => app.upgradeRendered());

        expect(result).toSayOnce('@zitadel/sdk-next left at "^0.0.1", not an exact version');
      });

      it("fails once, on stderr, when the registry cannot be reached", async () => {
        const app = await aSetUpApp();
        platform.npmRegistryIsDown();

        const result = await shown(() => app.upgradeRendered());

        expect(result.stdout).toBe("");
        expect(result).toSayOnce("Could not look up the latest Zitadel release");
      });
    });
  });
});
