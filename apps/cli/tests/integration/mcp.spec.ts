import { describe, expect, it } from "vitest";

import { usePlatformMock } from "../helpers/platform";
import { aSetUpApp } from "../helpers/project";

const platform = usePlatformMock();

describe("mcp", () => {
  describe("against an invalid server", () => {
    describe("that is not a zitadel api", () => {
      it("still lists its tools, asking no server", async () => {
        const app = await aSetUpApp();
        platform.isNotZitadel();

        const tools = await app.mcpTools();

        expect(tools).toContain("getVariables");
      });

      it("answers a call with an error result", async () => {
        const app = await aSetUpApp();
        platform.isNotZitadel();

        const result = await app.mcpCall("getVariables", {});

        expect(result.isError).toBe(true);
      });
    });

    describe("that is down", () => {
      it("answers a call with an error result", async () => {
        const app = await aSetUpApp();
        platform.isUnavailable();

        const result = await app.mcpCall("getVariables", {});

        expect(result.isError).toBe(true);
      });
    });
  });

  describe("against a valid server", () => {
    describe("--json", () => {
      it("is refused, since stdout carries the protocol", async () => {
        const app = await aSetUpApp();

        const result = await app.mcpRefusing("--json", "--non-interactive");

        expect(result).toFailWith("E_VALIDATION");
      });
    });

    describe("as an MCP client starts it", () => {
      it("answers a call with the operation's response body", async () => {
        const app = await aSetUpApp();
        expect(await app.setVariable("FOO", "bar")).toSucceed();

        const result = await app.mcpCall("getVariable", { variable_name: "FOO" });

        expect(JSON.parse(result.text)).toMatchObject({ primary: "bar" });
      });

      it("offers no tool that writes without --allow-writes", async () => {
        const app = await aSetUpApp();

        const result = await app.mcpCall("updateVariables", { body: { FOO: "bar" } });

        expect(result.refused).toContain("updateVariables");
      });

      it("writes what a call says with --allow-writes", async () => {
        const app = await aSetUpApp();

        await app.mcpCall("updateVariables", { body: { FOO: "bar" } }, "--allow-writes");

        expect(app.envelopeOf(await app.getVariable("FOO")).data).toMatchObject({ value: "bar" });
      });

      it("sends no write on a dry run", async () => {
        const app = await aSetUpApp();

        await app.mcpCall(
          "updateVariables",
          { body: { FOO: "bar" } },
          "--allow-writes",
          "--dry-run",
        );

        expect(await app.projectVariables()).toEqual([]);
      });
    });
  });
});
