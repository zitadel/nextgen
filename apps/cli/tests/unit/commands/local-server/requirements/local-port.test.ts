import { describe, expect, it } from "vitest";

import { localPort } from "../../../../../src/commands/local-server/requirements/local-port";
import { requirementContext } from "../../../../helpers/requirement-context";

describe("localPort", () => {
  it("is the port that was asked for", async () => {
    const found = await localPort.resolve(
      requirementContext({ flags: { port: 9090, cwd: "/nonexistent-zitadel-dir" } }),
    );

    expect(found).toBe(9090);
    expect(localPort.source?.(9090)).toBe("http://localhost:9090");
  });

  it("is the default port where nothing was started and none was asked for", async () => {
    const found = await localPort.resolve(
      requirementContext({ flags: { cwd: "/nonexistent-zitadel-dir" } }),
    );

    expect(found).toBe(8080);
  });
});
