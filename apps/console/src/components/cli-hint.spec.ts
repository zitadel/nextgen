import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { cliSetup } from "./cli-hint";

/** The CLI's own default server, read from its source so a change there fails here. */
function cliDefaultServer(): string {
  const source = readFileSync(
    resolve(import.meta.dirname, "../../../cli/src/lib/server.ts"),
    "utf8",
  );
  const match = /export const DEFAULT_SERVER = "([^"]+)"/.exec(source);
  if (!match?.[1]) throw new Error("DEFAULT_SERVER not found in apps/cli/src/lib/server.ts");
  return match[1];
}

describe("cliSetup", () => {
  it("leaves the server out when it is the CLI's own default", () => {
    expect(cliSetup(cliDefaultServer())).toBe("npx @zitadel/cli@latest setup");
  });

  it("names any other server, a local one included", () => {
    expect(cliSetup("http://localhost:8080")).toBe(
      "npx @zitadel/cli@latest setup --server http://localhost:8080",
    );
  });
});
