import type { Metadata } from "next";
import type { CSSProperties, ReactNode } from "react";
import { type Exchange, type Question, Questions, Transcript } from "./blocks";
import { appPath } from "./commands";
import og from "./og.jpg";
import { PHASES, type PhaseSlug, phaseOf, phasePath } from "./phases";
import { stepColor } from "./showcase/step";
import { SiteFooter } from "./site-footer";
import { SiteHeader } from "./site-header";

/** A phase's color as --step: its place on the stepper's ramp, orange to green. */
export function phaseColor(index: number): CSSProperties {
  return stepColor(index, PHASES.length);
}

/**
 * A phase page's title, description and share card. The share image is the
 * front page's (layout.tsx): a page's openGraph replaces the layout's whole.
 */
export function phaseMetadata(slug: PhaseSlug): Metadata {
  const { phase } = phaseOf(slug);
  const title = `${phase.title.replace(/\.$/, "")} — Zitadel`;
  const { description } = phase;
  return {
    title,
    description,
    openGraph: {
      type: "website",
      siteName: "Zitadel",
      title,
      description,
      images: [{ url: og.src, width: og.width, height: og.height, alt: "Zitadel" }],
    },
    twitter: { card: "summary_large_image", title, description, images: [og.src] },
  };
}

/**
 * What a phase page says beside its title (phases.ts): three asks and their
 * replies; one real thing from the repository under the hood; how review,
 * rollback and naming who acted work here; commands that work now; and
 * three to five questions.
 */
export type PhaseContent = {
  asks: readonly Exchange[];
  hood: { line: ReactNode; artifact: ReactNode };
  decide: { line: ReactNode; block: ReactNode };
  /** `wide` gives the content the page's full width, for the showcase. */
  tryIt: { line?: ReactNode; content: ReactNode; wide?: boolean };
  questions: readonly Question[];
};

const H2 = "font-heading text-2xl leading-8 tracking-[-0.02em] md:text-3xl md:leading-10";

/**
 * One of a phase page's parts: its heading and line over its content, or
 * from a laptop up, with `split`, beside it.
 */
function Part({
  id,
  title,
  line,
  split = false,
  wide = false,
  children,
}: {
  id: string;
  title: string;
  line?: ReactNode;
  split?: boolean;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className="scroll-mt-20 overflow-x-clip px-6 py-12 md:py-16"
    >
      <div
        className={`mx-auto ${wide ? "max-w-6xl" : "max-w-5xl"} ${
          split
            ? "grid items-start gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:gap-14"
            : "flex flex-col gap-8"
        }`}
      >
        <header className="flex max-w-2xl flex-col gap-3">
          <h2 id={`${id}-title`} className={H2}>
            {title}
          </h2>
          {line && <p className="text-pretty text-text-secondary leading-7">{line}</p>}
        </header>
        <div className="min-w-0">{children}</div>
      </div>
    </section>
  );
}

/**
 * A phase page, the same seven parts every time (AGENTS.md): the title and
 * what your agent does, Ask it, Under the hood, You decide, Try it,
 * Questions, and the way on to the phase after it, in that phase's color.
 */
export function PhasePage({ slug, content }: { slug: PhaseSlug; content: PhaseContent }) {
  const { phase, index, next } = phaseOf(slug);
  return (
    <>
      <SiteHeader current={slug} />
      <main style={phaseColor(index)}>
        {/* The light over the top of the page, in the phase's color. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[40rem] bg-[radial-gradient(50%_60%_at_50%_0%,color-mix(in_oklch,var(--step)_12%,transparent),transparent)]"
        />
        <section aria-labelledby="phase-title" className="px-6 pt-12 pb-8 md:pt-24 md:pb-12">
          <div className="mx-auto flex max-w-4xl flex-col items-center text-center">
            <p className="font-mono text-(--step) text-xs leading-4">{phase.name}</p>
            <h1
              id="phase-title"
              className="mt-4 text-balance text-4xl leading-[1.08] tracking-[-0.025em] md:text-6xl"
            >
              <span className="display-title">{phase.title}</span>
            </h1>
            <p className="mt-5 max-w-2xl text-balance text-base text-text-secondary leading-7 md:text-lg md:leading-8">
              {phase.line}
            </p>
          </div>
        </section>

        <Part id="ask-it" title="Ask it">
          <div className="max-w-3xl">
            <Transcript title={appPath} exchanges={content.asks} />
          </div>
        </Part>

        <Part id="under-the-hood" title="Under the hood" line={content.hood.line} split>
          {content.hood.artifact}
        </Part>

        <Part id="you-decide" title="You decide" line={content.decide.line} split>
          {content.decide.block}
        </Part>

        <Part id="try-it" title="Try it" line={content.tryIt.line} wide={content.tryIt.wide}>
          {content.tryIt.content}
        </Part>

        <Part id="questions" title="Questions">
          <Questions questions={content.questions} />
        </Part>

        <nav aria-label="The phase after this one" className="px-6 pt-4 pb-20 md:pb-28">
          <a
            href={phasePath(next.slug)}
            style={phaseColor(PHASES.indexOf(next))}
            className="group mx-auto flex max-w-5xl items-center justify-between gap-6 rounded-2xl border border-window-border bg-window px-6 py-6 shadow-(--window-shadow) transition-colors hover:border-(--step) md:px-8 md:py-7"
          >
            <span className="flex flex-col gap-2">
              <span className="font-mono text-(--step) text-xs leading-4">{next.name}</span>
              <span className="text-balance font-heading text-text-primary text-xl leading-7 md:text-2xl md:leading-8">
                {next.title}
              </span>
            </span>
            <svg
              aria-hidden="true"
              viewBox="0 0 16 16"
              fill="none"
              className="size-5 shrink-0 text-text-secondary transition-transform group-hover:translate-x-0.5 group-hover:text-text-primary"
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
        </nav>
      </main>
      <SiteFooter />
    </>
  );
}
