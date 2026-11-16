import { fileURLToPath } from "node:url";

export const cliPackageRoot = fileURLToPath(new URL("../../", import.meta.url));
