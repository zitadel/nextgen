import { DEFAULT_SERVER } from "@zitadel/config/server";
import { describe, expect, it } from "vitest";

import { SERVER } from "@/constants";

describe("SERVER", () => {
  it("is the server the console leaves out of a command it would target anyway", () => {
    expect(SERVER).toBe(DEFAULT_SERVER);
  });
});
