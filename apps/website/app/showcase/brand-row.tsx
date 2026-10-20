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
import { RowLayout } from "./row-layout";
import { signInWithPassword } from "./sessions";

// Each chip is at least 24px high, the smallest target WCAG 2.2 asks for.
const CHIP =
  "cursor-pointer rounded-md border px-2.5 py-[3px] font-semibold text-xs leading-4 transition-colors";
const CHIP_ON = "border-border-secondary bg-surface-black-secondary text-text-primary";
const CHIP_OFF = "border-transparent text-text-secondary hover:text-text-primary";

function Control({ label, children }: { label: string; children: ReactNode }) {
  return (
    <fieldset className="flex items-center gap-2">
      <legend className="float-left mr-1 font-semibold text-text-muted text-xs leading-4">
        {label}
      </legend>
      <div className="flex items-center gap-1">{children}</div>
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
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-border-secondary border-b px-5 py-3 md:px-6">
      <Control label="Brand">
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
            custom ? "border-text-primary border-solid" : "border-border-secondary border-dashed"
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

      <Control label="Corners">
        {(Object.keys(CORNERS) as Corners[]).map((corners) => (
          <button
            key={corners}
            type="button"
            aria-pressed={choice.corners === corners}
            onClick={() => change({ corners })}
            className={`${CHIP} ${choice.corners === corners ? CHIP_ON : CHIP_OFF}`}
          >
            {CORNERS[corners].label}
          </button>
        ))}
      </Control>

      <Control label="Heading">
        {(Object.keys(HEADINGS) as Headings[]).map((headings) => (
          <button
            key={headings}
            type="button"
            aria-pressed={choice.headings === headings}
            onClick={() => change({ headings })}
            className={`${CHIP} ${choice.headings === headings ? CHIP_ON : CHIP_OFF}`}
            style={{ fontFamily: HEADINGS[headings].painted ?? HEADINGS[headings].css }}
          >
            {HEADINGS[headings].label}
          </button>
        ))}
      </Control>
    </div>
  );
}

/**
 * The fifth row, live (zitadel/new-website's BrandPlayground): the visitor
 * picks a brand colour, the corners and a heading face; the stylesheet card
 * rewrites its lines, and the sign-in card in the browser frame, the fourth
 * row's result built from the product's own atoms (login-preview.tsx), takes
 * the look. Before shows the card without the stylesheet.
 */
export function BrandRow({ index }: { index: number }) {
  const [choice, setChoice] = useState<BrandChoice>(DEFAULT_CHOICE);
  const [showResult, setShowResult] = useState(true);
  const change = (part: Partial<BrandChoice>) => {
    setChoice((current) => ({ ...current, ...part }));
    setShowResult(true);
  };

  return (
    <RowLayout
      index={index}
      label="Match your brand"
      description="Set the login's design tokens in your own stylesheet. The look follows your app. Try it here."
      artifact={
        <FileCard
          artifact={{ files: [{ path: "app/globals.css", lines: brandLines(choice) }] }}
          showResult={showResult}
          strip={<Controls choice={choice} change={change} />}
          copyText={brandStylesheet(choice)}
        />
      }
      result={
        <BrowserFrame url="localhost:3000/login" showResult={showResult} onToggle={setShowResult}>
          <LoginPreview screen={signInWithPassword} choice={showResult ? choice : undefined} />
        </BrowserFrame>
      }
    />
  );
}
