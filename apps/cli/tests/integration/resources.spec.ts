import { describe, expect, it } from "vitest";

import { usePlatformMock } from "../helpers/platform";
import { anApp, aSetUpApp, PASSWORD_POLICY } from "../helpers/project";
import { pressCtrlC } from "../helpers/run-cli";

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

          expect(result).toFailWith("E_VALIDATION");
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
  });
});
