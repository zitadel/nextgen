import { defineConfig } from "tsup";
import * as preset from "tsup-preset-solid";

/**
 * Solid component libraries must ship their JSX-preserving source under a
 * `solid` export condition so the *consuming* app's Solid compiler can compile
 * them correctly for both server and client. A pre-bundled-to-plain-JS build
 * (one target) cannot hydrate when imported from `node_modules` under SSR
 * (SolidStart) — see solidjs/solid-start#1110. `tsup-preset-solid` emits the
 * `.jsx` (server/`solid`) entry alongside the compiled `.js` (client) and the
 * `.d.ts`, which the `exports` map in package.json points at.
 */
const presetOptions: preset.PresetOptions = {
  entries: [{ entry: "src/index.tsx" }],
  cjs: false,
};

export default defineConfig((config) => {
  const watching = !!config.watch;
  const parsed = preset.parsePresetOptions(presetOptions, watching);
  return preset.generateTsupOptions(parsed);
});
