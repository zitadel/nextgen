import type { CSSProperties } from "react";
import { RunWindow, Transcript } from "./blocks";
import { Divider } from "./brand/divider";
import footerLight from "./brand/footer-light.webp";
import { HeroFan } from "./brand/hero-fan";
import { NotchedCard } from "./brand/notched-card";
import { Capabilities } from "./capabilities";
import { type Entry, entryPath, readChangelog } from "./changelog/entries";
import { DATE } from "./changelog/entry";
import { CommandWords } from "./command-line";
import { dryRunCommand, rollbackCommand } from "./commands";
import { StartButtons } from "./cta";
import { worksWith } from "./frameworks";
import { links } from "./links";
import { SENTENCE } from "./message";
import { PHASES, type PhaseSlug, phasePath } from "./phases";
import { PLATFORM } from "./platform";
import { Part, Unbroken } from "./sections";
import { acmeSsoRuns, historyRun, type Run, setupRun } from "./showcase/runs";
import { SiteFooter } from "./site-footer";
import { SiteHeader } from "./site-header";
import { StartWindow } from "./start-window";
import { StructuredData } from "./structured-data";

// The line under the title, from the message house's "Use the agent you
// already have." What Zitadel Next is stays message.ts's sentence.
const LINE = "Use the agent you already have: Claude Code, Cursor, Codex or any other.";

// Whom it serves, the strip under the hero: who it is for as a tag, and what
// it gives them.
const FOR = [
  {
    who: "For your coding agent",
    what: "Set up sign-in with Zitadel's CLI and skills.",
  },
  {
    who: "For your customers",
    what: "Passkeys, single sign-on and organizations, ready when they ask.",
  },
  {
    who: "For the agents you ship",
    what: "Their own identity, acting only with a user's consent.",
  },
];

// The way on from each phase's exchange to its page.
const READ_ABOUT: Record<PhaseSlug, string> = {
  "get-started": "Read about getting started",
  operate: "Read about operating",
  investigate: "Read about investigating",
  govern: "Read about governing",
};

// What stays yours, whatever your agent runs (LICENSING.md for the licenses),
// each with its notched card's label, a word the point already says, and
// what is behind it: the command that does it, or for Named the fields every
// event names who acted with (apps/api/api/openapi/endpoints/events/
// event-base.yaml). Open source has no command to show.
const DECIDE: readonly {
  label: string;
  point: string;
  command?: string;
  fields?: readonly string[];
}[] = [
  {
    label: "Review",
    point: "Every change is a diff you review before it goes live.",
    command: dryRunCommand,
  },
  {
    label: "Named",
    point: "Each change names who made it: a person, or an agent acting for one.",
    fields: ["actor_id", "actor_type", "user_id", "delegation_type"],
  },
  {
    label: "Roll back",
    point: "You can roll back to the release before.",
    command: rollbackCommand,
  },
  {
    label: "Open source",
    point:
      "It's open source: the server under AGPL-3.0, the SDKs under MIT. Run it in our cloud or on your servers.",
  },
];

// What your agent ran for a phase's first ask, where a run was recorded
// (showcase/runs.ts); Investigate and Govern keep their words alone.
const RUNS: Partial<Record<PhaseSlug, readonly Run[]>> = {
  "get-started": [setupRun],
  operate: acmeSsoRuns,
};

// The newest entries the changelog shows on the front page.
const SHIPPED = 3;

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

/**
 * The changelog's newest entries as rows between hairlines, the site's row
 * style (sections.tsx): the day each landed and its title, linking the
 * entry's page. Read when the site builds (changelog/entries.ts), so a new
 * entry reaches the front page with the deploy that brings it.
 */
function Shipped({ entries }: { entries: readonly Entry[] }) {
  return (
    <ul className="w-full border-border-primary border-b">
      {entries.map((entry) => (
        <li key={entry.slug} className="border-border-primary border-t">
          <a
            href={entryPath(entry.slug)}
            className="group grid gap-x-10 gap-y-1 py-5 md:grid-cols-[10rem_minmax(0,1fr)_auto] md:items-center"
          >
            <time dateTime={entry.date} className="font-mono text-text-muted text-xs leading-7">
              {DATE.format(new Date(entry.date))}
            </time>
            <span className="text-balance font-heading text-lg text-text-primary leading-7 tracking-[-0.01em]">
              {entry.title}
            </span>
            <svg
              aria-hidden="true"
              viewBox="0 0 16 16"
              fill="none"
              className="hidden size-4 text-text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-text-primary md:block"
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
        </li>
      ))}
    </ul>
  );
}

