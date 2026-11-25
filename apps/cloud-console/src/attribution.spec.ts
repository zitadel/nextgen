import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import {
  CREATE_USER_STEPS,
  attributionOf,
  nextWithCampaign,
  signupSourceOf,
  watchSignUps,
} from "./attribution";

const ORIGIN = "https://cloud.example";
const at = (path: string) => new URL(`${ORIGIN}${path}`);

describe("the source onboarding gets, from the page's address", () => {
  it("is the link's campaign parameters, on the console", () => {
    expect(
      attributionOf(at("/console/?utm_source=newsletter&utm_medium=email&utm_campaign=launch")),
    ).toEqual({
      via: "console",
      utm_source: "newsletter",
      utm_medium: "email",
      utm_campaign: "launch",
    });
  });

  it("is the CLI's on the claim page, where the CLI's sign-ups land", () => {
    expect(attributionOf(at("/console/claim?challenge_id=ch_1&project_id=p_1"))).toEqual({
      via: "cli",
    });
  });

  it("leaves out a parameter that holds an email or runs too long", () => {
    const address = encodeURIComponent("ada@example.com");
    expect(
      attributionOf(at(`/console/?utm_source=${address}&utm_medium=${"x".repeat(101)}`)),
    ).toEqual({
      via: "console",
    });
  });
});

describe("the source signup_completed reports, from the page the account was made on", () => {
  it("reads the page the login returns to, which holds the link's parameters", () => {
    const next = encodeURIComponent("/users?project=p_1&utm_source=newsletter&utm_campaign=launch");
    expect(signupSourceOf(at(`/console/login?next=${next}`), "")).toEqual({
      page: "login",
      utm_source: "newsletter",
      utm_campaign: "launch",
    });
  });

  it("takes the page's own parameters whole, never mixed with those of the page it returns to", () => {
    const next = encodeURIComponent("/users?utm_source=newsletter&utm_campaign=launch");
    expect(signupSourceOf(at(`/console/login?utm_medium=email&next=${next}`), "")).toEqual({
      page: "login",
      utm_medium: "email",
    });
  });

  it("names the referring site by its host alone", () => {
    expect(
      signupSourceOf(at("/console/signup?utm_source=hn"), "https://news.ycombinator.com/item?id=1"),
    ).toEqual({ page: "signup", utm_source: "hn", referrer_host: "news.ycombinator.com" });
  });

  it("is the claim page's with no parameters, and no referrer when the browser sent none", () => {
    expect(signupSourceOf(at("/console/claim?challenge_id=ch_1"), "")).toEqual({ page: "claim" });
  });
});

describe("the page the sign-up page opens next", () => {
  it("carries the sign-up page's campaign parameters, onto the home page when it names none", () => {
    expect(nextWithCampaign(undefined, at("/console/signup?utm_source=hn&ref=x"))).toBe(
      "/?utm_source=hn",
    );
    expect(nextWithCampaign("/projects?project=p_1", at("/console/signup?utm_medium=email"))).toBe(
      "/projects?project=p_1&utm_medium=email",
    );
  });

  it("stays as it is when the sign-up page has none", () => {
    expect(nextWithCampaign("/projects", at("/console/signup"))).toBe("/projects");
    expect(nextWithCampaign(undefined, at("/console/signup"))).toBeUndefined();
  });
});

it("knows the step that creates the user by the name the platform flow gives it", () => {
  const flow = JSON.parse(
    readFileSync(
      new URL("../../../packages/config/defaults/default-login.json", import.meta.url),
      "utf8",
    ),
  ) as { steps: { name: string; on_success?: string }[] };
  const creating = flow.steps.filter((step) => step.on_success === "create_user");
  expect(creating.map((step) => step.name)).toEqual([...CREATE_USER_STEPS]);
});

describe("a sign-up the widget finishes", () => {
  /** A widget on a page, its flow's steps rendered in order, then its end. */
  function flow(steps: { name: string; complete?: string }[]) {
    const page = new EventTarget();
    const onSignUp = vi.fn(async () => {});
    const waited: unknown[] = [];
    watchSignUps(page, onSignUp);
    for (const step of steps) {
      page.dispatchEvent(new CustomEvent("zitadel-flow-step", { detail: { step } }));
    }
    page.dispatchEvent(
      new CustomEvent("zitadel-flow-complete", {
        detail: { behavior: "show", waitUntil: (work: unknown) => waited.push(work) },
      }),
    );
    return { onSignUp, waited };
  }

  const done = { name: "done", complete: "show" };

  it("is reported once, and the widget waits for it before it leaves the page", () => {
    const { onSignUp, waited } = flow([
      { name: "identifier" },
      { name: "register" },
      { name: "register-password" },
      done,
    ]);
    expect(onSignUp).toHaveBeenCalledOnce();
    expect(waited).toHaveLength(1);
  });

  it.each([
    ["a sign-in", [{ name: "identifier" }, { name: "password" }, done]],
    [
      "a sign-up whose address exists, which signs the person in instead",
      [{ name: "register" }, { name: "register-password" }, { name: "password" }, done],
    ],
  ])("is not %s", (_, steps) => {
    expect(flow(steps).onSignUp).not.toHaveBeenCalled();
  });
});
