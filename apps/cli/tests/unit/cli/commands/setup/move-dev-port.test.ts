import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { beforeEach, describe, expect } from "vitest";

import type { SetupFlags } from "@/cli/commands/setup";
import type { SetupServices } from "@/cli/commands/setup/shared";
import { MoveAppPort } from "@/cli/commands/setup/steps/move-app-port";
import { ZitadelError } from "@/lib/errors";
import { callbackUriFor } from "@/lib/idp";
import { installLogSink } from "@/lib/log";
import { readZitadelSecret } from "@/lib/project";
import { Ui } from "@/lib/ui";
import { takeReportedWarnings } from "@/lib/warnings";
import { forced } from "@tests/helpers/check-context";
import { aGoogleConnection } from "@tests/helpers/config";
import { it } from "@tests/helpers/fixtures";
import { usePlatformServer } from "@tests/helpers/platform-project";
import { runCliForTest } from "@tests/helpers/run-cli";
import { aNextApp } from "@tests/helpers/setup";
import { aSuggest } from "@tests/helpers/suggestions";
import { rejectionOf } from "@tests/helpers/thrown-value";

usePlatformServer();

beforeEach(({ onTestFinished }) => {
  onTestFinished(installLogSink(() => {}));
});

/**
 * The cloud platform the mock answers for.
 */
const CLOUD = "https://api.zitadel.cloud";

/**
 * The origin the app moves to.
 */
const MOVED_TO = "http://localhost:3101";

/**
 * Set up a Next app, so it can be moved to another dev port.
 *
 * @param dir - The project directory.
 * @returns Nothing, once the app is set up.
 */
async function setUpApp(dir: string): Promise<void> {
  await aNextApp(dir, { scripts: { dev: "next dev" } });
  await runCliForTest([
    "setup",
    "--cwd",
    dir,
    "--json",
    "--server",
    CLOUD,
    "--non-interactive",
    "--skip-install",
  ]);
}

/**
 * Move the app at `dir` to port 3101, as setup's step does: as a dry run, in which nobody consents,
 * unless `deps` say otherwise.
 *
 * @param dir - The project directory.
 * @param deps - What the run is given, where it differs from that.
 * @returns What the move answers.
 */
async function movingTo3101(
  dir: string,
  deps: Partial<Pick<SetupServices, "consent" | "dryRun" | "signal">> = {},
) {
  const suggest = aSuggest({}, "0.0.0");
  return new MoveAppPort({
    cliVersion: "0.0.0",
    consent: () => {
      return Promise.resolve(undefined);
    },
    cwd: dir,
    dryRun: true,
    realRun: () => {
      return Promise.resolve(suggest({ id: "setup" }));
    },
    recoverAt: () => {},
    signal: new AbortController().signal,
    suggest,
    ui: new Ui({ interactive: false, force: false }),
    ...deps,
  }).run({
    flags: { devPort: 3101 } as SetupFlags,
    preflight: { configured: true, server: { value: CLOUD, origin: "flag" } },
  });
}

/**
 * The providers the move warned redirect to the old port, in the order it named them.
 *
 * @returns The names of the providers.
 */
function reregistered(): string[] {
  return takeReportedWarnings().flatMap((warning) => {
    return ["acme", "google"].filter((slug) => {
      return (
        warning ===
        `Social sign-in with ${slug} redirects to the old port: add ${callbackUriFor(MOVED_TO, slug)} as a redirect URI at the provider.`
      );
    });
  });
}

