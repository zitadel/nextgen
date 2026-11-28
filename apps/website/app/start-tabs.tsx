"use client";

import { type KeyboardEvent, type ReactNode, useId, useRef, useState } from "react";
import { type Placement, type Snippet, type Tab, trackEvent } from "./analytics";
import { CopyButton } from "./copy-button";
import { SEGMENTS, segment, WINDOW_INSET, Window } from "./window";

/** A tab of the start window: its name, and what its copy button copies. */
export type StartTab = {
  id: Tab;
  label: string;
  copy: { text: string; label: string; snippet: Snippet };
};

/**
 * The start window's tabs (start-window.tsx), each over its panel, which the
 * server renders, so its commands come coloured and no highlighting runs
 * here. The tabs follow the tab pattern: the arrow keys, Home and End move
 * between them. Both panels are in the page; choosing one reports
 * `selected_tab` with `placement` (analytics.ts).
 */
export function StartTabs({
  title,
  note,
  tabs,
  panels,
  placement,
}: {
  title: string;
  note: string;
  tabs: readonly StartTab[];
  panels: readonly ReactNode[];
  placement: Placement;
}) {
  const [active, setActive] = useState(0);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const id = useId();
  const current = tabs[active] ?? tabs[0];

  const choose = (index: number, focus = false) => {
    const tab = tabs[index];
    if (!tab) {
      return;
    }
    if (index !== active) {
      setActive(index);
      trackEvent("selected_tab", { tab: tab.id, placement });
    }
    if (focus) {
      buttons.current[index]?.focus();
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const last = tabs.length - 1;
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
      title={title}
      end={
        <>
          <span className="font-mono text-text-muted text-xs leading-4">{note}</span>
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
          {tabs.map((tab, index) => (
            <button
              key={tab.id}
              ref={(button) => {
                buttons.current[index] = button;
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
      {tabs.map((tab, index) => (
        <div
          key={tab.id}
          role="tabpanel"
          id={`${id}-panel-${tab.id}`}
          aria-labelledby={`${id}-tab-${tab.id}`}
          hidden={index !== active}
        >
          {panels[index]}
        </div>
      ))}
    </Window>
  );
}
