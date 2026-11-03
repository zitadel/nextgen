import { DEFAULT_SERVER } from "@zitadel/config/server";
import { describe, expect, it } from "vitest";

import { cliSetup } from "./cli-hint";

describe("cliSetup", () => {
  it("leaves the server out when it is the CLI's own default", () => {
    expect(cliSetup(DEFAULT_SERVER)).toBe("npx @zitadel/cli@latest setup");
  });

  it("names any other server, a local one included", () => {
    expect(cliSetup("http://localhost:8080")).toBe(
      "npx @zitadel/cli@latest setup --server http://localhost:8080",
    );
  });
});
