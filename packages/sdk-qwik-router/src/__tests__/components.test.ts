import * as ui from "@zitadel/sdk-qwik";
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

describe("@zitadel/sdk-qwik-router/components", () => {
  it.each(VALUES)("exports %s as the very object @zitadel/sdk-qwik exports", (name) => {
    expect(entryExports[name]).toBeDefined();
    expect(entryExports[name]).toBe(uiExports[name]);
  });

  it("exports no value that @zitadel/sdk-qwik does not", () => {
    expect(Object.keys(entryExports).filter((name) => !(name in uiExports))).toEqual([]);
  });

  it("exports exactly the widget values the standard requires", () => {
    expect(Object.keys(entryExports).sort()).toEqual([...VALUES].sort());
  });
});
