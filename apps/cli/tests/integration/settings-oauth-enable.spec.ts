import { describe, expect, it } from "vitest";

import { usePlatformMock } from "@tests/helpers/platform";
import { anApp, aSetUpApp } from "@tests/helpers/project";
import { cliVersion, expectedPublicCliCommand } from "@tests/helpers/run-cli";

const platform = usePlatformMock();

/**
 * The settings file enabling writes.
 */
const OAUTH_FILE = ".zitadel/oauth/oauth.json";

/**
 * The headline of a run that turned the switch on.
 */
const ENABLED = `Enabled the OAuth authorization server in ${OAUTH_FILE}`;

/**
 * The headline of a run that found the switch already on.
 */
const ALREADY_ENABLED = "The OAuth authorization server is already enabled";

/**
 * What to do once the switch is on.
 */
const NEXT_ACTIONS = [
  "See the diff with a dry run, then publish the switch with the next release.",
];

describe("settings oauth enable", () => {
  describe("against an invalid server", () => {
    describe("that is not a zitadel api", () => {
      it("still writes the switch into the project", async () => {
        const app = await aSetUpApp();
        platform.isNotZitadel();

        const result = await app.enableOAuth();

        expect(result).toSucceed();
      });
    });

    describe("that is down", () => {
      it("still writes the switch into the project", async () => {
        const app = await aSetUpApp();
        platform.isUnavailable();

        const result = await app.enableOAuth();

        expect(result).toSucceed();
      });
    });
  });

  describe("against a valid server", () => {
    it("holds its invariants in every rendering", async () => {
      const app = await aSetUpApp();
      platform.servesAHostileOrigin();
      const args = ["settings", "oauth", "enable"];

      await app.inEveryRendering((how) => app.run(how.json ? [...args, "--json"] : args, how.env));
    });

    describe("--json", () => {
      it("reports the file it wrote and what to do next", async () => {
        const app = await aSetUpApp();

        const result = await app.enableOAuth();

        expect(app.envelopeOf(result)).toEqual({
          cli_version: cliVersion.version,
          command: "settings:oauth:enable",
          source: "",
          status: "ok",
          data: {
            title: ENABLED,
            files_written: [OAUTH_FILE],
            next_actions: NEXT_ACTIONS,
            next_commands: [
              expectedPublicCliCommand(`deploy --dry-run --cwd ${app.path}`),
              expectedPublicCliCommand(`deploy --message '<what changed>' --cwd ${app.path}`),
            ],
          },
          warnings: [],
        });
      });

      it("reports nothing to do the second time", async () => {
        const app = await aSetUpApp();
        await app.enableOAuth();

        const result = await app.enableOAuth();

        expect(app.envelopeOf(result)).toEqual({
          cli_version: cliVersion.version,
          command: "settings:oauth:enable",
          source: "",
          status: "skipped",
          reason: "already-enabled",
          data: { title: ALREADY_ENABLED },
        });
      });

      it("turns the settings the project already has on in place, whatever their name", async () => {
        const app = await aSetUpApp();
        const file = await app.writeOAuthSettings("settings.json", false);

        const result = await app.enableOAuth();

        expect(app.envelopeOf(result)).toMatchObject({
          status: "ok",
          data: {
            title: `Enabled the OAuth authorization server in ${file}`,
            files_written: [file],
          },
        });
      });
    });

    describe("on a dry run", () => {
      it("reports the file it would write, with the real command to run next", async () => {
        const app = await aSetUpApp();

        const result = await app.enableOAuth(["--dry-run"]);

        expect(app.envelopeOf(result)).toEqual({
          cli_version: cliVersion.version,
          command: "settings:oauth:enable",
          source: "",
          status: "ok",
          data: {
            dry_run: true,
            title: `Would enable the OAuth authorization server in ${OAUTH_FILE} (dry run)`,
            verb: "enable",
            topic: "OAuth",
            files_would_write: [OAUTH_FILE],
            next_commands: [expectedPublicCliCommand(`settings oauth enable --cwd ${app.path}`)],
          },
          warnings: [],
        });
      });

      it("writes nothing", async () => {
        const app = await aSetUpApp();
        const before = await app.snapshot();

        await app.enableOAuth(["--dry-run"]);

        expect(await before.changes()).toMatchObject({ added: [], modified: [], removed: [] });
      });

      it("answers ok when the switch is already on", async () => {
        const app = await aSetUpApp();
        await app.enableOAuth();

        const result = await app.enableOAuth(["--dry-run"]);

        expect(app.envelopeOf(result)).toEqual({
          cli_version: cliVersion.version,
          command: "settings:oauth:enable",
          source: "",
          status: "ok",
          data: { title: `${ALREADY_ENABLED} (dry run)`, dry_run: true },
          warnings: [],
        });
      });
    });

    describe("in a directory setup has not made a project", () => {
      it("is refused, with setup as the way out", async () => {
        const app = await anApp();

        const result = await app.enableOAuth();

        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "settings:oauth:enable",
          source: "",
          code: "E_VALIDATION",
          message: "This directory is not a Zitadel project",
          hint: "Run setup first; the OAuth settings live under .zitadel/.",
          next_commands: [expectedPublicCliCommand(`setup --cwd ${app.path}`)],
        });
      });
    });

    describe("rendered for a terminal", () => {
      it("heads the text with the headline the envelope carries", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["settings", "oauth", "enable"]);

        expect(result.stdout.split("\n")[0]).toBe(ENABLED);
      });

      it("says to deploy once the switch is on", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["settings", "oauth", "enable"]);

        expect(result).toSayOnce(expectedPublicCliCommand(`deploy --dry-run --cwd ${app.path}`));
      });

      it("heads a second run with the headline the envelope carries", async () => {
        const app = await aSetUpApp();
        await app.enableOAuth();

        const result = await app.run(["settings", "oauth", "enable"]);

        expect(result.stdout.split("\n")[0]).toBe(ALREADY_ENABLED);
      });
    });
  });
});
