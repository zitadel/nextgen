import { version as viteVersion } from "vite";
import { describe, expect, it } from "vitest";

import { builderMeta, moduleJson } from "./module-json.ts";

describe("builderMeta", () => {
  it("names this plugin and the Vite it built with", () => {
    expect(builderMeta()).toEqual({
      "vite-plugin-nuxt-module": expect.stringMatching(/^\d+\.\d+\.\d+/),
      vite: viteVersion,
    });
  });
});

describe("moduleJson", () => {
  it("fills name and version from the package when the module's meta has none", () => {
    expect(
      moduleJson({ configKey: "x" }, { name: "pkg", version: "1.0.0" }, undefined),
    ).toMatchObject({ configKey: "x", name: "pkg", version: "1.0.0" });
  });

  it("keeps the module's own name and lets extra fields win", () => {
    expect(
      moduleJson({ name: "own" }, { name: "pkg", version: "1.0.0" }, { version: "2.0.0" }),
    ).toMatchObject({ name: "own", version: "2.0.0" });
  });
});
