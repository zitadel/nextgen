import { describe, expect, it } from "vitest";

import { usePlatformMock } from "../helpers/platform";
import { aSetUpApp } from "../helpers/project";

const platform = usePlatformMock();

describe("start", () => {
  describe("against an invalid server", () => {
    describe("that is not a zitadel api", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.isNotZitadel();

        const result = await app.run(["start", "--port", "0", "--json"]);

        expect(result).toFailWith("E_VALIDATION");
      });
    });

    describe("that is down", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.isUnavailable();

        const result = await app.run(["start", "--port", "0", "--json"]);

        expect(result).toFailWith("E_VALIDATION");
      });
    });
  });

  describe("against a valid server", () => {
    describe("--json", () => {
      it("refuses a port outside the usable range", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["start", "--port", "99999", "--json"]);

        expect(result).toFailWith("E_VALIDATION");
        expect(result).toExplain("Invalid port 99999");
      });

      it("refuses port zero", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["start", "--port", "0", "--json"]);

        expect(result).toExplain("Invalid port 0");
      });

      it("refuses an image for a runtime that takes none", async () => {
        const app = await aSetUpApp();

        const result = await app.run([
          "start",
          "--runtime",
          "binary",
          "--image",
          "zitadel:latest",
          "--json",
        ]);

        expect(result).toFailWith("E_VALIDATION");
        expect(result).toExplain("--image requires --runtime docker");
      });
    });
  });
});
