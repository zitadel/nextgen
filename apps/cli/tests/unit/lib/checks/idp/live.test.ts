import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import type { CheckResult } from "../../../../../src/lib/checks/check";
import {
  idpContext,
  type IdpContext,
  type LiveSignIn,
  type SignInEvent,
} from "../../../../../src/lib/checks/idp/context";
import { LiveSignInCheck } from "../../../../../src/lib/checks/idp/live";

const LOGIN_URL = "http://localhost:3000/login";

const event = (overrides: Partial<SignInEvent>): SignInEvent => ({
  slug: "acme",
  flowId: "att_1",
  phase: "ceremony_started",
  status: "ok",
  ...overrides,
});

const PASSED: CheckResult = { name: "x", title: "X", status: "pass", message: "ok" };

/**
 * A runtime that reports `events` and then goes quiet until the sign-in is
 * given up on. `timeoutAfter` makes the clock run out as soon as the events
 * are used up.
 */
function aRuntime(events: readonly SignInEvent[]) {
  const said: string[] = [];
  const opened: string[] = [];
  const live: LiveSignIn = {
    loginUrl: LOGIN_URL,
    timeoutMs: 300_000,
    open: async (url) => {
      opened.push(url);
    },
    say: (message) => said.push(message),
    watch: async (signal) =>
      (async function* () {
        yield* events;
        await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve()));
      })(),
    sleep: (_ms, signal) =>
      new Promise<void>((resolve) => {
        // The clock runs out once the event loop has delivered every event.
        const timer = setTimeout(resolve, 5);
        signal.addEventListener("abort", () => {
          clearTimeout(timer);
          resolve();
        });
      }),
  };
  return { live, said, opened };
}

function aContext(live: LiveSignIn | undefined, overrides: Partial<IdpContext> = {}): IdpContext {
  return idpContext({
    slug: "acme",
    issuer: "https://issuer.example",
    clientId: "the-client",
    scopes: ["openid"],
    claims: [],
    callbackUri: "http://localhost:3000/__nextgen/idp/acme/callback",
    endpoints: undefined,
    consoleUrl: "https://console.example",
    probes: undefined,
    request: async (url) => ({ status: 404, url, body: "" }),
    ...(live === undefined ? {} : { live }),
    ...overrides,
  });
}

const run = (events: readonly SignInEvent[], earlier: readonly CheckResult[] = [PASSED]) => {
  const runtime = aRuntime(events);
  const outcome = new LiveSignInCheck().run(aContext(runtime.live), earlier);
  return { outcome, ...runtime };
};

/** An event about an exchange with the connection, which is what ties an attempt to it. */
const sso = (overrides: Partial<SignInEvent>): SignInEvent => event({ sso: true, ...overrides });

/** A sign-in the connection took part in, up to the point the app is handed the attempt. */
const SIGNED_IN: readonly SignInEvent[] = [
  event({ phase: "ceremony_started" }),
  sso({ phase: "exchange_finished" }),
  event({ phase: "handed_off" }),
];

