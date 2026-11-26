import { SyncStateMalformedError, SyncStateUnreadableError } from "@/lib/sync";

import type { Refusal } from "@/cli/core/refusal";
import type { Wording } from "./wording";

/** How a state file whose entries do not read is refused, with how to fix it. */
const STATE_MALFORMED_REFUSAL = {
  message: "{message}",
  hint: "The file records which platform resource each local file was synced as. Fix or remove it, then run this command again.",
  details: {
    file: ".zitadel/state.json",
  },
} as const satisfies Refusal;

/** How a state file that does not read at all is refused: as the parser failed. */
const STATE_UNREADABLE_REFUSAL = {
  message: "{message}",
  details: {
    original: "{original}",
  },
} as const satisfies Refusal;

/** How the errors of `@/lib/sync` are worded, most specific first. */
export const SYNC_WORDINGS: readonly Wording[] = [
  [SyncStateUnreadableError, STATE_UNREADABLE_REFUSAL],
  [SyncStateMalformedError, STATE_MALFORMED_REFUSAL],
];
