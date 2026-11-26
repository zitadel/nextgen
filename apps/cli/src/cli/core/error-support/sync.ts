import { SyncStateMalformedError } from "@/lib/sync";

import type { Refusal } from "@/cli/core/refusal";
import type { Wording } from "./wording";

/** How a `.zitadel/state.json` that cannot be read as one is refused. */
const STATE_MALFORMED_REFUSAL = {
  message: "{message}",
  hint: "The file records which platform resource each local file was synced as. Fix or remove it, then run this command again.",
  details: {
    file: ".zitadel/state.json",
  },
} as const satisfies Refusal;

/** How the errors of `@/lib/sync` are worded. */
export const SYNC_WORDINGS: readonly Wording[] = [
  [SyncStateMalformedError, STATE_MALFORMED_REFUSAL],
];
