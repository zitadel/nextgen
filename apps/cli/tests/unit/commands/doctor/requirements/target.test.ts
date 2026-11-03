import { describe, expect, it } from "vitest";

import { target } from "../../../../../src/commands/doctor/requirements/target";
import { requirementContext } from "../../../../helpers/requirement-context";

type Target = {
  port: number;
  hostedServer: string | undefined;
};

describe("target", () => {
  const meta = { cwd: "/nonexistent-zitadel-dir" };

  it("is the default local port where nothing was started and no port was asked for", async () => {
    const found = (await target.resolve(requirementContext({ meta }))) as Target;

    expect(found).toEqual({ port: 8080, hostedServer: undefined });
    expect(target.source?.(found)).toBe("http://localhost:8080");
  });

  it("is the port that was asked for", async () => {
    const found = (await target.resolve(
      requirementContext({ flags: { port: 9090 }, meta }),
    )) as Target;

    expect(found.port).toBe(9090);
  });
});
