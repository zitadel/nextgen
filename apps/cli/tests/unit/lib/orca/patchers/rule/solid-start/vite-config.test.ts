import { describe, expect, it } from "vitest";

import { solidStartConfigEdit } from "../../../../../../../src/lib/orca/patchers/rule/solid-start/vite-config";

const edit = solidStartConfigEdit();

const BARE = `import { defineConfig } from "vite";
import { solidStart } from "@solidjs/start/config";

export default defineConfig({
  plugins: [solidStart(), nitro()],
});
`;

describe("solidStartConfigEdit", () => {
  it("adds the middleware option to a bare solidStart() call", () => {
    const out = edit(BARE);
    expect(out).toContain('solidStart({ middleware: "./src/middleware.ts" })');
    expect(out).toContain("nitro()"); // other plugins preserved
  });

  it("merges middleware into an existing solidStart({ ... }) options object", () => {
    const source = BARE.replace("solidStart()", 'solidStart({ ssr: true })');
    const out = edit(source);
    expect(out).toContain('middleware: "./src/middleware.ts"');
    expect(out).toContain("ssr: true");
    // Must not double the opening paren (solidStart(( ... ) — invalid config),
    // and parens must stay balanced.
    expect(out).not.toContain("solidStart((");
    expect(out).toContain('solidStart({ middleware: "./src/middleware.ts", ssr: true })');
    const open = (out.match(/\(/g) ?? []).length;
    const close = (out.match(/\)/g) ?? []).length;
    expect(open).toBe(close);
  });

  it("is idempotent — re-running over its own output changes nothing", () => {
    const once = edit(BARE);
    expect(edit(once)).toBe(once);
  });

  it("leaves an existing middleware option untouched", () => {
    const source = BARE.replace("solidStart()", 'solidStart({ middleware: "./src/mine.ts" })');
    expect(edit(source)).toBe(source);
  });

  it("throws E_VALIDATION when the file is missing", () => {
    expect(() => edit(undefined)).toThrowError(/not found/);
  });

  it("throws E_VALIDATION when there is no solidStart() plugin call", () => {
    expect(() => edit("export default defineConfig({ plugins: [] })")).toThrowError(
      /solidStart\(\) plugin call/,
    );
  });
});
