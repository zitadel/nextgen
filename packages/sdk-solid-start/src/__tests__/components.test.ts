import { readFileSync } from "node:fs";
import * as ui from "@zitadel/sdk-solid";
import { describe, expect, it } from "vitest";

import * as entry from "../components";

const VALUES = [
  "ZitadelLogin",
  "ZitadelLogout",
  "ZitadelSession",
  "configureZitadel",
  "businessLocales",
] as const;

const entryExports = entry as Record<string, unknown>;
const uiExports = ui as Record<string, unknown>;

describe("@zitadel/sdk-solid-start/components", () => {
  it.each(VALUES)("exports %s as the very object @zitadel/sdk-solid exports", (name) => {
    expect(entryExports[name]).toBeDefined();
    expect(entryExports[name]).toBe(uiExports[name]);
  });

  it("exports no value that @zitadel/sdk-solid does not", () => {
    expect(Object.keys(entryExports).filter((name) => !(name in uiExports))).toEqual([]);
  });

  it("exports exactly the widget values the standard requires", () => {
    expect(Object.keys(entryExports).sort()).toEqual([...VALUES].sort());
  });
  it("declares the solid export condition on its package entry", () => {
    const manifest = JSON.parse(
      readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
    ) as {
      exports: Record<string, Record<string, string>>;
    };
    expect(manifest.exports["./components"]?.solid).toBe(manifest.exports["./components"]?.import);
  });
});
