import { http, HttpResponse } from "msw";
import { describe, expect } from "vitest";

import { Claim } from "@/lib/claim";
import { ZitadelError } from "@/lib/errors";
import { it } from "@tests/fixtures";
import { aSuggest } from "@tests/helpers/suggestions";

/** A run that named no environment, so its suggestions carry no selector. */
const SUGGEST = aSuggest();

/** The `claim` command the nudges quote. */
const CLAIM = SUGGEST({ id: "claim" });

/** The `setup` command a closed window points the reader at. */
const SETUP = SUGGEST({ id: "setup", flags: { cwd: Claim.FRESH_DIRECTORY } });

/** The state of a claim read from `input`. */
function claimState(input: Parameters<typeof Claim.state>[0]): ReturnType<typeof Claim.state> {
  return Claim.state(input);
}

const ATTACHED = { claimed_at: "2026-08-01T10:00:00.000Z", team_id: "team-001" };
const DETACHED = {};

describe("claim state", () => {
  it("reads an attached project from the local secret", () => {
    expect(claimState({ secret: ATTACHED, cloud: true })).toEqual({
      kind: "attached",
      team_id: "team-001",
      claimed_at: "2026-08-01T10:00:00.000Z",
    });
  });

  // Without a creation time the window cannot be classified, so the state is
  // lenient (claimable, no deadline): the server enforces, the CLI advises.
  it("reads a project with neither field as detached and claimable", () => {
    expect(claimState({ secret: DETACHED, cloud: true })).toEqual({
      kind: "detached",
      claimable: true,
    });
  });

  it("classifies the claim window from the recorded creation time", () => {
    const recent = new Date(Date.now() - 60_000).toISOString();
    expect(claimState({ secret: { created_at: recent }, cloud: true })).toEqual({
      kind: "detached",
      claimable: true,
      deadline: Claim.deadline(recent).toISOString(),
    });

    const stale = "2026-01-01T00:00:00.000Z";
    expect(claimState({ secret: { created_at: stale }, cloud: true })).toEqual({
      kind: "detached",
      claimable: false,
      deadline: Claim.deadline(stale).toISOString(),
    });
  });

  // Mirrors the predicate `zitadel claim` uses before it decides to skip: a
  // half-written record is not an attachment, so the nudge stays and the
  // command can still recover the real answer from the platform.
  it("treats a half-written record as detached", () => {
    expect(claimState({ secret: { team_id: "team-001" }, cloud: true })).toEqual({
      kind: "detached",
      claimable: true,
    });
    expect(
      claimState({
        secret: { claimed_at: ATTACHED.claimed_at },
        cloud: true,
      }),
    ).toEqual({ kind: "detached", claimable: true });
  });

  // Local stays not-applicable even though a bootstrapped local server can
  // host a claim: this classifier is offline by design, and only `setup`
  // (online anyway) probes the local server's runtime document to nudge.
  it("is not applicable off the cloud, attached or not", () => {
    expect(claimState({ secret: DETACHED, cloud: false })).toEqual({ kind: "not-applicable" });
    expect(claimState({ secret: ATTACHED, cloud: false })).toEqual({ kind: "not-applicable" });
  });
});

/** The credential and server {@link Claim.confirmed} asks with. */
const REMOTE = {
  server: "https://preview.zitadel.com",
  secret: { project_id: "proj-001", project_secret: "sk_proj_test" },
} as const;

/** A claimed answer from the server, for a project the record calls unclaimed. */
const CLAIMED = { status: "claimed", team_id: "team-002", claimed_at: "2026-01-03T00:00:00Z" };

describe("confirmed claim state", () => {
  it("takes the server's owning team over a record that says unclaimed", async ({ server }) => {
    server.use(
      http.get("*/projects/proj-001/claim", () => {
        return HttpResponse.json(CLAIMED);
      }),
    );

    const state = await Claim.confirmed({
      ...REMOTE,
      cloud: true,
      signal: new AbortController().signal,
    });

    expect(state).toEqual({
      kind: "attached",
      team_id: "team-002",
      claimed_at: "2026-01-03T00:00:00Z",
      recorded: false,
    });
  });

  it("keeps the record when the server says unclaimed", async ({ server }) => {
    server.use(
      http.get("*/projects/proj-001/claim", () => {
        return HttpResponse.json({ status: "unclaimed" });
      }),
    );

    const state = await Claim.confirmed({
      ...REMOTE,
      cloud: true,
      signal: new AbortController().signal,
    });

    expect(state).toEqual({ kind: "detached", claimable: true });
  });

  it.for([
    ["refuses the secret", () => HttpResponse.json({ code: "auth.unauthorized" }, { status: 401 })],
    ["cannot be reached", () => HttpResponse.error()],
  ] as const)("keeps the record when the server %s", async ([, answer], { server }) => {
    server.use(http.get("*/projects/proj-001/claim", answer));

    const state = await Claim.confirmed({
      ...REMOTE,
      cloud: true,
      signal: new AbortController().signal,
    });

    expect(state).toEqual({ kind: "detached", claimable: true });
  });

  it("keeps an attached record whatever the server would say", async ({ server }) => {
    server.use(
      http.get("*/projects/proj-001/claim", () => {
        return HttpResponse.json({ status: "unclaimed" });
      }),
    );

    const state = await Claim.confirmed({
      ...REMOTE,
      secret: { ...REMOTE.secret, ...ATTACHED },
      cloud: true,
      signal: new AbortController().signal,
    });

    expect(state).toEqual({ kind: "attached", ...ATTACHED });
  });

  it("stays not applicable off the cloud, whatever the server would say", async ({ server }) => {
    server.use(
      http.get("*/projects/proj-001/claim", () => {
        return HttpResponse.json(CLAIMED);
      }),
    );

    const state = await Claim.confirmed({
      ...REMOTE,
      cloud: false,
      signal: new AbortController().signal,
    });

    expect(state).toEqual({ kind: "not-applicable" });
  });

  it.for(["http://preview.zitadel.com", "https://preview.zitadel.com:8443"])(
    "asks nothing of %s, keeping the record",
    async (server, { server: msw }) => {
      msw.use(
        http.get("*/projects/proj-001/claim", () => {
          return HttpResponse.json(CLAIMED);
        }),
      );

      const state = await Claim.confirmed({
        ...REMOTE,
        server,
        cloud: true,
        signal: new AbortController().signal,
      });

      expect(state).toEqual({ kind: "detached", claimable: true });
    },
  );

  it("stops when the run is cancelled, rather than guessing", async () => {
    const cancelled = new AbortController();
    cancelled.abort(new ZitadelError("E_CANCELLED", "cancelled"));

    await expect(
      Claim.confirmed({ ...REMOTE, cloud: true, signal: cancelled.signal }),
    ).rejects.toMatchObject({ code: "E_CANCELLED" });
  });
});

