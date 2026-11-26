import { errorMessage } from "@/lib/errors";
import { TelemetryClientError, TelemetryHomeUnknownError } from "@/lib/telemetry";

import type { Refusal } from "@/cli/core/refusal";
import { derived, type Wording } from "./wording";

/**
 * How a telemetry failure is reported, should one ever escape the package: as
 * the system or the client failed.
 */
const TELEMETRY_REFUSAL = {
  code: "E_VALIDATION",
  message: "{reason}",
  details: {
    original: "{original}",
  },
} as const satisfies Refusal;

/** How the errors of `@/lib/telemetry` are worded. */
export const TELEMETRY_WORDINGS: readonly Wording[] = [
  derived(TelemetryHomeUnknownError, TELEMETRY_REFUSAL, (error) => {
    return {
      values: {
        reason: errorMessage(error.cause ?? error),
      },
    };
  }),
  derived(TelemetryClientError, TELEMETRY_REFUSAL, (error) => {
    return {
      values: {
        reason: errorMessage(error.cause ?? error),
      },
    };
  }),
];
