import { describe, expect, it } from "vitest";

import { devScriptPortEdit } from "../../../../../../src/lib/orca/patchers/rule/dev-script-port";

const pkg = (scripts: Record<string, string>): string =>
  `${JSON.stringify({ name: "app", scripts }, null, 2)}\n`;

function devScriptOf(source: string): string | undefined {
  return (JSON.parse(source) as { scripts?: Record<string, string> }).scripts?.dev;
}

describe("devScriptPortEdit", () => {
  it("pins the port on a dev script that declares none", () => {
    const out = devScriptPortEdit("http://localhost:3456")(pkg({ dev: "next dev", build: "next build" }));
    expect(devScriptOf(out)).toBe("next dev --port 3456");
    // Sibling scripts survive untouched.
    expect(devScriptOf(out)).not.toBe(undefined);
    expect((JSON.parse(out) as { scripts: Record<string, string> }).scripts.build).toBe(
      "next build",
    );
  });

  it("rewrites a dev script pointing at a different port", () => {
    const out = devScriptPortEdit("http://localhost:3456")(pkg({ dev: "next dev -p 3000" }));
    expect(devScriptOf(out)).toBe("next dev -p 3456");
  });

  it("returns the source unchanged when the port already matches", () => {
    // Unchanged output is how the edit op skips the file, so a pre-existing
    // app whose script already agrees never gets its package.json reformatted.
    const source = pkg({ dev: "next dev --port 3456" });
    expect(devScriptPortEdit("http://localhost:3456")(source)).toBe(source);
  });

  it("leaves a project without a dev script alone", () => {
    const source = pkg({ build: "next build" });
    expect(devScriptPortEdit("http://localhost:3456")(source)).toBe(source);
  });

  it("preserves formatting outside the scripts map", () => {
    const source = `{\n  "name": "app",\n\n  "scripts": { "dev": "next dev" },\n  "private": true\n}\n`;
    const out = devScriptPortEdit("http://localhost:3456")(source);
    expect(out).toContain(`"private": true`);
    expect(out.startsWith(`{\n  "name": "app",\n\n`)).toBe(true);
  });

  it("fails with actionable guidance when package.json is missing", () => {
    expect(() => devScriptPortEdit("http://localhost:3456")(undefined)).toThrow(/package\.json is required/);
  });
});

describe("devScriptPortEdit issuer handling", () => {
  it("is a no-op when the issuer names no port", () => {
    // Nothing to hold the script to, so the user's script is left alone
    // rather than guessed at.
    const source = pkg({ dev: "next dev" });
    expect(devScriptPortEdit("https://auth.example.com")(source)).toBe(source);
    expect(devScriptPortEdit("not-a-url")(source)).toBe(source);
  });

  it("still pins a scheme-default port", () => {
    // Regression: losing 80 to URL canonicalisation turned the op into a
    // no-op, leaving the app on 3000 while the project allowed only 80.
    const out = devScriptPortEdit("http://localhost:80")(pkg({ dev: "next dev" }));
    expect(devScriptOf(out)).toBe("next dev --port 80");
  });

  it("targets the issuer's port even when the script names another", () => {
    // The doctor path: detection would say 4000; the registered origin is
    // what the server actually allows.
    const out = devScriptPortEdit("http://localhost:3456")(pkg({ dev: "next dev --port 4000" }));
    expect(devScriptOf(out)).toBe("next dev --port 3456");
  });
});
