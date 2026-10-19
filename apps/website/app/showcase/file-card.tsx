import { Fragment, type ReactNode } from "react";
import { LINE_COPY } from "../command-block";
import { CopyButton } from "../copy-button";
import { GradientBorder, TITLE_BAR, WindowDots } from "../gradient-border";
import type { Artifact, FileLine, FlowStep } from "./types";

/** Green and red lines on tinted rows. */
const LINE_CLASSES: Record<FileLine["type"], string> = {
  context: "text-text-secondary",
  added: "bg-[rgba(34,197,94,0.08)] text-[#86efac]",
  removed: "bg-[rgba(248,113,113,0.08)] text-[#f87171]",
};

const LINE_MARKS: Record<FileLine["type"], string> = { context: " ", added: "+", removed: "-" };

/**
 * Lines added or removed together read as one block: only its first line
 * rounds its top and only its last its bottom, so no seam runs between them.
 */
function runCorners(lines: FileLine[], index: number): string {
  const type = lines[index]?.type;
  if (!type || type === "context") {
    return "";
  }
  const first = lines[index - 1]?.type !== type;
  const last = lines[index + 1]?.type !== type;
  return `${first ? "rounded-t" : ""} ${last ? "rounded-b" : ""}`;
}

/**
 * The steps of the flow, before or after the change, as pills with arrows. A
 * step that takes over a removed step's field shows it, in the diff's green.
 */
function FlowSteps({ steps, after }: { steps: FlowStep[]; after: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-border-secondary border-b px-5 py-3 md:px-6">
      <span className="mr-1 w-12 font-semibold text-[0.6875rem] text-text-muted leading-4">
        {after ? "After" : "Before"}
      </span>
      {steps.map((step, index) => {
        const { name, adds } = typeof step === "string" ? { name: step, adds: undefined } : step;
        return (
          <Fragment key={name}>
            {index > 0 && (
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                fill="none"
                className="size-3.5 shrink-0 text-text-muted"
              >
                <path
                  d="M5 12h14M13 6l6 6-6 6"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            )}
            <span className="rounded-md border border-border-secondary bg-surface-black-secondary px-2.5 py-1 font-mono text-text-primary text-xs leading-4">
              {name}
              {adds && <span className="text-[#86efac]"> + {adds}</span>}
            </span>
          </Fragment>
        );
      })}
    </div>
  );
}

/**
 * A row's changed files as an editor card (zitadel/new-website's FileCard):
 * the diff with its added and removed lines; above it a strip that shows what
 * the change means, the flow's steps or the controls of the brand playground;
 * below it the commands that publish the change, each with its line of output.
 * `showResult` picks the flow's steps before or after; `copyText` adds a copy
 * button to the title bar.
 */
export function FileCard({
  artifact,
  showResult,
  strip,
  copyText,
}: {
  artifact: Artifact;
  showResult: boolean;
  strip?: ReactNode;
  copyText?: string;
}) {
  const [first] = artifact.files;
  const { graph } = artifact;

  return (
    <GradientBorder className="overflow-hidden">
      <div className={`${TITLE_BAR} gap-3 pr-3 pl-5`}>
        <WindowDots />
        <span className="min-w-0 flex-1 truncate font-mono text-text-secondary text-xs leading-4">
          {first?.path}
          {artifact.files.length > 1 && (
            <span className="text-text-muted"> +{artifact.files.length - 1}</span>
          )}
        </span>
        {copyText && <CopyButton text={copyText} label="the stylesheet" withLabel />}
      </div>

      {strip}
      {!strip && graph && (
        <FlowSteps steps={showResult ? graph.after : graph.before} after={showResult} />
      )}

      {/* Whole-pixel line heights: a fraction leaves a hairline between the
          tinted rows of a block. */}
      <div className="px-5 py-4 font-mono text-xs leading-5 md:px-6 md:py-5 md:text-[0.8125rem] md:leading-[1.375rem]">
        {artifact.files.map((file, fileIndex) => (
          <div key={file.path} className={fileIndex > 0 ? "mt-4" : undefined}>
            {artifact.files.length > 1 && (
              <div className="mb-1 font-mono text-[0.6875rem] text-text-muted leading-4">
                {file.path}
              </div>
            )}
            {file.lines.map((line, index) => (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: the lines of a fixed diff, never reordered
                key={index}
                className={`-mx-2 flex gap-2 px-2 ${runCorners(file.lines, index)} ${LINE_CLASSES[line.type]}`}
              >
                <span aria-hidden="true" className="w-3 shrink-0 select-none text-right opacity-70">
                  {LINE_MARKS[line.type]}
                </span>
                <span className="whitespace-pre-wrap break-words">{line.text || " "}</span>
              </div>
            ))}
          </div>
        ))}
      </div>

      {artifact.commands && artifact.commands.length > 0 && (
        <div className="flex flex-col gap-1 border-border-secondary border-t px-5 py-3 font-mono text-xs leading-5 md:px-6 md:text-[0.8125rem]">
          {artifact.commands.map(({ command, output }) => (
            <div key={command} className="flex flex-col">
              <div className="group -mx-2 flex items-start gap-2 rounded px-2 transition-colors hover:bg-surface-black-secondary">
                <span className="flex-1 whitespace-pre-wrap break-words text-text-primary">
                  <span className="select-none text-text-accent">$ </span>
                  {command}
                </span>
                <CopyButton text={command} label="the command" className={LINE_COPY} />
              </div>
              {output && (
                <div className="whitespace-pre-wrap break-words text-text-secondary">{output}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </GradientBorder>
  );
}
