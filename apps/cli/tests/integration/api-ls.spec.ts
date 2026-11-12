import { describe, expect, it } from "vitest";

import { usePlatformMock } from "@tests/helpers/platform";
import { aSetUpApp } from "@tests/helpers/project";
import { expectedPublicCliCommand } from "@tests/helpers/run-cli";

const platform = usePlatformMock();

describe("api ls", () => {
  describe("against an invalid server", () => {
    describe("that is not a zitadel api", () => {
      it("still lists the operations, asking no server", async () => {
        const app = await aSetUpApp();
        platform.isNotZitadel();

        const result = await app.apiOperations("getLive");

        expect(result).toSucceed();
        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: expect.any(String),
          command: "api:ls",
          source: "",
          data: {
            title: "Found 1 operation",
            operations: [
              {
                id: "getLive",
                method: "GET",
                path: "/livez",
                summary: "Check the server's liveness",
                tag: "System",
                auth: "none",
                callable: true,
                parameters: [],
                body: null,
                paging: null,
                command: null,
              },
            ],
            count: 1,
            next_commands: [expectedPublicCliCommand(`api '<operation-id>' --cwd ${app.path}`)],
          },
          warnings: [],
        });
      });
    });

    describe("that is down", () => {
      it("still lists the operations, asking no server", async () => {
        const app = await aSetUpApp();
        platform.isUnavailable();

        const result = await app.apiOperations("getLive");

        expect(result).toSucceed();
        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: expect.any(String),
          command: "api:ls",
          source: "",
          data: {
            title: "Found 1 operation",
            operations: [
              {
                id: "getLive",
                method: "GET",
                path: "/livez",
                summary: "Check the server's liveness",
                tag: "System",
                auth: "none",
                callable: true,
                parameters: [],
                body: null,
                paging: null,
                command: null,
              },
            ],
            count: 1,
            next_commands: [expectedPublicCliCommand(`api '<operation-id>' --cwd ${app.path}`)],
          },
          warnings: [],
        });
      });
    });
  });

  describe("against a valid server", () => {
    it("holds its invariants in every rendering", async () => {
      const app = await aSetUpApp();
      platform.servesAHostileOrigin();
      const args = ["api", "ls"];

      await app.inEveryRendering((how) => app.run(how.json ? [...args, "--json"] : args, how.env));
    });

    describe("--json", () => {
      it("lists the operations of a tag with what a caller needs to build the call", async () => {
        const app = await aSetUpApp();

        const result = await app.apiOperations("--tag", "System");

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: expect.any(String),
          command: "api:ls",
          source: "",
          data: {
            title: "Found 2 operations",
            operations: [
              {
                id: "getLive",
                method: "GET",
                path: "/livez",
                summary: "Check the server's liveness",
                tag: "System",
                auth: "none",
                callable: true,
                parameters: [],
                body: null,
                paging: null,
                command: null,
              },
              {
                id: "getReady",
                method: "GET",
                path: "/readyz",
                summary: "Check the server's readiness",
                tag: "System",
                auth: "none",
                callable: true,
                parameters: [],
                body: null,
                paging: null,
                command: null,
              },
            ],
            count: 2,
            next_commands: [expectedPublicCliCommand(`api '<operation-id>' --cwd ${app.path}`)],
          },
          warnings: [],
        });
      });

      it("points to api <operation-id> from a list", async () => {
        const app = await aSetUpApp();

        const result = await app.apiOperations("getReady");

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: expect.any(String),
          command: "api:ls",
          source: "",
          data: {
            title: "Found 1 operation",
            operations: [
              {
                id: "getReady",
                method: "GET",
                path: "/readyz",
                summary: "Check the server's readiness",
                tag: "System",
                auth: "none",
                callable: true,
                parameters: [],
                body: null,
                paging: null,
                command: null,
              },
            ],
            count: 1,
            next_commands: [expectedPublicCliCommand(`api '<operation-id>' --cwd ${app.path}`)],
          },
          warnings: [],
        });
      });

      it("points back to api ls when nothing matches", async () => {
        const app = await aSetUpApp();

        const result = await app.apiOperations("zzznomatchzzz");

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: expect.any(String),
          command: "api:ls",
          source: "",
          data: {
            title: "No operations found",
            operations: [],
            count: 0,
            next_commands: [expectedPublicCliCommand(`api ls --cwd ${app.path}`)],
          },
          warnings: [],
        });
      });

      it("never echoes a filter holding a control character", async () => {
        const app = await aSetUpApp();

        const result = await app.apiOperations("a\u001b[2Jb");

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: expect.any(String),
          command: "api:ls",
          source: "",
          data: {
            title: "No operations found",
            operations: [],
            count: 0,
            next_commands: [expectedPublicCliCommand(`api ls --cwd ${app.path}`)],
          },
          warnings: [],
        });
      });
    });

    describe("rendered for a terminal", () => {
      it("prints an operation a line, its id first", async () => {
        const app = await aSetUpApp();

        const result = await app.apiOperationsRendered("--tag", "System");

        expect(result).toPrintPlainRows(
          ["getLive", "GET", "/livez", "Check the server's liveness"],
          ["getReady", "GET", "/readyz", "Check the server's readiness"],
        );
      });

      it("suggests api <operation-id> once, off stdout", async () => {
        const app = await aSetUpApp();

        const result = await app.apiOperationsRendered("--tag", "System");

        expect(result).toSayOnce(
          expectedPublicCliCommand(`api '<operation-id>' --cwd ${app.path}`),
        );
        expect(result.stdout).not.toContain("<operation-id>");
      });

      it("prints nothing for a filter that matches nothing, and points back to api ls", async () => {
        const app = await aSetUpApp();

        const result = await app.apiOperationsRendered("a\u001b[2Jb");

        expect(result.stdout).toBe("");
        expect(result).toSayOnce(expectedPublicCliCommand(`api ls --cwd ${app.path}`));
      });
    });

    describe("--plain", () => {
      it("prints each operation as a tab-separated record", async () => {
        const app = await aSetUpApp();

        const result = await app.apiOperationsRendered("--tag", "System", "--plain");

        expect(result).toPrintPlainRows(
          ["getLive", "GET", "/livez", "Check the server's liveness"],
          ["getReady", "GET", "/readyz", "Check the server's readiness"],
        );
      });
    });
  });
});
