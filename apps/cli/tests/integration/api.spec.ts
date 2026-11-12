import { describe, expect, it } from "vitest";

import { usePlatformMock } from "@tests/helpers/platform";
import { anApp, aSetUpApp, MOCK_SERVER_URL, type ScaffoldedApp } from "@tests/helpers/project";
import { expectedPublicCliCommand, pressCtrlC } from "@tests/helpers/run-cli";

const platform = usePlatformMock();

/** Publishes a second revision of the user schema, so the schemas no longer fit one page of one. */
async function reviseUserSchema(app: ScaffoldedApp): Promise<void> {
  await app.editUserSchema((schema) => {
    schema.properties.company = { type: "string" };
  });
  expect(await app.publish()).toSucceed();
}

describe("api", () => {
  describe("against an invalid server", () => {
    describe("that is not a zitadel api", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.isNotZitadel();

        const result = await app.api("getVariables");

        expect(result).toFailWith("E_NOT_FOUND");
        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: expect.any(String),
          command: "api",
          source: "http://mock.zitadel.test",
          code: "E_NOT_FOUND",
          message: expect.stringContaining("is this a Zitadel platform API?"),
          details: {
            status: 404,
            url: expect.stringMatching(/\/variables\?project_id=\S+$/),
            body: "<html>not here</html>",
          },
        });
      });
    });

    describe("that is down", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.isUnavailable();

        const result = await app.api("getVariables");

        expect(result).toFailWith("E_NETWORK");
        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: expect.any(String),
          command: "api",
          source: "http://mock.zitadel.test",
          code: "E_NETWORK",
          message: "down",
          details: {
            status: 503,
            url: expect.stringMatching(/\/variables\?project_id=\S+$/),
            body: { code: "unavailable", message: "down" },
          },
        });
      });
    });

    describe("that hangs", () => {
      it("stops on Ctrl-C with one envelope", async () => {
        const app = await aSetUpApp();
        const waiting = platform.hangs();

        const result = app.api("getVariables");
        await waiting;
        pressCtrlC();

        const finished = await result;
        expect(finished).toFailWith("E_CANCELLED");
        expect(finished.exitCode).toBe(130);
        expect(app.envelopeOf(finished)).toEqual({
          status: "error",
          cli_version: expect.any(String),
          command: "api",
          source: "http://mock.zitadel.test",
          code: "E_CANCELLED",
          message: "Cancelled",
          hint: "The command was cancelled with Ctrl-C.",
        });
      });
    });
  });

  describe("asking for help", () => {
    it.each([["-h"], ["help"]])("prints the usage for %s", async (ask) => {
      const app = await aSetUpApp();

      const result = await app.apiRendered(ask);

      expect(result).toPrint("Call any operation of the Zitadel API");
    });

    it("ends with the usage, as --help does", async () => {
      const app = await aSetUpApp();

      const result = await app.apiRendered("help");

      expect(result.stdout).not.toMatch(/npx @zitadel\/cli@\S+ api ls/);
      expect(result.stdout.endsWith("\n\n")).toBe(false);
    });

    it("points to api ls under --json", async () => {
      const app = await aSetUpApp();

      const result = await app.api("help");

      expect(app.envelopeOf(result)).toEqual({
        status: "ok",
        cli_version: expect.any(String),
        command: "api",
        source: "",
        data: {
          title: "Done",
          next_commands: [expectedPublicCliCommand(`api ls --cwd ${app.path}`)],
        },
        warnings: [],
      });
    });
  });

  describe("against a valid server", () => {
    it("holds its invariants in every rendering", async () => {
      const app = await aSetUpApp();
      await app.addPrimaryOrigin();
      await app.setVariable("BANNER", "a\u001b[2Jwiped");
      await app.deployData();
      const args = ["api", "getVariables"];

      await app.inEveryRendering((how) => app.run(how.json ? [...args, "--json"] : args, how.env));
    });

    describe("--json", () => {
      it("answers with the operation's response body", async () => {
        const app = await aSetUpApp();
        expect(await app.setVariable("FOO", "bar")).toSucceed();

        const result = await app.api("getVariable", "FOO");

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: expect.any(String),
          command: "api",
          source: "http://mock.zitadel.test",
          data: { primary: "bar", preview: "bar" },
          warnings: [],
        });
      });

      it("carries a body holding a control character raw", async () => {
        const app = await aSetUpApp();
        expect(await app.setVariable("BANNER", "a\u001b[2Jwiped")).toSucceed();

        const result = await app.api("getVariable", "BANNER");

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: expect.any(String),
          command: "api",
          source: "http://mock.zitadel.test",
          data: { primary: "a\u001b[2Jwiped", preview: "a\u001b[2Jwiped" },
          warnings: [],
        });
      });

      it("writes what its fields say", async () => {
        const app = await aSetUpApp();

        const result = await app.api("updateVariables", "-F", "FOO=bar");

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: expect.any(String),
          command: "api",
          source: "http://mock.zitadel.test",
          data: { FOO: { primary: "bar", preview: "bar" } },
          warnings: [],
        });
        expect(app.envelopeOf(await app.getVariable("FOO")).data).toMatchObject({ value: "bar" });
      });

      it("writes the body piped in with --input -", async () => {
        const app = await aSetUpApp();

        const result = await app.apiPiping('{"FOO":"bar"}', "updateVariables", "--input", "-");

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: expect.any(String),
          command: "api",
          source: "http://mock.zitadel.test",
          data: { FOO: { primary: "bar", preview: "bar" } },
          warnings: [],
        });
        expect(app.envelopeOf(await app.getVariable("FOO")).data).toMatchObject({ value: "bar" });
      });

      it("answers a dry run with the request it would send", async () => {
        const app = await aSetUpApp();
        const { ZITADEL_PROJECT_ID } = await app.developmentValues();

        const result = await app.api("updateVariables", "-F", "FOO=bar", "--dry-run");

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: expect.any(String),
          command: "api",
          source: "http://mock.zitadel.test",
          data: {
            title: "Would call updateVariables (dry run)",
            dry_run: true,
            operation: "updateVariables",
            method: "PATCH",
            url: `http://mock.zitadel.test/api/v1/variables?project_id=${ZITADEL_PROJECT_ID}`,
            body: { FOO: "bar" },
          },
          warnings: [],
        });
      });

      it("leaves the body out of a dry run that has none", async () => {
        const app = await aSetUpApp();
        const { ZITADEL_PROJECT_ID } = await app.developmentValues();

        const result = await app.api("getVariable", "FOO", "--dry-run");

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: expect.any(String),
          command: "api",
          source: "http://mock.zitadel.test",
          data: {
            title: "Would call getVariable (dry run)",
            dry_run: true,
            operation: "getVariable",
            method: "GET",
            url: `http://mock.zitadel.test/api/v1/variables/FOO?project_id=${ZITADEL_PROJECT_ID}`,
          },
          warnings: [],
        });
      });

      it("carries a field holding a control character raw in a dry run", async () => {
        const app = await aSetUpApp();
        const { ZITADEL_PROJECT_ID } = await app.developmentValues();

        const result = await app.api("updateVariables", "-F", "FOO=a\u001b[2Jb", "--dry-run");

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: expect.any(String),
          command: "api",
          source: "http://mock.zitadel.test",
          data: {
            title: "Would call updateVariables (dry run)",
            dry_run: true,
            operation: "updateVariables",
            method: "PATCH",
            url: `http://mock.zitadel.test/api/v1/variables?project_id=${ZITADEL_PROJECT_ID}`,
            body: { FOO: "a\u001b[2Jb" },
          },
          warnings: [],
        });
      });

      it("answers a dry run of an operation that deletes without asking", async () => {
        const app = await aSetUpApp();
        const { ZITADEL_PROJECT_ID } = await app.developmentValues();

        const result = await app.api("deleteVariable", "FOO", "--dry-run");

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: expect.any(String),
          command: "api",
          source: "http://mock.zitadel.test",
          data: {
            title: "Would call deleteVariable (dry run)",
            dry_run: true,
            operation: "deleteVariable",
            method: "DELETE",
            url: `http://mock.zitadel.test/api/v1/variables/FOO?project_id=${ZITADEL_PROJECT_ID}`,
          },
          warnings: [],
        });
      });

      it("sends nothing with --dry-run", async () => {
        const app = await aSetUpApp();

        await app.api("updateVariables", "-F", "FOO=bar", "--dry-run");

        expect(await app.projectVariables()).toEqual([]);
      });

      it("gathers every page with --paginate", async () => {
        const app = await aSetUpApp();
        await reviseUserSchema(app);

        const all = await app.api("listSchemas", "-F", "limit=100");
        const total = app.envelopeOf<{ schemas: unknown[] }>(all).data.schemas.length;

        const result = await app.api("listSchemas", "-F", "limit=1", "--paginate");

        expect(total).toBeGreaterThan(1);
        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: expect.any(String),
          command: "api",
          source: "http://mock.zitadel.test",
          data: { schemas: expect.any(Array) },
          warnings: [],
        });
        expect(app.envelopeOf<{ schemas: unknown[] }>(result).data.schemas).toHaveLength(total);
      });

      it("calls the server the project's environment names", async () => {
        const app = await aSetUpApp();

        const result = await app.runWithoutServer([
          "api",
          "getVariables",
          "--non-interactive",
          "--json",
        ]);

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: expect.any(String),
          command: "api",
          source: MOCK_SERVER_URL,
          data: {},
          warnings: [],
        });
      });

      it("refuses a call that needs the project secret where no server is named", async () => {
        const app = await anApp();
        await app.writeLocalSecret("proj_local");

        const result = await app.runWithoutServer([
          "api",
          "getVariables",
          "--non-interactive",
          "--json",
        ]);

        expect(result).toFailWith("E_VALIDATION");
        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: expect.any(String),
          command: "api",
          source: "",
          code: "E_VALIDATION",
          message: "ZITADEL_URL is not set for the development environment",
          hint: "Consulted, in order: --server, process environment, .env.development.local, .env.local, .env.development, .env, .zitadel/secret. Set ZITADEL_URL in .env.development.local or the process environment.",
          details: {
            environment: "development",
            variable: "ZITADEL_URL",
            consulted: [
              "--server",
              "process environment",
              ".env.development.local",
              ".env.local",
              ".env.development",
              ".env",
              ".zitadel/secret",
            ],
          },
        });
      });

      it("fails as the server refuses", async () => {
        const app = await aSetUpApp();

        const result = await app.api("getVariable", "NOT_THERE");

        expect(result).toFailWith("E_NOT_FOUND");
        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: expect.any(String),
          command: "api",
          source: "http://mock.zitadel.test",
          code: "E_NOT_FOUND",
          message: "variable not found",
          details: {
            status: 404,
            url: expect.stringMatching(/\/variables\/NOT_THERE\?project_id=\S+$/),
            body: { code: "var.not_found", message: "variable not found" },
          },
        });
      });

      it("refuses an operation the spec does not have, and points to the list", async () => {
        const app = await aSetUpApp();

        const result = await app.api("nopeOp");

        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: expect.any(String),
          command: "api",
          source: "http://mock.zitadel.test",
          code: "E_VALIDATION",
          message: "No operation is called nopeOp",
          hint: `List them with ${expectedPublicCliCommand("api ls")}, or give a path such as /users/query.`,
          next_commands: [expectedPublicCliCommand(`api ls --json --cwd ${app.path}`)],
        });
      });

      it("carries an operation name holding a control character raw", async () => {
        const app = await aSetUpApp();

        const result = await app.api("a\u001b[2Jb");

        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: expect.any(String),
          command: "api",
          source: "http://mock.zitadel.test",
          code: "E_VALIDATION",
          message: "No operation is called a\u001b[2Jb",
          hint: `List them with ${expectedPublicCliCommand("api ls")}, or give a path such as /users/query.`,
          next_commands: [expectedPublicCliCommand(`api ls --json --cwd ${app.path}`)],
        });
      });

      it("refuses --paginate on an operation that does not page", async () => {
        const app = await aSetUpApp();

        const result = await app.api("getVariable", "FOO", "--paginate");

        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: expect.any(String),
          command: "api",
          source: "http://mock.zitadel.test",
          code: "E_VALIDATION",
          message: "getVariable does not page, so --paginate has nothing to follow",
          hint: "Leave out --paginate.",
        });
      });

      it("refuses an operation only an end user's session authenticates", async () => {
        const app = await aSetUpApp();

        const result = await app.api("getMyUser");

        expect(result).toFailWith("E_VALIDATION");
        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: expect.any(String),
          command: "api",
          source: "http://mock.zitadel.test",
          code: "E_VALIDATION",
          message:
            "getMyUser is authenticated by an end user's session cookie, and the CLI holds a project secret",
          hint: "Call it from the app it belongs to, through the SDK; the api ls command marks what the CLI can call.",
          next_commands: [expectedPublicCliCommand(`api ls --cwd ${app.path}`)],
        });
      });

      describe("without --force when no one can be asked", () => {
        it("is refused, with the question a person would be asked and the command to run again", async () => {
          const app = await aSetUpApp();
          expect(await app.setVariable("FOO", "bar")).toSucceed();

          const result = await app.api("deleteVariable", "FOO");

          expect(result).toFailWith("E_CONFIRMATION_REQUIRED");
          expect(app.envelopeOf(result)).toEqual({
            status: "error",
            cli_version: expect.any(String),
            command: "api",
            source: "http://mock.zitadel.test",
            code: "E_CONFIRMATION_REQUIRED",
            message: "Cannot call deleteVariable without --force in non-interactive mode",
            hint: `Ask a person first: Call deleteVariable in ${await app.projectPlace()}? Delete a variable by name. Pass --force only once they agree.`,
            next_commands: [
              expectedPublicCliCommand(app.againAsRun("api deleteVariable FOO --force")),
            ],
            details: {
              question: `Call deleteVariable in ${await app.projectPlace()}? Delete a variable by name.`,
            },
          });
        });

        it("deletes nothing", async () => {
          const app = await aSetUpApp();
          expect(await app.setVariable("FOO", "bar")).toSucceed();

          await app.api("deleteVariable", "FOO");

          expect(await app.projectVariables()).not.toEqual([]);
        });

        it("repeats nothing of a refused request's body, and says to run it again with --force", async () => {
          const app = await aSetUpApp();

          const result = await app.api("removePreview", "-F", "origin=https://pr-1.example.com");

          expect(app.envelopeOf(result)).toEqual({
            status: "error",
            cli_version: expect.any(String),
            command: "api",
            source: "http://mock.zitadel.test",
            code: "E_CONFIRMATION_REQUIRED",
            message: "Cannot call removePreview without --force in non-interactive mode",
            hint: `Ask a person first: Call removePreview in ${await app.projectPlace()}? Remove a preview. Once they agree, run the same command again, with its --field values or the pipe into --input, and add --force.`,
            details: {
              question: `Call removePreview in ${await app.projectPlace()}? Remove a preview.`,
            },
          });
        });
      });

      it("runs an operation that deletes with --force", async () => {
        const app = await aSetUpApp();
        expect(await app.setVariable("FOO", "bar")).toSucceed();

        const result = await app.api("deleteVariable", "FOO", "--force");

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: expect.any(String),
          command: "api",
          source: "http://mock.zitadel.test",
          data: null,
          warnings: [],
        });
        expect(await app.projectVariables()).toEqual([]);
      });

      it("sends a merge patch with a null without asking, as before", async () => {
        const app = await aSetUpApp();
        expect(await app.setVariable("FOO", "bar")).toSucceed();

        const result = await app.api("updateVariables", "-F", "FOO:=null");

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: expect.any(String),
          command: "api",
          source: "http://mock.zitadel.test",
          data: {},
          warnings: [],
        });
        expect(await app.projectVariables()).toEqual([]);
      });

      it.each([
        ["a dry run", ["getVariables", "--dry-run"]],
        ["a call", ["getVariables"]],
      ])("never carries the project secret, in %s", async (_what, args) => {
        const app = await aSetUpApp();

        const result = await app.api(...args);

        expect(result.stdout + result.stderr).not.toContain(
          (await app.developmentValues()).ZITADEL_PROJECT_SECRET,
        );
      });
    });

    describe("rendered for a terminal", () => {
      it("prints the response body", async () => {
        const app = await aSetUpApp();
        expect(await app.setVariable("FOO", "bar")).toSucceed();

        const result = await app.apiRendered("getVariable", "FOO");

        expect(JSON.parse(result.stdout)).toEqual({ primary: "bar", preview: "bar" });
      });

      it("prints the request as cURL with --dry-run", async () => {
        const app = await aSetUpApp();
        const { ZITADEL_PROJECT_ID } = await app.developmentValues();

        const result = await app.apiRendered("getVariables", "--dry-run");

        expect(result.stdout).toBe(
          `curl -X GET 'http://mock.zitadel.test/api/v1/variables?project_id=${ZITADEL_PROJECT_ID}' \\\n  -H "Authorization: Bearer $ZITADEL_PROJECT_SECRET"\n`,
        );
      });

      it("prints a dry run's body once, in its curl line", async () => {
        const app = await aSetUpApp();

        const result = await app.apiRendered("updateVariables", "-F", "FOO=bar", "--dry-run");

        expect(result.stdout.split('-d \'{"FOO":"bar"}\'')).toHaveLength(2);
      });

      // The line is there to be copied into a shell, so the secret has to stay
      // a reference to the environment: inlined, it would land in the shell's
      // history and in any CI log that kept the output.
      it("names the project secret rather than writing it out", async () => {
        const app = await aSetUpApp();

        const result = await app.apiRendered("getVariables", "--dry-run");

        expect(result).toPrint('-H "Authorization: Bearer $ZITADEL_PROJECT_SECRET"');
        expect(result.stdout + result.stderr).not.toContain(
          (await app.developmentValues()).ZITADEL_PROJECT_SECRET,
        );
      });

      it("sends no credential for an operation that needs none", async () => {
        const app = await aSetUpApp();
        const result = await app.apiRendered("getLive", "--dry-run");

        expect(result.stdout).toBe("curl -X GET 'http://mock.zitadel.test/api/v1/livez'\n");
      });

      it("gives a pipe a body that parses back to what the server answered", async () => {
        const app = await aSetUpApp();
        expect(await app.setVariable("BANNER", "a\u009bb")).toSucceed();

        const result = await app.apiRendered("getVariable", "BANNER");

        expect(result).toSucceed();
        expect(result.stdout).not.toContain("\u009b");
        expect(JSON.parse(result.stdout)).toEqual({ primary: "a\u009bb", preview: "a\u009bb" });
      });

      it("spells out a control character in a dry run's body the way JSON does", async () => {
        const app = await aSetUpApp();

        const result = await app.apiRendered(
          "updateVariables",
          "-F",
          "FOO=a\u001b[2Jb",
          "--dry-run",
        );

        expect(result.stdout).toContain(`-d '{"FOO":"a\\u001b[2Jb"}'`);
        expect(result.stdout).not.toContain("\u001b");
      });

      it("spells out a control character in the operation it refuses", async () => {
        const app = await aSetUpApp();

        const result = await app.apiRendered("a\u001b[2Jb");

        expect(result).toSay("No operation is called a\\x1b[2Jb");
        expect(result.stderr).not.toContain("\u001b");
      });

      it("says what it refuses, and the command to run again, once each", async () => {
        const app = await aSetUpApp();
        expect(await app.setVariable("FOO", "bar")).toSucceed();

        const result = await app.apiRendered("deleteVariable", "FOO");

        expect(result).toSayOnce(
          `Call deleteVariable in ${await app.projectPlace()}? Delete a variable by name.`,
        );
        expect(result).toSayOnce(
          expectedPublicCliCommand(app.againAsRun("api deleteVariable FOO --force")),
        );
      });

      it("says nothing on stdout for an answer without content", async () => {
        const app = await aSetUpApp();
        expect(await app.setVariable("FOO", "bar")).toSucceed();

        const result = await app.apiRendered("deleteVariable", "FOO", "--force");

        expect(result.stdout).toBe("");
      });
    });
  });
});
