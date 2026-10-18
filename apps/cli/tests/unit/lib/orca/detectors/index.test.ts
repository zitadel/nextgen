import { describe, expect, it } from "vitest";

import { detectors } from "../../../../../src/lib/orca/detectors";

describe("detectors", () => {
  it.each(detectors.map((detector) => [detector.framework, detector]))(
    "%s names itself and the package its version comes from",
    (_framework, detector) => {
      expect(detector.displayName.trim()).not.toBe("");
      expect(detector.versionPackage.trim()).not.toBe("");
    },
  );

  it("gives every framework its own id and display name", () => {
    const ids = detectors.map((detector) => detector.framework);
    const names = detectors.map((detector) => detector.displayName);

    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(names).size).toBe(names.length);
  });
});
