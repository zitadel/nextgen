import { ApiError } from "@zitadel/api/runtime/fetch";
import { Alert, Icon } from "@zitadel/ui-react";
import type { ErrorComponentProps } from "@tanstack/react-router";

const STATE_ROW = "flex items-center gap-2 text-zl-text-secondary-gray";

/** Shared pending boundary (Console ADR 0001). */
export function PendingState() {
  return (
    <div className={STATE_ROW} role="status" aria-live="polite">
      <Icon name="spinner" spin label="Loading" />
      <span>Loading…</span>
    </div>
  );
}

/**
 * Shared error boundary. Reads `ApiError.status` so HTTP failures get
 * status-specific copy (e.g. a 401/403 access surface) while other throws
 * fall back to a generic message.
 */
export function ErrorState({ error }: ErrorComponentProps) {
  const { heading, message } = describeError(error);
  return (
    <div className={STATE_ROW}>
      <Alert severity="error" heading={heading}>
        {message}
      </Alert>
    </div>
  );
}

/** Shared not-found boundary. */
export function NotFoundState() {
  return (
    <div className={STATE_ROW}>
      <Alert severity="warning" heading="Not found">
        The page or resource you were looking for does not exist.
      </Alert>
    </div>
  );
}

function describeError(error: unknown): { heading: string; message: string } {
  if (error instanceof ApiError) {
    if (error.status === 401 || error.status === 403) {
      return {
        heading: "Not authorized",
        message:
          "The console could not authenticate this request. Check that the API proxy is configured with a valid project secret.",
      };
    }
    return {
      heading: `Request failed (${error.status})`,
      message: error.message,
    };
  }
  return {
    heading: "Something went wrong",
    message: error instanceof Error ? error.message : "An unexpected error occurred.",
  };
}
