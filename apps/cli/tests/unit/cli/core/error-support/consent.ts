import { ConsentInternalError, ConsentRequiredError } from "@/lib/consent";

import type { Row } from "./row";

/** The gate's name, which the refusal names. */
const GATE = "delete project acme";

/** The gate's question, which only a person can answer. */
const QUESTION = "Delete project acme and everything in it?";

/** What a dry run that asks for consent is refused with. */
const DRY_RUN_MESSAGE = `A dry run asked for consent to ${GATE}`;

/** What a destructive operation without consent is refused with. */
const UNCONSENTED_MESSAGE = "A destructive operation ran without consent";

/** The errors of `@/lib/consent`, each with what main showed for it. */
export const CONSENT_ROWS: readonly Row[] = [
  {
    case: "a dry run that asked for consent",
    error: new ConsentInternalError(DRY_RUN_MESSAGE),
    main: "lib/consent/consent.ts:115",
    deviation: {
      reason: "main threw a bare Error; the typed error names its own class",
      shown: {
        details: {
          original: { name: "ConsentInternalError", message: DRY_RUN_MESSAGE },
        },
      },
    },
    expected: {
      code: "E_VALIDATION",
      message: DRY_RUN_MESSAGE,
      details: {
        original: { name: "Error", message: DRY_RUN_MESSAGE },
      },
      exitCode: 3,
    },
  },
  {
    case: "a destructive operation that ran without consent",
    error: new ConsentInternalError(UNCONSENTED_MESSAGE),
    main: "lib/consent/consent.ts:150",
    deviation: {
      reason: "main threw a bare Error; the typed error names its own class",
      shown: {
        details: {
          original: { name: "ConsentInternalError", message: UNCONSENTED_MESSAGE },
        },
      },
    },
    expected: {
      code: "E_VALIDATION",
      message: UNCONSENTED_MESSAGE,
      details: {
        original: { name: "Error", message: UNCONSENTED_MESSAGE },
      },
      exitCode: 3,
    },
  },
  {
    error: new ConsentRequiredError(
      `Cannot ${GATE} without --force in non-interactive mode`,
      QUESTION,
    ),
    main: "lib/ui/asker.ts:197",
    expected: {
      code: "E_CONFIRMATION_REQUIRED",
      message: `Cannot ${GATE} without --force in non-interactive mode`,
      hint: `Ask a person first: ${QUESTION} Pass --force only once they agree.`,
      details: {
        question: QUESTION,
      },
      exitCode: 3,
    },
  },
];
