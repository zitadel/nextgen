import { describe, expect, it } from "vitest";

import { usePlatformMock } from "@tests/helpers/platform";
import { anApp, aSetUpApp } from "@tests/helpers/project";

const platform = usePlatformMock();

/**
 * The files a first run writes in a set-up Next.js app.
 */
const SUITE_FILES = [
  "playwright.config.mts",
  "e2e/sign-in.spec.ts",
  "e2e/signed-in.spec.ts",
  ".gitignore",
  "package.json",
];

/**
 * The dev dependencies a first run adds.
 */
const SUITE_DEPENDENCIES = ["@zitadel/testing", "@playwright/test"];

describe("tests add", () => {
  describe("against an invalid server", () => {
    describe("that is not a zitadel api", () => {
      it("still succeeds", async () => {
        const app = await aSetUpApp();
        platform.isNotZitadel();

        const result = await app.addTests(["--json"]);

        expect(result).toSucceed();
      });
    });

    describe("that is down", () => {
      it("still succeeds", async () => {
        const app = await aSetUpApp();
        platform.isUnavailable();

        const result = await app.addTests(["--json"]);

        expect(result).toSucceed();
      });
    });
  });

  describe("against a valid server", () => {
    it("holds its invariants in every rendering", async () => {
      const app = await aSetUpApp();

      await app.inEveryRendering((how) => {
        return app.addTests(how.json ? ["--json"] : [], { install: false });
      });
    });

    describe("--json", () => {
      it("reports the suite's files", async () => {
        const app = await aSetUpApp();

        const result = await app.addTests(["--json"]);

        expect(app.envelopeOf(result).data).toMatchObject({ files_written: SUITE_FILES });
      });

      it("reports the dev dependencies it added", async () => {
        const app = await aSetUpApp();

        const result = await app.addTests(["--json"]);

        expect(app.envelopeOf(result).data).toMatchObject({
          dependencies_added: SUITE_DEPENDENCIES,
        });
      });

      it("installs them with the app's package manager", async () => {
        const app = await aSetUpApp();

        await app.addTests(["--json"], { install: true });

        expect(await app.installWasRun()).toBe(true);
      });

      it("leaves the install to the reader with --skip-install", async () => {
        const app = await aSetUpApp();

        const result = await app.addTests(["--json"]);

        expect(result).toSuggest("install");
      });

      it("suggests running the suite through the project's script", async () => {
        const app = await aSetUpApp();

        const result = await app.addTests(["--json"]);

        expect(result).toSuggest("run test:e2e");
      });

      it("reports the script it added", async () => {
        const app = await aSetUpApp();

        const result = await app.addTests(["--json"]);

        expect(app.envelopeOf(result).data).toMatchObject({
          test_script: { name: "test:e2e", command: "playwright test", status: "added" },
        });
      });

      it("writes nothing when run again", async () => {
        const app = await aSetUpApp();
        await app.addTests(["--json"]);

        const result = await app.addTests(["--json"]);

        expect(app.envelopeOf(result).data).toMatchObject({ files_written: [] });
      });

      it("leaves the files to a real run after a dry run", async () => {
        const app = await aSetUpApp();
        await app.addTests(["--json", "--dry-run"]);

        const result = await app.addTests(["--json"]);

        expect(app.envelopeOf(result).data).toMatchObject({ files_written: SUITE_FILES });
      });

      it("refuses an app setup has not wired up", async () => {
        const app = await anApp();

        const result = await app.addTests(["--json"]);

        expect(result).toFailWith("E_VALIDATION");
      });
    });

    describe("rendered for a terminal", () => {
      it("prints the files it wrote", async () => {
        const app = await aSetUpApp();

        const result = await app.addTests();

        expect(result).toPrint("e2e/sign-in.spec.ts");
      });
    });
  });
});
