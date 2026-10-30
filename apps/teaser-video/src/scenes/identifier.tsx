import type { ZlField, ZlFieldType } from "@zitadel/components/atoms";
import { useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { continueRender, delayRender, useCurrentFrame } from "remotion";

import { type Brand, brandProperties } from "../brands";
import { Card, SIGN_UP } from "../card";
import { fontsLoaded, LoginSurface } from "../login-surface";
import { FRAMES_PER_BEAT, HEIGHT, WIDTH } from "../timeline";

// The identifier step, held still and close on its field, the typing starting
// a third of the way across the frame, a caret blinking on the beat in it.
// The cold open types the email address in it; the montage then keeps the
// same view while a user schema swaps what identifies the person, and the
// brand around it.

type Point = { x: number; y: number };

/** Where the input sits on the stage, in its own unscaled pixels. */
type Geometry = {
  /** The left edge of the input's text and its vertical middle, which the camera holds on. */
  text: Point;
  font: string;
  fontSize: number;
};

/**
 * How much larger than on a page the field is shown, still for the whole
 * shot: large enough that the typed value crosses about half the frame, with
 * the card around it cut off by the frame's edges.
 */
const SCALE = 6.5;

/** Where across the frame the typing starts, as a share of its width. */
const ANCHOR = 1 / 3;

function measure(stage: HTMLElement, field: ZlField): Geometry {
  const origin = stage.getBoundingClientRect();
  // The stage's own scale, and the Studio's around it.
  const scale = origin.width / stage.offsetWidth;
  const input = field.shadowRoot?.querySelector<HTMLInputElement>('[part="input"]');
  if (!input) {
    throw new Error("<zl-field> rendered no input");
  }
  const box = input.getBoundingClientRect();
  const computed = getComputedStyle(input);
  const inset =
    Number.parseFloat(computed.paddingLeft) + Number.parseFloat(computed.borderLeftWidth);
  return {
    text: {
      x: (box.left - origin.left) / scale + inset,
      y: (box.top + box.height / 2 - origin.top) / scale,
    },
    font: computed.font,
    fontSize: Number.parseFloat(computed.fontSize),
  };
}

let context: CanvasRenderingContext2D | null = null;
function textWidth(text: string, font: string): number {
  context ??= document.createElement("canvas").getContext("2d");
  if (!context) {
    return 0;
  }
  context.font = font;
  return context.measureText(text).width;
}

export type IdentifierField = {
  label: string;
  type: ZlFieldType;
  placeholder: string;
  /** The step's line under its title, naming what to enter. */
  subtitle: string;
};

export function IdentifierShot({
  brand,
  field: { label, type, placeholder, subtitle },
  text,
  keys,
}: {
  /** The brand around the step; without one, the design system's own dark look. */
  brand?: Brand;
  field: IdentifierField;
  /** What is typed, one character on each of `keys`, in frames from the shot's start. */
  text: string;
  keys: number[];
}) {
  const frame = useCurrentFrame();
  const stage = useRef<HTMLDivElement>(null);
  const input = useRef<ZlField>(null);
  const [geometry, setGeometry] = useState<Geometry>();

  const typedCount = keys.filter((at) => at <= frame).length;
  const typed = text.slice(0, typedCount);
  const lastKey = keys[typedCount - 1] ?? Number.NEGATIVE_INFINITY;

  // The geometry, once the faces and the atoms have rendered.
  useLayoutEffect(() => {
    if (geometry) {
      return;
    }
    const handle = delayRender("Measuring the login");
    Promise.all([fontsLoaded, input.current?.updateComplete]).then(() => {
      if (stage.current && input.current) {
        const measured = measure(stage.current, input.current);
        flushSync(() => setGeometry(measured));
      }
      continueRender(handle);
    });
  }, [geometry]);

  // Lit renders a new value a microtask later; the frame waits for it.
  useLayoutEffect(() => {
    const handle = delayRender("Rendering the typed value");
    Promise.resolve(input.current?.updateComplete).then(() => continueRender(handle));
  }, [typed]);

  // Solid while typing, as an editor's caret is; otherwise on for the first
  // half of every beat.
  const caretOn =
    frame - lastKey < FRAMES_PER_BEAT || frame % FRAMES_PER_BEAT < FRAMES_PER_BEAT / 2;

  const focus = geometry?.text ?? { x: WIDTH / 2, y: HEIGHT / 2 };
  return (
    <LoginSurface theme={brand?.theme} brand={brand && brandProperties(brand)}>
      <div
        ref={stage}
        style={{
          position: "absolute",
          width: WIDTH,
          height: HEIGHT,
          transformOrigin: "0 0",
          transform: `translate(${ANCHOR * WIDTH}px, ${HEIGHT / 2}px) scale(${SCALE}) translate(${-focus.x}px, ${-focus.y}px)`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Card
          title="Sign in"
          subtitle={subtitle}
          fields={
            <zl-field
              ref={input}
              label={label}
              type={type}
              placeholder={placeholder}
              autocomplete="off"
              required
              value={typed}
              data-state="focused"
            />
          }
          actions={
            <zl-button hierarchy="primary" size="medium" type="button" label="Continue" block />
          }
          nav={SIGN_UP}
        />
        {geometry && caretOn && (
          <div
            style={{
              position: "absolute",
              left: geometry.text.x + textWidth(typed, geometry.font),
              top: geometry.text.y - geometry.fontSize * 0.62,
              width: 1.5,
              height: geometry.fontSize * 1.24,
              background: "var(--zl-foreground)",
            }}
          />
        )}
      </div>
    </LoginSurface>
  );
}
