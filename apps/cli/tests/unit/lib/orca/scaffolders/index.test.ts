import semver from "semver";
import { describe, expect, it } from "vitest";

import { scaffolders } from "@/lib/orca/scaffolders";
import { type FrameworkCli, frameworkCli } from "@/lib/orca/scaffolders/framework-clis";

/** The version or tag an npm spec names: `2.0.0-rc.3` for `create-qwik@2.0.0-rc.3`. */
function specVersion(spec: string): string {
  return spec.slice(spec.lastIndexOf("@") + 1);
}

/** The package an npm spec names: `@angular/cli` for `@angular/cli@22.2.6`. */
function specName(spec: string): string {
  return spec.slice(0, spec.lastIndexOf("@"));
}

const cases = scaffolders.map((scaffolder) => [scaffolder.displayName, scaffolder] as const);

describe("scaffolders", () => {
  it.each(cases)(
    "%s runs its framework CLI at the version framework-clis pins, and lists it",
    (_, scaffolder) => {
      const { spec } = scaffolder.nodeEngines;

      expect(spec).toBe(frameworkCli(specName(spec) as FrameworkCli));
      expect(scaffolder.pinnedPackages).toContain(spec);
    },
  );

  it.each(cases)("%s pins packages only at exact versions", (_, scaffolder) => {
    const ranges = scaffolder.pinnedPackages.filter((spec) => !semver.valid(specVersion(spec)));

    expect(ranges).toEqual([]);
  });
});
