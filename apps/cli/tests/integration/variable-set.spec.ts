import { describe, expect, it } from "vitest";

import { usePlatformMock } from "@tests/helpers/platform";
import { aSetUpApp, anUndeployedEnvironment } from "@tests/helpers/project";
import { cliVersion, expectedPublicCliCommand, pressCtrlC } from "@tests/helpers/run-cli";
import { asTerminal, offTerminal, onTerminalReadingAFile } from "@tests/helpers/terminal";

const platform = usePlatformMock();

const DEPLOY_ACTION =
  "The new value applies after the next deploy: sign-ins keep using the variables the last deploy froze.";
const PREVIEW_ACTION =
  "The new preview value applies to the next preview: a preview build keeps using the variables its last deploy froze.";

describe("variable set", () => {
  describe("a name the platform cannot accept", () => {
    // Every command that names a variable refuses the name itself, so neither a
    // dry run nor a confirmation can report work the platform would never do.
    it.each([
      ["GOOGLE-CLIENT", 'Invalid variable name "GOOGLE-CLIENT".'],
      ["a.b", 'Invalid variable name "a.b".'],
      ["has space", 'Invalid variable name "has space".'],
      ["A\u001b[2J", 'Invalid variable name "A\u001b[2J".'],
    ])("is refused for %j", async (name, message) => {
      const app = await aSetUpApp();

      const result = await app.setVariable(name, "x");

      expect(result).toFailWith("E_VALIDATION");
      expect(JSON.parse(result.stdout)).toEqual({
        status: "error",
        cli_version: cliVersion.version,
        command: "variable:set",
        source: "http://mock.zitadel.test",
        code: "E_VALIDATION",
        message,
        hint: "A variable name contains only letters, digits and underscores.",
      });
    });

    it("is refused for more characters than the limit", async () => {
      const app = await aSetUpApp();

      const result = await app.setVariable("A".repeat(256), "x");

      expect(JSON.parse(result.stdout)).toEqual({
        status: "error",
        cli_version: cliVersion.version,
        command: "variable:set",
        source: "http://mock.zitadel.test",
        code: "E_VALIDATION",
        message: "Variable name is 256 characters; the limit is 255.",
        hint: "Shorten the name.",
      });
    });

    it("is refused on a dry run too, which otherwise reports work it could not do", async () => {
      const app = await aSetUpApp();

      const result = await app.setVariable("GOOGLE-CLIENT", "x", { dryRun: true });

      expect(JSON.parse(result.stdout)).toEqual({
        status: "error",
        cli_version: cliVersion.version,
        command: "variable:set",
        source: "http://mock.zitadel.test",
        code: "E_VALIDATION",
        message: 'Invalid variable name "GOOGLE-CLIENT".',
        hint: "A variable name contains only letters, digits and underscores.",
      });
    });

    it("is spelled out for a person, where the envelope carries it as typed", async () => {
      const app = await aSetUpApp();

      const result = await app.run(["variable", "set", "A\u001b[2J", "x"]);

      expect(result).toSay('Invalid variable name "A\\x1b[2J".');
      expect(result.stdout + result.stderr).not.toContain("\u001b");
    });
  });

  describe("a dry run", () => {
    // What it says is read off the flags, so opening the connection would ask
    // for a credential to report work that needs none, as the resource
    // commands' own dry run does not.
    it("opens no connection, which a real write announces", async () => {
      const app = await aSetUpApp();

      const dry = await onTerminalReadingAFile(() => {
        return app.setVariableRendered("HOST", "app.acme.com", "--dry-run");
      });

      expect(dry).toSucceed();
      expect(dry).not.toSay("on mock.zitadel.test");
    });

    it("is the only one that does not, so the write still announces it", async () => {
      const app = await aSetUpApp();

      const written = await onTerminalReadingAFile(() => {
        return app.setVariableRendered("HOST", "app.acme.com");
      });

      expect(written).toSucceed();
      expect(written).toSay("on mock.zitadel.test");
    });

    it("says it would set the variable for both kinds, and suggests the write that pipes it in", async () => {
      const app = await aSetUpApp();

      const result = await app.setVariable("FOO", "bar", { dryRun: true });

      expect(JSON.parse(result.stdout)).toEqual({
        status: "ok",
        cli_version: cliVersion.version,
        command: "variable:set",
        source: "http://mock.zitadel.test",
        data: {
          dry_run: true,
          title: "Would set variable FOO on the project (dry run)",
          verb: "set",
          topic: "variable",
          id: "FOO",
          name: "FOO",
          type: "string",
          secret: false,
          kinds: ["primary", "preview"],
          next_commands: [
            `${expectedPublicCliCommand(app.againAsRun("variable set FOO"))} < value.txt`,
          ],
        },
        warnings: [],
      });
    });

    it("keeps a value given on the command line, with the type and kind that were typed", async () => {
      const app = await aSetUpApp();

      const result = await app.run([
        "variable",
        "set",
        "RETRIES",
        "5",
        "--as",
        "number",
        "--preview",
        "--dry-run",
        "--json",
      ]);

      expect(JSON.parse(result.stdout)).toEqual({
        status: "ok",
        cli_version: cliVersion.version,
        command: "variable:set",
        source: "http://mock.zitadel.test",
        data: {
          dry_run: true,
          title: "Would set variable RETRIES on the project as number (preview) (dry run)",
          verb: "set",
          topic: "variable",
          id: "RETRIES",
          name: "RETRIES",
          type: "number",
          secret: false,
          kinds: ["preview"],
          next_commands: [
            expectedPublicCliCommand(
              app.againAsRun("variable set RETRIES 5 --as number --preview"),
            ),
          ],
        },
        warnings: [],
      });
    });

    it("says it is a secret for the primary kind alone, and never carries a value", async () => {
      const app = await aSetUpApp();

      const result = await app.setVariable("TOKEN", "s3cret", { secret: true, dryRun: true });

      expect(JSON.parse(result.stdout)).toEqual({
        status: "ok",
        cli_version: cliVersion.version,
        command: "variable:set",
        source: "http://mock.zitadel.test",
        data: {
          dry_run: true,
          title: "Would set variable TOKEN on the project (secret) (dry run)",
          verb: "set",
          topic: "variable",
          id: "TOKEN",
          name: "TOKEN",
          type: "string",
          secret: true,
          kinds: ["primary"],
          next_commands: [
            `${expectedPublicCliCommand(app.againAsRun("variable set TOKEN --secret"))} < value.txt`,
          ],
        },
        warnings: [],
      });
      expect(result.stdout + result.stderr).not.toContain("s3cret");
    });

    it("enters nothing", async () => {
      const app = await aSetUpApp();

      await app.run(["variable", "set", "FOO", "bar", "--dry-run", "--json"]);

      expect(await app.projectVariables()).toEqual([]);
    });

    it("draws the headline the envelope carries", async () => {
      const app = await aSetUpApp();

      const result = await asTerminal(() =>
        app.run(["variable", "set", "FOO", "bar", "--dry-run"]),
      );

      expect(result).toPrint("Would set variable FOO on the project (dry run)");
    });

    it("refuses a secret value on the command line, as the write does", async () => {
      const app = await aSetUpApp();

      const result = await app.run([
        "variable",
        "set",
        "TOKEN",
        "s3cret",
        "--secret",
        "--dry-run",
        "--json",
      ]);

      expect(result).toFailWith("E_VALIDATION");
      expect(result.stdout + result.stderr).not.toContain("s3cret");
    });
  });

  describe("against an invalid server", () => {
    describe("that is not a zitadel api", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.isNotZitadel();

        const result = await app.setVariable("FOO", "bar");

        expect(result).toFailWith("E_NOT_FOUND");
        expect(JSON.parse(result.stdout)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "variable:set",
          source: "http://mock.zitadel.test",
          code: "E_NOT_FOUND",
          message: expect.stringMatching(
            /^PATCH http:\/\/mock\.zitadel\.test\/api\/v1\/variables\?project_id=proj-[0-9a-f]+ returned 404 — .* is this a Zitadel platform API\?$/,
          ),
          details: {
            status: 404,
            url: expect.stringMatching(
              /^http:\/\/mock\.zitadel\.test\/api\/v1\/variables\?project_id=proj-[0-9a-f]+$/,
            ),
            body: { raw: "<html>not here</html>" },
          },
        });
      });
    });

    describe("that is down", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.isUnavailable();

        const result = await app.setVariable("FOO", "bar");

        expect(result).toFailWith("E_NETWORK");
        expect(JSON.parse(result.stdout)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "variable:set",
          source: "http://mock.zitadel.test",
          code: "E_NETWORK",
          message: "down",
          details: {
            status: 503,
            url: expect.stringMatching(
              /^http:\/\/mock\.zitadel\.test\/api\/v1\/variables\?project_id=proj-[0-9a-f]+$/,
            ),
            body: { code: "unavailable", message: "down" },
          },
        });
      });
    });

    describe("that refuses connections", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.refusesConnections();

        const result = await app.setVariable("FOO", "bar");

        expect(result).toFailWith("E_NETWORK");
        expect(JSON.parse(result.stdout)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "variable:set",
          source: "http://mock.zitadel.test",
          code: "E_NETWORK",
          message: expect.stringMatching(
            /^PATCH http:\/\/mock\.zitadel\.test\/api\/v1\/variables\?project_id=proj-[0-9a-f]+ got no response$/,
          ),
          hint: "Check your connection and the server URL (ZITADEL_URL or --server).",
          details: {
            url: expect.stringMatching(
              /^http:\/\/mock\.zitadel\.test\/api\/v1\/variables\?project_id=proj-[0-9a-f]+$/,
            ),
            reason: "unreachable",
          },
        });
      });
    });

    describe("that hangs", () => {
      it("stops on Ctrl-C with one envelope and exit 130", async () => {
        const app = await aSetUpApp();
        const waiting = platform.hangs();

        const result = app.setVariable("FOO", "bar");
        await waiting;
        pressCtrlC();

        const cancelled = await result;
        expect(cancelled).toExitWith(130);
        expect(JSON.parse(cancelled.stdout)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "variable:set",
          source: "http://mock.zitadel.test",
          code: "E_CANCELLED",
          message: "Cancelled",
          hint: "The command was cancelled with Ctrl-C.",
        });
      });
    });
  });

  describe("against a valid server", () => {
    it("holds its invariants in every rendering", async () => {
      const app = await aSetUpApp();
      const args = ["variable", "set", "BANNER"];

      await app.inEveryRendering((how) =>
        app.pipingStdin("a\u001b[2Jwiped", () =>
          app.run(how.json ? [...args, "--json"] : args, how.env),
        ),
      );
    });

    describe("with no value piped in", () => {
      it("is refused, saying how to pipe it in", async () => {
        const app = await aSetUpApp();

        const result = await app.setVariableWithNothingPiped("FOO");

        expect(result).toFailWith("E_VALIDATION");
        expect(JSON.parse(result.stdout)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "variable:set",
          source: "http://mock.zitadel.test",
          code: "E_VALIDATION",
          message: "No value for FOO supplied",
          hint: `Pipe it in on stdin. For example: ${expectedPublicCliCommand(app.againAsRun("variable set FOO"))} < value.txt`,
          next_commands: [
            `${expectedPublicCliCommand(app.againAsRun("variable set FOO"))} < value.txt`,
          ],
        });
      });

      it("keeps --secret in the command it suggests, and says it is never a flag", async () => {
        const app = await aSetUpApp();

        const result = await app.setVariableWithNothingPiped("TOKEN", { secret: true });

        expect(JSON.parse(result.stdout)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "variable:set",
          source: "http://mock.zitadel.test",
          code: "E_VALIDATION",
          message: "No value for TOKEN supplied",
          hint: `Pipe it in on stdin. It is never a flag: that would put it in shell history, a process listing and CI logs. For example: ${expectedPublicCliCommand(app.againAsRun("variable set TOKEN --secret"))} < value.txt`,
          next_commands: [
            `${expectedPublicCliCommand(app.againAsRun("variable set TOKEN --secret"))} < value.txt`,
          ],
        });
      });

      it("enters nothing", async () => {
        const app = await aSetUpApp();

        await app.setVariableWithNothingPiped("FOO");

        expect(await app.projectVariables()).toEqual([]);
      });
    });

    describe("--json", () => {
      it("enters a plain value piped in", async () => {
        const app = await aSetUpApp();

        const result = await app.setVariable("FOO", "bar");

        expect(JSON.parse(result.stdout)).toEqual({
          status: "ok",
          cli_version: cliVersion.version,
          command: "variable:set",
          source: "http://mock.zitadel.test",
          data: {
            title: "Set FOO on the project",
            name: "FOO",
            type: "string",
            kinds: ["primary", "preview"],
            primary: { held: true, secret: false, value: "bar" },
            preview: { held: true, secret: false, value: "bar" },
            next_actions: [DEPLOY_ACTION],
            next_commands: [expectedPublicCliCommand(app.againAsRun("deploy -m '<what changed>'"))],
          },
          warnings: [],
        });
      });

      it("enters a plain value given on the command line", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["variable", "set", "FOO", "bar", "--json"]);

        expect(JSON.parse(result.stdout)).toEqual({
          status: "ok",
          cli_version: cliVersion.version,
          command: "variable:set",
          source: "http://mock.zitadel.test",
          data: {
            title: "Set FOO on the project",
            name: "FOO",
            type: "string",
            kinds: ["primary", "preview"],
            primary: { held: true, secret: false, value: "bar" },
            preview: { held: true, secret: false, value: "bar" },
            next_actions: [DEPLOY_ACTION],
            next_commands: [expectedPublicCliCommand(app.againAsRun("deploy -m '<what changed>'"))],
          },
          warnings: [],
        });
      });

      it("stores a number as a number", async () => {
        const app = await aSetUpApp();

        const result = await app.pipingStdin("5", () => {
          return app.run(["variable", "set", "RETRIES", "--as", "number", "--json"]);
        });

        expect(JSON.parse(result.stdout)).toEqual({
          status: "ok",
          cli_version: cliVersion.version,
          command: "variable:set",
          source: "http://mock.zitadel.test",
          data: {
            title: "Set RETRIES on the project",
            name: "RETRIES",
            type: "number",
            kinds: ["primary", "preview"],
            primary: { held: true, secret: false, value: 5 },
            preview: { held: true, secret: false, value: 5 },
            next_actions: [DEPLOY_ACTION],
            next_commands: [expectedPublicCliCommand(app.againAsRun("deploy -m '<what changed>'"))],
          },
          warnings: [],
        });
      });

      it("reads the secret back from the store as held without a value", async () => {
        const app = await aSetUpApp();

        const result = await app.setVariable("TOKEN", "s3cret", { secret: true });

        expect(JSON.parse(result.stdout)).toEqual({
          status: "ok",
          cli_version: cliVersion.version,
          command: "variable:set",
          source: "http://mock.zitadel.test",
          data: {
            title: "Set TOKEN on the project",
            name: "TOKEN",
            type: "string",
            kinds: ["primary"],
            primary: { held: true, secret: true },
            preview: { held: false },
            next_actions: [DEPLOY_ACTION],
            next_commands: [expectedPublicCliCommand(app.againAsRun("deploy -m '<what changed>'"))],
          },
          warnings: [],
        });
        expect(result.stdout + result.stderr).not.toContain("s3cret");
      });

      it("carries a control character in a value as it was given", async () => {
        const app = await aSetUpApp();

        const result = await app.setVariable("BANNER", "a\u001b[2Jwiped");

        expect(JSON.parse(result.stdout)).toEqual({
          status: "ok",
          cli_version: cliVersion.version,
          command: "variable:set",
          source: "http://mock.zitadel.test",
          data: {
            title: "Set BANNER on the project",
            name: "BANNER",
            type: "string",
            kinds: ["primary", "preview"],
            primary: { held: true, secret: false, value: "a\u001b[2Jwiped" },
            preview: { held: true, secret: false, value: "a\u001b[2Jwiped" },
            next_actions: [DEPLOY_ACTION],
            next_commands: [expectedPublicCliCommand(app.againAsRun("deploy -m '<what changed>'"))],
          },
          warnings: [],
        });
      });

      it("reports a preview write in the preview kind, with the primary value still standing", async () => {
        const app = await aSetUpApp();
        await app.setVariable("API_URL", "https://api.acme.com");

        const result = await app.setVariable("API_URL", "https://preview.acme.com", {
          preview: true,
        });

        expect(JSON.parse(result.stdout)).toEqual({
          status: "ok",
          cli_version: cliVersion.version,
          command: "variable:set",
          source: "http://mock.zitadel.test",
          data: {
            title: "Set API_URL on the project",
            name: "API_URL",
            type: "string",
            kinds: ["preview"],
            primary: { held: true, secret: false, value: "https://api.acme.com" },
            preview: { held: true, secret: false, value: "https://preview.acme.com" },
            next_actions: [PREVIEW_ACTION],
            next_commands: [
              expectedPublicCliCommand(
                app.againAsRun("preview --origin '<preview-url>' -m '<what changed>'"),
              ),
            ],
          },
          warnings: [],
        });
      });

      it("points a preview write to a preview, not the primary deploy", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["variable", "set", "FOO", "bar", "--preview", "--json"]);

        expect(JSON.parse(result.stdout).data.next_commands).toEqual([
          expectedPublicCliCommand(
            app.againAsRun("preview --origin '<preview-url>' -m '<what changed>'"),
          ),
        ]);
      });

      it("does not suggest a preview that the environment would skip", async () => {
        const app = await anUndeployedEnvironment();

        const result = await app.run([
          "variable",
          "set",
          "FOO",
          "bar",
          "--preview",
          "--env",
          "staging",
          "--json",
        ]);

        expect(JSON.parse(result.stdout)).toEqual({
          status: "ok",
          cli_version: cliVersion.version,
          command: "variable:set",
          source: "http://mock.zitadel.test",
          data: {
            title: "Set FOO on the project",
            name: "FOO",
            type: "string",
            kinds: ["preview"],
            primary: { held: false },
            preview: { held: true, secret: false, value: "bar" },
            next_actions: [
              PREVIEW_ACTION,
              "Run it in the preview or development environment: preview skips any other.",
            ],
            next_commands: [],
          },
          warnings: [],
        });
      });

      it("does not suggest a preview that a CI build naming no environment would skip", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["variable", "set", "FOO", "bar", "--preview", "--json"], {
          CI: "true",
        });

        expect(JSON.parse(result.stdout)).toEqual({
          status: "ok",
          cli_version: cliVersion.version,
          command: "variable:set",
          source: "http://mock.zitadel.test",
          data: {
            title: "Set FOO on the project",
            name: "FOO",
            type: "string",
            kinds: ["preview"],
            primary: { held: false },
            preview: { held: true, secret: false, value: "bar" },
            next_actions: [
              PREVIEW_ACTION,
              "Name the environment with --env preview: a CI build that names none is not known to be a preview, and preview skips it.",
            ],
            next_commands: [],
          },
          warnings: [],
        });
      });

      it("refuses a value on the command line for a secret", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["variable", "set", "TOKEN", "s3cret", "--secret", "--json"]);

        expect(result).toFailWith("E_VALIDATION");
        expect(JSON.parse(result.stdout)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "variable:set",
          source: "http://mock.zitadel.test",
          code: "E_VALIDATION",
          message: "A secret value is not given on the command line.",
          hint: "Drop the value and pipe it in, or let the prompt ask for it.",
        });
        expect(result.stdout + result.stderr).not.toContain("s3cret");
      });

      it("refuses a secret stored as another type", async () => {
        const app = await aSetUpApp();

        const result = await app.pipingStdin("5", () => {
          return app.run(["variable", "set", "TOKEN", "--secret", "--as", "number", "--json"]);
        });

        expect(result).toFailWith("E_VALIDATION");
        expect(JSON.parse(result.stdout)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "variable:set",
          source: "http://mock.zitadel.test",
          code: "E_VALIDATION",
          message: "A secret is stored as a string.",
          hint: "Drop --as, or drop --secret for a non-credential number or boolean.",
        });
      });

      it("refuses a value that is not the type asked for", async () => {
        const app = await aSetUpApp();

        const result = await app.run([
          "variable",
          "set",
          "RETRIES",
          "abc",
          "--as",
          "number",
          "--json",
        ]);

        expect(result).toFailWith("E_VALIDATION");
        expect(JSON.parse(result.stdout)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "variable:set",
          source: "http://mock.zitadel.test",
          code: "E_VALIDATION",
          message: '"abc" is not a valid number value.',
          hint: "A boolean variable is exactly true or false, and a number is a JSON number such as 5, -1.5 or 1e3. Pass --as string to keep it as text.",
        });
      });

      it("stores a plain value for both kinds", async () => {
        const app = await aSetUpApp();

        await app.setVariable("API_URL", "https://api.acme.com");

        expect(await app.projectVariables({ preview: true })).toEqual([
          { name: "API_URL", secret: false, value: "https://api.acme.com" },
        ]);
      });

      it("stores a secret for the primary kind only", async () => {
        const app = await aSetUpApp();

        await app.setVariable("TOKEN", "s3cret", { secret: true });

        expect(await app.projectVariables({ preview: true })).toEqual([]);
      });

      it("drops a preview value a secret replaces, so a preview keeps no plaintext copy", async () => {
        const app = await aSetUpApp();
        await app.setVariable("TOKEN", "plain");

        await app.setVariable("TOKEN", "s3cret", { secret: true });

        expect(await app.projectVariables({ preview: true })).toEqual([]);
      });

      it("refuses a plain preview value for a secret, naming the secret write to run instead", async () => {
        const app = await aSetUpApp();
        await app.setVariable("TOKEN", "s3cret", { secret: true });

        const result = await app.run(["variable", "set", "TOKEN", "plain", "--preview", "--json"]);

        expect(result).toFailWith("E_VALIDATION");
        expect(JSON.parse(result.stdout)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "variable:set",
          source: "http://mock.zitadel.test",
          code: "E_VALIDATION",
          message: "TOKEN is a secret, so its preview value must be one too.",
          hint: "Set the preview value with --secret, piped in or prompted for.",
          next_commands: [
            `${expectedPublicCliCommand(app.againAsRun("variable set TOKEN --secret --preview"))} < value.txt`,
          ],
        });
      });

      it("writes no plain preview value for a secret", async () => {
        const app = await aSetUpApp();
        await app.setVariable("TOKEN", "s3cret", { secret: true });

        await app.run(["variable", "set", "TOKEN", "plain", "--preview", "--json"]);

        expect(await app.projectVariables({ preview: true })).toEqual([]);
      });

      it("writes the preview value into its own kind", async () => {
        const app = await aSetUpApp();
        await app.setVariable("API_URL", "https://api.acme.com");

        await app.setVariable("API_URL", "https://preview.acme.com", { preview: true });

        expect(await app.projectVariables({ preview: true })).toEqual([
          { name: "API_URL", secret: false, value: "https://preview.acme.com" },
        ]);
      });

      it("leaves the primary kind alone on a preview write", async () => {
        const app = await aSetUpApp();
        await app.setVariable("API_URL", "https://api.acme.com");

        await app.setVariable("API_URL", "https://preview.acme.com", { preview: true });

        expect(await app.projectVariables()).toEqual([
          {
            name: "API_URL",
            secret: false,
            value: "https://api.acme.com",
            preview: { secret: false, value: "https://preview.acme.com" },
          },
        ]);
      });
    });

    describe("rendered for a terminal", () => {
      it("draws the headline naming the variable it set", async () => {
        const app = await aSetUpApp();

        const result = await asTerminal(() => app.run(["variable", "set", "FOO", "bar"]));

        expect(result).toPrint("Set FOO on the project");
      });

      it("shows what each kind now holds", async () => {
        const app = await aSetUpApp();

        const result = await asTerminal(() => app.run(["variable", "set", "FOO", "bar"]));

        expect(result).toPrintRow("primary", "bar");
        expect(result).toPrintRow("preview", "bar");
      });

      it("says a kind it left without a value is not set", async () => {
        const app = await aSetUpApp();

        const result = await asTerminal(() =>
          app.run(["variable", "set", "FOO", "bar", "--preview"]),
        );

        expect(result).toPrintRow("primary", "(not set)");
      });

      it("never prints a secret's value, and says it is held", async () => {
        const app = await aSetUpApp();

        const result = await asTerminal(() => {
          return app.pipingStdin("s3cret", () => {
            return app.run(["variable", "set", "TOKEN", "--secret"]);
          });
        });

        expect(result).toPrintRow("primary", "(secret)");
        expect(result.stdout + result.stderr).not.toContain("s3cret");
      });

      it("spells out a control character in the value it reports", async () => {
        const app = await aSetUpApp();

        const result = await asTerminal(() => {
          return app.pipingStdin("a\u001b[2Jwiped", () => app.run(["variable", "set", "BANNER"]));
        });

        expect(result.stdout).toContain("a\\x1b[2Jwiped");
        expect(result.stdout + result.stderr).not.toContain("\u001b");
      });
    });

    describe("piped", () => {
      it("carries the headline, what each kind holds and the next step", async () => {
        const app = await aSetUpApp();

        const result = await offTerminal(() => app.run(["variable", "set", "FOO", "bar"]));

        expect(result).toPrint("Set FOO on the project");
        expect(result).toPrintRow("primary", "bar");
        expect(result).toPrintRow("preview", "bar");
        expect(result).toPrint("deploy -m '<what changed>'");
      });

      it("says each step once", async () => {
        const app = await aSetUpApp();

        const result = await offTerminal(() => app.run(["variable", "set", "FOO", "bar"]));

        expect(result).toSayOnce("deploy -m '<what changed>'");
        expect(result).toSayOnce(DEPLOY_ACTION);
      });
    });
  });
});
