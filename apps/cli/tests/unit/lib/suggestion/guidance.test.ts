import { describe, expect, it } from "vitest";

import { Claim } from "@/lib/claim";
import { Guidance } from "@/lib/suggestion";
import { aSuggest } from "@tests/helpers/suggestions";

/** A run that named no environment, so its suggestions carry no selector. */
const guidance = new Guidance(aSuggest());

describe("Guidance.customizeAndPublish", () => {
  it("quotes the publish commands with the run's environment", () => {
    const actions = new Guidance(aSuggest({ env: "production" })).customizeAndPublish();

    expect(actions.join("\n")).toContain("deploy --dry-run --env production");
    expect(actions.join("\n")).toContain("deploy --message '<what changed>' --env production");
  });

  it("adds no selector for the default environment", () => {
    const actions = new Guidance(aSuggest()).customizeAndPublish();

    expect(actions.join("\n")).not.toContain("--env");
  });
});

describe("Guidance claim copy", () => {
  // The 14-day window is enforced at claim time (the server answers
  // proj.claim_window_expired), so the nudge promises the deadline — and the
  // data-loss stake, per product decision: temporary projects get purged
  // after the window. "lost", deliberately not "deleted"/"removed": the copy
  // warns about the outcome without promising a mechanism.
  it("names the window and the data-loss stake", () => {
    expect(guidance.claimNudge(undefined)).toContain("within 14 days of creation");
    expect(guidance.claimNudge(undefined)).toContain("its data may be lost");
    expect(guidance.claimNudge(undefined)).not.toMatch(/delete|removed|expire/i);
    expect(guidance.claimNudge(undefined)).toContain("npx @zitadel/cli@0.1.0 claim");
  });

  it("names the concrete deadline when the creation time is known", () => {
    const withDeadline = guidance.claimNudge(Claim.deadline("2026-09-04T10:00:00.000Z"));
    expect(withDeadline).toContain("Claim your project before ");
    expect(withDeadline).toContain("2026");
    expect(withDeadline).not.toContain("within 14 days of creation");
  });

  it("boxes the same nudge with the command pulled out of the prose", () => {
    const box = guidance.claimBoxNudge(undefined);
    expect(box.command).toBe("npx @zitadel/cli@0.1.0 claim");
    expect(box.text).toContain("temporary and its data may be lost");
    expect(box.text).not.toContain("npx");
  });

  // The closed-window counterpart stays reconciliatory: the local record can
  // be stale (claimed from another machine reads detached), so it keeps
  // quoting the claim command as the safe authoritative check alongside the
  // fresh-setup pointer.
  it("frames a closed window as reconciliation, not a verdict", () => {
    const closed = guidance.claimWindowClosedNudge();
    expect(closed).toContain("claim window has closed");
    expect(closed).toContain("npx @zitadel/cli@0.1.0 claim");
    expect(closed).toContain("no longer be claimed");
    expect(closed).toContain(
      "npx @zitadel/cli@0.1.0 setup --cwd '<new-directory>' in a fresh directory",
    );
    expect(closed).not.toMatch(/delete|removed|expire/i);
  });

  it("points the fresh setup at a new directory, not the one the run was given", () => {
    expect(new Guidance(aSuggest({ cwd: "app" })).claimWindowClosedNudge()).toContain(
      "setup --cwd '<new-directory>' in a fresh directory",
    );
  });

  // `unclaimed` is banned from the public docs by the vocabulary gate; keeping
  // it out of the strings themselves is what makes that gate easy to keep.
  it("stays on the vocabulary the claim command established", () => {
    expect(guidance.claimNudge(undefined)).not.toMatch(/\bunclaimed\b/i);
    expect(guidance.claimBoxNudge(undefined).text).not.toMatch(/\bunclaimed\b/i);
    expect(guidance.claimWindowClosedNudge()).not.toMatch(/\bunclaimed\b/i);
  });
});
