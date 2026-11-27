import { FsExistsError } from "@/lib/fs";

import type { Advice, Wording } from "./wording";

/** How a file that stands where the run would write one is refused. */
const EXISTS_ADVICE = {
  hint: "A file already exists. Use --force to overwrite or remove it first.",
} as const satisfies Advice;

/** How the errors of `@/lib/fs` are advised on, each for exactly its class. */
export const FS_WORDINGS: readonly Wording[] = [[FsExistsError, EXISTS_ADVICE]];
