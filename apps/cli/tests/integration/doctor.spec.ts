import { describe, expect, it } from "vitest";

import { useLocalServers } from "../helpers/local-server";
import { usePlatformMock } from "../helpers/platform";
import { aSetUpApp, aSetUpReactApp, type ScaffoldedApp } from "../helpers/project";

const platform = usePlatformMock();
useLocalServers();

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

      it("names the proxy file whose own response hook keeps the session token in the exchange answer", async () => {
        const app = await aSetUpReactApp();
        await app.hookTheUnredactedProxyResponses();

        const result = await app.doctor();

        expect(result).toSay("vite.config.ts");
        expect(result).toSay("session_token");
      });

      it("leaves a proxy with its own response hook alone while repairing", async () => {
        const app = await aSetUpReactApp();
        await app.hookTheUnredactedProxyResponses();
        const before = await app.snapshot();

        await app.doctor(["--fix"]);

        expect((await before.changes()).modified).not.toContain("vite.config.ts");
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

  describe("in an app inside the directory a local server was started in", () => {
    it("checks that server's port", async () => {
      const parent = await aSetUpApp();
      const started = await parent.startLocalServer();
      const app = await parent.appInside("my-app");

      const result = await app.doctorAtItsServer();

      expect(app.doctoredPortOf(result)).toBe(parent.localPortOf(started));
    });

    it("finds that server healthy", async () => {
      const parent = await aSetUpApp();
      await parent.startLocalServer();
      const app = await parent.appInside("my-app");

      const result = await app.doctorAtItsServer();

      expect(result).toSucceed();
    });

    describe("that is not running", () => {
      it("fails", async () => {
        const parent = await aSetUpApp();
        await parent.writeStoppedServerRecord();
        const app = await parent.appInside("my-app");

        const result = await app.doctorAtItsServer();

        expect(result).toFailWith("E_VALIDATION");
      });

      it("starts it again where it was started", async () => {
        const parent = await aSetUpApp();
        await parent.writeStoppedServerRecord();
        const app = await parent.appInside("my-app");

        const result = await app.doctorAtItsServer();

        expect(result).toSuggest(`start --cwd ${parent.path}`);
      });

      it("resets it where it was started", async () => {
        const parent = await aSetUpApp();
        await parent.writeStoppedServerRecord();
        const app = await parent.appInside("my-app");

        const result = await app.doctorAtItsServer();

        expect(result).toSuggest(`reset --force --cwd ${parent.path}`);
      });
    });

    describe("whose record is malformed", () => {
      it("resets it where it was started", async () => {
        const parent = await aSetUpApp();
        await parent.writeMalformedServerRecord();
        const app = await parent.appInside("my-app");

        const result = await app.doctorAtItsServer();

        expect(result).toSuggest(`reset --force --cwd ${parent.path}`);
      });
    });

    describe("in a directory whose path needs shell quoting", () => {
      async function parentNamed(name: string): Promise<ScaffoldedApp> {
        const outer = await aSetUpApp();
        return outer.appInside(name);
      }

      it.each(["my app", "it's"])(
        "hands over where to start it again as arguments (%s)",
        async (name) => {
          const parent = await parentNamed(name);
          await parent.writeStoppedServerRecord();
          const app = await parent.appInside("my-app");

          const result = await app.doctorAtItsServer();

          expect(app.suggestedArgsOf(result)).toContainEqual(["start", "--cwd", parent.path]);
        },
      );

      it.each(["my app", "it's"])(
        "hands over where to reset it as arguments (%s)",
        async (name) => {
          const parent = await parentNamed(name);
          await parent.writeStoppedServerRecord();
          const app = await parent.appInside("my-app");

          const result = await app.doctorAtItsServer();

          expect(app.suggestedArgsOf(result)).toContainEqual([
            "reset",
            "--force",
            "--cwd",
            parent.path,
          ]);
        },
      );

      it.each(["my app", "it's"])(
        "hands over where to reset a malformed record as arguments (%s)",
        async (name) => {
          const parent = await parentNamed(name);
          await parent.writeMalformedServerRecord();
          const app = await parent.appInside("my-app");

          const result = await app.doctorAtItsServer();

          expect(app.suggestedArgsOf(result)).toContainEqual([
            "reset",
            "--force",
            "--cwd",
            parent.path,
          ]);
        },
      );

      it("suggests no command string a shell would split", async () => {
        const parent = await parentNamed("my app");
        await parent.writeStoppedServerRecord();
        const app = await parent.appInside("my-app");

        const result = await app.doctorAtItsServer();

        expect(result).not.toSuggest("--cwd");
      });

      it("names the directory and the JSON fallback in the hint", async () => {
        const parent = await parentNamed("my app");
        await parent.writeStoppedServerRecord();
        const app = await parent.appInside("my-app");

        const result = await app.doctorAtItsServer();

        expect(result).toHintAt(parent.path);
        expect(result).toHintAt("--json");
      });
    });
  });
});
