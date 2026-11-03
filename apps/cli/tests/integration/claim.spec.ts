import { describe, expect, it } from "vitest";

import { usePlatformMock } from "../helpers/platform";
import { anApp, aSetUpApp, type ScaffoldedApp } from "../helpers/project";

const platform = usePlatformMock();

/** Prints the link and gives up quickly, rather than opening a browser and waiting. */
const WITHOUT_A_BROWSER = ["claim", "--no-open", "--timeout", "1", "--json"];

/** Waits long enough for the claim to be completed out of band. */
const WAITING_FOR_A_BROWSER = ["claim", "--no-open", "--timeout", "10", "--json"];

/** Hands the link back as the result instead of waiting for it. */
const HANDING_OVER_THE_LINK = ["claim", "--no-wait", "--json"];

/** Hands out a claim link, and returns the challenge id a later run waits on. */
async function aHandedOutLink(app: ScaffoldedApp): Promise<string> {
  const result = await app.run(HANDING_OVER_THE_LINK);
  return app.envelopeOf<{ challenge_id: string }>(result).data.challenge_id;
}

describe("claim", () => {
  describe("against an invalid server", () => {
    describe("that is not a zitadel api", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.isNotZitadel();

        const result = await app.run(WITHOUT_A_BROWSER);

        expect(result).toFail();
      });
    });

    describe("that is down", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.isUnavailable();

        const result = await app.run(WITHOUT_A_BROWSER);

        expect(result).toFail();
      });
    });

    describe("that refuses connections", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.refusesConnections();

        const result = await app.run(WITHOUT_A_BROWSER);

        expect(result).toFail();
      });
    });
  });

  describe("against a valid server", () => {
    describe("--json", () => {
      it("refuses a directory that was never set up", async () => {
        const app = await anApp();

        const result = await app.run(WITHOUT_A_BROWSER);

        expect(result).toFail();
      });

      it("gives up when nobody completes the claim in time", async () => {
        const app = await aSetUpApp();

        const result = await app.run(WITHOUT_A_BROWSER);

        expect(result).toFail();
      });

      it("targets the project the environment resolves, not the fallback secret", async () => {
        const app = await aSetUpApp();
        await app.bindEnvironment("production", {
          ZITADEL_URL: "https://prod.example",
          ZITADEL_PROJECT_ID: "proj_prod",
          ZITADEL_PROJECT_SECRET: "sk_prod",
        });

        const result = await app.run([
          "claim",
          "--env",
          "production",
          "--no-open",
          "--dry-run",
          "--json",
        ]);

        expect(app.envelopeOf<{ project_id: string }>(result).data.project_id).toBe("proj_prod");
      });

      it("hands over the link with the command that waits for it", async () => {
        const app = await aSetUpApp();

        const result = await app.run(HANDING_OVER_THE_LINK);

        expect(result).toSuggest("claim --challenge-id ch_");
      });

      it("claims the project once a handed-over link is completed", async () => {
        const app = await aSetUpApp();
        const challengeId = await aHandedOutLink(app);
        platform.completesTheNextClaim();

        const result = await app.run([
          "claim",
          "--challenge-id",
          challengeId,
          "--timeout",
          "10",
          "--json",
        ]);

        expect(result).toSucceed();
      }, 30000);
    });

    it("claims the project once the challenge is completed", async () => {
      const app = await aSetUpApp();
      platform.completesTheNextClaim();

      const result = await app.run(WAITING_FOR_A_BROWSER);

      expect(result).toSucceed();
    }, 30000);

    it("reports nothing minted on a dry run", async () => {
      const app = await aSetUpApp();

      const result = await app.run([...WITHOUT_A_BROWSER, "--dry-run"]);

      expect(result).toBeSkipped();
    });

    describe("rendered for a terminal", () => {
      it("prints the command that waits for a handed-over link", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["claim", "--no-wait"]);

        expect(result).toPrint("claim --challenge-id ch_");
      });
    });
  });
});
