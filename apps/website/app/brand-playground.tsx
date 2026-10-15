"use client";

import { Fragment, type ReactNode, useState } from "react";
import { BrandPreview } from "./brand-preview";
import {
  type BrandChoice,
  brandStylesheet,
  COLORS,
  CORNERS,
  type Corners,
  DEFAULT_CHOICE,
  HEADINGS,
  type Headings,
} from "./brand-tokens";
import { CopyButton } from "./copy-button";

const CHIP =
  "cursor-pointer rounded-md border px-2.5 py-1 font-semibold text-xs leading-4 transition-colors";
const CHIP_ON = "border-border-secondary bg-surface-black-secondary text-text-primary";
const CHIP_OFF = "border-transparent text-text-secondary hover:text-text-primary";

function Control({ label, children }: { label: string; children: ReactNode }) {
  return (
    <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <legend className="float-left w-24 font-semibold text-text-muted text-xs">{label}</legend>
      <div className="flex flex-wrap items-center gap-1.5">{children}</div>
    </fieldset>
  );
}

/**
 * The sign-in card of the login, restyled live: the visitor picks a brand
 * colour, the corners and a heading face, the stylesheet beside it says what
 * that amounts to, and the card (brand-preview.tsx), built from the product's
 * own atoms, takes the look.
 */
export function BrandPlayground() {
  const [choice, setChoice] = useState<BrandChoice>(DEFAULT_CHOICE);
  const change = (part: Partial<BrandChoice>) => setChoice((current) => ({ ...current, ...part }));
  const stylesheet = brandStylesheet(choice);
  const custom = !COLORS.some(({ value }) => value === choice.color);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="flex min-w-0 flex-col gap-5 rounded-2xl border border-border-primary p-5 md:p-6">
        <Control label="Brand colour">
          {COLORS.map(({ name, value }) => (
            <button
              key={value}
              type="button"
              aria-label={name}
              aria-pressed={choice.color === value}
              title={name}
              onClick={() => change({ color: value })}
              className={`size-7 cursor-pointer rounded-full border-2 transition-transform ${
                choice.color === value
                  ? "scale-110 border-text-primary"
                  : "border-transparent hover:scale-105"
              }`}
              style={{ background: value }}
            />
          ))}
          <label
            title="Any colour"
            className={`relative flex size-7 cursor-pointer items-center justify-center rounded-full border text-sm text-text-secondary has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-text-primary has-[:focus-visible]:outline-offset-2 hover:text-text-primary ${
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

        <Control label="Headings">
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

        <figure className="mt-auto flex flex-col gap-2">
          <figcaption className="font-semibold text-text-muted text-xs">
            In your app&apos;s stylesheet
          </figcaption>
          <div className="relative rounded-xl border border-border-primary bg-background">
            {/* A declaration too long for the column wraps between words,
                never at a hyphen inside one, and under its value, not under
                the selector, as the commands in the hero do. */}
            <pre className="whitespace-pre-wrap py-4 pr-14 pl-4 font-mono text-xs leading-6 sm:text-[0.8125rem]">
              <code>
                {stylesheet.split("\n").map((line) => (
                  <span
                    key={line}
                    className={line.startsWith(" ") ? "block pl-[4ch] -indent-[2ch]" : "block"}
                  >
                    {line
                      .trim()
                      .split(" ")
                      .map((word, index) => (
                        // biome-ignore lint/suspicious/noArrayIndexKey: the words of one declaration, never reordered
                        <Fragment key={index}>
                          {index > 0 && " "}
                          <span className="whitespace-nowrap">{word}</span>
                        </Fragment>
                      ))}
                  </span>
                ))}
              </code>
            </pre>
            <CopyButton text={stylesheet} label="Copy the stylesheet" />
          </div>
        </figure>
      </div>

      <section
        aria-label="Preview of the sign-in card"
        className="flex overflow-hidden rounded-2xl border border-border-primary"
      >
        <BrandPreview choice={choice} />
      </section>
    </div>
  );
}
