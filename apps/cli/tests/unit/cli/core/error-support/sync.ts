import { SyncStateMalformedError, SyncStateUnreadableError } from "@/lib/sync";

import type { Row } from "./row";

/** The state file every sync row reads. */
const STATE_PATH = ".zitadel/state.json";

/** What main's `readState` threw for a file that holds no object. */
const NOT_OBJECT_MESSAGE = `${STATE_PATH} does not hold an object`;

/** What `JSON.parse` throws for a file that is not JSON. */
const NOT_JSON_MESSAGE = `Unexpected token 'x', "x" is not valid JSON`;

/** What `publishedIds` found wrong with the file. */
const ENTRY_MESSAGE = "resources is not an object";

/** The errors of `@/lib/sync`, each with what main showed for it. */
export const SYNC_ROWS: readonly Row[] = [
  {
    case: "a state file that holds no object, read directly",
    error: new SyncStateUnreadableError(NOT_OBJECT_MESSAGE),
    main: "lib/sync/state.ts:34",
    deviation: {
      reason: "main threw a bare Error; the typed error names its own class",
      shown: {
        details: {
          original: { name: "SyncStateUnreadableError", message: NOT_OBJECT_MESSAGE },
        },
      },
    },
    expected: {
      code: "E_VALIDATION",
      message: NOT_OBJECT_MESSAGE,
      details: {
        original: { name: "Error", message: NOT_OBJECT_MESSAGE },
      },
      exitCode: 3,
    },
  },
  {
    case: "a state file that is not JSON, read directly",
    error: new SyncStateUnreadableError(NOT_JSON_MESSAGE, new SyntaxError(NOT_JSON_MESSAGE)),
    main: "lib/sync/state.ts:32",
    expected: {
      code: "E_VALIDATION",
      message: NOT_JSON_MESSAGE,
      details: {
        original: { name: "SyntaxError", message: NOT_JSON_MESSAGE },
      },
      exitCode: 3,
    },
  },
  {
    case: "a state file whose entries are malformed",
    error: new SyncStateMalformedError(
      `Cannot read ${STATE_PATH}: ${ENTRY_MESSAGE}`,
      new Error(ENTRY_MESSAGE),
    ),
    main: "lib/sync/state.ts:118",
    expected: {
      code: "E_VALIDATION",
      message: `Cannot read ${STATE_PATH}: ${ENTRY_MESSAGE}`,
      hint: "The file records which platform resource each local file was synced as. Fix or remove it, then run this command again.",
      details: {
        file: STATE_PATH,
      },
      exitCode: 3,
    },
  },
];
