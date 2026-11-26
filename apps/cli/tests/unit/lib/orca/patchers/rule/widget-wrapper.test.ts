import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const RULE_DIR = join(process.cwd(), "src/lib/orca/patchers/rule");

const FULL_VIEWPORT_WRAPPER = /position:\s*"?fixed"?[\s\S]*?color-?[sS]cheme/g;

const CENTERED = /align-?[iI]tems:\s*"?center/;

describe("the full-viewport wrapper around a login widget", () => {
  it.each([
    "angular",
    "qwik",
    "qwik-router",
    "react",
    "solid",
    "solid-start",
    "svelte",
    "sveltekit",
    "tanstack-start",
    "vue",
  ])("centers the widget in the %s templates", (framework) => {
    const source = readFileSync(join(RULE_DIR, framework, "templates.ts"), "utf8");
    const wrappers = source.match(FULL_VIEWPORT_WRAPPER) ?? [];

    expect(wrappers.length).toBeGreaterThan(0);
    expect(wrappers.filter((wrapper) => !CENTERED.test(wrapper))).toEqual([]);
  });

  it("gives each Angular component host the width the widget fills", () => {
    const source = readFileSync(join(RULE_DIR, "angular", "templates.ts"), "utf8");
    const hosts = source.match(/<zitadel-auth-(?:login|session)\n[\s\S]*?><\/zitadel-auth-/g) ?? [];

    expect(hosts).toHaveLength(3);
    expect(hosts.filter((host) => !host.includes("display:block;width:100%"))).toEqual([]);
  });
});
