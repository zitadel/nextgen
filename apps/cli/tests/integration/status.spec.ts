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
  describe("against an unavailable platform", () => {
    it("still reports when the platform is unavailable", async () => {
      const app = await aSetUpApp();
      platform.isUnavailable();

      const result = await app.status();

      expect(result).toSucceed();
    });
  });

  describe("against the platform", () => {
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

        expect(result).toSay("Zitadel status.");
        expect(result).toSay("project=proj-001");
      });

      it("names a non-default server", async () => {
        const app = await aConfiguredApp();

        const result = await app.runWithoutServer(["status", "--server", "https://self.example"]);

        expect(result).toSay("(server: self.example)");
      });

      it("closes with what to do next", async () => {
        const app = await aConfiguredApp();

        const result = await app.runWithoutServer(["status", "--server", "https://self.example"]);

        expect(result).toSay("Next:");
      });
    });
  });
});
