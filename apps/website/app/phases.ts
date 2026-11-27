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
          "Setup added the login, sign-up and profile pages to your app. I signed up a test user and signed in again to check that it works.",
      },
      {
        ask: "Add passkeys.",
        reply:
          "Passkeys are on in your user schema, and the sign-in and sign-up steps offer them. The change is ready for your review.",
      },
      {
        ask: "Use our brand on the login screen.",
        reply:
          "I set the login's design tokens to your colors and font in your stylesheet, so the login screens look like the rest of your app.",
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
          "I connected their OpenID Connect provider and added it to your sign-in steps. Their people sign in with their work accounts once you deploy.",
      },
      {
        ask: "Require 12-character passwords.",
        reply:
          "The password policy asks for at least 12 characters. New passwords are checked once you deploy; passwords already set stay as they are.",
      },
      {
        ask: "Give support read access to users.",
        reply:
          "I gave the support team viewer access to the project. They can read your users and change nothing.",
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
          "The events show her password checks failed. She signed up with a passkey and never set a password, so her passkey is the way in.",
      },
      {
        ask: "Who changed the password policy?",
        reply:
          "Your agent did, for you, in the release that requires 12-character passwords. The release names the commit it came from and why.",
      },
      {
        ask: "Which sign-ins failed this morning?",
        reply:
          "Some password checks, and a single sign-on the provider turned down. I listed each one with its user and the time it happened.",
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
          "Done. The support agent can look up a user's orders once that user agrees, and each look-up names the agent and the user.",
      },
      {
        ask: "Show what our agents did for Dana.",
        reply: "Only the support agent acted for her: it looked up her orders after she agreed.",
      },
      {
        ask: "Remove the support agent's access.",
        reply:
          "Removed. The agent's requests are refused from now on, and the events show that you removed it.",
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
