import { describe, expect, it } from "vitest";

import { usePlatformMock } from "../helpers/platform";
import { anApp, aSetUpApp, type ScaffoldedApp } from "../helpers/project";

const platform = usePlatformMock();

/** A project configured against a self-hosted server, without being set up. */
async function aConfiguredApp(): Promise<ScaffoldedApp> {
  const app = await anApp();
  await app.writeConfig({
    project: "proj-001",
    server: "https://self.example",
    environments: { development: { issuer: "http://localhost:3000" } },
  });
  await app.writeLocalSecret("proj-001");
  return app;
}

describe("status", () => {
  describe("against an invalid server", () => {
    describe("that is not a zitadel api", () => {
      it("still succeeds", async () => {
        const app = await aSetUpApp();
        platform.isNotZitadel();

        const result = await app.status();

        expect(result).toSucceed();
      });
    });

    describe("that is down", () => {
      it("still succeeds", async () => {
        const app = await aSetUpApp();
        platform.isUnavailable();

        const result = await app.status();

        expect(result).toSucceed();
      });
    });

    describe("that refuses connections", () => {
      it("still succeeds", async () => {
        const app = await aSetUpApp();
        platform.refusesConnections();

        const result = await app.status();

        expect(result).toSucceed();
      });
    });
  });

  describe("against a valid server", () => {
    describe("--json", () => {
      it("offers plan while nobody has registered", async () => {
        const app = await aSetUpApp();

        const result = await app.status();

        expect(result).toSuggest("plan");
      });

      it("withholds apply while nobody has registered", async () => {
        const app = await aSetUpApp();

        const result = await app.status();

        expect(result).not.toSuggest("apply");
      });

      it("asks for a registered user before anything else", async () => {
        const app = await aSetUpApp();

        const result = await app.status();

        const { data } = app.envelopeOf<{ next_actions: string[] }>(result);
        expect(data.next_actions.join("\n")).toContain("register a user");
      });

      it("calls config pointing at a project that no longer exists orphaned", async () => {
        const app = await anApp();
        await app.writeConfig({
          $schema: "https://schemas.zitadel.com/v2/project.schema.json",
          project: "orphan",
          server: "https://api.zitadel.cloud",
        });

        const result = await app.status();

        expect(
          app.envelopeOf<{ project: { lifecycle: string } }>(result).data.project.lifecycle,
        ).toBe("orphaned-config");
      });
    });

    describe("rendered for a terminal", () => {
      it("names the project", async () => {
        const app = await aConfiguredApp();

        const result = await app.runWithoutServer(["status", "--server", "https://self.example"]);

        expect(result).toPrint("Zitadel status.");
        expect(result).toPrint("project=proj-001");
      });

      it("names a non-default server", async () => {
        const app = await aConfiguredApp();

        const result = await app.runWithoutServer(["status", "--server", "https://self.example"]);

        expect(result).toPrint("(server: self.example)");
      });

      it("renders text rather than a json envelope", async () => {
        const app = await aConfiguredApp();

        const result = await app.runWithoutServer(["status", "--server", "https://self.example"]);

        expect(result).toPrintNoJson();
      });

      it("closes with what to do next", async () => {
        const app = await aConfiguredApp();

        const result = await app.runWithoutServer(["status", "--server", "https://self.example"]);

        expect(result).toPrint("Next:");
      });
    });
  });
});
