import { describe, expect, it } from "vitest";

import { usePlatformMock } from "../helpers/platform";
import { anApp, type ScaffoldedApp } from "../helpers/project";

const platform = usePlatformMock();

/** A Next 15 app through setup, carrying a README the developer wrote. */
async function aPatchedApp(): Promise<ScaffoldedApp> {
  const app = await anApp({ nextVersion: "^15.0.0" });
  await app.writeProjectFile("README.md", "# demo-next-app\n\nDeploy notes.\n");
  expect(await app.setup()).toSucceed();
  return app;
}

describe("eject", () => {
  describe("against an unavailable platform", () => {
    it("still removes the managed files", async () => {
      const app = await aPatchedApp();
      platform.isUnavailable();

      const result = await app.run(["eject", "--force", "--json"]);

      expect(result).toSucceed();
    });
  });

  describe("against the platform", () => {
    describe("--json", () => {
      it("reports the managed files it removed", async () => {
        const app = await aPatchedApp();

        const result = await app.run(["eject", "--force", "--json"]);

        expect(result).toSucceed();
        const { data } = app.envelopeOf<{ files_removed: string[] }>(result);
        expect(data.files_removed).toEqual(
          expect.arrayContaining([
            "app/login/page.tsx",
            "middleware.ts",
            "zitadel.json",
            ".zitadel",
          ]),
        );
      });

      it("reports the developer's own file as preserved", async () => {
        const app = await aPatchedApp();
        await app.writeProjectFile(
          "app/register/page.tsx",
          "export default function Page() { return null; }\n",
        );

        const result = await app.run(["eject", "--force", "--json"]);

        const { data } = app.envelopeOf<{ files_preserved: string[] }>(result);
        expect(data.files_preserved).toContain("app/register/page.tsx");
      });

      it("removes the managed files from the project", async () => {
        const app = await aPatchedApp();
        const before = await app.snapshot();

        await app.run(["eject", "--force", "--json"]);

        const { removed } = await before.changes();
        expect(removed).toEqual(
          expect.arrayContaining(["zitadel.json", "app/login/page.tsx", "middleware.ts"]),
        );
      });

      it("leaves the developer's own file in the project", async () => {
        const app = await aPatchedApp();
        await app.writeProjectFile(
          "app/register/page.tsx",
          "export default function Page() { return null; }\n",
        );
        const before = await app.snapshot();

        await app.run(["eject", "--force", "--json"]);

        const { unchanged } = await before.changes();
        expect(unchanged).toContain("app/register/page.tsx");
      });

      it("takes its own guidance file away and edits the developer's in place", async () => {
        const app = await aPatchedApp();
        const before = await app.snapshot();

        await app.run(["eject", "--force", "--json"]);

        const { removed, modified } = await before.changes();
        expect(removed).toContain("AGENTS.md");
        expect(modified).toContain("README.md");
      });
    });
  });
});
