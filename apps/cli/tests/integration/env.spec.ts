import { describe, expect, it } from "vitest";

import { usePlatformMock } from "../helpers/platform";
import { aSetUpApp } from "../helpers/project";

const platform = usePlatformMock();

interface Resolution {
  readonly values: Array<{ variable: string; value: string; source: string }>;
}

describe("env", () => {
  describe("against an invalid server", () => {
    describe("that is not a zitadel api", () => {
      it("still succeeds", async () => {
        const app = await aSetUpApp();
        platform.isNotZitadel();

        const result = await app.run(["env", "--json"]);

        expect(result).toSucceed();
      });
    });

    describe("that is down", () => {
      it("still succeeds", async () => {
        const app = await aSetUpApp();
        platform.isUnavailable();

        const result = await app.run(["env", "--json"]);

        expect(result).toSucceed();
      });
    });
  });

  describe("against a valid server", () => {
    describe("--json", () => {
      it("names the file a set-up project resolves from", async () => {
        const app = await aSetUpApp();

        const result = await app.runWithoutServer(["env", "--json"]);

        expect(app.envelopeOf<Resolution>(result).data.values).toContainEqual(
          expect.objectContaining({
            variable: "ZITADEL_PROJECT_ID",
            source: ".env.development.local",
          }),
        );
      });

      it("resolves the environment --env names", async () => {
        const app = await aSetUpApp();
        await app.bindEnvironment("production", {
          ZITADEL_URL: "https://prod.example",
          ZITADEL_PROJECT_ID: "proj_prod",
        });

        const result = await app.runWithoutServer(["env", "--env", "production", "--json"]);

        expect(app.envelopeOf<Resolution>(result).data.values).toContainEqual(
          expect.objectContaining({ variable: "ZITADEL_PROJECT_ID", value: "proj_prod" }),
        );
      });

      it("resolves the values of the file --env-file names", async () => {
        const app = await aSetUpApp();
        const file = await app.writeEnvFile("staging.env", {
          ZITADEL_URL: "https://staging.example",
          ZITADEL_PROJECT_ID: "proj_staging",
        });

        const result = await app.runWithoutServer(["env", "--env-file", file, "--json"]);

        expect(app.envelopeOf<Resolution>(result).data.values).toContainEqual(
          expect.objectContaining({ variable: "ZITADEL_PROJECT_ID", value: "proj_staging" }),
        );
      });

      it("refuses --env together with --env-file", async () => {
        const app = await aSetUpApp();
        const file = await app.writeEnvFile("staging.env", { ZITADEL_PROJECT_ID: "proj_staging" });

        const result = await app.run(["env", "--env", "production", "--env-file", file, "--json"]);

        expect(result).toFailWith("E_VALIDATION");
      });

      it("withholds the rest of a secret", async () => {
        const app = await aSetUpApp();
        await app.bindEnvironment("production", {
          ZITADEL_PROJECT_ID: "proj_prod",
          ZITADEL_PROJECT_SECRET: "sk_0123456789abcdef",
        });

        const result = await app.run(["env", "--env", "production", "--json"]);

        expect(result.stdout).not.toContain("sk_0123456789abcdef");
      });

      it("never shows a short secret whole", async () => {
        const app = await aSetUpApp();
        await app.bindEnvironment("production", {
          ZITADEL_PROJECT_ID: "proj_prod",
          ZITADEL_PROJECT_SECRET: "sk_short",
        });

        const result = await app.run(["env", "--env", "production", "--json"]);

        expect(result.stdout).not.toContain("sk_short");
      });
    });

    describe("rendered for a terminal", () => {
      it("names the environment", async () => {
        const app = await aSetUpApp();

        const result = await app.runWithoutServer(["env"]);

        expect(result).toPrint("Environment development (from default)");
      });

      it("lists the files it looked in", async () => {
        const app = await aSetUpApp();

        const result = await app.runWithoutServer(["env"]);

        expect(result).toPrint("Consulted, in order:");
      });

      it("renders text rather than a json envelope", async () => {
        const app = await aSetUpApp();

        const result = await app.runWithoutServer(["env"]);

        expect(result).toPrintNoJson();
      });
    });
  });
});
