import { describe, expect, it } from "vitest";

import VariableList from "@/cli/commands/variable/list";
import { parseFlag } from "@tests/helpers/inputs";

describe("variable list --fields", () => {
  it.each(["name", "secret", "value", "preview", "preview.secret", "preview.value"])(
    "accepts %s, which a variable carries under --json",
    async (path) => {
      await expect(parseFlag(VariableList.flags.fields, path, "fields")).resolves.toEqual([path]);
    },
  );

  it("refuses a field a variable does not carry", async () => {
    await expect(
      parseFlag(VariableList.flags.fields, "no_such_field", "fields"),
    ).rejects.toMatchObject({ code: "E_VALIDATION" });
  });

  it("shows a field the list has in the example of an empty choice", async () => {
    await expect(parseFlag(VariableList.flags.fields, "", "fields")).rejects.toMatchObject({
      hint: expect.stringContaining("--fields name"),
    });
  });
});
