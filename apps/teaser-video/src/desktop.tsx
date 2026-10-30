import type { CSSProperties, ReactNode } from "react";

// Where the product is used: a desktop with its wallpaper and menu bar, a
// terminal or a browser on it, so the screens read as a product someone is
// using rather than parts floating in a void.

const FONT = "Arimo, system-ui, sans-serif";

/** A dark desktop wallpaper: deep colours, softly blended. */
export function Wallpaper() {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: [
          "radial-gradient(60% 70% at 18% 28%, #1f2b5e 0%, transparent 70%)",
          "radial-gradient(55% 65% at 82% 72%, #3a1f5a 0%, transparent 70%)",
          "radial-gradient(40% 45% at 62% 12%, #123a40 0%, transparent 70%)",
          "#0a0c12",
        ].join(", "),
      }}
    />
  );
}

/** The desktop's menu bar, named after the app in front. */
export function MenuBar({ app }: { app: string }) {
  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        height: 34,
        display: "flex",
        alignItems: "center",
        gap: 26,
        padding: "0 22px",
        background: "rgb(16 16 22 / 0.7)",
        color: "rgb(255 255 255 / 0.85)",
        fontFamily: FONT,
        fontSize: 15,
      }}
    >
      <span style={{ fontWeight: 700 }}>{app}</span>
      {["File", "Edit", "View", "Window", "Help"].map((item) => (
        <span key={item}>{item}</span>
      ))}
      <span style={{ marginLeft: "auto" }}>Sat 14 Dec 9:41</span>
    </div>
  );
}

/** A desktop window's shadow and hairline edge. */
export const WINDOW_SHADOW = "0 40px 120px rgb(0 0 0 / 0.55), 0 0 0 1px rgb(255 255 255 / 0.06)";

/** The three window buttons of a desktop window's title bar. */
export function WindowButtons() {
  return (
    <span style={{ display: "flex", gap: 9 }}>
      {["#ff5f57", "#febc2e", "#28c840"].map((dot) => (
        <span key={dot} style={{ width: 13, height: 13, borderRadius: 7, background: dot }} />
      ))}
    </span>
  );
}

/** A browser window at `url`, its tab titled `title`, the page in its `theme`. */
export function BrowserWindow({
  url,
  title,
  theme,
  width,
  height,
  style,
  children,
}: {
  url: string;
  title: string;
  theme: "dark" | "light";
  width: number;
  height: number;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const dark = theme === "dark";
  const chrome = dark ? "#1d1d22" : "#e9e9ec";
  const field = dark ? "#2a2a31" : "#ffffff";
  const ink = dark ? "rgb(255 255 255 / 0.82)" : "rgb(0 0 0 / 0.75)";
  return (
    <div
      style={{
        width,
        height,
        borderRadius: 14,
        overflow: "hidden",
        boxShadow: WINDOW_SHADOW,
        display: "flex",
        flexDirection: "column",
        fontFamily: FONT,
        ...style,
      }}
    >
      <div
        style={{
          height: 56,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          gap: 22,
          padding: "0 18px",
          background: chrome,
          color: ink,
          fontSize: 15,
        }}
      >
        <WindowButtons />
        <span
          style={{
            padding: "7px 16px",
            borderRadius: 9,
            background: field,
            maxWidth: 220,
            overflow: "hidden",
            whiteSpace: "nowrap",
          }}
        >
          {title}
        </span>
        <span
          style={{
            flex: 1,
            maxWidth: 640,
            margin: "0 auto",
            padding: "8px 16px",
            borderRadius: 9,
            background: field,
            textAlign: "center",
            color: ink,
          }}
        >
          {url}
        </span>
        <span style={{ width: 120 }} />
      </div>
      <div style={{ position: "relative", flex: 1, overflow: "hidden" }}>{children}</div>
    </div>
  );
}
