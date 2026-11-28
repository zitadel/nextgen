"use client";

import { type KeyboardEvent, useId, useRef, useState } from "react";
import { type Placement, type Snippet, type Tab, trackEvent } from "./analytics";
import { type Step, StepList } from "./blocks";
import { agentQuickstart, appPath, quickstart, skillsCommand } from "./commands";
import { CopyButton } from "./copy-button";
import { SEGMENTS, segment, WINDOW_INSET, Window } from "./window";

// The two ways to start (commands.ts), your agent's first. Copy takes the
// tab's commands: with your agent the skills command alone, since the ask
// goes to the agent and not to the shell.
const TABS: readonly {
  id: Tab;
  label: string;
  steps: readonly Step[];
  copy: { text: string; label: string; snippet: Snippet };
}[] = [
  {
    id: "with_agent",
    label: "With your agent",
    steps: agentQuickstart,
    copy: { text: skillsCommand, label: "the skills command", snippet: "skills" },
  },
  {
    id: "in_terminal",
    label: "In your terminal",
    steps: quickstart,
    copy: {
      text: quickstart.map(({ command }) => command).join("\n"),
      label: "all commands",
      snippet: "all",
    },
  },
];

/**
 * The hero's start window: the app's folder, the one prerequisite and a copy
 * button over two tabs, with your agent (its skills, then the ask) and in
 * your terminal (the quickstart's commands), each as numbered steps
 * (StepList). The tabs follow the tab pattern: the arrow keys, Home and End
 * move between them. Both panels are in the page; choosing one reports
 * `selected_tab` with `placement` (analytics.ts).
 */
export function StartWindow({ placement }: { placement: Placement }) {
  const [active, setActive] = useState(0);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const id = useId();
  const current = TABS[active] ?? TABS[0];

  const choose = (index: number, focus = false) => {
    const tab = TABS[index];
    if (!tab) {
      return;
    }
    if (index !== active) {
      setActive(index);
      trackEvent("selected_tab", { tab: tab.id, placement });
    }
    if (focus) {
      tabs.current[index]?.focus();
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const last = TABS.length - 1;
    const next = {
      ArrowRight: active === last ? 0 : active + 1,
      ArrowLeft: active === 0 ? last : active - 1,
      Home: 0,
      End: last,
    }[event.key];
    if (next !== undefined) {
      event.preventDefault();
      choose(next, true);
    }
  };

  return (
    <Window
      title={appPath}
      end={
        <>
          <span className="font-mono text-text-muted text-xs leading-4">Node 24+</span>
          {current && (
            <CopyButton
              text={current.copy.text}
              label={current.copy.label}
              withLabel
              event={{ snippet: current.copy.snippet, placement }}
            />
          )}
        </>
      }
    >
      <div className={`border-window-border border-b py-2.5 ${WINDOW_INSET}`}>
        <div role="tablist" aria-label="How to start" className={`${SEGMENTS} w-fit`}>
          {TABS.map((tab, index) => (
            <button
              key={tab.id}
              ref={(button) => {
                tabs.current[index] = button;
              }}
              type="button"
              role="tab"
              id={`${id}-tab-${tab.id}`}
              aria-selected={index === active}
              aria-controls={`${id}-panel-${tab.id}`}
              tabIndex={index === active ? 0 : -1}
              onClick={() => choose(index)}
              onKeyDown={onKeyDown}
              className={segment(index === active)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>
      {TABS.map((tab, index) => (
        <div
          key={tab.id}
          role="tabpanel"
          id={`${id}-panel-${tab.id}`}
          aria-labelledby={`${id}-tab-${tab.id}`}
          hidden={index !== active}
        >
          <StepList steps={tab.steps} placement={placement} />
        </div>
      ))}
    </Window>
  );
}
