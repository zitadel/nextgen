import { describe, expect, it } from "vitest";

import { usePlatformMock } from "@tests/helpers/platform";
import { anApp, aSetUpApp, MOCK_SERVER_URL, type ScaffoldedApp } from "@tests/helpers/project";
import { cliVersion, expectedPublicCliCommand } from "@tests/helpers/run-cli";
import { asTerminal, offTerminal } from "@tests/helpers/terminal";

const platform = usePlatformMock();

const CLI_VERSION = cliVersion.version;

/** The two ways a person reads a run, which must say the same thing. */
const SHOWN = [
  ["on a terminal", asTerminal],
  ["piped", offTerminal],
] as const;

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
      it("fails, saying the server has no such endpoint", async () => {
        const app = await aSetUpApp();
        platform.isNotZitadel();

        const result = await app.run(WITHOUT_A_BROWSER);

        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: CLI_VERSION,
          command: "claim",
          source: MOCK_SERVER_URL,
          code: "E_NOT_FOUND",
          message: expect.stringMatching(
            /^POST http:\/\/mock\.zitadel\.test\/api\/v1\/projects\/proj-[0-9a-f]{12}\/claim\/init returned 404 — .* has no such endpoint; is this a Zitadel platform API\?$/,
          ),
          details: {
            status: 404,
            url: expect.stringMatching(
              /^http:\/\/mock\.zitadel\.test\/api\/v1\/projects\/proj-[0-9a-f]{12}\/claim\/init$/,
            ),
            body: { raw: "<html>not here</html>" },
          },
        });
      });
    });

    describe("that is down", () => {
      it("fails with a network error", async () => {
        const app = await aSetUpApp();
        platform.isUnavailable();

        const result = await app.run(WITHOUT_A_BROWSER);

        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: CLI_VERSION,
          command: "claim",
          source: MOCK_SERVER_URL,
          code: "E_NETWORK",
          message: "down",
          details: {
            status: 503,
            url: expect.stringMatching(
              /^http:\/\/mock\.zitadel\.test\/api\/v1\/projects\/proj-[0-9a-f]{12}\/claim\/init$/,
            ),
            body: { code: "unavailable", message: "down" },
          },
        });
      });
    });

    describe("that refuses connections", () => {
      it("fails with a network error, saying to check the server URL", async () => {
        const app = await aSetUpApp();
        platform.refusesConnections();

        const result = await app.run(WITHOUT_A_BROWSER);

        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: CLI_VERSION,
          command: "claim",
          source: MOCK_SERVER_URL,
          code: "E_NETWORK",
          message: expect.stringMatching(
            /^POST http:\/\/mock\.zitadel\.test\/api\/v1\/projects\/proj-[0-9a-f]{12}\/claim\/init got no response$/,
          ),
          hint: "Check your connection and the server URL (ZITADEL_URL or --server).",
          details: {
            url: expect.stringMatching(
              /^http:\/\/mock\.zitadel\.test\/api\/v1\/projects\/proj-[0-9a-f]{12}\/claim\/init$/,
            ),
            reason: "unreachable",
          },
        });
      });
    });
  });

  describe("against a valid server", () => {
    it("holds its invariants in every rendering", async () => {
      const app = await aSetUpApp();
      const args = ["claim", "--no-wait"];

      await app.inEveryRendering((how) => app.run(how.json ? [...args, "--json"] : args, how.env));
    });

    describe("--json", () => {
      it("refuses a directory that was never set up, and suggests setting it up", async () => {
        const app = await anApp();

        const result = await app.run(WITHOUT_A_BROWSER);

        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: CLI_VERSION,
          command: "claim",
          source: MOCK_SERVER_URL,
          code: "E_VALIDATION",
          message: "ZITADEL_PROJECT_ID is not set for the development environment",
          hint: `Consulted, in order: --server, process environment, .env.development.local, .env.local, .env.development, .env, .zitadel/secret. Set ZITADEL_PROJECT_ID in .env.development.local or the process environment, or run ${expectedPublicCliCommand("env add development")}.`,
          next_commands: [expectedPublicCliCommand(`setup --cwd ${app.path}`)],
          details: {
            environment: "development",
            variable: "ZITADEL_PROJECT_ID",
            consulted: [
              "--server",
              "process environment",
              ".env.development.local",
              ".env.local",
              ".env.development",
              ".env",
              ".zitadel/secret",
            ],
          },
        });
      });

      it("gives up when nobody completes the claim in time, offering to start over", async () => {
        const app = await aSetUpApp();

        const result = await app.run(WITHOUT_A_BROWSER);

        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: CLI_VERSION,
          command: "claim",
          source: MOCK_SERVER_URL,
          code: "E_VALIDATION",
          message: "Stopped waiting for the browser step to finish",
          hint: "Links are valid for 10 minutes. Start a new one.",
          next_commands: [
            expectedPublicCliCommand(
              `claim --no-open --timeout 1 --server ${MOCK_SERVER_URL} --cwd ${app.path}`,
            ),
          ],
        });
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

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: CLI_VERSION,
          command: "claim",
          source: MOCK_SERVER_URL,
          data: {
            dry_run: true,
            title: "Nothing was claimed (dry run)",
            project_id: "proj_prod",
            would: "Open a browser to claim this project.",
            next_commands: [
              expectedPublicCliCommand(
                `claim --no-open --env production --server ${MOCK_SERVER_URL} --cwd ${app.path}`,
              ),
            ],
          },
          warnings: [],
        });
      });

      it("hands over the link with the command that waits for it", async () => {
        const app = await aSetUpApp();

        const result = await app.run(HANDING_OVER_THE_LINK);

        const { data } = app.envelopeOf<{ challenge_id: string }>(result);
        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: CLI_VERSION,
          command: "claim",
          source: MOCK_SERVER_URL,
          data: {
            title: "Open the link in a browser to make your project permanent",
            project_id: expect.stringMatching(/^proj-[0-9a-f]{12}$/),
            claim_url: `${MOCK_SERVER_URL}/claim/${data.challenge_id}`,
            challenge_id: expect.stringMatching(/^ch_[\w-]{22}$/),
            expires_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/),
            next_actions: ["Wait for the browser step to finish with:"],
            next_commands: [
              expectedPublicCliCommand(
                `claim --challenge-id ${data.challenge_id} --server ${MOCK_SERVER_URL} --cwd ${app.path}`,
              ),
            ],
          },
          warnings: [],
        });
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

        const { data } = app.envelopeOf<{ team_id: string }>(result);
        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: CLI_VERSION,
          command: "claim",
          source: MOCK_SERVER_URL,
          data: {
            title: "Your project is now permanent",
            project_id: expect.stringMatching(/^proj-[0-9a-f]{12}$/),
            team_id: expect.stringMatching(/^team-[0-9a-f]{12}$/),
            claimed_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/),
            dashboard_url: `https://dashboard.example.com/teams/${data.team_id}`,
            next_actions: [
              "Manage your project and collaborate in the Console:",
              `https://dashboard.example.com/teams/${data.team_id}`,
            ],
          },
          warnings: [],
        });
      }, 30000);

      it("claims the project once the challenge is completed", async () => {
        const app = await aSetUpApp();
        platform.completesTheNextClaim();

        const result = await app.run(WAITING_FOR_A_BROWSER);

        const { data } = app.envelopeOf<{ team_id: string }>(result);
        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: CLI_VERSION,
          command: "claim",
          source: MOCK_SERVER_URL,
          data: {
            title: "Your project is now permanent",
            project_id: expect.stringMatching(/^proj-[0-9a-f]{12}$/),
            team_id: expect.stringMatching(/^team-[0-9a-f]{12}$/),
            claimed_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/),
            dashboard_url: `https://dashboard.example.com/teams/${data.team_id}`,
            next_actions: [
              "Manage your project and collaborate in the Console:",
              `https://dashboard.example.com/teams/${data.team_id}`,
            ],
          },
          warnings: [],
        });
      }, 30000);

      it("skips a project that already belongs to a team", async () => {
        const app = await aSetUpApp();
        platform.completesTheNextClaim();
        await app.run(WAITING_FOR_A_BROWSER);

        const result = await app.run(["claim", "--no-open", "--json"]);

        const { data } = app.envelopeOf<{ team_id: string }>(result);
        expect(app.envelopeOf(result)).toEqual({
          status: "skipped",
          cli_version: CLI_VERSION,
          command: "claim",
          source: MOCK_SERVER_URL,
          reason: "already-claimed",
          data: {
            title: "This project already belongs to a team",
            project_id: expect.stringMatching(/^proj-[0-9a-f]{12}$/),
            team_id: expect.stringMatching(/^team-[0-9a-f]{12}$/),
            claimed_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/),
          },
        });
        expect(data.team_id).toMatch(/^team-/);
      }, 30000);

      it("plans the claim with the flags it was given and suggests the real one", async () => {
        const app = await aSetUpApp();

        const result = await app.run([
          "claim",
          "--no-open",
          "--timeout",
          "5",
          "--dry-run",
          "--json",
        ]);

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: CLI_VERSION,
          command: "claim",
          source: MOCK_SERVER_URL,
          data: {
            dry_run: true,
            title: "Nothing was claimed (dry run)",
            project_id: expect.stringMatching(/^proj-[0-9a-f]{12}$/),
            would:
              "Open a browser to claim this project, then record the owning team in .zitadel/secret.",
            next_commands: [
              expectedPublicCliCommand(
                `claim --no-open --timeout 5 --server ${MOCK_SERVER_URL} --cwd ${app.path}`,
              ),
            ],
          },
          warnings: [],
        });
      });

      it("plans handing over the link and suggests the real run", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["claim", "--no-wait", "--dry-run", "--json"]);

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: CLI_VERSION,
          command: "claim",
          source: MOCK_SERVER_URL,
          data: {
            dry_run: true,
            title: "Nothing was claimed (dry run)",
            project_id: expect.stringMatching(/^proj-[0-9a-f]{12}$/),
            would: "Create a link to claim this project.",
            next_commands: [
              expectedPublicCliCommand(
                `claim --no-wait --server ${MOCK_SERVER_URL} --cwd ${app.path}`,
              ),
            ],
          },
          warnings: [],
        });
      });

      it("opens no challenge in a dry run", async () => {
        const app = await aSetUpApp();
        await app.run([...WITHOUT_A_BROWSER, "--dry-run"]);

        const result = await app.run(["claim", "--challenge-id", "ch_missing", "--json"]);

        expect(result).toFail();
      });

      it("ends cancelled when Ctrl-C lands while it waits for the browser step", async () => {
        const app = await aSetUpApp();

        const result = await app.claimInterrupted();

        expect(result).toExitWith(130);
        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: CLI_VERSION,
          command: "claim",
          source: MOCK_SERVER_URL,
          code: "E_CANCELLED",
          message: "Cancelled",
          hint: "The command was cancelled with Ctrl-C.",
        });
      });

      it("refuses a challenge id holding control characters without echoing it", async () => {
        const app = await aSetUpApp();

        const result = await app.run([
          "claim",
          "--challenge-id",
          "ch_\u001b[31mx",
          "--timeout",
          "1",
          "--json",
        ]);

        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: CLI_VERSION,
          command: "claim",
          source: MOCK_SERVER_URL,
          code: "E_VALIDATION",
          message:
            "--challenge-id takes the challenge_id that the --no-wait run returned, which starts with ch_",
          next_commands: [
            expectedPublicCliCommand(
              `claim --no-wait --server ${MOCK_SERVER_URL} --cwd ${app.path}`,
            ),
          ],
        });
      });
    });

    describe.each(SHOWN)("rendered %s", (_how, shown) => {
      it("says a project already claimed once", async () => {
        const app = await aSetUpApp();
        platform.completesTheNextClaim();
        await app.run(WAITING_FOR_A_BROWSER);

        const result = await shown(() => app.run(["claim", "--no-open"]));

        expect(result).toSayOnce("This project already belongs to a team");
      }, 30000);

      it("prints the link to open and the command that waits for it", async () => {
        const app = await aSetUpApp();

        const result = await shown(() => app.run(["claim", "--no-wait"]));

        expect(result).toPrint("claim --challenge-id ch_");
        expect(result).toPrint(`${MOCK_SERVER_URL}/claim/ch_`);
      });

      it("titles the handed-over link as --json does", async () => {
        const app = await aSetUpApp();

        const result = await shown(() => app.run(["claim", "--no-wait"]));

        expect(result).toSayOnce("Open the link in a browser to make your project permanent");
      });

      it("titles a dry run as --json does, ending in (dry run)", async () => {
        const app = await aSetUpApp();

        const result = await shown(() =>
          app.run(["claim", "--no-open", "--timeout", "5", "--dry-run"]),
        );

        expect(result).toSayOnce("Nothing was claimed (dry run)");
      });

      it("prints the claim it planned, once", async () => {
        const app = await aSetUpApp();

        const result = await shown(() =>
          app.run(["claim", "--no-open", "--timeout", "5", "--dry-run"]),
        );

        expect(result).toSayOnce(
          expectedPublicCliCommand(
            `claim --no-open --timeout 5 --server ${MOCK_SERVER_URL} --cwd ${app.path}`,
          ),
        );
      });

      it("titles a finished claim as --json does", async () => {
        const app = await aSetUpApp();
        platform.completesTheNextClaim();

        const result = await shown(() => app.run(["claim", "--no-open", "--timeout", "10"]));

        expect(result).toSayOnce("Your project is now permanent");
      }, 30000);

      it("prints the dashboard link of a finished claim once", async () => {
        const app = await aSetUpApp();
        platform.completesTheNextClaim();

        const result = await shown(() => app.run(["claim", "--no-open", "--timeout", "10"]));

        expect(result).toSayOnce("https://dashboard.example.com/teams/team-");
      }, 30000);

      it("says it stopped waiting, once, and offers to start over", async () => {
        const app = await aSetUpApp();

        const result = await shown(() => app.run(["claim", "--no-open", "--timeout", "1"]));

        expect(result).toSayOnce("Stopped waiting for the browser step to finish");
        expect(result).toSayOnce(
          expectedPublicCliCommand(
            `claim --no-open --timeout 1 --server ${MOCK_SERVER_URL} --cwd ${app.path}`,
          ),
        );
      });
    });
  });
});
