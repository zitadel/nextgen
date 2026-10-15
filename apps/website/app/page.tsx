import Image from "next/image";
import { Fragment } from "react";
import { Agents } from "./agents";
import { BrandPlayground } from "./brand-playground";
import { commands } from "./commands";
import { CopyButton } from "./copy-button";
import hero from "./hero.avif";
import heroStill from "./hero-still.webp";
import { links } from "./links";
import { Pillars } from "./pillars";
import { ArrowLink, SectionHeading } from "./section";
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

export default function Home() {
  return (
    <>
      <SiteHeader />
      <main>
        <section
          aria-labelledby="hero-title"
          className="flex flex-col items-center overflow-hidden px-6 pt-6 pb-16 md:pb-24"
        >
          <Stage>
            <div className="stage-frame">
              <Hero className="stage-glow" />
              <Hero className="stage-art" first />
            </div>
            <h1 id="hero-title" className="stage-caption">
              <span className="block">You own the experience.</span>
              <span className="block">Zitadel guards the state.</span>
            </h1>
          </Stage>
          <div className="teaser mt-6 flex max-w-3xl flex-col items-center gap-7">
            <p className="text-pretty text-center text-lg text-text-secondary leading-8">
              The next generation of Zitadel, in developer preview. Registration and login live in
              your app, under your brand; Zitadel guards the credentials, sessions and tokens.
            </p>
            <figure className="flex max-w-full flex-col items-center gap-3">
              <figcaption className="text-center text-sm text-text-muted">
                Try it locally:
              </figcaption>
              <div className="relative max-w-full rounded-2xl border border-border-primary">
                {/* A line too long for a phone wraps between words, never after
                    the hyphens or slashes inside one, and under its command,
                    not its $. The first leaves room for the copy button at its
                    end. */}
                <pre className="whitespace-pre-wrap px-4 py-4 font-mono text-xs leading-6 sm:px-5 sm:text-sm">
                  <code>
                    {commands.map((command) => (
                      <span key={command} className="block pl-[2ch] -indent-[2ch] first:pr-7">
                        <span aria-hidden="true" className="select-none text-text-muted">
                          {"$ "}
                        </span>
                        {command.split(" ").map((word, index) => (
                          // biome-ignore lint/suspicious/noArrayIndexKey: the words of a fixed command, never reordered
                          <Fragment key={index}>
                            {index > 0 && " "}
                            <span className="whitespace-nowrap">{word}</span>
                          </Fragment>
                        ))}
                      </span>
                    ))}
                  </code>
                </pre>
                <CopyButton text={commands.join("\n")} label="Copy the commands" />
              </div>
            </figure>
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

        <Pillars />

        <section aria-labelledby="brand-title" className="px-6 py-16 md:py-24">
          <div className="mx-auto flex max-w-6xl flex-col gap-10">
            <SectionHeading id="brand-title" label="Your brand" title="The login is yours to style">
              The card below is built from @zitadel/components, the same elements your app embeds.
              Pick a colour, the corners and a heading face: it follows the --zl-* custom
              properties, the way your own stylesheet themes it.
            </SectionHeading>
            <BrandPlayground />
            <p className="flex flex-wrap gap-x-8 gap-y-3 text-sm">
              <ArrowLink href={links.customizeDesign}>Customize the design</ArrowLink>
              <ArrowLink href={links.storybook}>Browse every component</ArrowLink>
            </p>
          </div>
        </section>

        <Agents />
      </main>
      <SiteFooter />
    </>
  );
}
