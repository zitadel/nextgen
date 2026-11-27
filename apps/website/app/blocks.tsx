import type { ReactNode } from "react";
import type { Placement } from "./analytics";
import { CommandLine, Words } from "./command-line";
import { skillsCommand } from "./commands";
import { CopyButton } from "./copy-button";
import type { Exchange } from "./phases";
import { WINDOW_FOOTER, WINDOW_INSET, Window } from "./window";

// What the front page and the phase and feature pages (phase-page.tsx,
// feature-page.tsx) show: in windows, a person asking their agent, the
// changes and events that name who acted, a file and commands to copy as
// numbered steps; the line for coding agents; and the questions with their
// FAQPage data. All in the page's neutral inks: a brand color never marks who
// acted or what is current (AGENTS.md).

export type { Exchange };

/**
 * A person asking their coding agent, and its replies, in a terminal window:
 * each ask at its prompt, the reply under it.
 */
export function Transcript({
  title,
  exchanges,
}: {
  title: string;
  exchanges: readonly Exchange[];
}) {
  return (
    <Window title={title}>
      <ol className={`flex flex-col gap-7 py-6 md:py-8 ${WINDOW_INSET}`}>
        {exchanges.map(({ ask, reply }) => (
          <li key={ask} className="grid grid-cols-[1ch_minmax(0,1fr)] gap-x-3 gap-y-2">
            <span
              aria-hidden="true"
              className="select-none font-mono text-[0.8125rem] text-text-accent leading-6"
            >
              &gt;
            </span>
            <p className="font-mono text-[0.8125rem] text-text-primary leading-6">
              <span className="sr-only">You: </span>
              {ask}
            </p>
            <span
              aria-hidden="true"
              className="mt-2.5 size-1.5 justify-self-center rounded-full bg-text-muted"
            />
            <p className="text-pretty text-sm text-text-secondary leading-6 md:text-base md:leading-7">
              <span className="sr-only">Your agent: </span>
              {reply}
            </p>
          </li>
        ))}
      </ol>
    </Window>
  );
}

export type Change = { change: string; agent: boolean };

