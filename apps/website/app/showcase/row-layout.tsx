import { Fragment, type ReactNode } from "react";

/** A faint glow behind each row's card, one hue per step from the design system's gradient palette. */
const HUES = ["#bba5e4", "#9066da", "#ea8aa0", "#f25543"];

/** The description's text between backticks, a command or a file, as code. */
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
 * One step of the showcase (zitadel/new-website's TerminalSessionRow). From
 * laptop width the heading and its line sit on one side, sides alternating by
 * step, with the step's number on the spine beside them (showcase.tsx); under
 * them the terminal or the files and the result stand side by side, their
 * title bars on one line. A step without a result centres its terminal
 * against the heading instead. Narrower, one column as wide as a card reads
 * well: heading, terminal or files, result.
 */
export function RowLayout({
  index,
  label,
  description,
  artifact,
  result,
}: {
  index: number;
  label: string;
  description: string;
  artifact: ReactNode;
  result?: ReactNode;
}) {
  const artifactLeft = index % 2 === 0;
  const artifactSide = artifactLeft ? "lg:col-start-1" : "lg:col-start-2";
  const textSide = artifactLeft ? "lg:col-start-2" : "lg:col-start-1";
  const number = String(index + 1).padStart(2, "0");
  const hue = HUES[index % HUES.length];

  return (
    <li className="relative mx-auto grid w-full max-w-2xl grid-cols-1 gap-6 lg:max-w-none lg:grid-cols-2 lg:grid-rows-[auto_1fr] lg:items-start lg:gap-x-16 lg:gap-y-8">
      <span
        aria-hidden="true"
        className="absolute top-0 left-1/2 hidden size-10 -translate-x-1/2 items-center justify-center rounded-full border border-border-secondary bg-background font-semibold text-sm text-text-accent leading-5 lg:flex"
      >
        {number}
      </span>

      <div className={`flex flex-col gap-3 lg:row-start-1 ${textSide}`}>
        <span className="font-semibold text-sm text-text-accent leading-5 lg:hidden">{number}</span>
        <h3 className="font-heading text-2xl leading-8 tracking-[-0.02em] lg:text-[2rem] lg:leading-10">
          {label}
        </h3>
        <p className="text-text-secondary leading-6">
          <Prose text={description} />
        </p>
      </div>

      <div
        className={`relative isolate min-w-0 ${result ? "lg:row-start-2" : "lg:row-span-2 lg:row-start-1 lg:self-center"} ${artifactSide}`}
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -inset-x-16 -inset-y-10 -z-10 opacity-20"
          style={{ background: `radial-gradient(ellipse at center, ${hue}, transparent 68%)` }}
        />
        {artifact}
      </div>

      {result && <div className={`min-w-0 lg:row-start-2 ${textSide}`}>{result}</div>}
    </li>
  );
}
