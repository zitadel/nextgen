import { NumberedCommands, Questions } from "./blocks";
import { Words } from "./command-line";
import { appPath, devCommand, setupCommand, skillsCommand, startCommand } from "./commands";
import { CopyButton } from "./copy-button";
import { CallToAction } from "./cta";
import { phaseColor } from "./phase-page";
import { PHASES, phasePath } from "./phases";
import { SiteFooter } from "./site-footer";
import { SiteHeader } from "./site-header";

// The commands of README.md's quick start (commands.ts), as numbered steps.
const STEPS = [
  { label: "Start Zitadel on your machine", command: startCommand },
  { label: "Add sign-in to your app", command: setupCommand },
  { label: "Run your app", command: devCommand },
];

// The questions about starting, no more than three (AGENTS.md).
const QUESTIONS = [
  {
    question: "What is Zitadel Next?",
    answer:
      "Open-source identity your agent can run, from the login screens to every policy, so you can just ask.",
  },
  {
    question: "Can a coding agent set up sign-in with it?",
    answer:
      "Yes. Your agent adds sign-in to your app and changes every setting, and you review each change.",
  },
  {
    question: "Is it open source?",
    answer:
      "Yes. The server is AGPL-3.0, and the SDKs and client libraries are MIT. It runs in Zitadel Cloud or on your servers.",
  },
];

// The front page has one job, how to start (AGENTS.md): the benefit and the
// commands that deliver it, two lines on what is different, the strip to the
// four phase pages, and the questions about starting.
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
          {/* The commands as numbered steps, the first thing to do, with the
              coding agents' one under them, and the quickstart as the second. */}
          <div className="teaser mt-9 flex w-full max-w-[42rem] flex-col items-center">
            <div className="w-full">
              <NumberedCommands
                title={appPath}
                note="Node 24+"
                steps={STEPS}
                placement="hero"
                copyAll
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
              sits just above the middle; the cue down to the page under it,
              unlabeled, as the section it leads to names itself. */}
          <div aria-hidden="true" className="flex-[1.15]" />
          <a
            href="#whats-different"
            className="scroll-cue group absolute bottom-8 left-1/2 flex -translate-x-1/2 rounded-md p-2 text-text-muted transition-colors hover:text-text-primary"
          >
            <span className="sr-only">What's different</span>
            <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className="size-5">
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

        {/* What is different, in two lines, and the four phases it opens,
            each a page of its own, in the stepper's colors. */}
        <section
          id="whats-different"
          aria-labelledby="whats-different-title"
          className="scroll-mt-20 px-6 py-16 md:py-24"
        >
          <div className="mx-auto max-w-6xl">
            <div className="mx-auto max-w-3xl text-center">
              <h2
                id="whats-different-title"
                className="font-mono text-text-muted text-xs leading-4"
              >
                What's different
              </h2>
              <p className="mt-4 text-balance text-text-secondary text-xl leading-8 md:text-2xl md:leading-9">
                <span className="text-text-primary">
                  Software is now built and run by people and their agents, together.
                </span>{" "}
                Your agent runs every piece of identity, and you review each change.
              </p>
            </div>
            <ol className="mt-12 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {PHASES.map((phase, index) => (
                <li key={phase.slug} style={phaseColor(index)}>
                  <a
                    href={phasePath(phase.slug)}
                    className="group flex h-full flex-col gap-3 rounded-xl border border-window-border border-t-2 border-t-(--step) bg-window p-5 shadow-(--window-shadow) transition-colors hover:border-(--step)"
                  >
                    <span className="flex items-center justify-between font-mono text-(--step) text-xs leading-4">
                      {phase.short}
                      <svg
                        aria-hidden="true"
                        viewBox="0 0 16 16"
                        fill="none"
                        className="size-4 text-text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-text-primary"
                      >
                        <path
                          d="M3 8h10M9 4l4 4-4 4"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </span>
                    <span className="text-balance font-heading text-lg text-text-primary leading-6">
                      {phase.title}
                    </span>
                  </a>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section
          id="questions"
          aria-labelledby="questions-title"
          className="px-6 pt-8 pb-20 md:pb-28"
        >
          <div className="mx-auto max-w-4xl">
            <h2
              id="questions-title"
              className="font-heading text-2xl leading-8 tracking-[-0.02em] md:text-3xl md:leading-10"
            >
              Questions
            </h2>
            <div className="mt-8">
              <Questions questions={QUESTIONS} />
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
