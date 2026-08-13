import { describe, expect, it } from "vitest";

import { devScriptPortEdit } from "../../../../../../src/lib/orca/patchers/rule/dev-script-port";

const pkg = (scripts: Record<string, string>): string =>
  `${JSON.stringify({ name: "app", scripts }, null, 2)}\n`;

function devScriptOf(source: string): string | undefined {
  return (JSON.parse(source) as { scripts?: Record<string, string> }).scripts?.dev;
}

describe("devScriptPortEdit", () => {
  it("pins the port on a dev script that declares none", () => {
    const out = devScriptPortEdit(3456)(pkg({ dev: "next dev", build: "next build" }));
    expect(devScriptOf(out)).toBe("next dev --port 3456");
    // Sibling scripts survive untouched.
    expect(devScriptOf(out)).not.toBe(undefined);
    expect((JSON.parse(out) as { scripts: Record<string, string> }).scripts.build).toBe(
      "next build",
    );
  });

  it("rewrites a dev script pointing at a different port", () => {
    const out = devScriptPortEdit(3456)(pkg({ dev: "next dev -p 3000" }));
    expect(devScriptOf(out)).toBe("next dev -p 3456");
  });

  it("returns the source unchanged when the port already matches", () => {
    // Unchanged output is how the edit op skips the file, so a pre-existing
    // app whose script already agrees never gets its package.json reformatted.
    const source = pkg({ dev: "next dev --port 3456" });
    expect(devScriptPortEdit(3456)(source)).toBe(source);
  });

  it("leaves a project without a dev script alone", () => {
    const source = pkg({ build: "next build" });
    expect(devScriptPortEdit(3456)(source)).toBe(source);
  });

  it("preserves formatting outside the scripts map", () => {
    const source = `{\n  "name": "app",\n\n  "scripts": { "dev": "next dev" },\n  "private": true\n}\n`;
    const out = devScriptPortEdit(3456)(source);
    expect(out).toContain(`"private": true`);
    expect(out.startsWith(`{\n  "name": "app",\n\n`)).toBe(true);
  });

  it("fails with actionable guidance when package.json is missing", () => {
    expect(() => devScriptPortEdit(3456)(undefined)).toThrow(/package\.json is required/);
  });
});
