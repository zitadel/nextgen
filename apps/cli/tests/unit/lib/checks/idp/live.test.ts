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
    const { outcome } = run([event({ phase: "handed_off" })], [{ ...PASSED, status: "skipped" }]);

    expect((await outcome).status).toBe("pass");
  });

  it("prints the login URL and opens it", async () => {
    const { outcome, said, opened } = run([event({ phase: "handed_off" })]);
    await outcome;

    expect(opened).toEqual([LOGIN_URL]);
    expect(said[0]).toContain(LOGIN_URL);
  });

  it("passes once the attempt has been handed over to the app", async () => {
    const { outcome } = run([
      event({ phase: "ceremony_started" }),
      event({ phase: "callback_received" }),
      event({ phase: "exchange_finished" }),
      event({ phase: "resolved", result: "linked" }),
      event({ phase: "handed_off" }),
    ]);

    expect(await outcome).toEqual({ status: "pass", message: "sign-in completed with acme" });
  });

  it.each([
    ["the identity is bound to its user", event({ phase: "resolved", result: "linked" })],
    ["a user is created for the identity", event({ phase: "user_created" })],
  ])(
    "does not call the sign-in complete when %s but the handoff has not happened",
    async (_name, last) => {
      const { outcome } = run([event({ phase: "callback_received" }), last]);

      expect(await outcome).toMatchObject({
        status: "fail",
        message: expect.stringContaining("did not finish"),
      });
    },
  );

  it("fails a handoff that did not happen, as the journey's", async () => {
    const { outcome } = run([
      event({ phase: "resolved", result: "linked" }),
      event({
        phase: "handed_off",
        status: "failed",
        reason: "handoff_failed",
        side: "journey",
      }),
    ]);

    expect(await outcome).toMatchObject({
      status: "fail",
      message: expect.stringContaining("journey side"),
    });
  });

  it("keeps waiting after the collection step is asked for, and passes once the user is created", async () => {
    const { outcome } = run([
      event({ phase: "resolved", result: "collect" }),
      event({ phase: "user_created" }),
      event({ phase: "handed_off" }),
    ]);

    expect((await outcome).status).toBe("pass");
  });

  it("fails a provider-side failure with the console and the callback URI as its one action", async () => {
    const { outcome } = run([
      event({ phase: "callback_received" }),
      event({
        phase: "callback_received",
        status: "failed",
        reason: "provider_denied",
        side: "provider",
      }),
    ]);

    expect(await outcome).toEqual({
      status: "fail",
      message:
        "Failed at the provider's redirect back (provider side): the sign-in was declined at the provider",
      recovery:
        "Check the client ID, the secret and the redirect URI http://localhost:3000/__nextgen/idp/acme/callback at https://console.example",
    });
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
    ["state_invalid", `Start again from ${LOGIN_URL}: the state is single-use and short-lived`],
    ["internal", 'Run zitadel logs and look for the lines saying "sso attempt"'],
  ])("fails a journey-side %s with the file or rule to fix", async (reason, recovery) => {
    const { outcome } = run([
      event({ phase: "resolved", status: "failed", reason, side: "journey" }),
    ]);

    expect(await outcome).toMatchObject({ status: "fail", recovery });
    expect((await outcome).message).toContain("journey side");
  });

  it("follows the first attempt and says it ignored a second", async () => {
    const { outcome, said } = run([
      event({ flowId: "att_1", phase: "ceremony_started" }),
      event({ flowId: "att_2", phase: "ceremony_started" }),
      event({ flowId: "att_2", phase: "handed_off" }),
      event({ flowId: "att_1", phase: "handed_off" }),
    ]);

    expect((await outcome).status).toBe("pass");
    expect(said.filter((line) => line.includes("Ignoring"))).toEqual([
      "Ignoring another sign-in attempt (att_2)",
    ]);
  });

  it("attributes a failure that names no attempt to the one it follows", async () => {
    const { outcome } = run([
      event({ phase: "ceremony_started" }),
      event({
        flowId: "",
        phase: "callback_received",
        status: "failed",
        reason: "state_invalid",
        side: "journey",
      }),
    ]);

    expect(await outcome).toMatchObject({
      status: "fail",
      message: expect.stringContaining("the sign-in state was unknown, used or expired"),
    });
  });

  it("ignores events of other connections", async () => {
    const { outcome } = run([
      event({
        slug: "other",
        phase: "resolved",
        status: "failed",
        reason: "internal",
        side: "journey",
      }),
      event({ phase: "handed_off" }),
    ]);

    expect((await outcome).status).toBe("pass");
  });

  it("fails with 'no sign-in attempt seen' and points at the logs when nothing happens", async () => {
    const { outcome } = run([]);

    expect(await outcome).toEqual({
      status: "fail",
      message: "no sign-in attempt seen",
      recovery: 'Run zitadel logs and look for the lines saying "sso attempt"',
    });
  });

  it("fails when an attempt started and never finished, naming where it stopped", async () => {
    const { outcome } = run([event({ phase: "ceremony_started" })]);

    expect(await outcome).toMatchObject({
      status: "fail",
      message:
        "The sign-in started but did not finish: the last thing seen was sending the browser to the provider",
    });
  });

  it("stops watching and waiting when it finishes", async () => {
    const aborted: boolean[] = [];
    const base = aRuntime([event({ phase: "handed_off" })]).live;
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

  it("only warns when the identity belongs to an existing account, which still has to be proved", async () => {
    const { outcome } = run([
      event({ phase: "callback_received" }),
      event({ phase: "resolved", result: "existing_user" }),
    ]);

    expect(await outcome).toMatchObject({
      status: "warn",
      message: expect.stringContaining("existing account"),
    });
  });

  it("opens the browser only once the log it compares against has been read", async () => {
    const steps: string[] = [];
    const base = aRuntime([event({ phase: "handed_off" })]).live;
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

  it("ignores a line with no flow id until an attempt has begun, since it is someone else's request", async () => {
    const { outcome } = run([
      event({
        flowId: "",
        phase: "callback_received",
        status: "failed",
        reason: "state_invalid",
        side: "journey",
      }),
      event({ phase: "callback_received" }),
      event({ phase: "handed_off" }),
    ]);

    expect(await outcome).toMatchObject({ status: "pass" });
  });

  it("counts a line with no flow id once the attempt has begun, as when its state expired", async () => {
    const { outcome } = run([
      event({ phase: "ceremony_started" }),
      event({
        flowId: "",
        phase: "callback_received",
        status: "failed",
        reason: "state_invalid",
        side: "journey",
      }),
    ]);

    expect(await outcome).toMatchObject({
      status: "fail",
      message: expect.stringContaining("expired"),
    });
  });
});

const RUNTIME_EVENTS = readFileSync(
  new URL("../../../../../../../internal/instrumentation/ssoevent/ssoevent.go", import.meta.url),
  "utf8",
);
const REASONS_THE_RUNTIME_LOGS = [...RUNTIME_EVENTS.matchAll(/Reason\s+= "([a-z_]+)"/g)].map(
  (match) => match[1] ?? "",
);

describe("the reasons the runtime logs", () => {
  it("are found in the runtime's source, or the cases below prove nothing", () => {
    expect(REASONS_THE_RUNTIME_LOGS.length).toBeGreaterThan(10);
  });

  it.each(REASONS_THE_RUNTIME_LOGS)(
    "include %s, which the check describes in words",
    async (reason) => {
      const { outcome } = run([
        event({ phase: "callback_received", status: "failed", reason, side: "journey" }),
      ]);

      expect((await outcome).message).not.toContain(reason);
    },
  );
});
