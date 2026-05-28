import { describe, expect, it } from "vitest";

import { Orca } from "../../../../src/lib/orca";
import { patchers } from "../../../../src/lib/orca/patchers";
import { scaffolders } from "../../../../src/lib/orca/scaffolders";

const orca = new Orca(scaffolders, patchers);

describe("Orca", () => {
  it("selects the Next scaffolder and patcher", () => {
    expect(orca.scaffolderFor("next").canScaffold("next")).toBe(true);
    expect(orca.patcherFor("next").canPatch("next")).toBe(true);
  });

  it("throws E_VALIDATION for an unsupported framework", () => {
    expect(() => orca.scaffolderFor("svelte")).toThrowError(/No scaffolder/);
    expect(() => orca.patcherFor("svelte")).toThrowError(/No patcher/);
  });

  it("derives available frameworks from the scaffolder registry", () => {
    expect(orca.availableFrameworks().map((choice) => choice.id)).toEqual(["next"]);
  });
});
