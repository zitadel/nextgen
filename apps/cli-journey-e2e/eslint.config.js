// @ts-check
import zitadel from "@zitadel/eslint-config";
import { defineConfig } from "eslint/config";

export default defineConfig({ ignores: ["fixtures/preexisting/**"] }, zitadel);
