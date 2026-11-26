import type { Metadata } from "next";
import type { ReactNode } from "react";
import { type Exchange, type Question, Questions, Transcript } from "./blocks";
import { appPath } from "./commands";
import og from "./og.jpg";
import { PHASES, type PhaseSlug, phaseOf, phasePath } from "./phases";
import { Part, TitleBlock, TopLight } from "./sections";
import { SiteFooter } from "./site-footer";
import { SiteHeader } from "./site-header";

/**
 * A page's title, description and share card. The share image is the front
 * page's (layout.tsx): a page's openGraph replaces the layout's whole.
 */
export function pageMetadata(title: string, description: string): Metadata {
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

/** A phase page's metadata: its title as the tag, and its description. */
export function phaseMetadata(slug: PhaseSlug): Metadata {
  const { phase } = phaseOf(slug);
  return pageMetadata(`${phase.title.replace(/\.$/, "")} — Zitadel`, phase.description);
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
  tryIt: { line?: ReactNode; content: ReactNode };
  questions: readonly Question[];
};

/**
 * The four phases as numbered steps joined by hairlines, the page's own the
 * current step and the others links; on a phone the others keep only their
 * number in sight.
 */
function PhaseStepper({ current }: { current: PhaseSlug }) {
  return (
    <nav aria-label="Phases">
      <ol className="flex items-center justify-center">
        {PHASES.map((phase, index) => {
          const here = phase.slug === current;
          const step = (
            <>
              <span
                aria-hidden="true"
                className={`flex size-5 items-center justify-center rounded-full font-mono text-[0.625rem] ${
                  here
                    ? "bg-text-primary text-background"
                    : "border border-window-border text-text-muted"
                }`}
              >
                {index + 1}
              </span>
              <span className={here ? "" : "max-sm:sr-only"}>{phase.short}</span>
            </>
          );
          return (
            <li key={phase.slug} className="flex items-center">
              {index > 0 && (
                <span aria-hidden="true" className="mx-1 h-px w-3 bg-border-secondary sm:w-5" />
              )}
              {here ? (
                <span
                  aria-current="step"
                  className="flex items-center gap-1.5 rounded-full py-1 pr-2.5 pl-1 text-text-primary text-xs leading-4"
                >
                  {step}
                </span>
              ) : (
                <a
                  href={phasePath(phase.slug)}
                  className="flex items-center gap-1.5 rounded-full p-1 text-text-secondary text-xs leading-4 transition-colors hover:bg-tint/[0.05] hover:text-text-primary sm:pr-2.5"
                >
                  {step}
                </a>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/**
 * A phase page, the same seven parts every time (AGENTS.md): the title with
 * the phases' stepper and what your agent does, Ask it, Under the hood, You
 * decide, Try it, Questions, and the way on to the phase after it.
 */
export function PhasePage({ slug, content }: { slug: PhaseSlug; content: PhaseContent }) {
  const { phase, next } = phaseOf(slug);
  return (
    <>
      <TopLight />
      <SiteHeader current={slug} />
      <main>
        <TitleBlock name={phase.name} title={phase.title} line={phase.line}>
          <PhaseStepper current={slug} />
        </TitleBlock>

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

        <Part id="try-it" title="Try it" line={content.tryIt.line}>
          {content.tryIt.content}
        </Part>

        <Part id="questions" title="Questions">
          <Questions questions={content.questions} />
        </Part>

        <nav aria-label="The phase after this one" className="px-6 pt-4 pb-20 md:pb-28">
          <a
            href={phasePath(next.slug)}
            className="group mx-auto flex max-w-5xl items-center justify-between gap-6 rounded-2xl border border-window-border bg-window px-6 py-6 shadow-(--window-shadow) transition-colors hover:border-border-secondary md:px-8 md:py-7"
          >
            <span className="flex flex-col gap-2">
              <span className="font-mono text-text-muted text-xs leading-4">{next.name}</span>
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
