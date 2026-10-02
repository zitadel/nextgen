// @ts-check
import { defineConfig } from "eslint/config";

import base from "./index.js";

// The shared config lints itself with its own rules (dogfooding).
export default defineConfig(base);
