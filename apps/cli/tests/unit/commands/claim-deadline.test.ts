import { describe, expect, it } from "vitest";

import { claimDeadline } from "../../../src/commands/claim";

const NOW = Date.parse("2026-08-04T12:00:00.000Z");
const TEN_MINUTES = 10 * 60 * 1000;

describe("claimDeadline", () => {
  it("uses the server's expiry when no timeout is set", () => {
    const expiresAt = new Date(NOW + 4 * 60 * 1000).toISOString();

    expect(claimDeadline({ expiresAt, now: NOW })).toBe(NOW + 4 * 60 * 1000);
  });

  it("takes the timeout when it lands first", () => {
    const expiresAt = new Date(NOW + TEN_MINUTES).toISOString();

    expect(claimDeadline({ expiresAt, timeoutSeconds: 30, now: NOW })).toBe(NOW + 30_000);
  });

  it("keeps the server's expiry when the timeout would outlast it", () => {
    const expiresAt = new Date(NOW + 60_000).toISOString();

    // A --timeout longer than the link's life cannot extend the link, so the
    // loop must still stop when the link dies.
    expect(claimDeadline({ expiresAt, timeoutSeconds: 3600, now: NOW })).toBe(NOW + 60_000);
  });

  it("falls back to the documented TTL when expires_at is unparseable", () => {
    // A malformed or misrouted response must not leave the poll loop with no
    // deadline at all.
    for (const expiresAt of ["", "not-a-date", "9999-99-99T99:99:99Z"]) {
      const deadline = claimDeadline({ expiresAt, now: NOW });
      expect(deadline).toBe(NOW + TEN_MINUTES);
      expect(Number.isFinite(deadline)).toBe(true);
    }
  });

  it("still honours a timeout when expires_at is unparseable", () => {
    expect(claimDeadline({ expiresAt: "garbage", timeoutSeconds: 5, now: NOW })).toBe(NOW + 5000);
  });

  it("never returns an infinite deadline", () => {
    const cases = [
      { expiresAt: new Date(NOW + 1000).toISOString(), now: NOW },
      { expiresAt: "garbage", now: NOW },
      { expiresAt: "garbage", timeoutSeconds: 900, now: NOW },
    ];

    for (const input of cases) {
      expect(Number.isFinite(claimDeadline(input))).toBe(true);
    }
  });
});
