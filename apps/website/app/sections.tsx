import { Fragment, type ReactNode } from "react";

// What the front page, the phase pages (phase-page.tsx) and the feature pages
// (feature-page.tsx) are built from: the light, the display title, sections
// under a heading, and lists set off by hairlines.

/** The front page's light over the top of a page: the accent's purple meeting the finish's green. */
export function TopLight() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[60rem] bg-[radial-gradient(45%_55%_at_28%_0%,color-mix(in_oklch,var(--color-text-accent)_16%,transparent),transparent),radial-gradient(45%_55%_at_74%_0%,color-mix(in_oklch,var(--color-step-end)_9%,transparent),transparent)]"
    />
  );
}

/** Text with each hyphenated word on one line, so a phone never breaks it at "sign-in". */
export function Unbroken({ text }: { text: string }) {
  return text.split(/(\S*-\S*)/).map((part, index) =>
    part.includes("-") ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: the parts of a fixed text, never reordered
      <span key={index} className="whitespace-nowrap">
        {part}
      </span>
    ) : (
      // biome-ignore lint/suspicious/noArrayIndexKey: the parts of a fixed text, never reordered
      <Fragment key={index}>{part}</Fragment>
    ),
  );
}

/**
 * A page's title block, centered: its name in small type, what goes under it
 * (the phases' stepper), the title as the front page sets its own
 * (.hero-title), and the line under it.
 */
export function TitleBlock({
  name,
  title,
  line,
  children,
}: {
  name: string;
  title: string;
  line: string;
  children?: ReactNode;
}) {
  return (
    <section aria-labelledby="page-title" className="px-6 pt-12 pb-8 md:pt-20 md:pb-12">
      <div className="mx-auto flex max-w-4xl flex-col items-center text-center">
        <p className="font-mono text-text-muted text-xs leading-4">{name}</p>
        {children && <div className="mt-5">{children}</div>}
        <h1 id="page-title" className="hero-title mt-8">
          <span className="display-title">
            <Unbroken text={title} />
          </span>
        </h1>
        <p className="mt-5 max-w-2xl text-balance text-base text-text-secondary leading-7 md:text-lg md:leading-8">
          {line}
        </p>
      </div>
    </section>
  );
}

const H2 = "font-heading text-2xl leading-8 tracking-[-0.02em] md:text-3xl md:leading-10";

/**
 * A page's section: its heading and line over its content, or from a laptop
 * up, with `split`, beside it; `wide` gives it the showcase's width.
 */
export function Part({
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

/** Short points, one sentence each, set off by hairlines. */
export function PointList({ points }: { points: readonly string[] }) {
  return (
    <ul className="max-w-3xl border-border-primary border-b">
      {points.map((point) => (
        <li
          key={point}
          className="border-border-primary border-t py-4 text-pretty text-text-primary leading-7"
        >
          {point}
        </li>
      ))}
    </ul>
  );
}

export type TitleRow = { label: string; title: string; line: string; ask?: string; href: string };

/**
 * Pages set off by hairlines, a row each: its name in the steps' small type
 * beside its title, its line and, given one, an ask at its prompt.
 */
export function TitleRows({ rows }: { rows: readonly TitleRow[] }) {
  return (
    <ul className="border-border-primary border-b">
      {rows.map(({ label, title, line, ask, href }) => (
        <li key={href} className="border-border-primary border-t">
          <a
            href={href}
            className="group grid gap-x-10 gap-y-2 py-6 md:grid-cols-[10rem_minmax(0,1fr)_auto]"
          >
            <span className="font-mono text-text-muted text-xs leading-7">{label}</span>
            <span className="flex flex-col gap-1">
              <span className="text-balance font-heading text-text-primary text-xl leading-7">
                <Unbroken text={title} />
              </span>
              <span className="text-pretty text-text-secondary leading-7 transition-colors group-hover:text-text-primary">
                {line}
              </span>
              {ask && (
                <span className="mt-1 flex gap-2 font-mono text-[0.8125rem] text-text-primary leading-6">
                  <span aria-hidden="true" className="select-none text-text-accent">
                    &gt;
                  </span>
                  <span>
                    <Unbroken text={ask} />
                  </span>
                </span>
              )}
            </span>
            <svg
              aria-hidden="true"
              viewBox="0 0 16 16"
              fill="none"
              className="mt-1.5 hidden size-4 text-text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-text-primary md:block"
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

export type LinkRow = { name: string; line: string; href: string };

/** Links set off by hairlines: each a name, the line of the page it opens, and an arrow. */
export function LinkRows({ rows }: { rows: readonly LinkRow[] }) {
  return (
    <ul className="border-border-primary border-b">
      {rows.map(({ name, line, href }) => (
        <li key={href} className="border-border-primary border-t">
          <a
            href={href}
            className="group grid gap-x-10 gap-y-1 py-5 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto] md:items-center"
          >
            <span className="font-semibold text-text-primary leading-7">{name}</span>
            <span className="text-text-secondary leading-7 transition-colors group-hover:text-text-primary">
              {line}
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
