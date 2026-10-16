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

/** Leaves a range the floor accepts, with a release below the floor installed under it. */
async function installAnOldFrameworkUnderARange(app: ScaffoldedApp): Promise<void> {
  await app.editPackageJson((pkg) => {
    pkg.dependencies.next = "^15.0.0";
  });
  await app.hasInstalled("next", "15.2.2");
}

/** Swaps the app's SDK dependency for the CLI, leaving `@zitadel/cli` its only Zitadel package. */
function keepOnlyTheCli(app: ScaffoldedApp): Promise<void> {
  return app.editPackageJson((pkg) => {
    delete pkg.dependencies["@zitadel/sdk-next"];
    pkg.dependencies["@zitadel/cli"] = "latest";
  });
}

/** A Nuxt app an older setup scaffolded, whose retired auth plugin the developer deleted. */
async function anOlderNuxtApp(): Promise<ScaffoldedApp> {
  const app = await aSetUpApp([], { framework: "nuxt" });
  await app.deletedTheRetiredNuxtAuthPlugin();
  return app;
}

describe("doctor", () => {
  describe("against an invalid server", () => {
    describe("that is not a zitadel api", () => {
      it("still succeeds", async () => {
        const app = await aSetUpApp();
        platform.isNotZitadel();

        const result = await app.doctor();

        expect(result).toSucceed();
      });
    });

    describe("that is down", () => {
      it("still succeeds", async () => {
        const app = await aSetUpApp();
        platform.isUnavailable();

        const result = await app.doctor();

        expect(result).toSucceed();
      });
    });

    describe("that refuses connections", () => {
      it("still succeeds", async () => {
        const app = await aSetUpApp();
        platform.refusesConnections();

        const result = await app.doctor();

        expect(result).toSucceed();
      });
    });
  });

  describe("against a valid server", () => {
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

        expect(result).toHintAt("Upgrade the app to Next.js 15.2.3 or later");
      });

      it("reports an installed framework version below the floor", async () => {
        const app = await aSetUpApp();
        await installAnOldFrameworkUnderARange(app);

        const result = await app.doctor();

        expect(result).toFailWith("E_UNSUPPORTED_PROJECT_SHAPE");
      });

      it("points an installed framework version below the floor at the upgrade", async () => {
        const app = await aSetUpApp();
        await installAnOldFrameworkUnderARange(app);

        const result = await app.doctor();

        expect(result).toHintAt("Upgrade the app to Next.js 15.2.3 or later");
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

      it("reports an app that kept only the CLI in place of its SDK", async () => {
        const app = await aSetUpApp();
        await keepOnlyTheCli(app);

        const result = await app.doctor();

        expect(result).toFailWith("E_VALIDATION");
      });

      it("re-adds the SDK an app kept only the CLI in place of", async () => {
        const app = await aSetUpApp();
        await keepOnlyTheCli(app);

        const result = await app.doctor(["--fix"]);

        expect(result).toSucceed();
      });

      it("reports the retired Nuxt auth plugin an older setup recorded", async () => {
        const app = await anOlderNuxtApp();

        const result = await app.doctor();

        expect(result).toFailWith("E_VALIDATION");
      });

      it("clears the retired Nuxt auth plugin an older setup recorded", async () => {
        const app = await anOlderNuxtApp();

        const result = await app.doctor(["--fix"]);

        expect(result).toSucceed();
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
