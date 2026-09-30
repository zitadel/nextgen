/**
 * `/auth-lab` — a dev-server-only design sandbox for the authentication
 * experience. A prototype, not the login surface: the real one is the Lit
 * `<zitadel-login>` orchestrator (`packages/components`).
 *
 * Loaded from `main.tsx` only when `import.meta.env.DEV` and the path matches,
 * so production builds never contain it. It renders outside the router: no
 * sign-in, no runtime, no API calls.
 *
 * Two groups of states (`states.tsx`), kept apart in the navigation: the
 * approved Figma baseline, and SSO explorations built on it. Every screen
 * composes `AuthShell` (`auth-shell.tsx`). Open a state directly with
 * `/auth-lab#<state-id>`.
 */

import { useEffect, useState } from "react";
import type { Root } from "react-dom/client";

import { AUTH_STATE_GROUPS, AUTH_STATES, type AuthState, DEFAULT_AUTH_STATE } from "./states";

import "../../styles.css";

export function renderAuthLab(root: Root): void {
  document.title = "Auth lab · Zitadel (dev)";
  root.render(<AuthLab />);
}

type Frame = "fill" | "desktop" | "mobile";

/** The two frame sizes the Figma page draws every block at. */
const FRAMES: { id: Frame; label: string; size?: { width: number; height: number } }[] = [
  { id: "fill", label: "Fill" },
  { id: "desktop", label: "1280", size: { width: 1280, height: 900 } },
  { id: "mobile", label: "360", size: { width: 360, height: 600 } },
];

function stateFromHash(): AuthState {
  const hash = window.location.hash.slice(1);
  return AUTH_STATES.find((state) => state.id === hash) ?? DEFAULT_AUTH_STATE;
}

function AuthLab() {
  const [state, setState] = useState<AuthState>(stateFromHash);
  const [frame, setFrame] = useState<Frame>("fill");
  // Local, not `useTheme()`: that persists the console's own preference.
  // Dark first — the Figma frames are drawn dark.
  const [resolved, setResolved] = useState<"dark" | "light">("dark");
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", resolved);
  }, [resolved]);

  // The hash is the state: the switcher and in-screen links ("Sign up") both
  // just change it.
  useEffect(() => {
    const onHash = () => setState(stateFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const size = FRAMES.find((item) => item.id === frame)?.size;
  const { Screen } = state;

  return (
    <div className="bg-background text-foreground flex h-svh flex-col text-xs">
      <header className="border-border flex flex-wrap items-center gap-x-6 gap-y-2 border-b px-4 py-2.5">
        <div className="flex items-baseline gap-2">
          <h1 className="font-serif text-lg leading-6">Auth lab</h1>
          <span className="text-muted-foreground text-[11px]">dev only</span>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Segmented
            label="Frame"
            value={frame}
            items={FRAMES}
            onChange={(id) => setFrame(id as Frame)}
          />
          <Segmented
            label="Theme"
            value={resolved}
            items={[
              { id: "dark", label: "Dark" },
              { id: "light", label: "Light" },
            ]}
            onChange={(id) => setResolved(id as "dark" | "light")}
          />
        </div>
      </header>
      <div className="border-border flex flex-wrap items-center gap-x-6 gap-y-2 border-b px-4 py-2">
        {AUTH_STATE_GROUPS.map((group) => (
          <div key={group.id} className="flex flex-wrap items-center gap-2">
            <span
              className={`text-[11px] ${
                group.id === "sso"
                  ? "border-border rounded border border-dashed px-1.5 py-0.5"
                  : "text-muted-foreground"
              }`}
            >
              {group.label}
            </span>
            <Segmented
              label={group.label}
              value={state.id}
              items={AUTH_STATES.filter((item) => item.group === group.id).map((item) => ({
                id: item.id,
                label: item.label,
              }))}
              onChange={(id) => {
                window.location.hash = id;
              }}
            />
          </div>
        ))}
      </div>
      <div className="border-border text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 border-b px-4 py-1.5 text-[11px]">
        <StateSource state={state} frame={frame} />
        {resolved === "light" && (
          <span>Figma draws these blocks dark only; light is token-derived.</span>
        )}
        {state.note && <span>{state.note}</span>}
      </div>
      <main className="bg-muted/40 min-h-0 flex-1 overflow-auto">
        {size ? (
          <div className="flex min-w-fit justify-center p-6">
            <div className="border-border box-content shrink-0 overflow-auto border" style={size}>
              <Screen key={state.id} />
            </div>
          </div>
        ) : (
          <div className="h-full">
            <Screen key={state.id} />
          </div>
        )}
      </main>
    </div>
  );
}

function StateSource({ state, frame }: { state: AuthState; frame: Frame }) {
  if (state.group === "sso") {
    return (
      <>
        <span className="text-foreground">Exploration — not in Figma</span>
        <span>{state.source}</span>
        {state.keys.length > 0 && (
          <span>
            Placeholder copy for <code>{state.keys.join(", ")}</code>
          </span>
        )}
      </>
    );
  }
  const node = frame === "mobile" ? state.nodes.mobile : state.nodes.desktop;
  return (
    <span>
      Figma: <span className="text-foreground">{state.figma}</span>{" "}
      {node ? (
        <code>{node}</code>
      ) : (
        <span>— no {frame === "mobile" ? "360 " : ""}frame in Figma</span>
      )}
    </span>
  );
}

function Segmented({
  label,
  value,
  items,
  onChange,
}: {
  label: string;
  value: string;
  items: { id: string; label: string }[];
  onChange: (id: string) => void;
}) {
  return (
    <nav className="bg-muted flex flex-wrap rounded-lg p-0.5" aria-label={label}>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          aria-current={value === item.id ? "page" : undefined}
          onClick={() => onChange(item.id)}
          className={`rounded-md px-3 py-1 text-[12px] ${
            value === item.id
              ? "bg-background font-medium shadow-xs"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {item.label}
        </button>
      ))}
    </nav>
  );
}
