import { describe, expect, it } from "vitest";

import { claimDeadline, claimLinkNarration, originOf } from "../../../src/commands/claim";

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

describe("claim link narration", () => {
  const claimUrl = "https://console.example/claim?challenge_id=ch_1&project_id=proj_1";

  it("carries the link and a parsed expiry", () => {
    const text = claimLinkNarration({ claim_url: claimUrl, expires_at: "2026-09-03T22:54:42Z" });
    expect(text).toContain(`Finish in your browser: ${claimUrl}`);
    expect(text).toContain("The link expires at 2026-09-03T22:54:42.000Z.");
  });

  // `claimDeadline` falls back to the documented TTL for an unparseable
  // `expires_at`; echoing the raw value would promise a time the poll does
  // not honour, so the narration drops it instead.
  it("omits an expiry the poll would not honour", () => {
    for (const expiresAt of ["soon", "", undefined]) {
      const text = claimLinkNarration({ claim_url: claimUrl, expires_at: expiresAt });
      expect(text).toContain(claimUrl);
      expect(text).not.toContain("expires at");
    }
  });
});

describe("origin of a claim link", () => {
  it("names the origin of a well-formed link", () => {
    expect(originOf("https://nextgen.zitadel.cloud/ui/console/claim?x=1")).toBe(
      "https://nextgen.zitadel.cloud",
    );
  });

  // The wrong-origin warning must never be the reason a claim run crashes:
  // a link that does not parse is named as-is and the command carries on.
  it("falls back to the raw value when the link does not parse", () => {
    expect(originOf("/claim?challenge_id=ch_1")).toBe("/claim?challenge_id=ch_1");
    expect(originOf("not a url")).toBe("not a url");
  });
});
