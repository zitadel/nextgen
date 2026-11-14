import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect } from "vitest";

import { moveDevPort } from "@/cli/commands/setup/move-dev-port";
import { ZitadelError } from "@/lib/errors";
import { createOrca } from "@/lib/orca";
import { readZitadelSecret } from "@/lib/project";
import { forced } from "@tests/helpers/check-context";
import { aGoogleConnection } from "@tests/helpers/config";
import { it } from "@tests/helpers/fixtures";
import { usePlatformServer } from "@tests/helpers/platform-project";
import { runCliForTest } from "@tests/helpers/run-cli";
import { aNextApp } from "@tests/helpers/setup";
import { rejectionOf } from "@tests/helpers/thrown-value";

usePlatformServer();

/**
 * The cloud platform the mock answers for.
 */
const CLOUD = "https://api.zitadel.cloud";

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
 * Move the app at `dir` to port 3101, as a dry run.
 *
 * @param dir - The project directory.
 * @returns What the move reports.
 */
function movingTo3101(dir: string): ReturnType<typeof moveDevPort> {
  return moveDevPort({
    cwd: dir,
    devPort: 3101,
    source: CLOUD,
    orca: createOrca(),
    cliVersion: "0.0.0",
    dryRun: true,
    signal: new AbortController().signal,
    consent: () => {
      return Promise.resolve(undefined);
    },
  });
}

describe("moveDevPort", () => {
  describe("when a connection file fails its contract", () => {
    it("still lists it, by its file name, among the providers to re-register", async ({ dir }) => {
      await setUpApp(dir);
      await mkdir(join(dir, ".zitadel/idps"), { recursive: true });
      await writeFile(join(dir, ".zitadel/idps/google.json"), "{}\n");
      await writeFile(join(dir, ".zitadel/idps/acme.json"), "{ not json");

      const move = await movingTo3101(dir);

      expect(move.ssoProviders).toEqual(["acme", "google"]);
    });
  });

  describe("when a valid connection file sorts after a broken one", () => {
    it("lists them together in path order", async ({ dir }) => {
      await setUpApp(dir);
      await mkdir(join(dir, ".zitadel/idps"), { recursive: true });
      await writeFile(join(dir, ".zitadel/idps/google.json"), JSON.stringify(aGoogleConnection()));
      await writeFile(join(dir, ".zitadel/idps/acme.json"), "{ not json");

      const move = await movingTo3101(dir);

      expect(move.ssoProviders).toEqual(["acme", "google"]);
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

      const move = await movingTo3101(dir);

      expect(move.ssoProviders).toEqual(["google"]);
    });
  });

  describe("when it asks to remove the previous origin", () => {
    it("names the project and the server it removes it from", async ({ dir }) => {
      await setUpApp(dir);
      const { project_id } = await readZitadelSecret(dir);
      const asked: string[] = [];

      await moveDevPort({
        cwd: dir,
        devPort: 3101,
        source: CLOUD,
        orca: createOrca(),
        cliVersion: "0.0.0",
        dryRun: false,
        signal: new AbortController().signal,
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
        return moveDevPort({
          cwd: dir,
          devPort: 3101,
          source: CLOUD,
          orca: createOrca(),
          cliVersion: "0.0.0",
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
      const order: string[] = [];

      await moveDevPort({
        cwd: dir,
        devPort: 3101,
        source: CLOUD,
        orca: createOrca(),
        cliVersion: "0.0.0",
        dryRun: false,
        signal: new AbortController().signal,
        filesMoved: () => {
          order.push("moved");
        },
        consent: () => {
          order.push("asked");
          return Promise.resolve(undefined);
        },
      });

      expect(order).toEqual(["moved", "asked"]);
    });
  });

  describe("when asking to remove the previous origin fails for a reason other than a refusal", () => {
    it("stops with that failure", async ({ dir }) => {
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

      const error = await rejectionOf(() => {
        return moveDevPort({
          cwd: dir,
          devPort: 3101,
          source: CLOUD,
          orca: createOrca(),
          cliVersion: "0.0.0",
          dryRun: false,
          signal: new AbortController().signal,
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
