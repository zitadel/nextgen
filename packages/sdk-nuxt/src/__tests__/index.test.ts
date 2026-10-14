import { businessLocales as componentsBusinessLocales } from "@zitadel/components";
import { describe, expect, it } from "vitest";

import * as entry from "../index";
import { businessLocales } from "../index";

describe("package entry", () => {
  it("re-exports the business copy overlay from @zitadel/components", () => {
    expect(businessLocales).toBe(componentsBusinessLocales);
  });

  // Pages import this entry in `<script setup>`, which also runs during SSR and
  // ships to the browser: server middleware and element classes stay off it.
  it("exports only the client-safe surface", () => {
    expect(Object.keys(entry).sort()).toEqual(["businessLocales", "useZitadelProject"]);
  });
});
