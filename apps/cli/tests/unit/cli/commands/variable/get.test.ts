import { describe, expect, it } from "vitest";

import VariableGet from "@/cli/commands/variable/get";
import { Variable } from "@/lib/backend/services/variable";

describe("variable get --fields", () => {
  it("judges fields by the keys a Variable carries when it holds a value", () => {
    const shape = (VariableGet.flags.fields as { shape?: { known: ReadonlySet<string> } }).shape;
    const carried = Object.keys(JSON.parse(JSON.stringify(Variable.of("NAME", "x"))));

    expect([...(shape?.known ?? [])].sort()).toEqual(carried.sort());
  });
});
