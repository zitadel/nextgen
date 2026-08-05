import type { ConsoleSession } from "./session";

/**
 * Test fixture: a minimal `active` session as `GET /sessions/me` returns it.
 * Specs mock `@/auth/session`'s `fetchSession` with this so routes under the
 * `_authed` guard render without a real session round-trip. Lives next to the
 * session module (not in a spec) so every spec builds the same shape and a
 * model change breaks exactly one file.
 */
export function makeTestSession(overrides: Partial<ConsoleSession> = {}): ConsoleSession {
  return {
    session_id: "sess_test",
    project_id: "proj_test",
    state: "active",
    user_id: "user_test",
    name: "Test User",
    email: "test.user@example.com",
    factors: [],
    created_at: "2026-01-01T00:00:00Z",
    expires_at: "2100-01-01T00:00:00Z",
    ...overrides,
  };
}
