import { describe, expect, it } from "vitest";

import { usePlatformMock } from "../helpers/platform";
import { aSetUpApp, type ScaffoldedApp } from "../helpers/project";

const platform = usePlatformMock();

/** Downgrades the app below the version the CLI supports. */
function downgradeTheFramework(app: ScaffoldedApp): Promise<void> {
  return app.editPackageJson((pkg) => {
    pkg.dependencies.next = "^14.2.0";
  });
}

describe("doctor", () => {
  describe("against an unavailable platform", () => {
    it("still checks the project", async () => {
      const app = await aSetUpApp();
      platform.isUnavailable();

      const result = await app.doctor();

      expect(result).toSucceed();
    });
  });

  describe("against the platform", () => {
    describe("--json", () => {
      it("passes a project straight out of setup", async () => {
        const app = await aSetUpApp();

        const result = await app.doctor();

        expect(result).toSucceed();
      });

      it("reports an unsupported framework version", async () => {
        const app = await aSetUpApp();
        await downgradeTheFramework(app);

        const result = await app.doctor();

        expect(result).toFailWith("E_UNSUPPORTED_PROJECT_SHAPE");
      });

      it("points at the upgrade", async () => {
        const app = await aSetUpApp();
        await downgradeTheFramework(app);

        const result = await app.doctor();

        expect(result).toHintAt("Upgrade the app to Next 15+");
      });

      it("does not offer a repair it cannot make", async () => {
        const app = await aSetUpApp();
        await downgradeTheFramework(app);

        const result = await app.doctor();

        expect(result).not.toSuggest("--fix");
      });

      it("restores a scaffolded page the developer deleted", async () => {
        const app = await aSetUpApp();
        await app.deleteProjectFile("app/login/page.tsx");
        const before = await app.snapshot();

        const result = await app.doctor(["--fix"]);

        expect(result).toSucceed();
        expect((await before.changes()).added).toContain("app/login/page.tsx");
      });

      it("removes nothing while repairing", async () => {
        const app = await aSetUpApp();
        await app.deleteProjectFile("app/login/page.tsx");
        const before = await app.snapshot();

        await app.doctor(["--fix"]);

        expect((await before.changes()).removed).toEqual([]);
      });
    });
  });
});
