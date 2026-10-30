import "@fontsource/arimo/400.css";
import "@fontsource/arimo/500.css";
import "@fontsource/arimo/600.css";
import "./fonts.css";
import "./freeze-motion";
import "@zitadel/components/atoms";
import "./login-surface.css";

import { THEME_SELECTORS, tokensCss } from "@zitadel/components/tokens";
import { type CSSProperties, type ReactNode, useEffect, useState } from "react";
import { AbsoluteFill, cancelRender, continueRender, delayRender } from "remotion";

// The ground every login shot stands on: the --zl-* properties of one side of
// the design system, set on the scene, and the page background they paint, as
// `<zitadel-login variant="page">` would. The atoms read the properties from
// their ancestors; login-surface.css gives their light-DOM chrome the look
// the orchestrator's layout chrome gives it.

/** The --zl-* declarations of one theme block of the package's stylesheet. */
function themeProperties(selector: string): Record<string, string> {
  const start = tokensCss.indexOf(`${selector} {`);
  const block = start < 0 ? "" : tokensCss.slice(start, tokensCss.indexOf("}", start));
  return Object.fromEntries(
    [...block.matchAll(/(--zl-[\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [name, value]),
  );
}

const DARK = themeProperties(THEME_SELECTORS.dark);
const LIGHT = { ...DARK, ...themeProperties(THEME_SELECTORS.light) };

// The faces as an app's login shows them. The heading token names APK Futural
// first, a licensed face that Zitadel's own sites load and an app does not
// (ADR 025), so an app's headings fall back to Arimo too.
const ARIMO = "Arimo, system-ui, sans-serif";
const FACES = { "--zl-font-family-sans": ARIMO, "--zl-font-family-heading": ARIMO };

// Every frame waits for the faces, so no frame shows a fallback font.
export const fontsLoaded = Promise.all([
  ...["400", "500", "600"].map((weight) => document.fonts.load(`${weight} 16px Arimo`)),
  document.fonts.load('400 16px "APK Futural"'),
]);

/** Holds the frame until the faces have loaded, and fails the render if they cannot. */
export function useFonts() {
  const [handle] = useState(() => delayRender("Loading the fonts"));
  useEffect(() => {
    fontsLoaded.then(
      () => continueRender(handle),
      (error) => cancelRender(new Error(`The fonts did not load: ${error}`)),
    );
  }, [handle]);
}

export function LoginSurface({
  theme = "dark",
  brand,
  children,
}: {
  theme?: "dark" | "light";
  /** --zl-* properties a brand sets over the theme. */
  brand?: Record<string, string>;
  children: ReactNode;
}) {
  useFonts();

  const style = {
    ...(theme === "light" ? LIGHT : DARK),
    ...FACES,
    ...brand,
  } as CSSProperties;
  return (
    <AbsoluteFill className="login-surface" style={style}>
      {children}
    </AbsoluteFill>
  );
}