describe("LiveSignInCheck", () => {
  it("is skipped, not passed, when no browser sign-in was asked for", async () => {
    const outcome = await new LiveSignInCheck().run(aContext(undefined), [PASSED]);

    expect(outcome.status).toBe("skipped");
  });

  it("is skipped when an earlier check failed, and never opens a browser", async () => {
    const { outcome, opened } = run([], [{ ...PASSED, status: "fail" }]);

    expect(await outcome).toMatchObject({ status: "skipped" });
    expect(opened).toEqual([]);
  });

  it("is not blocked by an earlier check that could only skip", async () => {
    const { outcome } = run(SIGNED_IN, [{ ...PASSED, status: "skipped" }]);

    expect((await outcome).status).toBe("pass");
  });

  it("prints the login URL and opens it", async () => {
    const { outcome, said, opened } = run(SIGNED_IN);
    await outcome;

    expect(opened).toEqual([LOGIN_URL]);
    expect(said[0]).toContain(LOGIN_URL);
  });

  it("passes once the attempt has been handed over to the app", async () => {
    const { outcome } = run(SIGNED_IN);

    expect(await outcome).toMatchObject({
      status: "pass",
      message: "sign-in completed with acme",
    });
  });

  it("gives the attempt, its phases and when each happened as data, not only as words", async () => {
    const { outcome } = run([
      event({ phase: "ceremony_started" }),
      sso({ phase: "exchange_finished", at: "2026-10-19T00:00:01Z" }),
      sso({
        phase: "resolved",
        status: "failed",
        reason: "creation_disabled",
        side: "journey",
        at: "2026-10-19T00:00:02Z",
      }),
    ]);

    expect((await outcome).details).toEqual({
      attempt_id: "att_1",
      phase: "resolved",
      status: "failed",
      reason: "creation_disabled",
      side: "journey",
      events: [
        { phase: "exchange_finished", status: "ok", at: "2026-10-19T00:00:01Z" },
        { phase: "resolved", status: "failed", at: "2026-10-19T00:00:02Z" },
      ],
    });
  });

  it("names the attempt and its phases for a completed sign-in too", async () => {
    const { outcome } = run(SIGNED_IN);

    expect((await outcome).details).toMatchObject({
      attempt_id: "att_1",
      phase: "handed_off",
      events: [{ phase: "exchange_finished" }, { phase: "handed_off" }],
    });
  });

  it("gives no attempt when none was seen", async () => {
    const { outcome } = run([]);

    expect((await outcome).details).toEqual({ events: [] });
  });

  it("does not call the sign-in complete after the exchange, before the handoff has happened", async () => {
    const { outcome } = run([
      event({ phase: "ceremony_started" }),
      sso({ phase: "exchange_finished" }),
    ]);

    expect(await outcome).toMatchObject({
      status: "fail",
      message: expect.stringContaining("did not finish"),
    });
  });

  it("fails a handoff that did not happen, as the journey's", async () => {
    const { outcome } = run([
      sso({ phase: "exchange_finished" }),
      sso({ phase: "handed_off", status: "failed", reason: "handoff_failed", side: "journey" }),
    ]);

    expect(await outcome).toMatchObject({
      status: "fail",
      message: expect.stringContaining("journey side"),
    });
  });

  it("fails a provider-side failure with the console and the callback URI as its one action", async () => {
    const { outcome } = run([
      event({ phase: "ceremony_started" }),
      sso({
        phase: "callback_received",
        status: "failed",
        reason: "provider_denied",
        side: "provider",
      }),
    ]);

    expect(await outcome).toMatchObject({
      status: "fail",
      message:
        "Failed at the provider's redirect back (provider side): the sign-in was declined at the provider",
      recovery:
        "If you did not cancel it, check the client ID, the secret and the redirect URI http://localhost:3000/__nextgen/idp/acme/callback at https://console.example; otherwise run it again",
    });
  });

  it("sends a provider-side exchange failure to the console, as the client or secret is wrong", async () => {
    const { outcome } = run([
      sso({
        phase: "exchange_finished",
        status: "failed",
        reason: "exchange_failed",
        side: "provider",
      }),
    ]);

    expect((await outcome).recovery).toBe(
      "Check the client ID, the secret and the redirect URI http://localhost:3000/__nextgen/idp/acme/callback at https://console.example",
    );
  });

  it.each([
    ["discovery_failed", "Check oidc.issuer in .zitadel/idps/acme.json"],
    ["userinfo_failed", "Check oidc.scopes and oidc.id_token_mapping in .zitadel/idps/acme.json"],
    ["id_token_invalid", "Check oidc.scopes and oidc.id_token_mapping in .zitadel/idps/acme.json"],
  ])("does not blame the client or secret for %s", async (reason, expected) => {
    const { outcome } = run([
      sso({ phase: "exchange_finished", status: "failed", reason, side: "provider" }),
    ]);

    expect((await outcome).recovery).toContain(expected);
  });

  it.each([
    [
      "creation_disabled",
      "Set provisioning.creation in .zitadel/idps/acme.json, or sign in with a user that is already linked",
    ],
    ["connection_invalid", "Fix .zitadel/idps/acme.json, then run zitadel apply"],
    [
      "claim_rejected",
      "Fix claim_mapping and verified_claims in .zitadel/idps/acme.json, or the matching rule in your user schema",
    ],
    ["state_mismatch", `Start again from ${LOGIN_URL}: the state is single-use and short-lived`],
    ["internal", "Run zitadel events list and look for the auth.sso events of the attempt"],
  ])("fails a journey-side %s with the file or rule to fix", async (reason, recovery) => {
    const { outcome } = run([
      sso({ phase: "resolved", status: "failed", reason, side: "journey" }),
    ]);

    expect(await outcome).toMatchObject({ status: "fail", recovery });
    expect((await outcome).message).toContain("journey side");
  });

  it("follows the first attempt that exchanged with the connection and says it ignored a second", async () => {
    const { outcome, said } = run([
      event({ flowId: "att_1", phase: "ceremony_started" }),
      event({ flowId: "att_2", phase: "ceremony_started" }),
      sso({ flowId: "att_1", phase: "exchange_finished" }),
      sso({ flowId: "att_2", phase: "exchange_finished" }),
      event({ flowId: "att_2", phase: "handed_off" }),
      event({ flowId: "att_1", phase: "handed_off" }),
    ]);

    expect((await outcome).status).toBe("pass");
    expect(said.filter((line) => line.includes("Ignoring"))).toEqual([
      "Ignoring another sign-in attempt (att_2)",
    ]);
  });

  it("does not take a password login's start and handoff for a sign-in with the connection", async () => {
    const { outcome } = run([event({ phase: "ceremony_started" }), event({ phase: "handed_off" })]);

    expect(await outcome).toMatchObject({ status: "fail", message: "no sign-in attempt seen" });
  });

  it("ignores events of other connections", async () => {
    const { outcome } = run([
      sso({
        slug: "other",
        phase: "resolved",
        status: "failed",
        reason: "internal",
        side: "journey",
      }),
      ...SIGNED_IN,
    ]);

    expect((await outcome).status).toBe("pass");
  });

  it("fails with 'no sign-in attempt seen' and points at the events when nothing happens", async () => {
    const { outcome } = run([]);

    expect(await outcome).toMatchObject({
      status: "fail",
      message: "no sign-in attempt seen",
      recovery: "Run zitadel events list and look for the auth.sso events of the attempt",
    });
  });

  it("fails when an attempt began and never finished, naming where it stopped", async () => {
    const { outcome } = run([sso({ phase: "exchange_finished" })]);

    expect(await outcome).toMatchObject({
      status: "fail",
      message: "The sign-in started but did not finish: the last thing seen was the code exchange",
    });
  });

  it("stops watching and waiting when it finishes", async () => {
    const aborted: boolean[] = [];
    const base = aRuntime(SIGNED_IN).live;
    const live: LiveSignIn = {
      ...base,
      watch: async (signal) => {
        signal.addEventListener("abort", () => aborted.push(true));
        return base.watch(signal);
      },
    };

    await new LiveSignInCheck().run(aContext(live), [PASSED]);

    expect(aborted).toEqual([true]);
  });

  it("opens the browser only once the stream it compares against has been read", async () => {
    const steps: string[] = [];
    const base = aRuntime(SIGNED_IN).live;
    const live: LiveSignIn = {
      ...base,
      open: async () => {
        steps.push("opened");
      },
      watch: async (signal) => {
        await new Promise<void>((resolve) => setTimeout(resolve, 5));
        steps.push("baseline read");
        return base.watch(signal);
      },
    };

    await new LiveSignInCheck().run(aContext(live), [PASSED]);

    expect(steps).toEqual(["baseline read", "opened"]);
  });

  it("starts the time to sign in only once the baseline is read and the page is open", async () => {
    const steps: string[] = [];
    const base = aRuntime(SIGNED_IN).live;
    const live: LiveSignIn = {
      ...base,
      open: async () => {
        steps.push("opened");
      },
      watch: async (signal) => {
        await new Promise<void>((resolve) => setTimeout(resolve, 5));
        steps.push("baseline read");
        return base.watch(signal);
      },
      sleep: (ms, signal) => {
        steps.push("clock started");
        return base.sleep(ms, signal);
      },
    };

    await new LiveSignInCheck().run(aContext(live), [PASSED]);

    expect(steps).toEqual(["baseline read", "opened", "clock started"]);
  });
});

const RUNTIME_EVENTS = readFileSync(
  new URL("../../../../../../../internal/instrumentation/ssoevent/ssoevent.go", import.meta.url),
  "utf8",
);
const REASONS_THE_RUNTIME_RECORDS = [...RUNTIME_EVENTS.matchAll(/Reason\s+= "([a-z_]+)"/g)].map(
  (match) => match[1] ?? "",
);

describe("the reasons the runtime records", () => {
  it("are found in the runtime's source, or the cases below prove nothing", () => {
    expect(REASONS_THE_RUNTIME_RECORDS.length).toBeGreaterThan(10);
  });

  it.each(REASONS_THE_RUNTIME_RECORDS)(
    "include %s, which the check describes in words",
    async (reason) => {
      const { outcome } = run([
        sso({ phase: "callback_received", status: "failed", reason, side: "journey" }),
      ]);

      expect(await outcome).toMatchObject({ status: "fail" });
      expect((await outcome).message).not.toContain(reason);
    },
  );
});
