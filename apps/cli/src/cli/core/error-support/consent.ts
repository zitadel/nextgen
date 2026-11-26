import { ConsentRequiredError } from "@/lib/consent";

import { type Advice, derived, type Wording } from "./wording";

/** How a destructive action stopped for want of consent is refused. */
const REQUIRED_ADVICE = {
  hint: "Ask a person first: {question} Pass --force only once they agree.",
  next: ["{retry}"],
  details: {
    question: "{question}",
  },
} as const satisfies Advice;

/** How the errors of `@/lib/consent` are worded. */
export const CONSENT_WORDINGS: readonly Wording[] = [
  derived(ConsentRequiredError, REQUIRED_ADVICE, (error) => {
    if (error.retry === undefined) {
      return {};
    }
    return {
      next: {
        retry: error.retry,
      },
    };
  }),
];
