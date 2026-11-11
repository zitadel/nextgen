import { describe, expect, it } from "vitest";

import { usePlatformMock } from "@tests/helpers/platform";
import { anApp, aSetUpApp, PASSWORD_POLICY } from "@tests/helpers/project";
import { pressCtrlC } from "@tests/helpers/run-cli";

const platform = usePlatformMock();

interface ResourceRow {
  readonly topic: string;
  readonly verbs?: string[];
}

const ACME_CONNECTION_FLAGS = [
  "--slug",
  "acme-sso",
  "--protocol",
  "oidc",
  "--display-name",
  "Acme SSO",
  "--oidc-issuer",
  "https://sso.acme.example",
  "--oidc-client-id",
  "abc123",
  "--oidc-client-secret",
  "${{ ACME_SSO_CLIENT_SECRET }}",
  "--oidc-scopes",
  "openid",
];

describe("resources", () => {
  describe("against an invalid server", () => {
    describe("that is not a zitadel api", () => {
      it("still succeeds", async () => {
        const app = await aSetUpApp();
        platform.isNotZitadel();

        const result = await app.run(["resources", "--json"]);

        expect(result).toSucceed();
      });
    });

    describe("that is down", () => {
      it("still succeeds", async () => {
        const app = await aSetUpApp();
        platform.isUnavailable();

        const result = await app.run(["resources", "--json"]);

        expect(result).toSucceed();
      });
    });

    describe("that refuses connections", () => {
      it("still succeeds", async () => {
        const app = await aSetUpApp();
        platform.refusesConnections();

        const result = await app.run(["resources", "--json"]);

        expect(result).toSucceed();
      });
    });
  });

  describe("a generated command", () => {
    describe("against a server that refuses connections", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.refusesConnections();

        const result = await app.run(["idps", "list", "--json"]);

        expect(result).toFailWith("E_NETWORK");
      });
    });

    describe("against a server that hangs", () => {
      it("stops on Ctrl-C", async () => {
        const app = await aSetUpApp();
        const waiting = platform.hangs();

        const result = app.run(["idps", "list", "--json"]);
        await waiting;
        pressCtrlC();

        expect(await result).toFailWith("E_CANCELLED");
      });
    });
  });

  describe("against a valid server", () => {
    it("holds its invariants in every rendering", async () => {
      const app = await aSetUpApp();
      platform.servesAHostileOrigin();
      const args = ["resources"];

      await app.inEveryRendering((how) => app.run(how.json ? [...args, "--json"] : args, how.env));
    });

    describe("--json", () => {
      it("lists what the CLI manages before the project is set up", async () => {
        const app = await anApp();

        const result = await app.run(["resources", "--json"]);

        expect(result).toSucceed();
      });

      it("names every topic the resource commands are generated for", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["resources", "--json"]);

        const { data } = app.envelopeOf<{ items: ResourceRow[] }>(result);
        expect(data.items.map((row) => row.topic)).toEqual(
          expect.arrayContaining(["users", "teams", "sessions", "idps", "schemas"]),
        );
      });

      describe("without --force when no one can be asked", () => {
        const DESTRUCTIVE = [
          ["users", "delete", "user_1"],
          ["teams", "deactivate", "team_1"],
          ["sessions", "revoke", "sess_1"],
        ];

        it.each(DESTRUCTIVE)("is refused for %s %s", async (topic, verb, id) => {
          const app = await aSetUpApp();

          const result = await app.run([topic, verb, id, "--json"]);

          expect(result).toFailWith("E_CONFIRMATION_REQUIRED");
        });

        it.each(DESTRUCTIVE)("says to pass --force for %s %s", async (topic, verb, id) => {
          const app = await aSetUpApp();

          const result = await app.run([topic, verb, id, "--json"]);

          expect(result).toHintAt("--force");
        });

        it.each(DESTRUCTIVE)(
          "suggests running %s %s again with --force",
          async (topic, verb, id) => {
            const app = await aSetUpApp();

            const result = await app.run([topic, verb, id, "--json"]);

            expect(result).toSuggestExactly(app.againAsRun(`${topic} ${verb} ${id} --force`));
          },
        );
      });

      it("registers a connection made from its nested fields", async () => {
        const app = await aSetUpApp();

        await app.run(["idps", "create", ...ACME_CONNECTION_FLAGS, "--json"]);

        expect((await app.registeredIdps()).map((idp) => idp.slug)).toContain("acme-sso");
      });

      it("reads a policy by its operation", async () => {
        const app = await aSetUpApp();
        await app.writePasswordPolicy({ min_length: 12 });
        expect(await app.publish()).toSucceed();

        const result = await app.run(["policies", "get", PASSWORD_POLICY, "--json"]);

        expect(app.envelopeOf<{ config: object }>(result).data.config).toEqual({ min_length: 12 });
      });

      it("says what can be done to each topic", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["resources", "--json"]);

        const { data } = app.envelopeOf<{ items: ResourceRow[] }>(result);
        for (const row of data.items) {
          expect(row.verbs ?? [], `${row.topic} lists no verbs`).not.toEqual([]);
        }
      });
    });

    describe("a paged list", () => {
      // The cursor is the server's text, and a list names it twice for a
      // person: in its footer and in the command that reads the next page.
      // The envelope keeps it as it came, so paging with it still works.
      it("spells out an escape sequence the server put in the page cursor", async () => {
        const app = await aSetUpApp();
        platform.pagesWithAHostileCursor();

        const result = await app.run(["users", "list"]);

        expect(result.stdout + result.stderr).not.toContain("\u001b[2J");
        expect(result.stdout + result.stderr).toContain("\\x1b[2Jwiped");
      });
    });

    describe("a resource id of the wrong kind", () => {
      it.each([
        [["users", "get", "rel_01M6KPFXAE68N6G2X1HN5XD29R"]],
        [["sessions", "get", "user_01KX5N7C9D2E7F0N9WD3P2E4YM6"]],
        [["release", "get", "sess_01KX5N7C9D2E7F0N9WD3P2E4YM6"]],
      ])("is refused by %j", async (args) => {
        const app = await aSetUpApp();

        const result = await app.run([...args, "--json"]);

        expect(result).toFailWith("E_VALIDATION");
      });

      it.each([
        [["users", "get", "rel_01M6KPFXAE68N6G2X1HN5XD29R"], "users list"],
        [["sessions", "get", "user_01KX5N7C9D2E7F0N9WD3P2E4YM6"], "sessions list"],
        [["release", "get", "sess_01KX5N7C9D2E7F0N9WD3P2E4YM6"], "release list"],
      ])("by %j suggests %s", async (args, list) => {
        const app = await aSetUpApp();

        const result = await app.run([...args, "--json"]);

        expect(result).toSuggest(list);
      });
    });

    describe("--plain", () => {
      it("prints each topic as a tab-separated record", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["resources", "--plain"]);

        expect(result).toPrintPlainRow("users", /.+/, /.*/);
      });
    });
  });
});
