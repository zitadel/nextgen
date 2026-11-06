import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** The package's own folder, whichever file asks. */
export const packageRoot: string = join(dirname(fileURLToPath(import.meta.url)), "..");
