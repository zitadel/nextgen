import type { ReactNode } from "react";

import { HEIGHT, WIDTH } from "../timeline";

// An app the login is embedded in: its header, a glimpse of its pages behind,
// and the login centred in front, either on the app's own sign-in page or as
// a dialog over the app, dimmed. Everything paints with the --zl-* properties
// of the app's brand, so the login and its app read as one product. The apps
// are invented, so the video shows how far the login bends without showing
// anyone's real product.

export type App = {
  name: string;
  /** The links in the app's header. */
  nav: string[];
  /** A sign-in page of its own, or a dialog over the app's pages. */
  layout: "page" | "dialog";
  /** The line the page leads with, behind the login. */
  tagline: string;
};

/** How much larger than on a page the login is shown, in front of its app. */
const LOGIN_SCALE = 1.6;

const faint = (share: number) => `color-mix(in srgb, var(--zl-foreground) ${share}%, transparent)`;

function Mark({ name }: { name: string }) {
  return (
    <div
      style={{
        width: 40,
        height: 40,
        borderRadius: "var(--zl-radius-md)",
        background: "var(--zl-primary)",
        color: "var(--zl-primary-foreground)",
        display: "grid",
        placeItems: "center",
        fontFamily: "var(--zl-font-family-heading)",
        fontSize: 22,
        fontWeight: 600,
      }}
    >
      {name.charAt(0)}
    </div>
  );
}

/** Rows of the app's content, drawn as faint blocks: enough to read as a product, never as copy. */
function Pages() {
  const tiles = [0, 1, 2];
  return (
    <div
      style={{
        position: "absolute",
        top: 240,
        left: 120,
        right: 120,
        display: "grid",
        gridTemplateColumns: "repeat(3, 1fr)",
        gap: 32,
      }}
    >
      {tiles.map((tile) => (
        <div
          key={tile}
          style={{
            height: 300,
            borderRadius: "var(--zl-radius-xl)",
            background: faint(5),
            border: `1px solid ${faint(8)}`,
            padding: 32,
            display: "flex",
            flexDirection: "column",
            gap: 18,
          }}
        >
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: "var(--zl-radius-md)",
              background: "color-mix(in srgb, var(--zl-primary) 35%, transparent)",
            }}
          />
          <div style={{ width: "70%", height: 18, borderRadius: 9, background: faint(16) }} />
          <div style={{ width: "90%", height: 14, borderRadius: 7, background: faint(9) }} />
          <div style={{ width: "55%", height: 14, borderRadius: 7, background: faint(9) }} />
        </div>
      ))}
    </div>
  );
}

function Header({ app }: { app: App }) {
  return (
    <header
      style={{
        position: "relative",
        height: 96,
        display: "flex",
        alignItems: "center",
        gap: 48,
        padding: "0 64px",
        borderBottom: `1px solid ${faint(10)}`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <Mark name={app.name} />
        <span
          style={{
            fontFamily: "var(--zl-font-family-heading)",
            fontSize: 26,
            fontWeight: 600,
          }}
        >
          {app.name}
        </span>
      </div>
      <nav style={{ display: "flex", gap: 36, fontSize: 19, color: faint(65) }}>
        {app.nav.map((link) => (
          <span key={link}>{link}</span>
        ))}
      </nav>
    </header>
  );
}

export function AppFrame({ app, children }: { app: App; children: ReactNode }) {
  const dialog = app.layout === "dialog";
  // The app's pages behind the login: out of focus and dimmed under a dialog;
  // faded under the app's own sign-in page, whose header stays sharp. The
  // blur is a filter on the pages themselves, slightly enlarged so its soft
  // border stays outside the frame (a backdrop filter mirrors the frame's
  // edges into it).
  const behind = (
    <div
      style={{
        position: "absolute",
        inset: 0,
        filter: `blur(${dialog ? 8 : 3}px)`,
        transform: "scale(1.04)",
        opacity: dialog ? 1 : 0.5,
      }}
    >
      {dialog && <Header app={app} />}
      <div
        style={{
          position: "absolute",
          top: 140,
          left: 120,
          fontFamily: "var(--zl-font-family-heading)",
          fontSize: 56,
          fontWeight: 600,
        }}
      >
        {app.tagline}
      </div>
      <Pages />
    </div>
  );
  return (
    <div
      style={{
        position: "relative",
        width: WIDTH,
        height: HEIGHT,
        overflow: "hidden",
        color: "var(--zl-foreground)",
        background: dialog
          ? "var(--zl-background)"
          : "radial-gradient(120% 90% at 50% 115%, color-mix(in srgb, var(--zl-primary) 28%, var(--zl-background)), var(--zl-background) 62%)",
      }}
    >
      {behind}
      {dialog ? (
        <div style={{ position: "absolute", inset: 0, background: "rgb(0 0 0 / 0.5)" }} />
      ) : (
        <Header app={app} />
      )}
      <div
        style={{
          position: "absolute",
          inset: 0,
          top: dialog ? 0 : 96,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div style={{ transform: `scale(${LOGIN_SCALE})` }}>{children}</div>
      </div>
    </div>
  );
}
