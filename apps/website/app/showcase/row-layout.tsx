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
 * One step of the showcase (zitadel/new-website's TerminalSessionRow). On
 * wide screens the terminal or the files sit on one side and the heading, the
 * line and the result on the other, sides alternating by step, with the
 * step's number on the spine between them (showcase.tsx). On narrower
 * screens: heading, terminal or files, result.
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
  const number = String(index + 1).padStart(2, "0");
  const hue = HUES[index % HUES.length];

  return (
    <li className="relative grid w-full grid-cols-1 gap-6 xl:grid-cols-2 xl:grid-rows-[auto_1fr] xl:items-start xl:gap-x-16 xl:gap-y-6">
      <span
        aria-hidden="true"
        className="absolute top-0 left-1/2 hidden size-10 -translate-x-1/2 items-center justify-center rounded-full border border-border-secondary bg-background font-semibold text-sm text-text-accent leading-5 xl:flex"
      >
        {number}
      </span>

      <div
        className={`flex flex-col gap-3 xl:row-start-1 ${artifactLeft ? "xl:col-start-2" : "xl:col-start-1"}`}
      >
        <span className="font-semibold text-sm text-text-accent leading-5 xl:hidden">{number}</span>
        <h3 className="font-heading text-2xl leading-8 tracking-[-0.02em] xl:text-[2rem] xl:leading-10">
          {label}
        </h3>
        <p className="text-text-secondary leading-6">
          <Prose text={description} />
        </p>
      </div>

      <div
        className={`relative isolate min-w-0 xl:row-span-2 xl:row-start-1 xl:self-center ${artifactLeft ? "xl:col-start-1" : "xl:col-start-2"}`}
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -inset-x-16 -inset-y-10 -z-10 opacity-20"
          style={{ background: `radial-gradient(ellipse at center, ${hue}, transparent 68%)` }}
        />
        {artifact}
      </div>

      {result && (
        <div
          className={`w-full min-w-0 max-w-[22rem] xl:row-start-2 xl:max-w-none ${artifactLeft ? "xl:col-start-2" : "xl:col-start-1"}`}
        >
          {result}
        </div>
      )}
    </li>
  );
}