describe("attachment predicate", () => {
  // `zitadel claim` shares this to decide whether to skip, so it has to answer
  // on any server, not just the cloud ones the nudges care about.
  it("answers from the record alone, ignoring the server", () => {
    expect(Claim.isAttached(ATTACHED)).toBe(true);
    expect(Claim.isAttached(DETACHED)).toBe(false);
    expect(Claim.isAttached({ team_id: "team-001" })).toBe(false);
    expect(Claim.isAttached({ claimed_at: ATTACHED.claimed_at })).toBe(false);
  });
});

describe("claim copy", () => {
  // The 14-day window is enforced at claim time (the server answers
  // proj.claim_window_expired), so the nudge promises the deadline — and the
  // data-loss stake, per product decision: temporary projects get purged
  // after the window. "lost", deliberately not "deleted"/"removed": the copy
  // warns about the outcome without promising a mechanism.
  it("names the window and the data-loss stake", () => {
    expect(Claim.nudge(CLAIM, undefined)).toContain("within 14 days of creation");
    expect(Claim.nudge(CLAIM, undefined)).toContain("its data may be lost");
    expect(Claim.nudge(CLAIM, undefined)).not.toMatch(/delete|removed|expire/i);
    expect(Claim.nudge(CLAIM, undefined)).toContain("npx @zitadel/cli@0.1.0 claim");
  });

  it("names the concrete deadline when the creation time is known", () => {
    const withDeadline = Claim.nudge(CLAIM, Claim.deadline("2026-09-04T10:00:00.000Z"));
    expect(withDeadline).toContain("Claim your project before ");
    expect(withDeadline).toContain("2026");
    expect(withDeadline).not.toContain("within 14 days of creation");
  });

  it("boxes the same nudge with the command pulled out of the prose", () => {
    const box = Claim.boxNudge(CLAIM, undefined);
    expect(box.command).toBe("npx @zitadel/cli@0.1.0 claim");
    expect(box.text).toContain("temporary and its data may be lost");
    expect(box.text).not.toContain("npx");
  });

  // The closed-window counterpart stays reconciliatory: the local record can
  // be stale (claimed from another machine reads detached), so it keeps
  // quoting the claim command as the safe authoritative check alongside the
  // fresh-setup pointer.
  it("frames a closed window as reconciliation, not a verdict", () => {
    const closed = Claim.windowClosedNudge(CLAIM, SETUP);
    expect(closed).toContain("claim window has closed");
    expect(closed).toContain("npx @zitadel/cli@0.1.0 claim");
    expect(closed).toContain("no longer be claimed");
    expect(closed).toContain(
      "npx @zitadel/cli@0.1.0 setup --cwd '<new-directory>' in a fresh directory",
    );
    expect(closed).not.toMatch(/delete|removed|expire/i);
  });

  it("points the fresh setup at a new directory, not the one the run was given", () => {
    expect(
      Claim.windowClosedNudge(
        CLAIM,
        aSuggest({ cwd: "app" })({ id: "setup", flags: { cwd: Claim.FRESH_DIRECTORY } }),
      ),
    ).toContain("setup --cwd '<new-directory>' in a fresh directory");
  });

  // `unclaimed` is banned from the public docs by the vocabulary gate; keeping
  // it out of the strings themselves is what makes that gate easy to keep.
  it("stays on the vocabulary the claim command established", () => {
    expect(Claim.nudge(CLAIM, undefined)).not.toMatch(/\bunclaimed\b/i);
    expect(Claim.boxNudge(CLAIM, undefined).text).not.toMatch(/\bunclaimed\b/i);
    expect(Claim.windowClosedNudge(CLAIM, SETUP)).not.toMatch(/\bunclaimed\b/i);
  });
});

describe("claim window deadline", () => {
  it("adds the 14-day window to the creation time", () => {
    expect(Claim.deadline("2026-09-04T10:00:00.000Z").toISOString()).toBe(
      "2026-09-18T10:00:00.000Z",
    );
  });

  // Setup calls this moments after creating the project, so "now" is the
  // honest stand-in when the response carried no usable timestamp.
  it("falls back to now for a missing or malformed creation time", () => {
    const now = Date.parse("2026-09-04T10:00:00.000Z");
    expect(Claim.deadline(undefined, now).toISOString()).toBe("2026-09-18T10:00:00.000Z");
    expect(Claim.deadline("not-a-date", now).toISOString()).toBe("2026-09-18T10:00:00.000Z");
  });
});
