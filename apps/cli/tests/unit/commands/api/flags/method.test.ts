import { describe, expect, it } from "vitest";

import { methodFlag } from "../../../../../src/commands/api/flags/method";
import { parseFlag } from "../../../../helpers/inputs";

const METHODS = "GET, POST, PUT, PATCH, DELETE";

describe("-X", () => {
  it.each(["GET", "POST", "PUT", "PATCH", "DELETE"])("sends %s", async (method) => {
    await expect(parseFlag(methodFlag({}), method, "method")).resolves.toBe(method);
  });

  it("takes any case, as curl does", async () => {
    await expect(parseFlag(methodFlag({}), "delete", "method")).resolves.toBe("DELETE");
  });

  it.each(["trace", "OPTIONS", ""])(
    "refuses %j, naming it and the methods that exist",
    async (value) => {
      await expect(parseFlag(methodFlag({}), value, "method")).rejects.toMatchObject({
        code: "E_VALIDATION",
        message: `-X ${value} is not one of ${METHODS}`,
      });
    },
  );
});
