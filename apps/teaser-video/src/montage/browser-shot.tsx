import type { ReactNode } from "react";
import { useRef } from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";

import { type Brand, brandProperties } from "../brands";
import { handheld, push } from "../camera";
import { BrowserWindow, Wallpaper } from "../desktop";
import { LoginSurface } from "../login-surface";
import { useAtomsRendered } from "./shot";

// A screen of the login as it is used: in the app's page, in a browser on a
// desktop, the camera pushing in and drifting as if held.

/** How much larger than on a page the login is shown inside the browser. */
const PAGE_SCALE = 1.3;

export function BrowserShot({
  brand,
  url,
  title,
  length,
  seed,
  render,
}: {
  brand: Brand;
  url: string;
  title: string;
  length: number;
  seed: number;
  /** The page `frame` frames in. */
  render: (frame: number) => ReactNode;
}) {
  const frame = useCurrentFrame();
  const page = useRef<HTMLDivElement>(null);
  useAtomsRendered(page, frame);
  return (
    <LoginSurface theme={brand.theme} brand={brandProperties(brand)}>
      <Wallpaper />
      <AbsoluteFill
        style={{
          alignItems: "center",
          justifyContent: "center",
          transform: `${handheld(frame, seed)} scale(${push(frame, length, 0.05)})`,
        }}
      >
        <BrowserWindow url={url} title={title} theme={brand.theme} width={1560} height={920}>
          <div
            ref={page}
            style={{
              position: "absolute",
              inset: 0,
              display: "grid",
              placeItems: "center",
              background: "var(--zl-background)",
            }}
          >
            <div style={{ transform: `scale(${PAGE_SCALE})` }}>{render(frame)}</div>
          </div>
        </BrowserWindow>
      </AbsoluteFill>
    </LoginSurface>
  );
}
