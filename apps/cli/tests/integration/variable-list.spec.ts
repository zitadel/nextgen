import { describe, expect, it } from "vitest";

import { usePlatformMock } from "@tests/helpers/platform";
import { aSetUpApp } from "@tests/helpers/project";
import { pressCtrlC } from "@tests/helpers/run-cli";
import { asTerminal, offTerminal, RENDERINGS } from "@tests/helpers/terminal";

const platform = usePlatformMock();

describe("variable list", () => {
  describe("against an invalid server", () => {
    describe("that is not a zitadel api", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.isNotZitadel();

        const result = await app.run(["variable", "list", "--json"]);

        expect(result).toFailWith("E_NOT_FOUND");
      });
    });

    describe("that is down", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.isUnavailable();

        const result = await app.run(["variable", "list", "--json"]);

        expect(result).toFailWith("E_NETWORK");
      });
    });

    describe("that hangs", () => {
      it("stops on Ctrl-C", async () => {
        const app = await aSetUpApp();
        const waiting = platform.hangs();

        const result = app.run(["variable", "list", "--json"]);
        await waiting;
        pressCtrlC();

        expect(await result).toFailWith("E_CANCELLED");
      });
    });

    describe("that refuses connections", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.refusesConnections();

        const result = await app.run(["variable", "list", "--json"]);

        expect(result).toFailWith("E_NETWORK");
      });
    });
  });

  describe("against a valid server", () => {
    it("holds its invariants in every rendering", async () => {
      const app = await aSetUpApp();
      await app.setVariable("BANNER", "a\u001b[2Jwiped");

      await app.inEveryRendering((how) =>
        app.run(how.json ? ["variable", "list", "--json"] : ["variable", "list"], how.env),
      );
    });

    describe("--json", () => {
      it("shows a variable that was entered", async () => {
        const app = await aSetUpApp();
        expect(await app.setVariable("FOO", "bar")).toSucceed();

        const listed = await app.projectVariables();

        expect(listed).toEqual(expect.arrayContaining([expect.objectContaining({ name: "FOO" })]));
      });

      it("carries a plain value", async () => {
        const app = await aSetUpApp();
        expect(await app.setVariable("FOO", "bar")).toSucceed();

        const listed = await app.projectVariables();

        expect(listed.find((variable) => variable.name === "FOO")?.value).toBe("bar");
      });

      it("lists only the names that hold a preview value under --preview", async () => {
        const app = await aSetUpApp();
        expect(await app.setVariable("TOKEN", "s3cret", { secret: true })).toSucceed();
        expect(
          await app.setVariable("API_URL", "https://preview.acme.com", { preview: true }),
        ).toSucceed();

        const listed = await app.projectVariables({ preview: true });

        expect(listed.map((variable) => variable.name)).toEqual(["API_URL"]);
      });

      it("withholds a secret's value", async () => {
        const app = await aSetUpApp();
        expect(await app.setVariable("TOKEN", "s3cret", { secret: true })).toSucceed();

        const listed = await app.projectVariables();

        const held = listed.find((variable) => variable.name === "TOKEN");
        expect(held).toMatchObject({ secret: true });
        expect(held).not.toHaveProperty("value");
      });
    });

    describe("rendered for a terminal", () => {
      it.each(RENDERINGS)("prints a variable that was entered, %s", async (_how, colour) => {
        const app = await aSetUpApp();
        expect(await app.setVariable("FOO", "bar")).toSucceed();

        const result = await asTerminal(() => app.run(["variable", "list"], colour));

        expect(result).toPrintRow("FOO", "bar");
      });

      it.each(RENDERINGS)("spells out a value the server answered, %s", async (_how, colour) => {
        const app = await aSetUpApp();
        expect(await app.setVariable("BANNER", "a\u009bb")).toSucceed();

        const result = await asTerminal(() => app.run(["variable", "list"], colour));

        expect(result).toSucceed();
        expect(result.stdout).not.toContain("\u009b");
      });
    });

    describe("--plain", () => {
      it("prints each variable as a tab-separated record, piped", async () => {
        const app = await aSetUpApp();
        expect(await app.setVariable("FOO", "bar")).toSucceed();

        const result = await offTerminal(() => app.run(["variable", "list", "--plain"]));

        expect(result).toPrintPlainRows(["FOO", "bar", /.*/]);
      });

      it("prints nothing when no variable is entered, piped", async () => {
        const app = await aSetUpApp();

        const result = await offTerminal(() => app.run(["variable", "list", "--plain"]));

        expect(result).toSucceed();
        expect(result).toPrintPlainRows();
      });
    });
  });
});
