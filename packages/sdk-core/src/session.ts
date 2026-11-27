/**
 * The browser's view of the current session.
 *
 * It holds {@link getSession}, one read of `GET /sessions/me`, and {@link sessionStore}, the
 * shared and subscribable read that the single-page-application SDKs bind their hooks and
 * composables to.
 *
 * @packageDocumentation
 */
export * from "./session-read.js";
export * from "./session-store.js";
