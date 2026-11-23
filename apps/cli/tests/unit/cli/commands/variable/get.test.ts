import { describe, expect, it } from "vitest";

import VariableGet from "@/cli/commands/variable/get";
import { Variable } from "@/lib/backend/services/variable";
import { parseFlag } from "@tests/helpers/inputs";

describe("variable get --fields", () => {
  it.each(Object.keys(JSON.parse(JSON.stringify(Variable.of("NAME", "x")))))(
    "accepts %s, which a Variable carries under --json",
    async (path) => {
      await expect(parseFlag(VariableGet.flags.fields, path, "fields")).resolves.toEqual([path]);
    },
  );

  it("refuses a field a Variable does not carry, naming the ones it does", async () => {
    await expect(
      parseFlag(VariableGet.flags.fields, "no_such_field", "fields"),
    ).rejects.toMatchObject({
      code: "E_VALIDATION",
      hint: expect.stringContaining("name, secret, value"),
    });
  });
});
