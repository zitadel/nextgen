import { describe, expect, it } from "vitest";

import { svelteKitViteConfigEdit } from "../../../../../../../src/lib/orca/patchers/rule/sveltekit/vite-config";

const edit = svelteKitViteConfigEdit();

// The config `npx sv create` writes, tabs and single quotes included.
const SV_CREATE = `import adapter from '@sveltejs/adapter-auto';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
\tplugins: [
\t\tsveltekit({
\t\t\tcompilerOptions: {
\t\t\t\trunes: ({ filename }) => (filename.includes('node_modules') ? undefined : true)
\t\t\t},
\t\t\tadapter: adapter()
\t\t})
\t]
});
`;

describe("svelteKitViteConfigEdit", () => {
  it("adds zitadel() after the sveltekit() plugin, keeping the config's formatting", () => {
    expect(edit(SV_CREATE)).toBe(`import adapter from '@sveltejs/adapter-auto';
import { sveltekit } from '@sveltejs/kit/vite';
import { zitadel } from "@zitadel/sdk-sveltekit/vite";
import { defineConfig } from 'vite';

export default defineConfig({
\tplugins: [
\t\tsveltekit({
\t\t\tcompilerOptions: {
\t\t\t\trunes: ({ filename }) => (filename.includes('node_modules') ? undefined : true)
\t\t\t},
\t\t\tadapter: adapter()
\t\t}), zitadel()
\t]
});
`);
  });

  it("returns an already-wired config untouched", () => {
    const wired = edit(SV_CREATE);
    expect(edit(wired)).toBe(wired);
  });

  it("adds only the import when the plugin call is already there", () => {
    const out = edit(SV_CREATE.replace("adapter()\n\t\t})", "adapter()\n\t\t}), zitadel()"));
    expect(out.match(/zitadel\(\)/g)).toHaveLength(1);
    expect(out).toContain('import { zitadel } from "@zitadel/sdk-sveltekit/vite";');
  });

  it("puts the import first when there is no @sveltejs/kit/vite import", () => {
    const out = edit(`export default { plugins: [sveltekit()] };\n`);
    expect(out).toBe(
      `import { zitadel } from "@zitadel/sdk-sveltekit/vite";\nexport default { plugins: [sveltekit(), zitadel()] };\n`,
    );
  });

  it("refuses a config without a sveltekit() plugin call", () => {
    expect(() => edit(`export default { plugins: [] };\n`)).toThrow(
      expect.objectContaining({ code: "E_VALIDATION" }),
    );
  });

  it("refuses a missing config", () => {
    expect(() => edit(undefined)).toThrow(expect.objectContaining({ code: "E_VALIDATION" }));
  });
});
