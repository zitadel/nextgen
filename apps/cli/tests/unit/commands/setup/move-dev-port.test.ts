import { describe, expect } from "vitest";

import { moveDevPort } from "@/commands/setup/move-dev-port";
import { createOrca } from "@/lib/orca";
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

describe("moveDevPort", () => {
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
