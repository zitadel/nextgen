"use client";

import { type RefObject, useEffect, useRef, useState } from "react";
import { type Target, trackEvent } from "./analytics";
import { phasePath } from "./phases";
import { featurePath } from "./platform";
import { prefersReducedMotion } from "./showcase/motion";

// What you can turn on, in the founder's order, each with an ask that turns
// it on and the page that shows it where there is one, with its name for
// analytics (analytics.ts).
const ITEMS: readonly {
  label: string;
  ask: string;
  link?: { href: string; target: Target };
}[] = [
  {
    label: "Login",
    ask: "Add passkeys to sign-up.",
    link: { href: featurePath("sign-in"), target: "sign_in" },
  },
  {
    label: "Single sign-on",
    ask: "Connect Acme's Okta for single sign-on.",
    link: { href: featurePath("single-sign-on"), target: "single_sign_on" },
  },
  {
    label: "Organizations",
    ask: "Give each customer its own organization and admins.",
    link: { href: featurePath("organizations"), target: "organizations" },
  },
  {
    label: "Permissions",
    ask: "Let support read users, but not change them.",
    link: { href: featurePath("permissions"), target: "permissions" },
  },
  {
    label: "OAuth server",
    ask: "Protect our MCP server with OAuth.",
    link: { href: featurePath("oauth-server"), target: "oauth_server" },
  },
  {
    label: "SCIM",
    ask: "Sync Acme's people from Entra with SCIM.",
    link: { href: featurePath("scim"), target: "scim" },
  },
  {
    label: "Agent identity",
    ask: "Let our booking agent act for a user, with their consent.",
    link: { href: featurePath("agents"), target: "agents" },
  },
  {
    label: "Audit trail",
    ask: "Who changed the password policy last week?",
    link: { href: phasePath("investigate"), target: "investigate" },
  },
];

// A key a little faster than a person types, and how long an ask stays.
const KEY_MS = 38;
const HOLD_MS = 2600;

/** Whether `ref` is on screen now, updated as it scrolls in and out. */
function useOnScreen(ref: RefObject<Element | null>): boolean {
  const [onScreen, setOnScreen] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }
    const observer = new IntersectionObserver((entries) =>
      setOnScreen(entries.some((entry) => entry.isIntersecting)),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return onScreen;
}

/**
 * The hero's asks between hairlines: one prompt line that types an ask out,
 * holds it, and moves to the next, over the names of what each turns on,
 * the shown one's lit. Hovering or focusing a name shows its ask and holds
 * the cycle. Every ask is in the page: the prompt stacks them all in one
 * place, the longest holding the line's height so nothing moves while one
 * types, and each name carries its ask for screen readers, where the prompt
 * itself is hidden. Before the page hydrates, without script and for reduced
 * motion, the first ask simply stands, and only hover and focus change it.
 * A name with a page links to it and reports `clicked_link` from the hero.
 */
export function AskTeaser({ className = "" }: { className?: string }) {
  const [active, setActive] = useState(0);
  const [typed, setTyped] = useState(ITEMS[0]?.ask.length ?? 0);
  const [motion, setMotion] = useState(false);
  const [held, setHeld] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const onScreen = useOnScreen(root);

  useEffect(() => {
    if (!prefersReducedMotion()) {
      setMotion(true);
    }
  }, []);

  useEffect(() => {
    const ask = ITEMS[active]?.ask ?? "";
    if (!motion || held || !onScreen) {
      return;
    }
    const tick =
      typed < ask.length
        ? setTimeout(() => setTyped(typed + 1), KEY_MS)
        : setTimeout(() => {
            setActive((active + 1) % ITEMS.length);
            setTyped(0);
          }, HOLD_MS);
    return () => clearTimeout(tick);
  }, [motion, held, onScreen, active, typed]);

  const show = (index: number) => {
    setHeld(true);
    setActive(index);
    setTyped(ITEMS[index]?.ask.length ?? 0);
  };
  const release = () => setHeld(false);

  return (
    <div
      ref={root}
      className={`flex flex-col items-center gap-3 border-border-primary border-y py-4 ${className}`}
    >
      <div aria-hidden="true" className="grid w-full font-mono text-sm leading-6">
        {ITEMS.map(({ label, ask }, index) => {
          const shown = index === active;
          return (
            <p
              key={label}
              className={`text-pretty text-center text-text-primary [grid-area:1/1] ${shown ? "" : "invisible"}`}
            >
              <span className="select-none text-text-accent">{"› "}</span>
              {shown ? (
                <>
                  {ask.slice(0, typed)}
                  {motion && <span className="caret ml-px" />}
                  <span className="invisible">{ask.slice(typed)}</span>
                </>
              ) : (
                ask
              )}
            </p>
          );
        })}
      </div>
      <ul
        aria-label="Things to ask your agent"
        className="flex flex-wrap justify-center gap-x-1.5 gap-y-1 text-sm leading-6"
      >
        {ITEMS.map(({ label, ask, link }, index) => {
          const lit = index === active;
          const name = `rounded-md px-1.5 transition-colors ${
            lit ? "bg-tint/[0.08] text-text-primary" : "text-text-secondary hover:text-text-primary"
          }`;
          const content = (
            <>
              {label}
              <span className="sr-only">: {ask}</span>
            </>
          );
          const handlers = {
            onMouseEnter: () => show(index),
            onMouseLeave: release,
            onFocus: () => show(index),
            onBlur: release,
          };
          return (
            <li key={label} className="whitespace-nowrap">
              {link ? (
                <a
                  href={link.href}
                  {...handlers}
                  onClick={() =>
                    trackEvent("clicked_link", { target: link.target, placement: "hero" })
                  }
                  className={`${name} underline decoration-tint/25 underline-offset-4 hover:decoration-text-primary`}
                >
                  {content}
                </a>
              ) : (
                <button
                  type="button"
                  {...handlers}
                  onClick={() => show(index)}
                  className={`${name} cursor-default`}
                >
                  {content}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