// The front page says your agent can do the auth work and shows how
// (AGENTS.md), in the brand's look (app/brand/), one light a screen: whom it
// serves, the asks it takes and how to start, agent first, over the blade
// fan; the work of each phase on a stage of orange light; the features, each
// with a window and its page; what stays yours as a bento of notched cards;
// what shipped last; and the ways to start again over the footer's light.
// The quickstart's walkthrough is /get-started; the questions about Zitadel
// Next as a whole are /llms.txt's (message.ts).
export default function Home() {
  return (
    <>
      <StructuredData />
      <SiteHeader />
      {/* Pulled up under the glass header by its height, so the grain starts
          at the top of the page and reads through the glass. Its own ground,
          so the fan blends with the page's (.hero-fan); the fan is the
          hero's only light. */}
      <main className="brand-noise -mt-16 bg-background pt-16">
        <section
          aria-labelledby="hero-title"
          className="overflow-x-clip px-6 pt-12 pb-16 md:pt-20 lg:pt-24 lg:pb-24"
        >
          {/* The words' column a little wider, so the ways to start keep to
              one row beside the start window at 1440px. */}
          <div className="mx-auto grid max-w-6xl items-center gap-14 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:gap-12">
            <div className="flex min-w-0 flex-col items-center lg:items-start">
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
              <p className="teaser mt-6 max-w-[34rem] text-pretty text-center text-lg text-text-secondary leading-8 lg:text-left">
                <Unbroken text={LINE} />
              </p>
              <StartButtons placement="hero" className="teaser mt-10 lg:justify-start" />
            </div>
            {/* The start window on the blade fan; below a laptop the fan's
                first frame is a soft ground behind it. */}
            <div className="relative flex min-w-0 items-center justify-center py-10 lg:min-h-[36rem] lg:py-0">
              <HeroFan className="pointer-events-none absolute top-1/2 left-1/2 -z-10 aspect-[550/448] w-[135%] max-w-none -translate-x-1/2 -translate-y-1/2 opacity-45 lg:opacity-100" />
              <div className="teaser w-full max-w-[31.5rem]">
                <StartWindow placement="hero" />
                {/* On the page's own ground, so the fan behind never takes
                    the words' contrast. */}
                <p className="mx-auto mt-4 w-fit max-w-full text-balance rounded-lg bg-background/85 px-3 py-1 text-center text-sm text-text-secondary leading-6">
                  {worksWith()}
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Whom it serves, a column each from a tablet up, between hairlines. */}
        <section aria-label="Whom it serves" className="px-6">
          <ul className="mx-auto grid max-w-6xl border-border-primary border-y md:grid-cols-3">
            {FOR.map(({ who, what }) => (
              <li
                key={who}
                className="flex flex-col gap-1 border-border-primary py-6 not-first:border-t md:px-8 md:py-8 md:not-first:border-t-0 md:not-first:border-l md:first:pl-0 md:last:pr-0"
              >
                <span className="font-heading text-text-muted text-xs uppercase leading-5 tracking-[0.08em]">
                  {who}
                </span>
                <span className="text-pretty text-base text-text-secondary leading-7">
                  <Unbroken text={what} />
                </span>
              </li>
            ))}
          </ul>
        </section>

        <Part
          id="the-work"
          title="From first sign-in to the audit, your agent does the work."
          line="One ask, or three commands: from an empty folder to working sign-in in about a minute."
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
                  runs: RUNS[slug],
                  link: { href: phasePath(slug), label: READ_ABOUT[slug] },
                }))}
              />
            </div>
          </div>
        </Part>

        <Part
          id="what-you-get"
          title="Passkeys, SSO, SCIM, OAuth: what your agent can turn on."
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
          title="You stay in charge: review, audit and roll back every change."
          divider={<Divider number="03" tag="You stay in charge" shape="rosette" />}
        >
          {/* A bento: the recorded deployment history across the top on the
              section's one light, wide enough for its table, the four points
              under it as notched cards, each over what is behind it. */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <div className="brand-stage brand-noise flex justify-center rounded-[1.25rem] px-4 py-8 sm:px-8 md:col-span-2 md:py-12 lg:col-span-4">
              <div className="w-full min-w-0 max-w-[44rem]">
                <RunWindow run={historyRun} placement="decide" />
              </div>
            </div>
            {DECIDE.map(({ label, point, command, fields }) => (
              <NotchedCard key={label} label={label}>
                <p className="text-pretty text-lg text-text-primary leading-7">{point}</p>
                {command && (
                  <p className="mt-4 pl-[2ch] -indent-[2ch] font-mono text-[0.6875rem] text-text-primary leading-5">
                    <span aria-hidden="true" className="select-none text-text-muted">
                      ${" "}
                    </span>
                    <CommandWords command={command} />
                  </p>
                )}
                {fields && (
                  <p className="mt-4 font-mono text-[0.6875rem] text-text-muted leading-5">
                    {fields.map((field, index) => (
                      <span key={field}>
                        {index > 0 && " · "}
                        <span className="text-(--zl-shiki-token-keyword)">{field}</span>
                      </span>
                    ))}
                  </p>
                )}
              </NotchedCard>
            ))}
          </div>
        </Part>

        <Part
          id="recently-shipped"
          title="Recently shipped"
          divider={<Divider number="04" tag="Recently shipped" shape="blade" />}
        >
          <div className="flex flex-col items-start gap-8">
            <Shipped entries={readChangelog().entries.slice(0, SHIPPED)} />
            <MoreLink href={links.changelog}>See the changelog</MoreLink>
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
              {/* Balanced, "Self-host it" and "our cloud" never split, so no
                  line starts on a stray word or ends on one. */}
              <span className="display-title">
                <Unbroken text={"Open source. Self-host it or use our cloud."} />
              </span>
            </h2>
            {/* What Zitadel Next is, the message house's sentence, the one
                place the page's text says it (message.ts). */}
            <p className="mt-5 max-w-2xl text-balance text-center text-base text-text-secondary leading-7 md:text-lg md:leading-8">
              {SENTENCE}
            </p>
            <StartButtons placement="closing" talk className="mt-9" />
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