describe("MoveAppPort", () => {
  describe("when a connection file fails its contract", () => {
    it("still lists it, by its file name, among the providers to re-register", async ({ dir }) => {
      await setUpApp(dir);
      await mkdir(join(dir, ".zitadel/idps"), { recursive: true });
      await writeFile(join(dir, ".zitadel/idps/google.json"), "{}\n");
      await writeFile(join(dir, ".zitadel/idps/acme.json"), "{ not json");

      takeReportedWarnings();

      await movingTo3101(dir);

      expect(reregistered()).toEqual(["acme", "google"]);
    });
  });

  describe("when a valid connection file sorts after a broken one", () => {
    it("lists them together in path order", async ({ dir }) => {
      await setUpApp(dir);
      await mkdir(join(dir, ".zitadel/idps"), { recursive: true });
      await writeFile(join(dir, ".zitadel/idps/google.json"), JSON.stringify(aGoogleConnection()));
      await writeFile(join(dir, ".zitadel/idps/acme.json"), "{ not json");

      takeReportedWarnings();

      await movingTo3101(dir);

      expect(reregistered()).toEqual(["acme", "google"]);
    });
  });

  describe("when the configuration cannot be read", () => {
    it("stops with the read error rather than listing no providers", async ({ dir }) => {
      await setUpApp(dir);
      await mkdir(join(dir, ".zitadel"), { recursive: true });
      await writeFile(join(dir, ".zitadel/idps"), "not a directory");

      const error = await rejectionOf(() => {
        return movingTo3101(dir);
      });

      expect(error).toBeInstanceOf(Error);
    });
  });

  describe("when a file of a kind that holds no connection cannot be read", () => {
    it("still lists the connections", async ({ dir }) => {
      await setUpApp(dir);
      await mkdir(join(dir, ".zitadel/idps"), { recursive: true });
      await writeFile(join(dir, ".zitadel/idps/google.json"), JSON.stringify(aGoogleConnection()));
      await mkdir(join(dir, ".zitadel/schemas/unreadable.json"), { recursive: true });

      takeReportedWarnings();

      await movingTo3101(dir);

      expect(reregistered()).toEqual(["google"]);
    });
  });

  describe("when it asks to remove the previous origin", () => {
    it("names the project and the server it removes it from", async ({ dir }) => {
      await setUpApp(dir);
      const { project_id } = await readZitadelSecret(dir);
      const asked: string[] = [];

      await movingTo3101(dir, {
        dryRun: false,
        consent: (gate) => {
          asked.push(gate.message);
          return Promise.resolve(undefined);
        },
      });

      expect(asked).toEqual([
        `Remove http://localhost:3000, the app's previous origin, from project ${project_id} on api.zitadel.cloud, now that http://localhost:3101 replaces it?`,
      ]);
    });
  });

  describe("when Ctrl-C is pressed while it removes the previous origin", () => {
    it("stops cancelled, rather than reporting the origin as left behind", async ({ dir }) => {
      await setUpApp(dir);
      const controller = new AbortController();

      const error = await rejectionOf(() => {
        return movingTo3101(dir, {
          dryRun: false,
          signal: controller.signal,
          consent: (gate) => {
            controller.abort(new ZitadelError("E_CANCELLED", "Cancelled"));
            return forced()(gate);
          },
        });
      });

      expect(error).toMatchObject({ code: "E_CANCELLED" });
    });
  });

  describe("when it moves the files", () => {
    it("says so before it asks for consent", async ({ dir }) => {
      await setUpApp(dir);
      const events: string[] = [];
      const restore = installLogSink((_level, text) => {
        events.push(text);
      });

      await movingTo3101(dir, {
        dryRun: false,
        consent: () => {
          events.push("asked");
          return Promise.resolve(undefined);
        },
      });
      restore();

      expect(
        events.filter((event) => {
          return event === "asked" || event.startsWith("Moved from");
        }),
      ).toEqual(["Moved from http://localhost:3000 to http://localhost:3101", "asked"]);
    });
  });

  describe("when asking to remove the previous origin fails for a reason other than a refusal", () => {
    it("stops with that failure", async ({ dir }) => {
      await setUpApp(dir);

      const error = await rejectionOf(() => {
        return movingTo3101(dir, {
          dryRun: false,
          consent: () => {
            return Promise.reject(new Error("a bug in the caller"));
          },
        });
      });

      expect(error).toBeInstanceOf(Error);
      expect(error).toMatchObject({ message: "a bug in the caller" });
    });
  });
});
