import { describe, expect, it } from "vitest";

import { usePlatformMock } from "@tests/helpers/platform";
import { anApp, aSetUpApp, MOCK_SERVER_URL } from "@tests/helpers/project";
import { cliVersion, expectedPublicCliCommand } from "@tests/helpers/run-cli";

const platform = usePlatformMock();

const MINIMAL_DESIGN = ["branding", "eject", "--design", "minimal", "--non-interactive", "--json"];

/**
 * The files a first ejection writes: the descriptor, its template and the
 * README, the project's copy of the dialect being there from setup.
 */
const EJECTED_FILES = [
  ".zitadel/branding/branding.json",
  ".zitadel/branding/login.liquid",
  ".zitadel/branding/README.md",
];

/**
 * The headline of an ejection of the minimal design.
 */
const EJECTED_MINIMAL = "Ejected the minimal design into .zitadel/branding/";

/**
 * What to do once the design is ejected.
 */
const NEXT_ACTIONS = [
  "Edit .zitadel/branding/login.liquid — the login UI is yours now.",
  "Validate the template and see the diff with a dry run, then publish it.",
];

describe("branding eject", () => {
  describe("against an invalid server", () => {
    describe("that is not a zitadel api", () => {
      it("still succeeds", async () => {
        const app = await aSetUpApp();
        platform.isNotZitadel();

        const result = await app.run(MINIMAL_DESIGN);

        expect(app.envelopeOf(result)).toEqual({
          cli_version: cliVersion.version,
          command: "branding:eject",
          source: "",
          status: "ok",
          data: {
            title: EJECTED_MINIMAL,
            design: "minimal",
            files_written: EJECTED_FILES,
            next_actions: NEXT_ACTIONS,
            next_commands: [
              expectedPublicCliCommand(
                `deploy --dry-run --server ${MOCK_SERVER_URL} --cwd ${app.path}`,
              ),
              expectedPublicCliCommand(
                `deploy --message '<what changed>' --server ${MOCK_SERVER_URL} --cwd ${app.path}`,
              ),
            ],
          },
          warnings: [],
        });
      });
    });

    describe("that is down", () => {
      it("still succeeds", async () => {
        const app = await aSetUpApp();
        platform.isUnavailable();

        const result = await app.run(MINIMAL_DESIGN);

        expect(app.envelopeOf(result)).toEqual({
          cli_version: cliVersion.version,
          command: "branding:eject",
          source: "",
          status: "ok",
          data: {
            title: EJECTED_MINIMAL,
            design: "minimal",
            files_written: EJECTED_FILES,
            next_actions: NEXT_ACTIONS,
            next_commands: [
              expectedPublicCliCommand(
                `deploy --dry-run --server ${MOCK_SERVER_URL} --cwd ${app.path}`,
              ),
              expectedPublicCliCommand(
                `deploy --message '<what changed>' --server ${MOCK_SERVER_URL} --cwd ${app.path}`,
              ),
            ],
          },
          warnings: [],
        });
      });
    });

    describe("that refuses connections", () => {
      it("still succeeds", async () => {
        const app = await aSetUpApp();
        platform.refusesConnections();

        const result = await app.run(MINIMAL_DESIGN);

        expect(app.envelopeOf(result)).toEqual({
          cli_version: cliVersion.version,
          command: "branding:eject",
          source: "",
          status: "ok",
          data: {
            title: EJECTED_MINIMAL,
            design: "minimal",
            files_written: EJECTED_FILES,
            next_actions: NEXT_ACTIONS,
            next_commands: [
              expectedPublicCliCommand(
                `deploy --dry-run --server ${MOCK_SERVER_URL} --cwd ${app.path}`,
              ),
              expectedPublicCliCommand(
                `deploy --message '<what changed>' --server ${MOCK_SERVER_URL} --cwd ${app.path}`,
              ),
            ],
          },
          warnings: [],
        });
      });
    });
  });

  describe("against a valid server", () => {
    it("holds its invariants in every rendering", async () => {
      const app = await aSetUpApp();
      platform.servesAHostileOrigin();
      const args = ["branding", "eject", "--design", "clean"];

      await app.inEveryRendering((how) => app.run(how.json ? [...args, "--json"] : args, how.env));
    });

    describe("--json", () => {
      it("reports the files it wrote and what to do next", async () => {
        const app = await aSetUpApp();

        const result = await app.run(MINIMAL_DESIGN);

        expect(app.envelopeOf(result)).toEqual({
          cli_version: cliVersion.version,
          command: "branding:eject",
          source: "",
          status: "ok",
          data: {
            title: EJECTED_MINIMAL,
            design: "minimal",
            files_written: EJECTED_FILES,
            next_actions: NEXT_ACTIONS,
            next_commands: [
              expectedPublicCliCommand(
                `deploy --dry-run --server ${MOCK_SERVER_URL} --cwd ${app.path}`,
              ),
              expectedPublicCliCommand(
                `deploy --message '<what changed>' --server ${MOCK_SERVER_URL} --cwd ${app.path}`,
              ),
            ],
          },
          warnings: [],
        });
      });

      it("starts from the default design when none is named and no one can be asked", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["branding", "eject", "--non-interactive", "--json"]);

        expect(app.envelopeOf(result)).toEqual({
          cli_version: cliVersion.version,
          command: "branding:eject",
          source: "",
          status: "ok",
          data: {
            title: "Ejected the centered design into .zitadel/branding/",
            design: "centered",
            files_written: EJECTED_FILES,
            next_actions: NEXT_ACTIONS,
            next_commands: [
              expectedPublicCliCommand(
                `deploy --dry-run --server ${MOCK_SERVER_URL} --cwd ${app.path}`,
              ),
              expectedPublicCliCommand(
                `deploy --message '<what changed>' --server ${MOCK_SERVER_URL} --cwd ${app.path}`,
              ),
            ],
          },
          warnings: [],
        });
      });

      it("replaces the files of an earlier ejection under --force", async () => {
        const app = await aSetUpApp();
        await app.run(MINIMAL_DESIGN);

        const result = await app.run([
          "branding",
          "eject",
          "--design",
          "centered",
          "--force",
          "--non-interactive",
          "--json",
        ]);

        expect(app.envelopeOf(result)).toEqual({
          cli_version: cliVersion.version,
          command: "branding:eject",
          source: "",
          status: "ok",
          data: {
            title: "Ejected the centered design into .zitadel/branding/",
            design: "centered",
            files_written: [".zitadel/branding/branding.json", ".zitadel/branding/login.liquid"],
            next_actions: NEXT_ACTIONS,
            next_commands: [
              expectedPublicCliCommand(
                `deploy --dry-run --server ${MOCK_SERVER_URL} --cwd ${app.path}`,
              ),
              expectedPublicCliCommand(
                `deploy --message '<what changed>' --server ${MOCK_SERVER_URL} --cwd ${app.path}`,
              ),
            ],
          },
          warnings: [],
        });
      });

      it("publishes nothing by itself", async () => {
        const published = platform.capturesBrandingPublishes();
        const app = await aSetUpApp();

        const result = await app.run(MINIMAL_DESIGN);

        expect(result).toSucceed();
        expect(published.count).toBe(0);
      });

      it("carries the ejected design into the next deploy's release", async () => {
        const app = await aSetUpApp();
        expect(await app.run(MINIMAL_DESIGN)).toSucceed();
        await app.addPrimaryOrigin();

        const data = await app.deployData();

        // The scaffold's schema, flow, password policy and sign-up policy,
        // plus the ejected branding.
        expect(data.resources).toBe(5);
      });

      it("re-deploys the same release once the design is published", async () => {
        const app = await aSetUpApp();
        expect(await app.run(MINIMAL_DESIGN)).toSucceed();
        await app.addPrimaryOrigin();
        const before = await app.deployData();

        const after = await app.deployData();

        expect(after.content_hash).toBe(before.content_hash);
      });
    });

    describe("on a dry run", () => {
      it("reports the files it would write, with the real command to run next", async () => {
        const app = await aSetUpApp();

        const result = await app.run([...MINIMAL_DESIGN, "--dry-run"]);

        expect(app.envelopeOf(result)).toEqual({
          cli_version: cliVersion.version,
          command: "branding:eject",
          source: "",
          status: "ok",
          data: {
            dry_run: true,
            title: "Would eject the minimal design into .zitadel/branding/ (dry run)",
            design: "minimal",
            files_would_write: EJECTED_FILES,
            next_commands: [
              expectedPublicCliCommand(
                `branding eject --design minimal --server ${MOCK_SERVER_URL} --cwd ${app.path}`,
              ),
            ],
          },
          warnings: [],
        });
      });

      it("keeps --force on the real command it suggests", async () => {
        const app = await aSetUpApp();

        const result = await app.run([...MINIMAL_DESIGN, "--force", "--dry-run"]);

        expect(app.envelopeOf(result)).toEqual({
          cli_version: cliVersion.version,
          command: "branding:eject",
          source: "",
          status: "ok",
          data: {
            dry_run: true,
            title: "Would eject the minimal design into .zitadel/branding/ (dry run)",
            design: "minimal",
            files_would_write: EJECTED_FILES,
            next_commands: [
              expectedPublicCliCommand(
                `branding eject --design minimal --force --server ${MOCK_SERVER_URL} --cwd ${app.path}`,
              ),
            ],
          },
          warnings: [],
        });
      });

      it("writes nothing", async () => {
        const app = await aSetUpApp();
        const before = await app.snapshot();

        await app.run([...MINIMAL_DESIGN, "--dry-run"]);

        expect(await before.changes()).toMatchObject({ added: [], modified: [], removed: [] });
      });

      it("refuses what the real run would refuse", async () => {
        const app = await aSetUpApp();
        await app.run(MINIMAL_DESIGN);

        const result = await app.run([...MINIMAL_DESIGN, "--dry-run"]);

        expect(result).toFailWith("E_CONFLICT");
      });
    });

    describe("when a design was already ejected", () => {
      it("is refused, with the forced run to try instead", async () => {
        const app = await aSetUpApp();
        await app.run(MINIMAL_DESIGN);

        const result = await app.run(MINIMAL_DESIGN);

        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "branding:eject",
          source: "",
          code: "E_CONFLICT",
          message: ".zitadel/branding/branding.json already exists",
          hint: "Rerun with --force to replace it, or edit the existing file directly.",
          next_commands: [
            expectedPublicCliCommand(
              `branding eject --design minimal --force --server ${MOCK_SERVER_URL} --cwd ${app.path}`,
            ),
          ],
          details: { file: ".zitadel/branding/branding.json" },
        });
      });

      it("changes nothing", async () => {
        const app = await aSetUpApp();
        await app.run(MINIMAL_DESIGN);
        const before = await app.snapshot();

        await app.run(MINIMAL_DESIGN);

        expect(await before.changes()).toMatchObject({ added: [], modified: [], removed: [] });
      });
    });

    describe("with a design it does not ship", () => {
      it("refuses an unknown one, naming the designs it has", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["branding", "eject", "--design", "nope", "--json"]);

        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "branding:eject",
          source: "",
          code: "E_VALIDATION",
          message: 'Unknown design "nope"',
          hint: "Pick one of: centered, minimal.",
        });
      });

      it("carries the design in the refusal as it was typed, escape sequence and all", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["branding", "eject", "--design", "\u001b[31mx", "--json"]);

        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "branding:eject",
          source: "",
          code: "E_VALIDATION",
          message: 'Unknown design "\u001b[31mx"',
          hint: "Pick one of: centered, minimal.",
        });
      });

      it("refuses a retired one, with the run it can use instead", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["branding", "eject", "--design", "split", "--json"]);

        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "branding:eject",
          source: "",
          code: "E_VALIDATION",
          message: "The split design was retired: it was page layout, not widget structure",
          hint: "Build page layout (split screens, hero panes, marketing copy) in your app around <zitadel-login>, and theme the widget with --zl-* custom properties in your stylesheet. To own the widget's structure, eject one of: centered, minimal.",
          next_commands: [
            expectedPublicCliCommand(`branding eject --design centered --cwd ${app.path}`),
          ],
        });
      });
    });

    describe("in a directory setup has not made a project", () => {
      it("is refused, with setup as the way out", async () => {
        const app = await anApp();

        const result = await app.run(MINIMAL_DESIGN);

        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "branding:eject",
          source: "",
          code: "E_VALIDATION",
          message: "This directory is not a Zitadel project",
          hint: "Run setup first; branding files live under .zitadel/.",
          next_commands: [expectedPublicCliCommand(`setup --cwd ${app.path}`)],
        });
      });
    });

    describe("rendered for a terminal", () => {
      it("heads the text with the headline the envelope carries", async () => {
        const app = await aSetUpApp();

        const result = await app.run([
          "branding",
          "eject",
          "--design",
          "minimal",
          "--non-interactive",
        ]);

        expect(result.stdout.split("\n")[0]).toBe(EJECTED_MINIMAL);
      });

      it("heads a dry run with the headline the envelope carries", async () => {
        const app = await aSetUpApp();

        const result = await app.run([
          "branding",
          "eject",
          "--design",
          "minimal",
          "--non-interactive",
          "--dry-run",
        ]);

        expect(result.stdout.split("\n")[0]).toBe(
          "Would eject the minimal design into .zitadel/branding/ (dry run)",
        );
      });

      it("names each file it wrote once", async () => {
        const app = await aSetUpApp();

        const result = await app.run([
          "branding",
          "eject",
          "--design",
          "minimal",
          "--non-interactive",
        ]);

        expect(result).toSayOnce("Wrote .zitadel/branding/login.liquid");
      });

      it("names each file a dry run would write", async () => {
        const app = await aSetUpApp();

        const result = await app.run([
          "branding",
          "eject",
          "--design",
          "minimal",
          "--non-interactive",
          "--dry-run",
        ]);

        expect(result).toPrint("Would write .zitadel/branding/login.liquid");
      });

      it("names the real command after a dry run", async () => {
        const app = await aSetUpApp();

        const result = await app.run([
          "branding",
          "eject",
          "--design",
          "minimal",
          "--non-interactive",
          "--dry-run",
        ]);

        expect(result).toSay(
          expectedPublicCliCommand(
            `branding eject --design minimal --server ${MOCK_SERVER_URL} --cwd ${app.path}`,
          ),
        );
      });

      it("says to deploy once the design is ejected", async () => {
        const app = await aSetUpApp();

        const result = await app.run([
          "branding",
          "eject",
          "--design",
          "minimal",
          "--non-interactive",
        ]);

        expect(result).toSayOnce(
          expectedPublicCliCommand(
            `deploy --dry-run --server ${MOCK_SERVER_URL} --cwd ${app.path}`,
          ),
        );
      });

      it("spells out an escape sequence in a design it refuses", async () => {
        const app = await aSetUpApp();

        const result = await app.run([
          "branding",
          "eject",
          "--design",
          "\u001b[31mx",
          "--non-interactive",
        ]);

        expect(result).toSay('Unknown design "\\x1b[31mx"');
      });

      it("names the forced run on stderr when a design was already ejected", async () => {
        const app = await aSetUpApp();
        await app.run(MINIMAL_DESIGN);

        const result = await app.run([
          "branding",
          "eject",
          "--design",
          "minimal",
          "--non-interactive",
        ]);

        expect(result).toSay(
          expectedPublicCliCommand(
            `branding eject --design minimal --force --server ${MOCK_SERVER_URL} --cwd ${app.path}`,
          ),
        );
      });
    });
  });
});
