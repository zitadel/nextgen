import type { CSSProperties } from "react";
import { AskTeaser } from "./ask-teaser";
import { ChangeHistory, Transcript } from "./blocks";
import { Divider } from "./brand/divider";
import footerLight from "./brand/footer-light.webp";
import { HeroFan } from "./brand/hero-fan";
import { MeshGlow } from "./brand/mesh-glow";
import { NotchedCard } from "./brand/notched-card";
import { Capabilities } from "./capabilities";
import { StartButtons } from "./cta";
import { HISTORY } from "./get-started/history";
import { PHASES, type PhaseSlug, phasePath } from "./phases";
import { PLATFORM } from "./platform";
import { Part, Unbroken } from "./sections";
import { SiteFooter } from "./site-footer";
import { SiteHeader } from "./site-header";
import { StartWindow } from "./start-window";

// The line under the title: what you ask, and what you keep. What Zitadel
// Next is, in the message house's words, is the site's description
// (message.ts).
const LINE =
  "Ask the agent you already use for passkeys, single sign-on or a new role. It sets them up in your app and in Zitadel, and you review every change before it goes live.";

// The way on from each phase's exchange to its page.
const READ_ABOUT: Record<PhaseSlug, string> = {
  "get-started": "Read about getting started",
  operate: "Read about operating",
  investigate: "Read about investigating",
  govern: "Read about governing",
};

// What stays yours, whatever your agent runs (LICENSING.md for the licenses),
// each with its notched card's label, a word the point already says, and
// where its glow sits.
const DECIDE = [
  {
    label: "Review",
    point: "Every change is a diff you review before it goes live.",
    glow: { x: "85%", y: "10%" },
  },
  {
    label: "Named",
    point: "Each change names who made it: a person, or an agent acting for one.",
    glow: { x: "20%", y: "75%" },
  },
  {
    label: "Roll back",
    point: "You can roll back to the release before.",
    glow: { x: "80%", y: "70%" },
  },
  {
    label: "Open source",
    point:
      "It's open source: the server under AGPL-3.0, the SDKs under MIT. Run it in our cloud or on your servers.",
    glow: { x: "30%", y: "15%" },
  },
];

