import { CommandBlock } from "./command-block";
import { Words } from "./command-line";
import { CallToAction } from "./cta";
import { appPath, commands, skillsCommand } from "./commands";
import { CopyButton } from "./copy-button";
import { Showcase, stepLink } from "./showcase/showcase";
import { SiteFooter } from "./site-footer";
import { SiteHeader } from "./site-header";

/**
 * One of the three things the hero's line says are yours, in the color of
 * the step that changes it, linking down to that step.
 */
function Yours({ step, children }: { step: string; children: string }) {
  const { href, number, style } = stepLink(step);
  return (
    <a href={href} style={style} title={`Step ${number}: ${step}`} className="yours">
      {children}
    </a>
  );
}

// The page follows zitadel/new-website's narrative (AGENTS.md): the benefit
// and the commands that deliver it, then the steps those commands take and
// what they let you change (the showcase), and nothing after it.
export default function Home() {
  return (
    <>
      {/* The process's light over the top of the page: Zitadel's orange on
          the left warming through amber to the finish's green on the right
          (showcase/finish.tsx), the way the steps' line runs. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[60rem] bg-[radial-gradient(45%_55%_at_28%_0%,color-mix(in_oklch,var(--color-step-start)_13%,transparent),transparent),radial-gradient(45%_55%_at_74%_0%,color-mix(in_oklch,var(--color-step-end)_9%,transparent),transparent)]"
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
                Your login <br className="sm:hidden" />
                in one minute.
              </span>
            </h1>
            <p className="hero-lede teaser mt-5 text-balance text-center text-base text-text-secondary leading-7 md:text-lg md:leading-8">
              Open-source auth that lives in your repo:{" "}
              <Yours step="Add a field">your user model</Yours>,{" "}
              <Yours step="Change the flow">your flows</Yours>,{" "}
              <Yours step="Match your brand">your look</Yours>.
            </p>
          </div>
          {/* The commands with the coding agents' one under them, and the ways
              on. The commands keep to their longest line's width. */}
          <div className="teaser mt-9 flex w-full max-w-[40rem] flex-col items-center">
            <div className="w-full">
              <CommandBlock
                title={appPath}
                note="Node 24+"
                lines={commands}
                footer={
                  <div className="flex items-start gap-3 text-xs leading-5">
                    <p className="flex flex-1 flex-wrap gap-x-3">
                      <span className="text-text-muted">Using a coding agent?</span>
                      <code className="font-mono text-text-secondary">
                        <Words text={skillsCommand} />
                      </code>
                    </p>
                    <CopyButton text={skillsCommand} label="the skills command" className="-my-1" />
                  </div>
                }
              />
            </div>
            <CallToAction className="mt-7" />
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
            numbered rows speak for themselves under the hero. */}
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
