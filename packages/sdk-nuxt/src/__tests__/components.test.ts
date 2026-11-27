import * as ui from "@zitadel/sdk-vue";
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

describe("@zitadel/sdk-nuxt/components", () => {
  it.each(VALUES)("exports %s as the very object @zitadel/sdk-vue exports", (name) => {
    expect(entryExports[name]).toBeDefined();
    expect(entryExports[name]).toBe(uiExports[name]);
  });

  it("exports no value that @zitadel/sdk-vue does not", () => {
    expect(Object.keys(entryExports).filter((name) => !(name in uiExports))).toEqual([]);
  });

  it("exports exactly the widget values the standard requires", () => {
    expect(Object.keys(entryExports).sort()).toEqual([...VALUES].sort());
  });
});
