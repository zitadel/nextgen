"use client";

import { useState } from "react";
import { BrowserFrame } from "./browser-frame";
import { FileCard } from "./file-card";
import { RowLayout } from "./row-layout";
import { TerminalReplay } from "./terminal-replay";
import type { Session } from "./types";

/**
 * A recorded row: the replaying terminal or the changed files beside the
 * result. Whether the picture shows the result is one state: the terminal's
 * replay drives it, and so do the frame's switch and the flow's steps.
 */
export function RecordedRow({ session, index }: { session: Session; index: number }) {
  const [showResult, setShowResult] = useState(true);
  const { artifact, recording, result } = session;

  return (
    <RowLayout
      index={index}
      label={session.label}
      description={session.description}
      artifact={
        artifact ? (
          <FileCard artifact={artifact} showResult={showResult} />
        ) : (
          recording && <TerminalReplay recording={recording} onDoneChange={setShowResult} />
        )
      }
      result={
        <BrowserFrame
          url={result.url}
          before={result.before}
          image={result.image}
          showResult={showResult}
          onToggle={result.before ? setShowResult : undefined}
        />
      }
    />
  );
}
