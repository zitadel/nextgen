import semver from "semver";
import { describe, expect, it } from "vitest";

import { scaffolders } from "../../../../../src/lib/orca/scaffolders";

/** The version or tag an npm spec names: `2.0.0-rc.3` for `create-qwik@2.0.0-rc.3`. */
function specVersion(spec: string): string {
  return spec.slice(spec.lastIndexOf("@") + 1);
}

const cases = scaffolders.map((scaffolder) => [scaffolder.displayName, scaffolder] as const);

describe("scaffolders", () => {
  it.each(cases)(
    "%s lists its framework CLI as pinned exactly when it names a version",
    (_, scaffolder) => {
      const { spec } = scaffolder.nodeEngines;

      expect(scaffolder.pinnedPackages.includes(spec)).toBe(
        semver.valid(specVersion(spec)) !== null,
      );
    },
  );

  it.each(cases)("%s pins packages only at exact versions", (_, scaffolder) => {
    const ranges = scaffolder.pinnedPackages.filter((spec) => !semver.valid(specVersion(spec)));

    expect(ranges).toEqual([]);
  });
});
