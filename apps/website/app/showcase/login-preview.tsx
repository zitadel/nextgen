"use client";

import { type CSSProperties, useEffect, useId, useRef, useState } from "react";
import { Logo } from "../logo";
import {
  type BrandChoice,
  baseProperties,
  lightProperties,
  paintedProperties,
} from "./brand-tokens";
import styles from "./login-preview.module.css";
import { useSeen } from "./motion";
import type { Screen } from "./types";

// How far below the viewport a preview may still be when the atoms start
// loading, so they are there by the time it scrolls in.
const LOAD_MARGIN = "600px";

type Layers = { dark: Record<string, string>; light: Record<string, string> };

// One load for every preview on the page: the first import defines the custom
// elements, the second holds the design system's defaults, both sides.
let atoms: Promise<Layers> | undefined;
function loadAtoms() {
  atoms ??= Promise.all([
    import("@zitadel/components/atoms"),
    import("@zitadel/components/tokens"),
  ]).then(([, { tokens, cssVars, tokensCss, THEME_SELECTORS }]) => ({
    dark: baseProperties(tokens, cssVars),
    light: lightProperties(tokensCss, THEME_SELECTORS.light),
  }));
  return atoms;
}

/**
 * A step of the login as the default template renders it, in its English copy
 * (packages/components/src/orchestrator): the header, the fields, the action
 * and the line under it. The action calls `onAction`.
 */
function Card({ screen, onAction }: { screen: Screen; onAction?: () => void }) {
  return (
    <zl-card>
      <h3 slot="header" className="zl-card-title">
        {screen.title}
      </h3>
      {screen.subtitle && (
        <p slot="header" className="zl-card-subtitle">
          {screen.subtitle}
        </p>
      )}
      {screen.fields.length > 0 && (
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
      )}
      <div className="zl-card-actions">
        <zl-button
          hierarchy="primary"
          size="medium"
          type="button"
          label={screen.action}
          block
          onClick={onAction}
        />
        {screen.nav && (
          <p className="zl-card-nav">
            {screen.nav.lead}
            <button type="button" className="zl-card-nav__link">
              {screen.nav.link}
            </button>
          </p>
        )}
      </div>
    </zl-card>
  );
}

/**
 * A page of the login, built from the atoms of @zitadel/components, the
 * product's own UI code, so it is as sharp as the page around it and never
 * older than the login it shows. It shows `screens[index]`, and its action
 * calls `onAdvance`, so the visitor walks the flow. Every screen, with
 * `before`'s, stacks in one place and only the shown one is visible: the
 * frame keeps the tallest one's height, so nothing below it moves while the
 * visitor switches or walks. `showResult` picks `screens` over `before`.
 * `choice` sets the --zl-* properties the brand step's visitor picked
 * (without one, the design system's own look), `light` its light side. The
 * atoms load once the first preview nears the viewport; until then, and if
 * they cannot load, it says so instead. Nothing submits: there is no server
 * behind it.
 */
export function LoginPreview({
  screens,
  before,
  showResult = true,
  index = 0,
  onAdvance,
  choice,
  light = false,
}: {
  screens: Screen[];
  before?: Screen[];
  showResult?: boolean;
  index?: number;
  onAdvance?: () => void;
  choice?: BrandChoice;
  light?: boolean;
}) {
  const [layers, setLayers] = useState<Layers>();
  const [failed, setFailed] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  // Keeps the SVG ids of each trustmark's logo apart (logo.tsx).
  const logoId = `preview-${useId().replace(/[^\w-]/g, "")}`;

  const near = useSeen(root, { rootMargin: LOAD_MARGIN });

  useEffect(() => {
    if (!near) {
      return;
    }
    let canceled = false;
    loadAtoms().then(
      (loaded) => {
        if (!canceled) {
          setLayers(loaded);
        }
      },
      () => {
        if (!canceled) {
          setFailed(true);
        }
      },
    );
    return () => {
      canceled = true;
    };
  }, [near]);

  const style =
    layers &&
    ({
      ...layers.dark,
      ...(light && layers.light),
      ...(choice && paintedProperties(choice)),
    } as CSSProperties);
  const flows = [
    ...(before ? [{ screens: before, current: !showResult }] : []),
    { screens, current: showResult },
  ];

  return (
    <div ref={root} className={styles.preview} style={style}>
      {layers ? (
        <div className={styles.stack}>
          {flows.flatMap((flow, flowIndex) =>
            flow.screens.map((screen, screenIndex) => {
              const shown = flow.current && screenIndex === index;
              return (
                <div
                  // biome-ignore lint/suspicious/noArrayIndexKey: fixed flows of fixed screens, never reordered
                  key={`${flowIndex}-${screenIndex}`}
                  className={styles.layer}
                  data-shown={shown}
                  aria-hidden={!shown || undefined}
                  inert={!shown || undefined}
                >
                  <Card screen={screen} onAction={shown ? onAdvance : undefined} />
                  <p className={styles.trustmark}>
                    Secured with <Logo id={`${logoId}-${flowIndex}-${screenIndex}`} />
                  </p>
                </div>
              );
            }),
          )}
        </div>
      ) : (
        <p className={styles.status} role="status">
          {failed ? "The components could not be loaded." : "Loading the components…"}
        </p>
      )}
    </div>
  );
}
