import { describe, expect, it } from "vitest";

import { usePlatformMock } from "../helpers/platform";
import { aSetUpApp, MOCK_SERVER_URL } from "../helpers/project";

const platform = usePlatformMock();

interface Listing {
  readonly environments: Array<{ name: string; source: string; resolved: boolean }>;
}

describe("env list", () => {
  describe("against an invalid server", () => {
    describe("that is not a zitadel api", () => {
      it("still succeeds", async () => {
        const app = await aSetUpApp();
        platform.isNotZitadel();

        const result = await app.run(["env", "list", "--json"]);

        expect(result).toSucceed();
      });
    });

    describe("that is down", () => {
      it("still succeeds", async () => {
        const app = await aSetUpApp();
        platform.isUnavailable();

        const result = await app.run(["env", "list", "--json"]);

        expect(result).toSucceed();
      });
    });
  });

  describe("against a valid server", () => {
    describe("--json", () => {
      it("lists the environments bound in this directory", async () => {
        const app = await aSetUpApp();
        await app.bindEnvironment("production", {
          ZITADEL_URL: MOCK_SERVER_URL,
          ZITADEL_PROJECT_ID: "proj_prod",
        });

        const result = await app.run(["env", "list", "--json"]);

        expect(
          app.envelopeOf<Listing>(result).data.environments.map((entry) => entry.name),
        ).toEqual(["development", "production"]);
      });

      it("leaves out a file that binds no project", async () => {
        const app = await aSetUpApp();
        await app.bindEnvironment("scratch", { ZITADEL_URL: MOCK_SERVER_URL });

        const result = await app.run(["env", "list", "--json"]);

        expect(
          app.envelopeOf<Listing>(result).data.environments.map((entry) => entry.name),
        ).not.toContain("scratch");
      });

      it("marks the environment that resolves now", async () => {
        const app = await aSetUpApp();
        await app.bindEnvironment("production", {
          ZITADEL_URL: MOCK_SERVER_URL,
          ZITADEL_PROJECT_ID: "proj_prod",
        });

        const result = await app.run(["env", "list", "--env", "production", "--json"]);

        expect(
          app.envelopeOf<Listing>(result).data.environments.filter((entry) => entry.resolved),
        ).toEqual([expect.objectContaining({ name: "production" })]);
      });

      it("includes the process environment when it carries a project", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["env", "list", "--json"], { ZITADEL_PROJECT_ID: "proj_ci" });

        expect(
          app.envelopeOf<Listing>(result).data.environments.map((entry) => entry.source),
        ).toContain("process environment");
      });
    });

    describe("rendered for a terminal", () => {
      it("says which environment resolves now", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["env", "list"]);

        expect(result).toPrint("Resolved now: development");
      });

      it("points at env add when nothing is bound", async () => {
        const app = await aSetUpApp();
        await app.deleteProjectFile(".env.development.local");

        const result = await app.run(["env", "list"]);

        expect(result).toPrint("zitadel env add");
      });
    });
  });
});
