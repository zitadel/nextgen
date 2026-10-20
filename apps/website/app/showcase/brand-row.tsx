"use client";

import { type ReactNode, useState } from "react";
import {
  type BrandChoice,
  brandLines,
  brandStylesheet,
  COLORS,
  CORNERS,
  type Corners,
  DEFAULT_CHOICE,
  HEADINGS,
  type Headings,
} from "./brand-tokens";
import { BrowserFrame } from "./browser-frame";
import { FileCard } from "./file-card";
import { LoginPreview } from "./login-preview";
import { BAR_BUTTON, SEGMENTS, segment, WINDOW_INSET } from "../window";
import { brandStep, loginAfterFlowChange } from "./sessions";
import { Step } from "./step";

/**
 * One row of the controls: its name in a column of its own (4.5rem, the same
 * in every row), then its options, in a segmented track when `segmented`.
 */
function Control({
  label,
  segmented = false,
  children,
}: {
  label: string;
  segmented?: boolean;
  children: ReactNode;
}) {
  return (
    <fieldset className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-x-4">
      {/* A rendered legend would not take its place in the grid. */}
      <legend className="sr-only">{label}</legend>
      <span
        aria-hidden="true"
        className="font-mono text-[0.6875rem] text-text-muted uppercase leading-4 tracking-[0.08em]"
      >
        {label}
      </span>
      <div className={segmented ? `${SEGMENTS} w-fit` : "flex items-center gap-1.5"}>
        {children}
      </div>
    </fieldset>
  );
}

/** The three choices: a brand colour (presets or any colour), the corners, the heading face. */
function Controls({
  choice,
  change,
}: {
  choice: BrandChoice;
  change: (part: Partial<BrandChoice>) => void;
}) {
  const custom = !COLORS.some(({ value }) => value === choice.color);
  return (
    <div className={`flex flex-col gap-2.5 border-window-border border-b py-3.5 ${WINDOW_INSET}`}>
      <Control label="Colour">
        {COLORS.map(({ name, value }) => (
          <button
            key={value}
            type="button"
            aria-label={name}
            aria-pressed={choice.color === value}
            title={name}
            onClick={() => change({ color: value })}
            className={`size-6 cursor-pointer rounded-full border-2 transition-transform ${
              choice.color === value
                ? "scale-110 border-text-primary"
                : "border-transparent hover:scale-105"
            }`}
            style={{ background: value }}
          />
        ))}
        <label
          title="Any colour"
          className={`relative flex size-6 cursor-pointer items-center justify-center rounded-full border text-text-secondary text-xs leading-none has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-text-primary has-[:focus-visible]:outline-offset-2 hover:text-text-primary ${
            custom ? "border-text-primary border-solid" : "border-white/20 border-dashed"
          }`}
          style={custom ? { background: choice.color } : undefined}
        >
          {custom ? "" : "+"}
          <input
            type="color"
            value={choice.color}
            onChange={(event) => change({ color: event.target.value })}
            aria-label="Any brand colour"
            className="absolute inset-0 size-full cursor-pointer opacity-0"
          />
        </label>
      </Control>

      <Control label="Corners" segmented>
        {(Object.keys(CORNERS) as Corners[]).map((corners) => (
          <button
            key={corners}
            type="button"
            aria-pressed={choice.corners === corners}
            onClick={() => change({ corners })}
            className={segment(choice.corners === corners)}
          >
            {CORNERS[corners].label}
          </button>
        ))}
      </Control>

      <Control label="Heading" segmented>
        {(Object.keys(HEADINGS) as Headings[]).map((headings) => (
          <button
            key={headings}
            type="button"
            aria-pressed={choice.headings === headings}
            onClick={() => change({ headings })}
            className={segment(choice.headings === headings)}
            style={{ fontFamily: HEADINGS[headings].painted ?? HEADINGS[headings].css }}
          >
            {HEADINGS[headings].label}
          </button>
        ))}
      </Control>
    </div>
  );
}

/** Shows the login in light or dark, as its `theme` follows the visitor's system. */
function ThemeSwitch({ light, onChange }: { light: boolean; onChange: (light: boolean) => void }) {
  return (
    <button
      type="button"
      aria-pressed={light}
      aria-label="Light mode"
      title={light ? "Show dark mode" : "Show light mode"}
      onClick={() => onChange(!light)}
      className={`${BAR_BUTTON} text-text-muted aria-pressed:text-text-primary`}
    >
      <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className="size-4">
        {light ? (
          <>
            <circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.4" />
            <path
              d="M8 1.5v1.25M8 13.25v1.25M1.5 8h1.25M13.25 8h1.25M3.4 3.4l.9.9M11.7 11.7l.9.9M3.4 12.6l.9-.9M11.7 4.3l.9-.9"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
          </>
        ) : (
          <path
            d="M13.5 9.6A5.75 5.75 0 0 1 6.4 2.5a5.75 5.75 0 1 0 7.1 7.1Z"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
        )}
      </svg>
    </button>
  );
}

/**
 * The fifth step, live (zitadel/new-website's BrandPlayground): the visitor
 * picks a brand colour, the corners and a heading face; the stylesheet card
 * rewrites its lines, and the login in the browser frame, the fourth step's
 * result built from the product's own atoms (login-preview.tsx), takes the
 * look, in dark or light. Before shows it without the stylesheet.
 */
export function BrandRow({ index, count }: { index: number; count: number }) {
  const [choice, setChoice] = useState<BrandChoice>(DEFAULT_CHOICE);
  const [showResult, setShowResult] = useState(true);
  const [light, setLight] = useState(false);
  const [screen, setScreen] = useState(0);
  const { url, screens } = loginAfterFlowChange;
  const change = (part: Partial<BrandChoice>) => {
    setChoice((current) => ({ ...current, ...part }));
    setShowResult(true);
  };

  return (
    <Step
      index={index}
      count={count}
      label={brandStep.label}
      description={brandStep.description}
      artifact={
        <FileCard
          artifact={{ files: [{ path: "app/globals.css", lines: brandLines(choice) }] }}
          showResult={showResult}
          strip={<Controls choice={choice} change={change} />}
          copy={{ text: brandStylesheet(choice), label: "the stylesheet" }}
        />
      }
      result={
        <BrowserFrame
          url={url}
          showResult={showResult}
          onToggle={setShowResult}
          control={<ThemeSwitch light={light} onChange={setLight} />}
        >
          <LoginPreview
            screens={screens}
            index={screen}
            onAdvance={() => setScreen((current) => (current + 1) % screens.length)}
            choice={showResult ? choice : undefined}
            light={light}
          />
        </BrowserFrame>
      }
    />
  );
}
