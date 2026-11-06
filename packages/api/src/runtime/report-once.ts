let reported = false;

/**
 * Warns about a failure the first time it happens and never again, so a page
 * that keeps failing is not flooded.
 */
export function reportOnce(message: string, cause: unknown): void {
  if (reported) {
    return;
  }
  reported = true;
  console.warn(message, cause);
}

/** Forgets what was reported, so a test starts from the first failure. Not exported by the package. */
export function forgetReports(): void {
  reported = false;
}
