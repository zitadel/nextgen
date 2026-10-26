import { describe, expect, it } from "vitest";

import { usePlatformMock } from "../helpers/platform";
import { aSetUpApp } from "../helpers/project";

const platform = usePlatformMock();

type Listed = { operations: { id: string; callable: boolean }[] };

describe("api ls", () => {
  describe("against an invalid server", () => {
    describe("that is not a zitadel api", () => {
      it("still lists the operations, asking no server", async () => {
        const app = await aSetUpApp();
        platform.isNotZitadel();

        const result = await app.apiOperations();

        expect(result).toSucceed();
      });
    });

    describe("that is down", () => {
      it("still lists the operations, asking no server", async () => {
        const app = await aSetUpApp();
        platform.isUnavailable();

        const result = await app.apiOperations();

        expect(result).toSucceed();
      });
    });
  });

  describe("against a valid server", () => {
    describe("--json", () => {
      it("lists the operations zitadel api calls", async () => {
        const app = await aSetUpApp();

        const result = await app.apiOperations();

        expect(app.envelopeOf<Listed>(result).data.operations).toContainEqual(
          expect.objectContaining({ id: "queryUsers", callable: true }),
        );
      });
    });

    describe("rendered for a terminal", () => {
      it("prints an operation a line, its id first", async () => {
        const app = await aSetUpApp();

        const result = await app.apiOperationsRendered("--tag", "System");

        expect(result).toPrint("getLive\tGET\t/livez");
      });
    });
  });
});
