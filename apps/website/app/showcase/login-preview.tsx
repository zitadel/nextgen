"use client";

import { type CSSProperties, useEffect, useId, useRef, useState } from "react";
import { Logo } from "../logo";
import { type BrandChoice, baseProperties, paintedProperties } from "./brand-tokens";
import styles from "./login-preview.module.css";
import type { Screen } from "./types";

// How far below the viewport a preview may still be when the atoms start
// loading, so they are there by the time it scrolls in.
const LOAD_MARGIN = "600px";

// One load for every preview on the page: the first import defines the custom
// elements, the second holds the design system's defaults.
let atoms: Promise<Record<string, string>> | undefined;
function loadAtoms() {
  atoms ??= Promise.all([
    import("@zitadel/components/atoms"),
    import("@zitadel/components/tokens"),
  ]).then(([, { tokens, cssVars }]) => baseProperties(tokens, cssVars));
  return atoms;
}

/**
 * A step of the login as the default template renders it, in its English copy
 * (packages/components/src/orchestrator): the header, the fields, the action
 * and the line under it.
 */
function Card({ screen }: { screen: Screen }) {
  return (
    <zl-card>
      <h3 slot="header" className="zl-card-title">
        {screen.title}
      </h3>
      <p slot="header" className="zl-card-subtitle">
        {screen.subtitle}
      </p>
      <div className="zl-field-group">
        {screen.fields.map((field) => (
          <zl-field
            key={field.label}
            label={field.label}
            type={field.type ?? "text"}
            placeholder={field.placeholder}
            autocomplete="off"
            required={field.required}
          />
        ))}
      </div>
      <div className="zl-card-actions">
        <zl-button hierarchy="primary" size="medium" type="button" label={screen.action} block />
        <p className="zl-card-nav">
          {screen.nav.lead}
          <button type="button" className="zl-card-nav__link">
            {screen.nav.link}
          </button>
        </p>
      </div>
    </zl-card>
  );
}

/**
 * A screen of the login, built from the atoms of @zitadel/components, the
 * product's own UI code, so it is as sharp as the page around it and never
 * older than the login it shows. With `before`, both screens stack in one
 * place and `showResult` cross-fades between them: the frame keeps the taller
 * one's height, so nothing below it moves. `choice` sets the --zl-* properties
 * the brand row's visitor picked; without one, the design system's own look.
 * The atoms load once the first preview nears the viewport; until then, and
 * if they cannot load, it says so instead. Nothing submits: there is no
 * server behind it.
 */
export function LoginPreview({
  screen,
  before,
  showResult = true,
  choice,
}: {
  screen: Screen;
  before?: Screen;
  showResult?: boolean;
  choice?: BrandChoice;
}) {
  const [base, setBase] = useState<Record<string, string>>();
  const [failed, setFailed] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  // Keeps the SVG ids of each trustmark's logo apart (logo.tsx).
  const logoId = `preview-${useId().replace(/[^\w-]/g, "")}`;

  useEffect(() => {
    const element = root.current;
    if (!element) {
      return;
    }
    let cancelled = false;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) {
          return;
        }
        observer.disconnect();
        loadAtoms().then(
          (properties) => {
            if (!cancelled) {
              setBase(properties);
            }
          },
          () => {
            if (!cancelled) {
              setFailed(true);
            }
          },
        );
      },
      { rootMargin: LOAD_MARGIN },
    );
    observer.observe(element);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, []);

  const style = base && ({ ...base, ...(choice && paintedProperties(choice)) } as CSSProperties);
  const layers = before
    ? [
        { screen: before, shown: !showResult },
        { screen, shown: showResult },
      ]
    : [{ screen, shown: true }];

  return (
    <div ref={root} className={styles.preview} style={style}>
      {base ? (
        <div className={styles.stack}>
          {layers.map((layer, index) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: before, then after, never reordered
              key={index}
              className={styles.layer}
              data-shown={layer.shown}
              aria-hidden={!layer.shown || undefined}
              inert={!layer.shown || undefined}
            >
              <Card screen={layer.screen} />
              <p className={styles.trustmark}>
                Secured with <Logo id={`${logoId}-${index}`} />
              </p>
            </div>
          ))}
        </div>
      ) : (
        <p className={styles.status} role="status">
          {failed ? "The components could not be loaded." : "Loading the components…"}
        </p>
      )}
    </div>
  );
}
