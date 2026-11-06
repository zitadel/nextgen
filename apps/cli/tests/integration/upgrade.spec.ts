import { describe, expect, it } from "vitest";

import { usePlatformMock } from "@tests/helpers/platform";
import { aSetUpApp, type ScaffoldedApp } from "@tests/helpers/project";

const platform = usePlatformMock();

const NEWEST = "99.0.0";

/** What `upgrade --json` reports, in the envelope's own terms. */
type Upgraded = {
  up_to_date: boolean;
  latest_version: string;
  packages: Array<{ name: string; from: string; to: string }>;
  left_alone: Array<{ name: string; specifier: string }>;
  breaking_changes: Array<{ version: string; note: string }>;
  refresh: string;
  install_command?: string;
};

function floatTheSdk(app: ScaffoldedApp): Promise<void> {
  return app.editPackageJson((pkg) => {
    for (const name of Object.keys(pkg.dependencies)) {
      if (name.startsWith("@zitadel/")) {
        pkg.dependencies[name] = "^0.0.1";
      }
    }
  });
}

describe("upgrade", () => {
  describe("against an invalid server", () => {
    describe("that is not a zitadel api", () => {
      it("still succeeds, because it never asks the server", async () => {
        const app = await aSetUpApp();
        platform.isNotZitadel();
        platform.publishesCli(NEWEST);

        const result = await app.upgrade();

        expect(result).toSucceed();
      });
    });

    describe("that is down", () => {
      it("still succeeds, because it never asks the server", async () => {
        const app = await aSetUpApp();
        platform.isUnavailable();
        platform.publishesCli(NEWEST);

        const result = await app.upgrade();

        expect(result).toSucceed();
      });
    });
  });

  describe("against a valid server", () => {
    it("holds its invariants in every rendering", async () => {
      const app = await aSetUpApp();
      platform.publishesCli(NEWEST);

      await app.inEveryRendering((how) =>
        how.json ? app.upgrade([], {}, how.env) : app.upgradeRendered(how.env),
      );
    });

    describe("--json", () => {
      it("moves the pinned packages to the latest release", async () => {
        const app = await aSetUpApp();
        platform.publishesCli(NEWEST);

        const result = await app.upgrade();

        const { packages } = app.envelopeOf<Upgraded>(result).data;
        expect(packages.length).toBeGreaterThan(0);
        expect(packages.every((pkg) => pkg.to === NEWEST)).toBe(true);
      });

      it("installs them at exact versions with the project's package manager", async () => {
        const app = await aSetUpApp();
        platform.publishesCli(NEWEST);

        await app.upgrade();

        const { args } = await app.installInvocation();
        expect(args.slice(0, 2)).toEqual(["install", "--save-exact"]);
        expect(args.at(-1)).toContain(`@${NEWEST}`);
      });

      it("has the new release refresh the generated files", async () => {
        const app = await aSetUpApp();
        platform.publishesCli(NEWEST);

        const result = await app.upgrade();

        expect(app.envelopeOf<Upgraded>(result).data.refresh).toBe("done");
        await expect(app.refreshInvocation()).resolves.toEqual([
          "--yes",
          `@zitadel/cli@${NEWEST}`,
          "doctor",
          "--fix",
          "--non-interactive",
          "--json",
        ]);
      });

      it("passes --no-telemetry on to the new release's doctor", async () => {
        const app = await aSetUpApp();
        platform.publishesCli(NEWEST);

        await app.upgrade(["--no-telemetry"]);

        await expect(app.refreshInvocation()).resolves.toContain("--no-telemetry");
      });

      it("keeps the upgrade and suggests doctor when the refresh finds issues", async () => {
        const app = await aSetUpApp();
        platform.publishesCli(NEWEST);

        const result = await app.upgrade([], { refresh: "issues" });

        expect(result).toSucceed();
        expect(app.envelopeOf<Upgraded>(result).data.refresh).toBe("issues");
        expect(result).toSuggest(`npx @zitadel/cli@${NEWEST} doctor`);
      });

      it("keeps the upgrade and suggests the repair when the refresh cannot run", async () => {
        const app = await aSetUpApp();
        platform.publishesCli(NEWEST);

        const result = await app.upgrade([], { refresh: "broken" });

        expect(result).toSucceed();
        expect(app.envelopeOf<Upgraded>(result).data.refresh).toBe("failed");
        expect(result).toSuggest(`npx @zitadel/cli@${NEWEST} doctor --fix`);
      });

      it("changes nothing under --dry-run", async () => {
        const app = await aSetUpApp();
        platform.publishesCli(NEWEST);

        const result = await app.upgrade(["--dry-run"]);

        expect(app.envelopeOf<Upgraded>(result).data.install_command).toContain(NEWEST);
        await expect(app.installWasRun()).resolves.toBe(false);
      });

      it("reports a range as left alone instead of moving it", async () => {
        const app = await aSetUpApp();
        await floatTheSdk(app);
        platform.publishesCli(NEWEST);

        const result = await app.upgrade();

        const { packages, left_alone } = app.envelopeOf<Upgraded>(result).data;
        expect(packages).toEqual([]);
        expect(left_alone.length).toBeGreaterThan(0);
      });

      it("has nothing to do on the latest release", async () => {
        const app = await aSetUpApp();
        platform.publishesCli("0.0.1");

        const result = await app.upgrade();

        const { up_to_date } = app.envelopeOf<Upgraded>(result).data;
        expect(up_to_date).toBe(true);
        await expect(app.installWasRun()).resolves.toBe(false);
      });

      it("reports the breaking changes on the way", async () => {
        const app = await aSetUpApp();
        platform.publishesCli(NEWEST, { [NEWEST]: "it broke" });

        const result = await app.upgrade();

        expect(app.envelopeOf<Upgraded>(result).data.breaking_changes).toEqual([
          { version: NEWEST, note: "it broke" },
        ]);
      });

      it("fails when the registry cannot say what the latest release is", async () => {
        const app = await aSetUpApp();
        platform.npmRegistryIsDown();

        const result = await app.upgrade();

        expect(result).toFailWith("E_NETWORK");
      });

      it("fails when the install does", async () => {
        const app = await aSetUpApp();
        platform.publishesCli(NEWEST);

        const result = await app.upgrade([], { install: "fails" });

        expect(result).toFailWith("E_VALIDATION");
      });
    });

    describe("rendered for a terminal", () => {
      it("says what moved", async () => {
        const app = await aSetUpApp();
        platform.publishesCli(NEWEST);

        const result = await app.upgradeRendered();

        expect(result).toPrint(`Zitadel upgraded to ${NEWEST}.`);
        expect(result).toPrint(`→ ${NEWEST}`);
      });

      it("shows a breaking change before it installs", async () => {
        const app = await aSetUpApp();
        platform.publishesCli(NEWEST, { [NEWEST]: "it broke" });

        const result = await app.upgradeRendered();

        expect(result).toPrint("it broke");
        expect(result.stdout.indexOf("it broke")).toBeLessThan(
          result.stdout.indexOf("Zitadel upgraded"),
        );
      });

      it("links the release notes", async () => {
        const app = await aSetUpApp();
        platform.publishesCli(NEWEST);

        const result = await app.upgradeRendered();

        expect(result).toPrint("github.com/zitadel/nextgen/releases");
      });
    });
  });
});
