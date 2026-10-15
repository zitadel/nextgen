"use client";

import { useState } from "react";
import { BrowserFrame } from "./browser-frame";
import { FileCard } from "./file-card";
import { FileTree } from "./file-tree";
import { RowLayout } from "./row-layout";
import { TerminalCard } from "./terminal-card";
import type { Session } from "./types";

/**
 * A recorded step: what a command printed, what setup wrote, or the changed
 * files, beside the result when there is one. Whether the picture shows the
 * result is one state: the frame's switch drives it, and the flow's steps
 * follow it.
 */
export function RecordedRow({ session, index }: { session: Session; index: number }) {
  const [showResult, setShowResult] = useState(true);
  const { artifact, recording, scaffold, result } = session;

  return (
    <RowLayout
      index={index}
      label={session.label}
      description={session.description}
      artifact={
        (artifact && <FileCard artifact={artifact} showResult={showResult} />) ||
        (scaffold && <FileTree scaffold={scaffold} />) ||
        (recording && <TerminalCard recording={recording} />)
      }
      result={
        result && (
          <BrowserFrame
            url={result.url}
            before={result.before}
            image={result.image}
            showResult={showResult}
            onToggle={result.before ? setShowResult : undefined}
          />
        )
      }
    />
  );
}
