import { defineConfig } from 'tsup';
import * as preset from 'tsup-preset-solid';

const presetOptions: preset.PresetOptions = {
  entries: [{ entry: 'src/index.tsx' }],
  cjs: false,
};

export default defineConfig((config) => {
  const watching = !!config.watch;
  const parsed = preset.parsePresetOptions(presetOptions, watching);

  if (!watching) {
    const packageFields = preset.generatePackageExports(parsed);
    preset.writePackageJson(packageFields);
  }

  return preset.generateTsupOptions(parsed);
});
