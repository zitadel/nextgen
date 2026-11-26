import type { ReactNode } from "react";
import { CommandBlock } from "./command-block";
import { Words } from "./command-line";
import { CallToAction } from "./cta";
import { appPath, commands, skillsCommand } from "./commands";
import { CopyButton } from "./copy-button";
import { stepColor } from "./showcase/step";
import { SiteFooter } from "./site-footer";
import { SiteHeader } from "./site-header";
import { WINDOW_INSET, Window } from "./window";

// The named sections under the hero, the closing band the last: each takes its
// turn of the stepper's colors (stepColor), from Zitadel's orange to the green
// the hero's title also ends in.
const SECTIONS = 5;

// What an agent runs, piece by piece, and what it does there.
const PIECES = [
  {
    name: "Login screens",
    line: "Your agent builds the login screens in your app, in your code and your brand.",
  },
  {
    name: "Sign-in methods",
    line: "Your agent changes sign-in methods like code. You review and can roll back.",
  },
  {
    name: "Policies",
    line: "Your agent sets policies, from password length to lockout, for you to review.",
  },
  {
    name: "Permissions",
    line: "Your agent changes who can do what. Every change shows who made it.",
  },
  {
    name: "User fields",
    line: "Your agent adds the fields you need, and your sign-up screen asks for them.",
  },
  { name: "Events", line: "Ask what happened, and your agent finds out why." },
];

// A person and their coding agent: three changes asked for, then a question
// about a user. The replies claim no number but the one asked for.
const TRANSCRIPT = [
  {
    ask: "Add passkeys.",
    reply:
      "I added passkeys to sign-in and to the login screen in your app. The change is ready for your review.",
  },
  {
    ask: "Connect this customer's single sign-on.",
    reply:
      "Connected with the details they sent. Their people now sign in with their work accounts.",
  },
  {
    ask: "Require 12-character passwords.",
    reply: "New passwords need at least 12 characters, and your sign-up screen says so.",
  },
  {
    ask: "Why couldn't Dana sign in yesterday?",
    reply:
      "The events show her password failed several times in a row, so her account was locked. Should I unlock it?",
  },
];

// What those asks, and one change of the reader's own, left in the history,
// oldest first: each names who made it.
const CHANGES = [
  { change: "Add passkeys", agent: true },
  { change: "Update the logo on the login screens", agent: false },
  { change: "Connect a customer's single sign-on", agent: true },
  { change: "Require 12-character passwords", agent: true },
];

// An agent the reader ships, in the events: it signs in as itself, and acts
// for a user once she consents, which names them both.
const AGENT_EVENTS = [
  { actor: "Support agent", action: "Signed in as itself" },
  { actor: "Dana", action: "Gave Support agent consent to see her orders" },
  { actor: "Support agent, for Dana", action: "Looked up her orders" },
];

