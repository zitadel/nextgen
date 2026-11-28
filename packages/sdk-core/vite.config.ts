import { defineConfig } from "vite";

import { libraryConfig } from "@zitadel/vite";

export default defineConfig(libraryConfig(import.meta.dirname));
