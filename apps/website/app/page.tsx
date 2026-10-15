import Image from "next/image";
import { Fragment } from "react";
import { CommandBlock } from "./command-block";
import { commands, skillsCommand } from "./commands";
import { CopyButton } from "./copy-button";
import hero from "./hero.avif";
import heroStill from "./hero-still.webp";
import { links } from "./links";
import { Showcase } from "./showcase/showcase";
import { SiteFooter } from "./site-footer";
import { SiteHeader } from "./site-header";
import { Stage } from "./stage";

const BUTTON =
  "inline-flex h-11 items-center rounded-lg px-5 font-semibold text-sm transition-colors";

// The website's homepage hero (AGENTS.md): animated, or its first frame for
// reduced motion and for browsers without AVIF. Decoration, so no alt text.
function Hero({ className, first = false }: { className: string; first?: boolean }) {
  return (
    <picture className={className}>
      <source media="(prefers-reduced-motion: reduce)" srcSet={heroStill.src} />
      <source type="image/avif" srcSet={hero.src} />
      <Image
        src={heroStill}
        alt=""
        unoptimized
        loading="eager"
        fetchPriority={first ? "high" : undefined}
        className="size-full"
      />
    </picture>
  );
}

// The page follows zitadel/new-website's narrative (AGENTS.md): the benefit
// and the commands that deliver it, then the steps those commands take and
// what they let you change (the showcase), and nothing after it.
export default function Home() {
  return (
    <>
      <SiteHeader />
      <main>
        <section
          aria-labelledby="hero-title"
          className="flex flex-col items-center overflow-hidden px-6 pt-2 pb-16 md:pb-20"
        >
          <Stage>
            <div className="stage-frame">
              <Hero className="stage-glow" />
              <Hero className="stage-art" first />
            </div>
            <h1 id="hero-title" className="stage-caption">
              Your login in one minute.
            </h1>
          </Stage>
          {/* Wide enough for the line on one row on a laptop; the commands
              keep to the width of their longest line. */}
          <div className="teaser mt-4 flex w-full max-w-[46rem] flex-col items-center gap-5">
            <p className="text-balance text-center text-lg text-text-secondary leading-7">
              Open-source auth that lives in your repo: your user model, your flows, your look.
            </p>
            <div className="w-full max-w-[40rem]">
              <CommandBlock title="Terminal" note="Node 24+" lines={commands} />
            </div>
            <p className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-center text-sm text-text-secondary leading-5">
              <span>Using a coding agent?</span>
              <span className="inline-flex items-center gap-1">
                {/* Wraps between words, never at the hyphens of a flag. */}
                <code className="font-mono text-[0.8125rem] text-text-primary">
                  {skillsCommand.split(" ").map((word, index) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: the words of a fixed command, never reordered
                    <Fragment key={index}>
                      {index > 0 && " "}
                      <span className="whitespace-nowrap">{word}</span>
                    </Fragment>
                  ))}
                </code>
                <CopyButton text={skillsCommand} label="the skills command" />
              </span>
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <a
                href={links.quickstart}
                className={`${BUTTON} bg-text-primary text-background hover:bg-text-secondary`}
              >
                Read the quickstart
              </a>
              <a
                href={links.github}
                className={`${BUTTON} border border-border-secondary text-text-primary hover:bg-surface-black-secondary`}
              >
                View on GitHub
              </a>
            </div>
          </div>
        </section>

        {/* What the commands do, step by step, with no title of its own: the
            numbered rows speak for themselves under the hero. */}
        <section aria-label="Step by step" className="overflow-hidden px-6 pt-4 pb-12 md:pb-20">
          <div className="mx-auto max-w-5xl">
            <Showcase />
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
