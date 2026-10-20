import { type CSSProperties, Fragment, type ReactNode } from "react";

// The rail's width beside the steps from a tablet up; the spine (spine.tsx)
// runs down its middle.
export const RAIL = "md:grid-cols-[2.5rem_minmax(0,1fr)] md:gap-x-8";

/**
 * The `index`th of `count` steps' colour, as --step: its place on the
 * stepper's ramp from orange to green (globals.css), mixed in OKLCH so it
 * warms through yellow rather than greying through brown.
 */
export function stepColor(index: number, count: number): CSSProperties {
  const share = count > 1 ? Math.round((index / (count - 1)) * 100) : 0;
  return {
    "--step": `color-mix(in oklch, var(--color-step-start), var(--color-step-end) ${share}%)`,
  } as CSSProperties;
}

/** A step's anchor on the page, from its label: `#add-a-field`. */
export function stepId(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

/** The text between backticks, a command or a file, as code. */
function Prose({ text }: { text: string }) {
  return text.split("`").map((part, index) =>
    index % 2 === 1 ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: the parts of a fixed sentence, never reordered
      <code key={index} className="font-mono text-[0.875em] text-text-primary">
        {part}
      </code>
    ) : (
      // biome-ignore lint/suspicious/noArrayIndexKey: the parts of a fixed sentence, never reordered
      <Fragment key={index}>{part}</Fragment>
    ),
  );
}

/**
 * Whole sentences, each on a line of its own, so a line never breaks between
 * two of them; within one, the text between backticks as code.
 */
export function Sentences({ text }: { text: string }) {
  return text.split(/(?<=[.!?])\s+/).map((sentence) => (
    <span key={sentence} className="block text-pretty">
      <Prose text={sentence} />
    </span>
  ));
}

/**
 * One step of the showcase (zitadel/new-website's TerminalSessionRow), the
 * same way round every time: its number and heading, the line under it, then
 * the terminal, the files or the diff beside the page they produce, at one
 * height. Its dot sits on the spine, in the rail beside it from a tablet up
 * and in the gutter on a phone, lit in the step's colour once the visitor
 * reaches it (spine.tsx sets data-reached on the step; .step-dot in
 * globals.css).
 */
export function Step({
  index,
  count,
  label,
  description,
  artifact,
  result,
}: {
  index: number;
  count: number;
  label: string;
  description: string;
  artifact: ReactNode;
  result?: ReactNode;
}) {
  const number = String(index + 1).padStart(2, "0");

  return (
    <li
      id={stepId(label)}
      data-step
      style={stepColor(index, count)}
      className={`group/step grid scroll-mt-24 grid-cols-1 ${RAIL}`}
    >
      <div aria-hidden="true" className="relative hidden justify-center pt-0.5 md:flex">
        <span data-dot data-glow className="step-dot relative z-10 size-3" />
      </div>

      <div className="flex min-w-0 flex-col gap-8">
        <header className="relative flex max-w-2xl flex-col gap-3">
          {/* On a phone the dot sits in the gutter, level with the number,
              on the spine there (spine.tsx). */}
          <span
            aria-hidden="true"
            data-dot
            className="step-dot absolute top-1 -left-4 size-2 md:hidden"
          />
          <span className="font-mono text-(--step) text-xs leading-4">Step {number}</span>
          <h2 className="font-heading text-2xl leading-8 tracking-[-0.02em] lg:text-[2rem] lg:leading-10">
            {label}
          </h2>
          <p className="text-text-secondary leading-6">
            <Sentences text={description} />
          </p>
        </header>

        <div className={`grid grid-cols-1 gap-5 ${result ? "lg:grid-cols-2" : ""}`}>
          <div className="min-w-0">{artifact}</div>
          {result && <div className="min-w-0">{result}</div>}
        </div>
      </div>
    </li>
  );
}
