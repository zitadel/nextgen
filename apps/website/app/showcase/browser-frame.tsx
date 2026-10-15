import Image from "next/image";
import type { ReactNode } from "react";
import { GradientBorder, WindowDots } from "../gradient-border";
import type { Picture } from "./types";

const SIZES = "(min-width: 1280px) 30rem, 22rem";
const SWITCH = "cursor-pointer rounded px-2 py-0.5 transition-colors";
const SWITCH_ON = "bg-surface-black-secondary text-text-primary";
const SWITCH_OFF = "text-text-secondary hover:text-text-primary";

/**
 * A browser window around what a row produced (zitadel/new-website's
 * BrowserFrame): the address, and with `onToggle` a Before / After switch.
 * The pictures cross-fade; without a before-picture, a running session shows
 * the address as a placeholder. `children` is live content instead.
 */
export function BrowserFrame({
  url,
  before,
  image,
  showResult,
  onToggle,
  children,
}: {
  url: string;
  before?: Picture;
  image?: Picture;
  showResult: boolean;
  onToggle?: (showResult: boolean) => void;
  children?: ReactNode;
}) {
  const fade = (visible: boolean) =>
    `object-cover transition-opacity duration-500 ${visible ? "opacity-100" : "opacity-0"}`;

  return (
    <GradientBorder className="overflow-hidden">
      <div className="flex items-center gap-3 border-border-secondary border-b py-2.5 pr-3 pl-4">
        <WindowDots />
        <span className="flex h-6 min-w-0 flex-1 items-center justify-center truncate rounded-md bg-surface-black-secondary px-3 font-mono text-[0.6875rem] text-text-secondary leading-4">
          {url}
        </span>
        {onToggle && (
          <fieldset className="flex shrink-0 rounded-md border border-border-secondary p-0.5 font-semibold text-[0.6875rem] leading-4">
            <legend className="sr-only">Before or after the change</legend>
            <button
              type="button"
              aria-pressed={!showResult}
              onClick={() => onToggle(false)}
              className={`${SWITCH} ${showResult ? SWITCH_OFF : SWITCH_ON}`}
            >
              Before
            </button>
            <button
              type="button"
              aria-pressed={showResult}
              onClick={() => onToggle(true)}
              className={`${SWITCH} ${showResult ? SWITCH_ON : SWITCH_OFF}`}
            >
              After
            </button>
          </fieldset>
        )}
      </div>

      {children ?? (
        <div className="relative aspect-square w-full bg-[#0a0a0a]">
          {before ? (
            <Image
              src={before.src}
              alt={before.alt}
              fill
              unoptimized
              sizes={SIZES}
              className={fade(!showResult)}
            />
          ) : (
            <div
              aria-hidden="true"
              className={`absolute inset-0 flex items-center justify-center transition-opacity duration-500 ${showResult ? "opacity-0" : "opacity-100"}`}
            >
              <span className="font-mono text-sm text-text-muted motion-safe:animate-pulse">
                {url}
              </span>
            </div>
          )}
          {image && (
            <Image
              src={image.src}
              alt={image.alt}
              fill
              unoptimized
              sizes={SIZES}
              className={fade(showResult)}
            />
          )}
        </div>
      )}
    </GradientBorder>
  );
}
