import { SuggestionInvalidError } from "@/lib/suggestion";

import type { Row } from "./row";

/** A follow-up that leaves out a flag its command requires. */
const REQUIRED_MESSAGE = "env:add requires --name";

/** A follow-up this run did not render. */
const UNRENDERED_MESSAGE = "deploy was not rendered by this run";

/** The errors of `@/lib/suggestion`, each with what main showed for it. */
export const SUGGESTION_ROWS: readonly Row[] = [
  {
    case: "a follow-up that leaves out a required flag",
    error: new SuggestionInvalidError(REQUIRED_MESSAGE),
    main: "lib/suggestion/index.ts:683",
    deviation: {
      reason: "main threw a bare Error; the typed error names its own class",
      shown: {
        details: {
          original: { name: "SuggestionInvalidError", message: REQUIRED_MESSAGE },
        },
      },
    },
    expected: {
      code: "E_VALIDATION",
      message: REQUIRED_MESSAGE,
      details: {
        original: { name: "Error", message: REQUIRED_MESSAGE },
      },
      exitCode: 3,
    },
  },
  {
    case: "a follow-up this run did not render",
    error: new SuggestionInvalidError(UNRENDERED_MESSAGE),
    main: "lib/suggestion/run.ts:164",
    deviation: {
      reason: "main threw a bare Error; the typed error names its own class",
      shown: {
        details: {
          original: { name: "SuggestionInvalidError", message: UNRENDERED_MESSAGE },
        },
      },
    },
    expected: {
      code: "E_VALIDATION",
      message: UNRENDERED_MESSAGE,
      details: {
        original: { name: "Error", message: UNRENDERED_MESSAGE },
      },
      exitCode: 3,
    },
  },
];
