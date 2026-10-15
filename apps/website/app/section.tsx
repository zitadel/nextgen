import type { ReactNode } from "react";

// The opening of every section under the hero: a short label in the accent
// colour, the title, a sentence or two.
export function SectionHeading({
  id,
  label,
  title,
  children,
}: {
  id: string;
  label: string;
  title: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex max-w-2xl flex-col gap-3">
      <p className="font-semibold text-sm text-text-accent">{label}</p>
      <h2
        id={id}
        className="text-balance font-heading text-[2rem] leading-10 tracking-[-0.02em] md:text-[2.5rem] md:leading-[3rem]"
      >
        {title}
      </h2>
      {children && (
        <p className="text-pretty text-base text-text-secondary leading-7 md:text-lg md:leading-8">
          {children}
        </p>
      )}
    </div>
  );
}

// A link with an arrow, to the docs or another site: a plain <a> (links.ts).
export function ArrowLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      className="group inline-flex items-center gap-1.5 rounded-sm font-semibold text-text-primary transition-colors hover:text-text-secondary"
    >
      {children}
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        className="size-4 transition-transform group-hover:translate-x-0.5"
      >
        <path
          d="M5 12h14M13 6l6 6-6 6"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </a>
  );
}
