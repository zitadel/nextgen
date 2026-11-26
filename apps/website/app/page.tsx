import { NumberedCommands } from "./blocks";
import { Words } from "./command-line";
import { appPath, devCommand, setupCommand, skillsCommand, startCommand } from "./commands";
import { CopyButton } from "./copy-button";
import { CallToAction } from "./cta";
import { Showcase, stepLink } from "./showcase/showcase";
import { SiteFooter } from "./site-footer";
import { SiteHeader } from "./site-header";

// The commands of README.md's quick start (commands.ts), as numbered steps.
const STEPS = [
  { label: "Start Zitadel on your machine", command: startCommand },
  { label: "Add sign-in to your app", command: setupCommand },
  { label: "Run your app", command: devCommand },
];

// The front page shows how to start and proves it (AGENTS.md): the benefit
// and the commands that deliver it, then the steps those commands take and
// what they let you change (the showcase), ending on its closing band.
export default function Home() {
  return (
    <>
      {/* The light over the top of the page: the accent's purple on the left
          meeting the finish's green on the right (showcase/finish.tsx). */}
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
          {/* The commands as numbered steps, with the coding agents' one under
              them, and the ways on. */}
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
            <CallToAction placement="hero" className="mt-7" />
          </div>
          {/* The air under the content, a little more than over it, so it
              sits just above the middle; the cue down to the steps under it. */}
          <div aria-hidden="true" className="flex-[1.15]" />
          <a
            href={stepLink("Start Zitadel").href}
            className="scroll-cue group absolute bottom-8 left-1/2 flex -translate-x-1/2 flex-col items-center gap-2 rounded-md px-2 py-1 font-mono text-text-muted text-xs leading-4 transition-colors hover:text-text-primary"
          >
            How it works
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

        {/* What the commands do, step by step, with no title of its own: the
            numbered rows speak for themselves under the hero, and the page
            ends on the closing band at their foot (showcase/finish.tsx). */}
        <section
          aria-label="Step by step"
          className="overflow-x-clip px-6 pt-12 pb-16 md:pt-16 md:pb-24"
        >
          <div className="mx-auto max-w-6xl">
            <Showcase />
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
