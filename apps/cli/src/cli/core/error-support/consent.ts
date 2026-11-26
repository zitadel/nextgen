import { ConsentInternalError, ConsentRequiredError } from "@/lib/consent";

import type { Refusal } from "@/cli/core/refusal";
import { derived, type Wording } from "./wording";

/** How a destructive action stopped for want of consent is refused. */
const REQUIRED_REFUSAL = {
  message: "{message}",
  hint: "Ask a person first: {question} Pass --force only once they agree.",
  next: ["{retry}"],
  details: {
    question: "{question}",
  },
} as const satisfies Refusal;

/** How a bug in the consent package is reported, with the failure it is. */
const INTERNAL_REFUSAL = {
  message: "{message}",
  details: {
    original: "{original}",
  },
} as const satisfies Refusal;

/** How the errors of `@/lib/consent` are worded. */
export const CONSENT_WORDINGS: readonly Wording[] = [
  derived(ConsentRequiredError, REQUIRED_REFUSAL, (error) => {
    if (error.retry === undefined) {
      return {};
    }
    return {
      next: {
        retry: error.retry,
      },
    };
  }),
  [ConsentInternalError, INTERNAL_REFUSAL],
];
