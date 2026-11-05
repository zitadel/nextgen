"use client";

import { useEffect, useRef, useState } from "react";
import { BrowserFrame } from "./browser-frame";
import { FileCard } from "./file-card";
import { FileTree } from "./file-tree";
import { LoginPreview } from "./login-preview";
import { prefersReducedMotion } from "./motion";
import { Step } from "./step";
import { TerminalCard } from "./terminal-card";
import type { Session } from "./types";

// How long a command seems to take before its output prints.
const RUN_MS = 700;

/**
 * A recorded step: what a command printed, what setup wrote, or the changed
 * files, beside the result when there is one, the login's page, live.
 *
 * - A step with commands starts before the change once it hydrates (before
 *   that, and without script, it shows the change made): the visitor runs
 *   them, and the page shows the change once the last has run. The page's
 *   Before / After switch sets how many have run, so the two always agree.
 * - The visitor walks the page's flow with its action; the flow's steps above
 *   the diff follow, and a switch or a new page starts it over.
 * - Setup's pages open from the file list.
 */
export function RecordedRow({
  session,
  index,
  count,
}: {
  session: Session;
  index: number;
  count: number;
}) {
  const { artifact, recording, scaffold, result } = session;
  const commands = artifact?.commands ?? [];
  const [ran, setRan] = useState(commands.length);
  const [running, setRunning] = useState<number>();
  const [screen, setScreen] = useState(0);
  const [open, setOpen] = useState(scaffold?.entries.find((entry) => entry.page)?.path);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const showResult = ran === commands.length;

  useEffect(() => {
    setRan(0);
    return () => clearTimeout(timer.current);
  }, []);

  const runTo = (count: number) => {
    clearTimeout(timer.current);
    setRunning(undefined);
    setRan(count);
    setScreen(0);
  };

  const run = (command: number) => {
    if (prefersReducedMotion()) {
      runTo(command + 1);
      return;
    }
    setRunning(command);
    timer.current = setTimeout(() => runTo(command + 1), RUN_MS);
  };

  const page = scaffold?.entries.find((entry) => entry.path === open)?.page ?? result;
  const screens = page?.screens ?? [];
  const before = result?.before;
  const flowLength = showResult || !before ? screens.length : before.length;

  return (
    <Step
      index={index}
      count={count}
      label={session.label}
      description={session.description}
      artifact={
        (artifact && (
          <FileCard
            artifact={artifact}
            showResult={showResult}
            current={screen}
            ran={ran}
            running={running}
            onRun={run}
          />
        )) ||
        (scaffold && (
          <FileTree
            scaffold={scaffold}
            open={open}
            onOpen={(path) => {
              setOpen(path);
              setScreen(0);
            }}
          />
        )) ||
        (recording && <TerminalCard recording={recording} />)
      }
      result={
        page && (
          <BrowserFrame
            url={page.url}
            showResult={showResult}
            onToggle={before ? (after) => runTo(after ? commands.length : 0) : undefined}
          >
            <LoginPreview
              screens={screens}
              before={before}
              showResult={showResult}
              index={screen}
              onAdvance={() => setScreen((current) => (current + 1) % flowLength)}
            />
          </BrowserFrame>
        )
      }
    />
  );
}
