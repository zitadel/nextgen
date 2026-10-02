import { describe, expect, it } from "vitest";

import { usePlatformMock } from "../helpers/platform";
import { anApp, aSetUpApp } from "../helpers/project";

const platform = usePlatformMock();

interface ResourceRow {
  readonly topic: string;
  readonly verbs?: string[];
}

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

        const { data } = app.envelopeOf<{ resources: ResourceRow[] }>(result);
        expect(data.resources.map((row) => row.topic)).toEqual(
          expect.arrayContaining(["users", "teams", "sessions", "idps", "schemas"]),
        );
      });

      it("says what can be done to each topic", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["resources", "--json"]);

        const { data } = app.envelopeOf<{ resources: ResourceRow[] }>(result);
        for (const row of data.resources) {
          expect(row.verbs ?? [], `${row.topic} lists no verbs`).not.toEqual([]);
        }
      });
    });
  });
});
