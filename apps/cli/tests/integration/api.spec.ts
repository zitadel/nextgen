import { describe, expect, it } from "vitest";

import { usePlatformMock } from "@tests/helpers/platform";
import { anApp, aSetUpApp, MOCK_SERVER_URL, type ScaffoldedApp } from "@tests/helpers/project";

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

        const result = await app.api("listVariables");

        expect(result).toFailWith("E_NOT_FOUND");
      });
    });

    describe("that is down", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.isUnavailable();

        const result = await app.api("listVariables");

        expect(result).toFailWith("E_NETWORK");
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
    });

    it("points to api ls under --json", async () => {
      const app = await aSetUpApp();

      const result = await app.api("help");

      expect(app.envelopeOf(result)).toMatchObject({
        command: "api",
        data: { next_commands: [expect.stringMatching(/ api ls$/)] },
      });
    });
  });

  describe("against a valid server", () => {
    it("holds its invariants in every rendering", async () => {
      const app = await aSetUpApp();
      await app.addPrimaryOrigin();
      await app.setVariable("BANNER", "a\u001b[2Jwiped");
      await app.deployData();
      const args = ["api", "listVariables"];

      await app.inEveryRendering((how) => app.run(how.json ? [...args, "--json"] : args, how.env));
    });

    describe("--json", () => {
      it("answers with the operation's response body", async () => {
        const app = await aSetUpApp();
        expect(await app.setVariable("FOO", "bar")).toSucceed();

        const result = await app.api("getVariable", "FOO");

        expect(result).toSucceed();
        expect(app.envelopeOf(result).data).toMatchObject({ primary: "bar" });
      });

      it("writes what its fields say", async () => {
        const app = await aSetUpApp();

        await app.api("setVariables", "-F", "FOO=bar");

        expect(app.envelopeOf(await app.getVariable("FOO")).data).toMatchObject({ value: "bar" });
      });

      it("writes the body piped in with --input -", async () => {
        const app = await aSetUpApp();

        await app.apiPiping('{"FOO":"bar"}', "setVariables", "--input", "-");

        expect(app.envelopeOf(await app.getVariable("FOO")).data).toMatchObject({ value: "bar" });
      });

      it("sends nothing with --dry-run", async () => {
        const app = await aSetUpApp();

        await app.api("setVariables", "-F", "FOO=bar", "--dry-run");

        expect(await app.projectVariables()).toEqual([]);
      });

      it("gathers every page with --paginate", async () => {
        const app = await aSetUpApp();
        await reviseUserSchema(app);

        const all = await app.api("listSchemas", "-F", "limit=100");
        const total = app.envelopeOf<{ schemas: unknown[] }>(all).data.schemas.length;

        const result = await app.api("listSchemas", "-F", "limit=1", "--paginate");

        expect(total).toBeGreaterThan(1);
        expect(app.envelopeOf<{ schemas: unknown[] }>(result).data.schemas).toHaveLength(total);
      });

      it("calls the server the project's environment names", async () => {
        const app = await aSetUpApp();

        const result = await app.runWithoutServer([
          "api",
          "listVariables",
          "--non-interactive",
          "--json",
        ]);

        expect(app.envelopeOf(result).source).toBe(MOCK_SERVER_URL);
      });

      it("refuses a call that needs the project secret where no server is named", async () => {
        const app = await anApp();
        await app.writeLocalSecret("proj_local");

        const result = await app.runWithoutServer([
          "api",
          "listVariables",
          "--non-interactive",
          "--json",
        ]);

        expect(result).toFailWith("E_VALIDATION");
      });

      it("fails as the server refuses", async () => {
        const app = await aSetUpApp();

        const result = await app.api("getVariable", "NOT_THERE");

        expect(result).toFailWith("E_NOT_FOUND");
      });

      describe("without --force when no one can be asked", () => {
        it("is refused", async () => {
          const app = await aSetUpApp();
          expect(await app.setVariable("FOO", "bar")).toSucceed();

          const result = await app.api("deleteVariable", "FOO");

          expect(result).toFailWith("E_CONFIRMATION_REQUIRED");
        });

        it("says to pass --force", async () => {
          const app = await aSetUpApp();
          expect(await app.setVariable("FOO", "bar")).toSucceed();

          const result = await app.api("deleteVariable", "FOO");

          expect(result).toHintAt("--force");
        });

        it("suggests running it again with --force", async () => {
          const app = await aSetUpApp();
          expect(await app.setVariable("FOO", "bar")).toSucceed();

          const result = await app.api("deleteVariable", "FOO");

          expect(result).toSuggestExactly(app.againAsRun("api deleteVariable FOO --force"));
        });

        it("deletes nothing", async () => {
          const app = await aSetUpApp();
          expect(await app.setVariable("FOO", "bar")).toSucceed();

          await app.api("deleteVariable", "FOO");

          expect(await app.projectVariables()).not.toEqual([]);
        });
      });

      it("runs an operation that deletes with --force", async () => {
        const app = await aSetUpApp();
        expect(await app.setVariable("FOO", "bar")).toSucceed();

        await app.api("deleteVariable", "FOO", "--force");

        expect(await app.projectVariables()).toEqual([]);
      });

      it("does not repeat a refused request's body in its suggestion", async () => {
        const app = await aSetUpApp();

        const result = await app.api(
          "removeProjectPreview",
          "-F",
          "origin=https://pr-1.example.com",
        );

        expect(result).not.toSuggest("pr-1.example.com");
      });

      it("says to run a refused request with a body again with --force", async () => {
        const app = await aSetUpApp();

        const result = await app.api(
          "removeProjectPreview",
          "-F",
          "origin=https://pr-1.example.com",
        );

        expect(result).toHintAt("Once they agree, run the same command again");
      });

      it("sends a merge patch with a null without asking, as before", async () => {
        const app = await aSetUpApp();
        expect(await app.setVariable("FOO", "bar")).toSucceed();

        await app.api("setVariables", "-F", "FOO:=null");

        expect(await app.projectVariables()).toEqual([]);
      });

      it("refuses an operation only an end user's session authenticates", async () => {
        const app = await aSetUpApp();

        const result = await app.api("getMyUser");

        expect(result).toFailWith("E_VALIDATION");
      });
    });

    describe("rendered for a terminal", () => {
      it("prints the response body", async () => {
        const app = await aSetUpApp();
        expect(await app.setVariable("FOO", "bar")).toSucceed();

        const result = await app.apiRendered("getVariable", "FOO");

        expect(result).toPrint('"primary": "bar"');
      });

      it("prints the request as cURL with --dry-run", async () => {
        const app = await aSetUpApp();

        const result = await app.apiRendered("listVariables", "--dry-run");

        expect(result).toPrint("curl -X GET");
      });

      // The line is there to be copied into a shell, so the secret has to stay
      // a reference to the environment: inlined, it would land in the shell's
      // history and in any CI log that kept the output.
      it("names the project secret rather than writing it out", async () => {
        const app = await aSetUpApp();

        const result = await app.apiRendered("listVariables", "--dry-run");

        expect(result).toPrint('-H "Authorization: Bearer $ZITADEL_PROJECT_SECRET"');
        expect(result.stdout).not.toContain((await app.developmentValues()).ZITADEL_PROJECT_SECRET);
      });

      it("sends no credential for an operation that needs none", async () => {
        const app = await aSetUpApp();

        const result = await app.apiRendered("getLive", "--dry-run");

        expect(result).toPrint("curl -X GET");
        expect(result.stdout).not.toContain("Authorization");
      });

      it("gives a pipe a body that parses back to what the server answered", async () => {
        const app = await aSetUpApp();
        expect(await app.setVariable("BANNER", "a\u009bb")).toSucceed();

        const result = await app.apiRendered("getVariable", "BANNER");

        expect(result).toSucceed();
        expect(result.stdout).not.toContain("\u009b");
        expect(JSON.parse(result.stdout)).toMatchObject({ primary: "a\u009bb" });
      });
    });
  });
});