// The front page's display titles in the brand's one highlight: white at
// the top, orange at the foot, end to end.
const TITLE_COLORS = {
  "--title-from": "var(--color-brand)",
  "--title-to": "var(--color-brand)",
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
// (AGENTS.md), in the brand's look (app/brand/): the asks it takes and how
// to start, agent first, over the blade fan; the work of each phase on a
// stage of orange light; the features, each with a window and its page; what
// stays yours as a bento of notched cards; and the ways to start again over
// the footer's light. The quickstart's walkthrough is /get-started; the
// questions about Zitadel Next as a whole are /llms.txt's (message.ts).
export default function Home() {
  return (
    <>
      <SiteHeader />
      {/* Pulled up under the glass header by its height, so the light and
          the grain start at the top of the page and read through the glass.
          Its own ground, so the fan blends with the page's (.hero-fan). */}
      <main className="brand-noise -mt-16 bg-background pt-16">
        <div
          aria-hidden="true"
          className="brand-light pointer-events-none absolute inset-x-0 top-0 -z-10 h-[60rem]"
        />
        <section
          aria-labelledby="hero-title"
          className="overflow-x-clip px-6 pt-12 pb-16 md:pt-20 lg:pt-24 lg:pb-24"
        >
          <div className="mx-auto grid max-w-6xl items-center gap-14 lg:grid-cols-2 lg:gap-12">
            <div className="flex min-w-0 flex-col items-center lg:items-start">
              {/* The title sets the width; the line under it fills it and
                  wraps inside it (.hero-lede), so the two read as one block. */}
              <div className="grid w-fit max-w-full justify-items-center lg:justify-items-start">
                <h1
                  id="hero-title"
                  style={TITLE_COLORS}
                  className="hero-title lg:text-left lg:text-[3.5rem]"
                >
                  <span className="display-title">
                    The auth platform <br className="max-sm:hidden" />
                    your agent can run.
                  </span>
                </h1>
                <p className="hero-lede teaser mt-5 text-balance text-center text-base text-text-secondary leading-7 md:text-lg md:leading-8 lg:text-left">
                  <Unbroken text={LINE} />
                </p>
              </div>
              <div className="teaser mt-8 flex w-full flex-col items-center gap-7 lg:items-start">
                <AskTeaser start className="w-full max-w-3xl" />
                <StartButtons placement="hero" className="lg:justify-start" />
              </div>
            </div>
            {/* The start window on the blade fan, the fan's light pooled
                under it; below a laptop the fan's first frame is a soft
                ground behind it. */}
            <div className="relative flex min-w-0 items-center justify-center py-10 lg:min-h-[36rem] lg:py-0">
              <HeroFan className="pointer-events-none absolute top-1/2 left-1/2 -z-10 aspect-[550/448] w-[135%] max-w-none -translate-x-1/2 -translate-y-1/2 opacity-45 lg:opacity-100" />
              <div
                aria-hidden="true"
                className="fan-pool pointer-events-none absolute inset-x-[-10%] bottom-[-8%] -z-10 h-1/2"
              />
              <div className="teaser w-full max-w-[31.5rem]">
                <StartWindow placement="hero" />
              </div>
            </div>
          </div>
        </section>

        <Part
          id="the-work"
          title="From first sign-in to the audit, your agent does the work."
          centered
          divider={<Divider number="01" tag="The work" shape="slats" />}
        >
          <div className="brand-stage brand-noise rounded-[2rem] px-4 py-10 sm:px-8 md:px-16 md:py-16">
            <div className="mx-auto max-w-3xl">
              <Transcript
                title="Your agent"
                exchanges={PHASES.map(({ slug, short, asks }) => ({
                  ...asks[0],
                  tag: short,
                  link: { href: phasePath(slug), label: READ_ABOUT[slug] },
                }))}
              />
            </div>
          </div>
        </Part>

        <Part
          id="what-you-get"
          title="What your agent can turn on."
          line="Each piece has its own page with the details."
          divider={<Divider number="02" tag="What you get" shape="sphere" />}
        >
          <div className="flex flex-col items-start gap-8">
            <div className="w-full">
              <Capabilities />
            </div>
            <MoreLink href={PLATFORM.path}>See every feature</MoreLink>
          </div>
        </Part>

        <Part
          id="in-charge"
          title="You stay in charge."
          divider={<Divider number="03" tag="You stay in charge" shape="rosette" />}
        >
          {/* A bento: the change history as the large card, the four points
              around it as notched cards on lilac, purple and pink glows. */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <div className="brand-stage brand-noise flex items-center rounded-[1.25rem] p-4 sm:p-6 md:col-span-2 lg:row-span-2">
              <div className="w-full">
                <ChangeHistory changes={HISTORY} />
              </div>
            </div>
            {DECIDE.map(({ label, point, glow }) => (
              <NotchedCard key={label} label={label} glow={<MeshGlow x={glow.x} y={glow.y} />}>
                <p className="text-pretty text-lg text-text-primary leading-7">{point}</p>
              </NotchedCard>
            ))}
          </div>
        </Part>

        <section
          aria-labelledby="closing-title"
          className="relative isolate overflow-hidden border-border-primary border-t px-6 pt-20 pb-24 md:pt-28 md:pb-32"
        >
          {/* One frame of zitadel/new-website's footer animation
              (Footer_Red.json), its ground keyed out, at the band's edge,
              served from /_next/ like every image here. */}
          <img
            src={footerLight.src}
            width={footerLight.width}
            height={footerLight.height}
            alt=""
            decoding="async"
            loading="lazy"
            className="pointer-events-none absolute top-1/2 right-0 -z-10 h-[125%] w-auto max-w-none -translate-y-1/2 opacity-50 md:opacity-90"
          />
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
