"use client";

import { Fragment, type ReactNode, useEffect, useRef } from "react";
import { CommandLine } from "../command-line";
import { CopyButton } from "../copy-button";
import { BAR_BUTTON, WINDOW_BODY, WINDOW_FOOTER, WINDOW_INSET, Window } from "../window";
import type { Artifact, FileLine, FlowStep } from "./types";

/** Green and red lines on tinted rows, edge to edge, a bar at their start. */
const LINE_CLASSES: Record<FileLine["type"], string> = {
  context: "text-text-secondary",
  added: "bg-diff-added-surface text-diff-added shadow-[inset_2px_0_0_var(--color-diff-added)]",
  removed:
    "bg-diff-removed-surface text-diff-removed shadow-[inset_2px_0_0_var(--color-diff-removed)]",
};

const LINE_MARKS: Record<FileLine["type"], string> = { context: " ", added: "+", removed: "-" };

// A diff's tinted row, edge to edge, its text on the body's padding.
const BLEED = "-mx-5 px-5 md:-mx-6 md:px-6";

/**
 * The steps of the flow, before or after the change, as pills with arrows;
 * `current` is the one the login beside shows. A step that takes over a
 * removed step's field shows it, in the diff's green.
 */
function FlowSteps({
  steps,
  after,
  current,
}: {
  steps: FlowStep[];
  after: boolean;
  current?: number;
}) {
  return (
    <div
      className={`flex flex-wrap items-center gap-2 border-window-border border-b py-3 ${WINDOW_INSET}`}
    >
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
            <span
              aria-current={index === current ? "step" : undefined}
              className={`rounded-md border px-2.5 py-1 font-mono text-xs leading-4 transition-colors duration-300 ${
                index === current
                  ? "border-text-accent/60 bg-text-accent/10 text-text-primary"
                  : "border-window-border bg-white/[0.03] text-text-secondary"
              }`}
            >
              {name}
              {adds && <span className="text-diff-added"> + {adds}</span>}
            </span>
          </Fragment>
        );
      })}
    </div>
  );
}

/** The next command's button: runs it and prints its output. */
function RunButton({ command, onRun }: { command: string; onRun: () => void }) {
  return (
    <button
      type="button"
      data-run
      onClick={onRun}
      aria-label={`Run ${command}`}
      className={`run-hint ${BAR_BUTTON} bg-text-accent/15 text-text-accent hover:bg-text-accent/25`}
    >
      <svg aria-hidden="true" viewBox="0 0 16 16" className="size-3" fill="currentColor">
        <path d="M5 3.5v9a.5.5 0 0 0 .77.42l7-4.5a.5.5 0 0 0 0-.84l-7-4.5A.5.5 0 0 0 5 3.5Z" />
      </svg>
      Run
    </button>
  );
}

/**
 * A step's changed files as an editor window (zitadel/new-website's
 * FileCard): the diff with its added and removed lines; above it a strip that
 * shows what the change means, the flow's steps or the brand playground's
 * controls; below it the commands that publish the change. `ran` of them have
 * run and show their output, `running` is printing; `onRun` runs the next one.
 * `showResult` picks the flow's steps before or after, `current` the one the
 * login shows; `copy` adds a button to the title bar that copies its `text`,
 * named by its `label`. A Run button goes away as its command runs, so the
 * keyboard's focus waits on the commands meanwhile and then moves on to the
 * next Run.
 */
export function FileCard({
  artifact,
  showResult,
  current,
  strip,
  copy,
  ran = artifact.commands?.length ?? 0,
  running,
  onRun,
}: {
  artifact: Artifact;
  showResult: boolean;
  current?: number;
  strip?: ReactNode;
  copy?: { text: string; label: string };
  ran?: number;
  running?: number;
  onRun?: (index: number) => void;
}) {
  const [first] = artifact.files;
  const { graph, commands = [] } = artifact;
  const commandsRef = useRef<HTMLDivElement>(null);
  // A Run was pressed: once its command has run, focus the next Run.
  const refocus = useRef(false);

  useEffect(() => {
    if (!refocus.current || running !== undefined) {
      return;
    }
    refocus.current = false;
    // Only if the focus still waits on the commands: a visitor who moved on
    // meanwhile, or pressed Before, keeps the control they chose.
    if (document.activeElement === commandsRef.current) {
      commandsRef.current?.querySelector<HTMLElement>("[data-run]")?.focus();
    }
  }, [ran, running]);

  return (
    <Window
      className="h-full"
      title={
        <span className="truncate">
          {first?.path}
          {artifact.files.length > 1 && (
            <span className="text-text-muted/70"> +{artifact.files.length - 1}</span>
          )}
        </span>
      }
      end={copy && <CopyButton text={copy.text} label={copy.label} withLabel />}
    >
      {strip}
      {!strip && graph && (
        <FlowSteps
          steps={showResult ? graph.after : graph.before}
          after={showResult}
          current={current}
        />
      )}

      {/* Whole-pixel line heights: a fraction leaves a hairline between the
          tinted rows of a block. */}
      <div className={`flex-1 md:leading-[1.375rem] ${WINDOW_BODY}`}>
        {artifact.files.map((file, fileIndex) => (
          <div key={file.path} className={fileIndex > 0 ? "mt-4" : undefined}>
            {artifact.files.length > 1 && (
              <div className="mb-1.5 font-mono text-[0.6875rem] text-text-muted leading-4">
                {file.path}
              </div>
            )}
            {file.lines.map((line, index) => (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: the lines of a fixed diff, never reordered
                key={index}
                className={`flex gap-3 ${BLEED} ${LINE_CLASSES[line.type]}`}
              >
                <span aria-hidden="true" className="w-2 shrink-0 select-none opacity-60">
                  {LINE_MARKS[line.type]}
                </span>
                <span className="whitespace-pre-wrap break-words">{line.text || " "}</span>
              </div>
            ))}
          </div>
        ))}
      </div>

      {commands.length > 0 && (
        <div
          ref={commandsRef}
          tabIndex={-1}
          className={`flex flex-col gap-1.5 py-3 font-mono text-xs leading-5 md:text-[0.8125rem] ${WINDOW_FOOTER} ${WINDOW_INSET}`}
        >
          {commands.map(({ command, output }, index) => (
            <div key={command} className="flex flex-col">
              <CommandLine
                command={command}
                end={
                  onRun &&
                  index === ran &&
                  running === undefined && (
                    <RunButton
                      command={command}
                      onRun={() => {
                        refocus.current = true;
                        commandsRef.current?.focus();
                        onRun(index);
                      }}
                    />
                  )
                }
              />
              {/* The output holds its place before it prints, so nothing moves. */}
              {output && (
                <div
                  className={`relative whitespace-pre-wrap break-words ${index < ran ? "text-text-secondary" : "invisible"}`}
                >
                  {output}
                  {running === index && (
                    <span className="visible absolute inset-0 text-text-muted">
                      <span aria-hidden="true" className="spinner" /> Running…
                    </span>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Window>
  );
}
