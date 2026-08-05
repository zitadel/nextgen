import { describe, expect, it } from "vitest";

import { exportpartsFor, stampExportparts } from "./exportparts.js";

describe("exportparts forwarding map", () => {
  it("derives <atom>-<part> mappings from the manifest registry", () => {
    expect(exportpartsFor("zl-field")).toContain("input: field-input");
    expect(exportpartsFor("zl-field")).toContain("error: field-error");
    expect(exportpartsFor("zl-button")).toBe("root: button-root, spinner: button-spinner");
    expect(exportpartsFor("zl-page-shell")).toContain("shell: page-shell-shell");
  });

  it("skips part-less atoms and unknown tags", () => {
    expect(exportpartsFor("zl-icon")).toBeUndefined();
    expect(exportpartsFor("zl-passkey")).toBeUndefined();
    expect(exportpartsFor("div")).toBeUndefined();
  });

  it("stamps idempotently across a scope", () => {
    const scope = document.createElement("div");
    scope.innerHTML = `<zl-field name="email"></zl-field><zl-icon></zl-icon><zl-button></zl-button>`;
    stampExportparts(scope);
    stampExportparts(scope);
    expect(scope.querySelector("zl-field")?.getAttribute("exportparts")).toBe(
      exportpartsFor("zl-field"),
    );
    expect(scope.querySelector("zl-button")?.getAttribute("exportparts")).toBe(
      exportpartsFor("zl-button"),
    );
    expect(scope.querySelector("zl-icon")?.hasAttribute("exportparts")).toBe(false);
  });
});
