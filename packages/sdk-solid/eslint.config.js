// @ts-check
import zitadel, { prettier as prettierLast } from "@zitadel/eslint-config";
import solid from "eslint-plugin-solid/configs/typescript";
import { defineConfig } from "eslint/config";

export default defineConfig(
  zitadel,
  { ...solid, files: ["**/*.{tsx,jsx}"] },
  // eslint-config-prettier LAST so Prettier wins over the Solid layer.
  prettierLast,
);