// The questions as the page shows them, and as FAQPage structured data
// (schema.org) for search engines, from this one list.
const QUESTIONS = [
  {
    question: "What is Zitadel Next?",
    answer:
      "Open-source identity your agent can run, from the login screens to every policy, so you can just ask.",
  },
  {
    question: "What makes it AI-native?",
    answer:
      "Every piece of the product is something an agent can run. The console is there when you want to look.",
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
];

// A data block, which runs nothing; csp-adapter.mjs lists its hash with the
// page's inline scripts all the same. `<` escaped, so no answer can close it.
const FAQ_DATA = JSON.stringify({
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: QUESTIONS.map(({ question, answer }) => ({
    "@type": "Question",
    name: question,
    acceptedAnswer: { "@type": "Answer", text: answer },
  })),
}).replace(/</g, "\\u003c");

const SECTION = "px-6 py-16 md:py-24";
const H2 = "text-balance font-heading text-3xl leading-tight tracking-[-0.02em] md:text-4xl";

/** A section's name over its heading, in the section's color (--step), and the line under it. */
function SectionHeader({
  id,
  name,
  title,
  center = false,
  className = "",
  children,
}: {
  id: string;
  name: string;
  title: string;
  center?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <header
      className={`flex max-w-2xl flex-col gap-4 ${center ? "mx-auto items-center text-center" : ""} ${className}`}
    >
      <p className="font-mono text-(--step) text-xs leading-4">{name}</p>
      <h2 id={id} className={H2}>
        {title}
      </h2>
      {children && (
        <p className="text-pretty text-text-secondary leading-7 md:text-lg md:leading-8">
          {children}
        </p>
      )}
    </header>
  );
}

// The page tells why, then how: the benefit and the commands that deliver it,
// what is changing, the pieces an agent runs, a person asking their agent,
// the history that names who changed what, the agents the reader ships, the
// questions, and the commands again.
export default function Home() {
  return (
    <>
      {/* The light over the top of the page: the accent's purple on the left
          meeting the stepper's green on the right. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[60rem] bg-[radial-gradient(45%_55%_at_28%_0%,color-mix(in_oklch,var(--color-text-accent)_16%,transparent),transparent),radial-gradient(45%_55%_at_74%_0%,color-mix(in_oklch,var(--color-step-end)_9%,transparent),transparent)]"
      />
      <SiteHeader />
      <main>
        <section
          aria-labelledby="hero-title"
          className="hero relative flex flex-col items-center overflow-hidden px-6 pt-10 pb-28"
        >
          {/* As much air over the content as under it, so it stays centered. */}
          <div aria-hidden="true" className="flex-1" />
          {/* The title sets the width; the line under it fills it and wraps
              inside it (.hero-lede), so the two read as one block. */}
          <div className="grid w-fit max-w-full justify-items-center">
            <h1 id="hero-title" className="hero-title">
              <span className="display-title">
                Identity your agent can run. <br />
                All of it.
              </span>
            </h1>
            <p className="hero-lede teaser mt-5 text-balance text-center text-base text-text-secondary leading-7 md:text-lg md:leading-8">
              Identity you can just ask.
            </p>
          </div>
          {/* The commands, the first thing to do, with the coding agents' one
              under them, and the quickstart as the second. The commands keep
              to their longest line's width. */}
          <div className="teaser mt-9 flex w-full max-w-[40rem] flex-col items-center">
            <div className="w-full">
              <CommandBlock
                title={appPath}
                note="Node 24+"
                lines={commands}
                placement="hero"
                footer={
                  <div className="flex items-start gap-3 text-xs leading-5">
                    <p className="flex flex-1 flex-wrap gap-x-3">
                      <span className="text-text-muted">Using a coding agent?</span>
                      <code className="font-mono text-text-secondary">
                        <Words text={skillsCommand} />
                      </code>
                    </p>
                    <CopyButton
                      text={skillsCommand}
                      label="the skills command"
                      event={{ snippet: "skills", placement: "hero" }}
                      className="-my-1"
                    />
                  </div>
                }
              />
            </div>
            <CallToAction placement="hero" quiet className="mt-7" />
          </div>
          {/* The air under the content, a little more than over it, so it
              sits just above the middle; the cue down to the page under it. */}
          <div aria-hidden="true" className="flex-[1.15]" />
          <a
            href="#whats-changing"
            className="scroll-cue group absolute bottom-8 left-1/2 flex -translate-x-1/2 flex-col items-center gap-2 rounded-md px-2 py-1 font-mono text-text-muted text-xs leading-4 transition-colors hover:text-text-primary"
          >
            What's changing
            <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className="size-4">
              <path
                d="M4 6l4 4 4-4"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </a>
        </section>

        {/* What is changing, which the hero's cue names: a statement with no
            name over it. */}
        <section
          id="whats-changing"
          aria-labelledby="whats-changing-title"
          className={`scroll-mt-20 ${SECTION}`}
        >
          <h2
            id="whats-changing-title"
            className="mx-auto max-w-4xl text-balance text-center font-heading text-3xl leading-tight tracking-[-0.025em] md:text-5xl md:leading-[1.1]"
          >
            Software is now built and run by people and their agents, together.
          </h2>
        </section>

        <section
          id="every-piece"
          aria-labelledby="every-piece-title"
          style={stepColor(0, SECTIONS)}
          className={SECTION}
        >
          <div className="mx-auto max-w-6xl">
            <SectionHeader
              id="every-piece-title"
              name="Every piece"
              title="From the login screens to every policy."
            />
            <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {PIECES.map(({ name, line }) => (
                <li
                  key={name}
                  className="flex flex-col gap-2 rounded-xl border border-window-border bg-window p-5 shadow-(--window-shadow) md:p-6"
                >
                  <h3 className="font-heading text-lg text-text-primary leading-7">{name}</h3>
                  <p className="text-sm text-text-secondary leading-6">{line}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* The page's center: a person asks, their agent answers. */}
        <section
          id="you-just-ask"
          aria-labelledby="you-just-ask-title"
          style={stepColor(1, SECTIONS)}
          className={SECTION}
        >
          <div className="mx-auto max-w-3xl">
            <SectionHeader
              id="you-just-ask-title"
              name="You just ask"
              title="Ask for a change, or ask what happened."
              center
            />
            <Window title={appPath} className="mt-10">
              <ol className={`flex flex-col gap-7 py-6 md:py-8 ${WINDOW_INSET}`}>
                {TRANSCRIPT.map(({ ask, reply }) => (
                  <li key={ask} className="grid grid-cols-[1ch_minmax(0,1fr)] gap-x-3 gap-y-2">
                    <span
                      aria-hidden="true"
                      className="select-none font-mono text-[0.8125rem] text-text-accent leading-6"
                    >
                      &gt;
                    </span>
                    <p className="font-mono text-[0.8125rem] text-text-primary leading-6">
                      <span className="sr-only">You: </span>
                      {ask}
                    </p>
                    <span
                      aria-hidden="true"
                      className="mt-2.5 size-1.5 justify-self-center rounded-full bg-(--step)"
                    />
                    <p className="text-pretty text-sm text-text-secondary leading-6 md:text-base md:leading-7">
                      <span className="sr-only">Your agent: </span>
                      {reply}
                    </p>
                  </li>
                ))}
              </ol>
            </Window>
          </div>
        </section>

        <section
          id="you-decide"
          aria-labelledby="you-decide-title"
          style={stepColor(2, SECTIONS)}
          className={SECTION}
        >
          <div className="mx-auto grid max-w-6xl items-center gap-10 lg:grid-cols-2 lg:gap-16">
            <SectionHeader
              id="you-decide-title"
              name="You decide"
              title="You review every change, and each one shows who made it."
            />
            <Window title="Change history">
              <ol className="divide-y divide-window-border">
                {CHANGES.map(({ change, agent }) => (
                  <li
                    key={change}
                    className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 py-3.5 ${WINDOW_INSET}`}
                  >
                    <span className="text-sm text-text-primary leading-6">{change}</span>
                    <span
                      className={`rounded-full px-2.5 font-mono text-xs leading-6 ${
                        agent
                          ? "bg-text-accent/10 text-text-accent"
                          : "bg-tint/[0.07] text-text-secondary"
                      }`}
                    >
                      <span className="sr-only">Made by </span>
                      {agent ? "Your agent, for you" : "You"}
                    </span>
                  </li>
                ))}
              </ol>
            </Window>
          </div>
        </section>

        <section
          id="your-agents-too"
          aria-labelledby="your-agents-too-title"
          style={stepColor(3, SECTIONS)}
          className={SECTION}
        >
          <div className="mx-auto grid max-w-6xl items-center gap-10 lg:grid-cols-2 lg:gap-16">
            <SectionHeader
              id="your-agents-too-title"
              name="Your agents too"
              title="The agents you ship get their identity the same way."
              className="lg:order-2"
            >
              Each signs in as itself and acts for your users only with their consent.
            </SectionHeader>
            <Window title="Events" className="lg:order-1">
              <ol className="divide-y divide-window-border">
                {AGENT_EVENTS.map(({ actor, action }) => (
                  <li
                    key={action}
                    className={`grid gap-x-4 gap-y-0.5 py-3.5 sm:grid-cols-[12rem_minmax(0,1fr)] ${WINDOW_INSET}`}
                  >
                    <span className="font-mono text-text-primary text-xs leading-6">{actor}</span>
                    <span className="text-sm text-text-secondary leading-6">{action}</span>
                  </li>
                ))}
              </ol>
            </Window>
          </div>
        </section>

        <section id="questions" aria-labelledby="questions-title" className={SECTION}>
          <div className="mx-auto max-w-4xl">
            <h2 id="questions-title" className={H2}>
              Questions
            </h2>
            <dl className="mt-8 border-border-primary border-b">
              {QUESTIONS.map(({ question, answer }) => (
                <div
                  key={question}
                  className="grid gap-2 border-border-primary border-t py-6 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] md:gap-10"
                >
                  <dt className="font-semibold text-text-primary leading-7">{question}</dt>
                  <dd className="text-text-secondary leading-7">{answer}</dd>
                </div>
              ))}
            </dl>
            <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: FAQ_DATA }} />
          </div>
        </section>

        {/* The way on, at the end: where it runs, and the commands again,
            lit from below in the stepper's last color. */}
        <section
          aria-labelledby="closing-title"
          style={stepColor(SECTIONS - 1, SECTIONS)}
          className="relative isolate overflow-hidden px-6 pt-16 pb-24 md:pt-24 md:pb-32"
        >
          <div
            aria-hidden="true"
            className="absolute inset-0 -z-10 bg-[radial-gradient(55%_65%_at_50%_100%,color-mix(in_oklch,var(--step)_14%,transparent),transparent)]"
          />
          <div className="mx-auto flex max-w-[40rem] flex-col items-center">
            <h2
              id="closing-title"
              className="text-balance text-center text-3xl leading-tight md:text-5xl"
            >
              <span className="display-title">Open source, in our cloud or on your servers.</span>
            </h2>
            <div className="mt-10 w-full">
              <CommandBlock title={appPath} note="Node 24+" lines={commands} placement="closing" />
            </div>
            <CallToAction placement="closing" className="mt-7" />
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
