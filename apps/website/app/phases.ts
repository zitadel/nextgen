// The four phases of running identity with an agent, in order: a page each
// (phase-page.tsx), with the phases' stepper and its asks on it; the front
// page's phase rows, the header's How it works menu (nav.ts), the sitemap and
// /llms.txt read them from here.

export type PhaseSlug = "get-started" | "operate" | "investigate" | "govern";

/** A person's ask to their agent, and the agent's reply. */
export type Exchange = { ask: string; reply: string };

export type Phase = {
  slug: PhaseSlug;
  /** The page's name in the header. */
  name: string;
  /** Its step in the How it works menu and on the phases' stepper. */
  short: string;
  /** The page's H1. */
  title: string;
  /** The line under it: what your agent does in this phase. */
  line: string;
  /** The page's description for search engines and shares. */
  description: string;
  /** The page's Ask it; the front page shows the first ask. */
  asks: readonly [Exchange, ...Exchange[]];
};

export const PHASES: readonly Phase[] = [
  {
    slug: "get-started",
    name: "Get started",
    short: "Start",
    title: "From an empty folder to working sign-in.",
    line: "Your agent runs setup, adds the login screens to your app, and signs in once to check that it works.",
    description:
      "Your agent runs setup, adds the login screens to your app, and signs in once to check that it works.",
    asks: [
      {
        ask: "Add sign-in to my app.",
        reply:
          "Done. Your app has login, sign-up and a profile page now. I made a test user and signed in with it to be sure. Want passkeys next?",
      },
      {
        ask: "Add passkeys.",
        reply:
          "Passkeys are on, and sign-in and sign-up offer them now. Want to review it before I deploy?",
      },
      {
        ask: "Use our brand on the login screen.",
        reply:
          "Your login screens use your colors and font now, set in your own stylesheet, so they match the rest of your app.",
      },
    ],
  },
  {
    slug: "operate",
    name: "Operate",
    short: "Operate",
    title: "Change sign-in like code.",
    line: "Your agent changes sign-in methods, policies and permissions like code. You review and can roll back.",
    description:
      "Your agent changes sign-in methods, policies and permissions like code. You review and can roll back.",
    asks: [
      {
        ask: "Connect this customer's single sign-on.",
        reply:
          "Their OpenID Connect provider is connected and part of your sign-in now. When you deploy, their people can sign in with their work accounts. Should I deploy?",
      },
      {
        ask: "Require 12-character passwords.",
        reply:
          "Done. New passwords need at least 12 characters once you deploy. Passwords people already have keep working.",
      },
      {
        ask: "Give support read access to users.",
        reply: "Your support team can read your users now, and they can't change a thing.",
      },
    ],
  },
  {
    slug: "investigate",
    name: "Investigate",
    short: "Investigate",
    title: "Ask what happened.",
    line: "Sign-ins, changes and requests are all events. Your agent reads them and finds out why.",
    description:
      "Ask why someone could not sign in, or who changed a policy. Your agent reads the events and finds out why.",
    asks: [
      {
        ask: "Why couldn't Dana sign in yesterday?",
        reply:
          "Found it: she kept trying a password, but she signed up with a passkey and never set one. Her passkey still works, so that's her way in.",
      },
      {
        ask: "Who changed the password policy?",
        reply:
          "That was me, for you: the release that requires 12-character passwords. It names the commit it came from and why.",
      },
      {
        ask: "Which sign-ins failed this morning?",
        reply:
          "Some password attempts, and one single sign-on the provider turned down. Here's each, with who it was and when.",
      },
    ],
  },
  {
    slug: "govern",
    name: "Govern",
    short: "Govern",
    title: "The agents you ship get their identity the same way.",
    line: "Each signs in as itself and acts for your users only with their consent.",
    description:
      "The agents you ship sign in as themselves and act for your users only with their consent. Every action names both.",
    asks: [
      {
        ask: "Let our support agent look up orders for a user.",
        reply:
          "Done. The support agent can look up a user's orders once that user says yes, and every look-up names both of them.",
      },
      {
        ask: "Show what our agents did for Dana.",
        reply: "Only the support agent: it looked up her orders after she said yes.",
      },
      {
        ask: "Remove the support agent's access.",
        reply: "Removed. Its requests are refused from now on, and the record shows you did it.",
      },
    ],
  },
];

/** The page of a phase, on this host. */
export function phasePath(slug: PhaseSlug): string {
  return `/${slug}`;
}

/** The phase with `slug`, its place, and the one after it (the first after the last). */
export function phaseOf(slug: PhaseSlug): { phase: Phase; index: number; next: Phase } {
  const index = PHASES.findIndex((phase) => phase.slug === slug);
  const phase = PHASES[index];
  const next = PHASES[(index + 1) % PHASES.length];
  if (!phase || !next) {
    throw new Error(`No phase ${slug}`);
  }
  return { phase, index, next };
}
