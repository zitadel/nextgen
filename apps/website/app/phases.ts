// The four phases of running identity with an agent, in order: a page each
// (phase-page.tsx), with the phases' stepper on it; the header's Product menu
// (nav.ts) and the sitemap read them from here.

export type PhaseSlug = "get-started" | "operate" | "investigate" | "govern";

export type Phase = {
  slug: PhaseSlug;
  /** The page's name in the header. */
  name: string;
  /** Its step in the Product menu and on the phases' stepper. */
  short: string;
  /** The page's H1. */
  title: string;
  /** The line under it: what your agent does in this phase. */
  line: string;
  /** The page's description for search engines and shares. */
  description: string;
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
  },
  {
    slug: "operate",
    name: "Operate",
    short: "Operate",
    title: "Change sign-in like code.",
    line: "Your agent changes sign-in methods, policies and permissions like code. You review and can roll back.",
    description:
      "Your agent changes sign-in methods, policies and permissions like code. You review and can roll back.",
  },
  {
    slug: "investigate",
    name: "Investigate",
    short: "Investigate",
    title: "Ask what happened.",
    line: "Sign-ins, changes and requests are all events. Your agent reads them and finds out why.",
    description:
      "Ask why someone could not sign in, or who changed a policy. Your agent reads the events and finds out why.",
  },
  {
    slug: "govern",
    name: "Govern",
    short: "Govern",
    title: "The agents you ship get their identity the same way.",
    line: "Each signs in as itself and acts for your users only with their consent.",
    description:
      "The agents you ship sign in as themselves and act for your users only with their consent. Every action names both.",
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
