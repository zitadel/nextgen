import { WizardDefinitionError } from "@/lib/wizard";

import type { Row } from "./row";

/** A wizard with two steps of one name. */
const DUPLICATE_MESSAGE = 'The wizard "init" already has a step "framework"';

/** The errors of `@/lib/wizard`, each with what main showed for it. */
export const WIZARD_ROWS: readonly Row[] = [
  {
    error: new WizardDefinitionError(DUPLICATE_MESSAGE),
    main: "lib/wizard/wizard.ts:380",
    expected: {
      code: "E_VALIDATION",
      message: DUPLICATE_MESSAGE,
      details: {
        original: { name: "WizardDefinitionError", message: DUPLICATE_MESSAGE },
      },
      exitCode: 3,
    },
  },
];
