import type { CSSProperties } from "react";
import { AskTeaser } from "./ask-teaser";
import { ChangeHistory, type Question, Questions, Transcript } from "./blocks";
import { Capabilities } from "./capabilities";
import { appPath } from "./commands";
import { StartButtons } from "./cta";
import { HISTORY } from "./get-started/history";
import { ANSWER } from "./message";
import { PHASES, phasePath } from "./phases";
import { PLATFORM } from "./platform";
import { Part, PointList, TopLight, Unbroken } from "./sections";
import { SiteFooter } from "./site-footer";
import { SiteHeader } from "./site-header";
import { StartWindow } from "./start-window";

// The line under the title: what you ask, and what you keep. What Zitadel
// Next is, in the message house's words, is the site's description
// (message.ts).
const LINE =
  "Ask the agent you already use for passkeys, single sign-on or a new role. It sets them up in your app and in Zitadel, and you review every change before it goes live.";

// What stays yours, whatever your agent runs (LICENSING.md for the licenses).
const DECIDE = [
  "Every change is a diff you review before it goes live.",
  "Each change names who made it: a person, or an agent acting for one.",
  "You can roll back to the release before.",
  "It's open source: the server under AGPL-3.0, the SDKs under MIT. Run it in our cloud or on your servers.",
];

// The questions, word for word from the message house; the first answers
// with what Zitadel Next is (message.ts).
const QUESTIONS: readonly Question[] = [
  { question: "What is Zitadel Next?", answer: ANSWER },
  {
    question: "Does Zitadel have its own AI agent?",
    answer:
      "No. It opens every part of auth to the agent you already use, and that agent acts with your permissions. Every change it makes names it.",
  },
  {
    question: "Can a coding agent set up sign-in with it?",
    answer:
      "Yes. Your agent adds sign-in to your app and changes every setting, and you review each change.",
  },
  {
    question: "How do the agents in my product get identity?",
    answer:
      "Each signs in as itself and acts for a user only with that user's consent. Every action names both.",
  },
  {
    question: "Is it open source?",
    answer:
      "Yes. The server is AGPL-3.0, and the SDKs and client libraries are MIT. It runs in Zitadel Cloud or on your servers.",
  },
  {
    question: "How is it different from Auth0?",
    answer:
      "It is open source and self-hostable, multi-tenant, and the agent you already use can run every part of it.",
  },
];

// The closing title in the hero's colors: Zitadel's orange to the green.
const TITLE_COLORS = {
  "--title-from": "var(--color-step-start)",
  "--title-to": "var(--color-step-end)",
} as CSSProperties;

/** A quiet link with an arrow, the way on from a section to a page. */
function MoreLink({ href, children }: { href: string; children: string }) {
  return (
    <a
      href={href}
      className="group inline-flex items-center gap-2 text-sm text-text-secondary transition-colors hover:text-text-primary"
    >
      {children}
      <svg
        aria-hidden="true"
        viewBox="0 0 16 16"
        fill="none"
        className="size-4 transition-transform group-hover:translate-x-0.5"
      >
        <path
          d="M3 8h10M9 4l4 4-4 4"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </a>
  );
}

// The front page says your agent can do the auth work and shows how
// (AGENTS.md): the asks it takes and how to start, agent first; the work of
// each phase; the features, each with a window and its page; what stays
// yours; the questions; and the ways to start again at its end. The
// quickstart's walkthrough is /get-started.
export default function Home() {
  return (
    <>
      <TopLight />
      <SiteHeader />
      <main>
        <section
          aria-labelledby="hero-title"
          className="flex flex-col items-center px-6 pt-16 pb-12 md:pt-28 md:pb-16"
        >
          {/* The title sets the width; the line under it fills it and wraps
              inside it (.hero-lede), so the two read as one block. */}
          <div className="grid w-fit max-w-full justify-items-center">
            <h1 id="hero-title" className="hero-title">
              <span className="display-title">
                The auth platform <br className="max-sm:hidden" />
                your agent can run.
              </span>
            </h1>
            <p className="hero-lede teaser mt-5 text-balance text-center text-base text-text-secondary leading-7 md:text-lg md:leading-8">
              <Unbroken text={LINE} />
            </p>
          </div>
          <div className="teaser mt-8 flex w-full flex-col items-center gap-6">
            <AskTeaser className="w-full max-w-3xl" />
            <div className="w-full max-w-3xl">
              <StartWindow placement="hero" />
            </div>
            <StartButtons placement="hero" />
          </div>
        </section>

        <Part id="the-work" title="From first sign-in to the audit, your agent does the work.">
          <div className="max-w-3xl">
            <Transcript
              title={appPath}
              exchanges={PHASES.map(({ slug, short, asks }) => ({
                ...asks[0],
                tag: short,
                link: { href: phasePath(slug), label: `How ${short} works` },
              }))}
            />
          </div>
        </Part>

        <Part
          id="what-you-get"
          title="What your agent can turn on."
          line="Each piece has its own page with the details."
        >
          <div className="flex flex-col items-start gap-8">
            <div className="w-full">
              <Capabilities />
            </div>
            <MoreLink href={PLATFORM.path}>See every feature</MoreLink>
          </div>
        </Part>

        <Part id="in-charge" title="You stay in charge.">
          <div className="grid items-start gap-8 lg:grid-cols-2 lg:gap-14">
            <PointList points={DECIDE} />
            <ChangeHistory changes={HISTORY} />
          </div>
        </Part>

        <Part id="questions" title="Questions">
          <Questions questions={QUESTIONS} />
        </Part>

        <section
          aria-labelledby="closing-title"
          className="border-border-primary border-t px-6 pt-16 pb-20 md:pt-24 md:pb-28"
        >
          <div className="mx-auto flex max-w-3xl flex-col items-center">
            <h2
              id="closing-title"
              style={TITLE_COLORS}
              className="text-balance text-center text-3xl leading-tight md:text-5xl"
            >
              <span className="display-title">Open source, in our cloud or on your servers.</span>
            </h2>
            <StartButtons placement="closing" talk className="mt-9" />
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
