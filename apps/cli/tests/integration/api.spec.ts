import { describe, expect, it } from "vitest";

import { usePlatformMock } from "../helpers/platform";
import { aSetUpApp, type ScaffoldedApp } from "../helpers/project";

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
      });
    });

    describe("that is down", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.isUnavailable();

        const result = await app.api("getVariables");

        expect(result).toFailWith("E_NETWORK");
      });
    });
  });

  describe("against a valid server", () => {
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

        await app.api("updateVariables", "-F", "FOO=bar");

        expect(app.envelopeOf(await app.getVariable("FOO")).data).toMatchObject({ value: "bar" });
      });

      it("writes the body piped in with --input -", async () => {
        const app = await aSetUpApp();

        await app.apiPiping('{"FOO":"bar"}', "updateVariables", "--input", "-");

        expect(app.envelopeOf(await app.getVariable("FOO")).data).toMatchObject({ value: "bar" });
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
        expect(app.envelopeOf<{ schemas: unknown[] }>(result).data.schemas).toHaveLength(total);
      });

      it("fails as the server refuses", async () => {
        const app = await aSetUpApp();

        const result = await app.api("getVariable", "NOT_THERE");

        expect(result).toFailWith("E_NOT_FOUND");
      });

      it("refuses an operation that deletes without --force", async () => {
        const app = await aSetUpApp();
        expect(await app.setVariable("FOO", "bar")).toSucceed();

        const result = await app.api("deleteVariable", "FOO");

        expect(result).toFailWith("E_VALIDATION");
      });

      it("deletes nothing when it refuses", async () => {
        const app = await aSetUpApp();
        expect(await app.setVariable("FOO", "bar")).toSucceed();

        await app.api("deleteVariable", "FOO");

        expect(await app.projectVariables()).not.toEqual([]);
      });

      it("runs an operation that deletes with --force", async () => {
        const app = await aSetUpApp();
        expect(await app.setVariable("FOO", "bar")).toSucceed();

        await app.api("deleteVariable", "FOO", "--force");

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

        const result = await app.apiRendered("getVariables", "--dry-run");

        expect(result).toPrint("curl -X GET");
      });
    });
  });
});
