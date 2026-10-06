import { describe, expect, it } from "vitest";

import { usePlatformMock } from "../helpers/platform";
import { aSetUpApp } from "../helpers/project";

const platform = usePlatformMock();

describe("vars list", () => {
  describe("against an invalid server", () => {
    describe("that is not a zitadel api", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.isNotZitadel();

        const result = await app.run(["vars", "list", "--json"]);

        expect(result).toFailWith("E_NOT_FOUND");
      });
    });

    describe("that is down", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.isUnavailable();

        const result = await app.run(["vars", "list", "--json"]);

        expect(result).toFailWith("E_NETWORK");
      });
    });
  });

  describe("against a valid server", () => {
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

      it("withholds a secret's value", async () => {
        const app = await aSetUpApp();
        expect(await app.setVariable("TOKEN", "s3cret", { secret: true })).toSucceed();

        const listed = await app.projectVariables();

        const held = listed.find((variable) => variable.name === "TOKEN");
        expect(held).toMatchObject({ secret: true });
        expect(held).not.toHaveProperty("value");
      });
    });
  });
});
