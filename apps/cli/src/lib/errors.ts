import { ApiError, apiErrorMessage } from "@zitadel/api/runtime/fetch";

/**
 * Closed set of failure categories the CLI can surface. Every error the
 * user sees is funnelled into one of these so messaging, exit codes, and
 * machine-readable output stay consistent regardless of where the failure
 * originated.
 */
export type ZitadelErrorCode =
  | "E_ALREADY_INIT"
  | "E_FRAMEWORK_NOT_DETECTED"
  | "E_UNSUPPORTED_PROJECT_SHAPE"
  | "E_NETWORK"
  | "E_AUTH"
  | "E_CONFLICT"
  | "E_LOCAL_SERVER_NOT_RUNNING"
  | "E_NOT_FOUND"
  | "E_PORT_IN_USE"
  | "E_VALIDATION"
  | "E_NOT_IMPLEMENTED";

/**
 * Maps each {@link ZitadelErrorCode} to the process exit code the CLI
 * returns. The table is the single source of truth for exit semantics so
 * scripts and CI can branch on stable, documented numbers.
 */
export const EXIT_CODES: Record<ZitadelErrorCode, number> = {
  E_ALREADY_INIT: 0,
  E_FRAMEWORK_NOT_DETECTED: 3,
  E_UNSUPPORTED_PROJECT_SHAPE: 3,
  E_NETWORK: 4,
  E_AUTH: 1,
  E_CONFLICT: 5,
  E_LOCAL_SERVER_NOT_RUNNING: 4,
  E_NOT_FOUND: 4,
  E_PORT_IN_USE: 5,
  E_VALIDATION: 3,
  E_NOT_IMPLEMENTED: 2,
};

/**
 * Optional, user-facing extras attached to a {@link ZitadelError}. Kept
 * separate from the message so the renderer can present a hint, suggested
 * follow-up commands, and structured details independently (e.g. as JSON
 * fields) rather than concatenating everything into one string.
 */
export type ZitadelErrorOptions = {
  hint?: string;
  nextCommands?: string[];
  details?: unknown;
};

/**
 * The CLI's single error type. Carries a {@link ZitadelErrorCode} so the
 * top-level handler can derive an exit code and structured output without
 * pattern-matching on messages. Throwing this anywhere guarantees the user
 * gets a categorised, hint-bearing failure instead of a raw stack trace.
 */
export class ZitadelError extends Error {
  readonly code: ZitadelErrorCode;
  readonly hint?: string;
  readonly nextCommands?: string[];
  readonly details?: unknown;

  constructor(code: ZitadelErrorCode, message: string, opts: ZitadelErrorOptions = {}) {
    super(message);
    this.name = "ZitadelError";
    this.code = code;
    this.hint = opts.hint;
    this.nextCommands = opts.nextCommands;
    this.details = opts.details;
  }

  get exitCode(): number {
    return EXIT_CODES[this.code] ?? 1;
  }
}

/**
 * Normalises any thrown value into a {@link ZitadelError}. Inspection is
 * ordered most-specific-first (already-normalised, then errno/filesystem,
 * network, Zod-like, generic `Error`, then a catch-all) so the most
 * actionable category and hint win. This is the boundary that lets the rest
 * of the CLI `throw` plain errors yet still produce consistent, categorised
 * output. The original error shape is preserved under `details` for
 * debugging without leaking it into the user-facing message.
 */
export function toZitadelError(error: unknown): ZitadelError {
  if (error instanceof ZitadelError) {
    return error;
  }

  if (error instanceof ApiError) {
    // `401`/`403` → bad or missing project secret; `404` → something is
    // missing (see below); `5xx` → transport or server fault; everything
    // else 4xx → the body the CLI sent was rejected (validation, conflict, …).
    const details = { status: error.status, url: error.url, body: error.body };
    if (error.status === 404) {
      // A 404 carrying the platform's error envelope (a `code` field) is a
      // domain-level miss from a real Zitadel API — an unknown schema or
      // project id. Without the envelope the endpoint itself is missing:
      // the CLI is pointed at a server that isn't a Zitadel platform API.
      const wrongServer = !isPlatformErrorEnvelope(error.body);
      const message = wrongServer
        ? `${apiErrorMessage(error)} — ${error.url} has no such endpoint; is this a Zitadel platform API?`
        : apiErrorMessage(error);
      return new ZitadelError("E_NOT_FOUND", message, { details });
    }
    const code: ZitadelErrorCode =
      error.status === 401 || error.status === 403
        ? "E_AUTH"
        : error.status >= 500
          ? "E_NETWORK"
          : "E_VALIDATION";
    return new ZitadelError(code, apiErrorMessage(error), { details });
  }

  if (isErrnoException(error)) {
    const details = { original: pickErrorShape(error) };
    if (error.code === "EACCES" || error.code === "EPERM") {
      return new ZitadelError("E_AUTH", `Permission denied: ${error.message}`, {
        hint: "Check file permissions or run with the right user.",
        details,
      });
    }
    if (error.code === "EEXIST") {
      return new ZitadelError("E_CONFLICT", error.message, {
        hint: "A file already exists. Use --force to overwrite or remove it first.",
        details,
      });
    }
    if (error.code === "ENOENT") {
      return new ZitadelError("E_VALIDATION", error.message, {
        hint: "A required file or directory is missing.",
        details,
      });
    }
  }

  if (isNetworkError(error)) {
    return new ZitadelError("E_NETWORK", errorMessage(error), {
      hint: "Check your connection, ZITADEL_API_BASE, or the configured server URL.",
      details: { original: pickErrorShape(error as Error) },
    });
  }

  if (isZodLikeError(error)) {
    return new ZitadelError("E_VALIDATION", errorMessage(error), {
      details: { issues: (error as { issues: unknown }).issues },
    });
  }

  if (error instanceof Error) {
    return new ZitadelError("E_VALIDATION", error.message, {
      details: { original: pickErrorShape(error) },
    });
  }

  return new ZitadelError("E_VALIDATION", "Unknown error", { details: error });
}

/**
 * True when a response body looks like the platform's structured error
 * envelope (`{ code, message, … }`). Its presence proves the request reached
 * a real Zitadel platform API rather than an arbitrary HTTP server.
 */
function isPlatformErrorEnvelope(body: unknown): boolean {
  return (
    typeof body === "object" &&
    body !== null &&
    typeof (body as { code?: unknown }).code === "string"
  );
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && typeof (error as NodeJS.ErrnoException).code === "string";
}

function isNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  if (
    error.name === "TypeError" &&
    /fetch failed|network|ECONNREFUSED|ENOTFOUND/i.test(error.message)
  ) {
    return true;
  }
  const cause = (error as { cause?: unknown }).cause;
  if (cause && typeof cause === "object" && "code" in cause) {
    const code = String((cause as { code: unknown }).code);
    return /^(ECONNREFUSED|ECONNRESET|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|UND_ERR)/i.test(code);
  }
  return false;
}

function isZodLikeError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "issues" in error &&
    Array.isArray((error as { issues: unknown }).issues)
  );
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return String(error);
}

function pickErrorShape(error: Error): Record<string, unknown> {
  return {
    name: error.name,
    message: error.message,
    code: (error as NodeJS.ErrnoException).code,
  };
}
