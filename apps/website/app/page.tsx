import type { CSSProperties } from "react";
import { SkillsLine } from "./blocks";
import { StartButtons } from "./cta";
import { PHASES, phasePath } from "./phases";
import { PLATFORM } from "./platform";
import { Part, PointList, TitleRows, TopLight } from "./sections";
import { SiteFooter } from "./site-footer";
import { SiteHeader } from "./site-header";

// The message house's sentence, word for word, under the title.
const LINE =
  "Zitadel Next is open-source identity your agent can run, from the login screens to every policy, so you can just ask.";

// What stays yours, whatever your agent runs (LICENSING.md for the licenses).
const DECIDE = [
  "Every change is a diff you review before it goes live.",
  "Each change names who made it: a person, or an agent acting for one.",
  "You can roll back to the release before.",
  "It's open source: the server under AGPL-3.0, the SDKs under MIT. Run it in our cloud or on your servers.",
];

// The closing title in the hero's colors: Zitadel's orange to the green.
const TITLE_COLORS = {
  "--title-from": "var(--color-step-start)",
  "--title-to": "var(--color-step-end)",
} as CSSProperties;

// The front page explains, proves, then starts (AGENTS.md): what it is and
// the two ways to start, what your agent runs in each phase, what you
// decide, and the ways to start again at its end. The quickstart's
// walkthrough is /get-started.
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
                Identity your agent can run. <br />
                All of it.
              </span>
            </h1>
            <p className="hero-lede teaser mt-5 text-balance text-center text-base text-text-secondary leading-7 md:text-lg md:leading-8">
              {LINE}
            </p>
          </div>
          <div className="teaser mt-9 flex flex-col items-center gap-6">
            <StartButtons placement="hero" />
            <SkillsLine placement="hero" className="text-balance text-center text-sm" />
          </div>
        </section>

        <Part id="what-your-agent-runs" title="What your agent runs">
          <div className="flex flex-col items-start gap-6">
            <div className="w-full">
              <TitleRows
                rows={PHASES.map(({ slug, short, title, line, asks }) => ({
                  label: short,
                  title,
                  line,
                  ask: asks[0].ask,
                  href: phasePath(slug),
                }))}
              />
            </div>
            <a
              href={PLATFORM.path}
              className="group inline-flex items-center gap-2 text-sm text-text-secondary transition-colors hover:text-text-primary"
            >
              All of the platform
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
          </div>
        </Part>

        <Part id="you-decide" title="You decide">
          <PointList points={DECIDE} />
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