/** A change history, each entry naming who made it: you, or your agent acting for you. */
export function ChangeHistory({ changes }: { changes: readonly Change[] }) {
  return (
    <Window title="Change history">
      <ol className="divide-y divide-window-border">
        {changes.map(({ change, agent }) => (
          <li
            key={change}
            className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 py-3.5 ${WINDOW_INSET}`}
          >
            <span className="text-sm text-text-primary leading-6">{change}</span>
            <span className="rounded-full bg-tint/[0.07] px-2.5 font-mono text-text-secondary text-xs leading-6">
              <span className="sr-only">Made by </span>
              {agent ? "Your agent, for you" : "You"}
            </span>
          </li>
        ))}
      </ol>
    </Window>
  );
}

export type Row = { term: string; text: string };

/**
 * Rows of a name in code type beside what it did or means: who acted and
 * what happened, or a field and what it holds.
 */
export function RowList({ title, rows }: { title: string; rows: readonly Row[] }) {
  return (
    <Window title={title}>
      <ol className="divide-y divide-window-border">
        {rows.map(({ term, text }) => (
          <li
            key={`${term} ${text}`}
            className={`grid gap-x-4 gap-y-0.5 py-3.5 sm:grid-cols-[12rem_minmax(0,1fr)] ${WINDOW_INSET}`}
          >
            <span className="font-mono text-text-primary text-xs leading-6">{term}</span>
            <span className="text-sm text-text-secondary leading-6">{text}</span>
          </li>
        ))}
      </ol>
    </Window>
  );
}

/** A file or a JSON document as it stands, in a window titled with where it comes from. */
export function CodeFile({ title, code }: { title: string; code: string }) {
  return (
    <Window title={title}>
      <pre
        className={`overflow-x-auto py-5 font-mono text-text-secondary text-xs leading-5 md:text-[0.8125rem] md:leading-6 ${WINDOW_INSET}`}
      >
        <code>{code}</code>
      </pre>
    </Window>
  );
}

export type Step = { label: string; command: string };

/**
 * Commands as numbered steps, each with what it does and a copy button that
 * always shows; without `numbered`, commands to pick from, each marked with
 * a dot. `copyAll` adds one button in the title bar for a sequence
 * run in order; `note` is the one prerequisite, `footer` a line under the
 * steps, and `placement` where the block sits (analytics.ts).
 */
export function NumberedCommands({
  title,
  steps,
  placement,
  note,
  numbered = true,
  copyAll = false,
  footer,
}: {
  title: string;
  steps: readonly Step[];
  placement: Placement;
  note?: string;
  numbered?: boolean;
  copyAll?: boolean;
  footer?: ReactNode;
}) {
  const List = numbered ? "ol" : "ul";
  return (
    <Window
      title={title}
      end={
        (note || copyAll) && (
          <>
            {note && <span className="font-mono text-text-muted text-xs leading-4">{note}</span>}
            {copyAll && (
              <CopyButton
                text={steps.map(({ command }) => command).join("\n")}
                label="all commands"
                withLabel
                event={{ snippet: "all", placement }}
              />
            )}
          </>
        )
      }
    >
      <List className={`flex flex-col gap-5 py-5 md:py-6 ${WINDOW_INSET}`}>
        {steps.map(({ label, command }, index) => (
          <li key={command} className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-3 gap-y-1">
            {numbered ? (
              <span
                aria-hidden="true"
                className="flex size-6 items-center justify-center rounded-full border border-window-border font-mono text-[0.6875rem] text-text-secondary"
              >
                {index + 1}
              </span>
            ) : (
              <span
                aria-hidden="true"
                className="size-1.5 self-center justify-self-center rounded-full bg-text-muted"
              />
            )}
            <p className="self-center text-sm text-text-primary leading-6">{label}</p>
            <div className="col-start-2 font-mono text-xs leading-6 md:text-[0.8125rem]">
              <CommandLine command={command} placement={placement} pinned />
            </div>
          </li>
        ))}
      </List>
      {footer && <div className={`${WINDOW_FOOTER} px-5 py-2.5`}>{footer}</div>}
    </Window>
  );
}

// The skills command but its last word, and that word, which its copy button
// keeps to.
const SKILLS_HEAD = skillsCommand.slice(0, skillsCommand.lastIndexOf(" "));
const SKILLS_LAST = skillsCommand.slice(skillsCommand.lastIndexOf(" ") + 1);

/**
 * The line for coding agents: the command that gives an agent the Zitadel
 * skills, with its copy button, and what to ask it then. It wraps as text,
 * the copy button kept to the command's last word so that it never starts a
 * line on a phone. `placement` is where the line sits, which a copy reports
 * (analytics.ts).
 */
export function SkillsLine({
  placement,
  className = "",
}: {
  placement: Placement;
  className?: string;
}) {
  return (
    <p className={`text-text-muted leading-6 ${className}`}>
      Using a coding agent? Run{" "}
      <code className="font-mono text-text-secondary">
        <Words text={SKILLS_HEAD} />{" "}
        <span className="whitespace-nowrap">
          {SKILLS_LAST}
          <CopyButton
            text={skillsCommand}
            label="the skills command"
            event={{ snippet: "skills", placement }}
            className="-my-1 ml-1 align-middle"
          />
        </span>
      </code>{" "}
      and ask it to add sign-in.
    </p>
  );
}

export type Question = { question: string; answer: string };

/**
 * The questions as a list, and as FAQPage structured data (schema.org) for
 * search engines. The data is a block of JSON, which runs nothing;
 * csp-adapter.mjs lists its hash with the page's inline scripts all the same.
 * `<` is escaped, so no answer can close it.
 */
export function Questions({ questions }: { questions: readonly Question[] }) {
  const data = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: questions.map(({ question, answer }) => ({
      "@type": "Question",
      name: question,
      acceptedAnswer: { "@type": "Answer", text: answer },
    })),
  }).replace(/</g, "\\u003c");
  return (
    <>
      <dl className="border-border-primary border-b">
        {questions.map(({ question, answer }) => (
          <div
            key={question}
            className="grid gap-2 border-border-primary border-t py-6 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] md:gap-10"
          >
            <dt className="font-semibold text-text-primary leading-7">{question}</dt>
            <dd className="text-text-secondary leading-7">{answer}</dd>
          </div>
        ))}
      </dl>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: data }} />
    </>
  );
}
