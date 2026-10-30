import type { ZlAccount } from "@zitadel/components/atoms";
import { useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import {
  continueRender,
  delayRender,
  Easing,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

import { type Brand, brandProperties } from "../brands";
import { handheld, push } from "../camera";
import { Card } from "../card";
import { fontsLoaded, LoginSurface } from "../login-surface";
import { HEIGHT, WIDTH } from "../timeline";

// The avatar where the login shows it: in the account chip on the password
// step, the title above, the address beside it and the password field below,
// the camera close on the avatar. Its gradient moves as it does in the console (.zl-avatar-moving
// in packages/components/src/styles/avatar.css): a turn and two sways, here
// played fast enough to see in a second. Inside <zl-avatar>'s shadow root the
// three angles are plain custom properties, so set on the chip they inherit
// down to the avatar.

/** How much larger than on a page the avatar is shown. */
const SCALE = 7;

/** Where across the frame the avatar sits, as a share of its width, leaving room for the address. */
const ANCHOR = 0.3;

/**
 * The account shown. The avatar's colours come from the identifier
 * (packages/components/src/avatar.ts); this one's are Zitadel's orange and
 * lavender, the outro's colours.
 */
const IDENTIFIER = "alan@zitadel.com";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

export function AvatarShot({
  brand,
  length,
  seed,
}: {
  brand: Brand;
  length: number;
  seed: number;
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const stage = useRef<HTMLDivElement>(null);
  const chip = useRef<ZlAccount>(null);
  const [focus, setFocus] = useState<{ x: number; y: number }>();

  useLayoutEffect(() => {
    if (focus) {
      return;
    }
    const handle = delayRender("Measuring the avatar");
    Promise.all([fontsLoaded, chip.current?.updateComplete]).then(() => {
      if (stage.current && chip.current) {
        const origin = stage.current.getBoundingClientRect();
        const scale = origin.width / stage.current.offsetWidth;
        const avatar = chip.current.shadowRoot?.querySelector("zl-avatar") ?? chip.current;
        const box = avatar.getBoundingClientRect();
        flushSync(() =>
          setFocus({
            x: (box.left + box.width / 2 - origin.left) / scale,
            y: (box.top + box.height / 2 - origin.top) / scale,
          }),
        );
      }
      continueRender(handle);
    });
  }, [focus]);

  const seconds = frame / fps;
  // A full turn over the shot, easing in and out, with the sways on top.
  const turn = interpolate(frame, [0, length], [0, 360], {
    ...clamp,
    easing: Easing.inOut(Easing.sin),
  });
  const swayA = 90 * Math.sin((2 * Math.PI * seconds) / 0.9);
  const swayB = 45 * Math.sin((2 * Math.PI * seconds) / 1.3);
  const zoom = SCALE * push(frame, length, 0.06);
  const at = focus ?? { x: WIDTH / 2, y: HEIGHT / 2 };

  return (
    <LoginSurface theme={brand.theme} brand={brandProperties(brand)}>
      <div
        ref={stage}
        style={{
          position: "absolute",
          width: WIDTH,
          height: HEIGHT,
          transformOrigin: "0 0",
          transform: `${handheld(frame, seed)} translate(${ANCHOR * WIDTH}px, ${HEIGHT / 2}px) scale(${zoom}) translate(${-at.x}px, ${-at.y}px)`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Card
          title="Sign in"
          subtitle="Enter your password"
          account={IDENTIFIER}
          accountRef={chip}
          accountStyle={{
            "--zl-avatar-turn": `${turn}deg`,
            "--zl-avatar-sway-a": `${swayA}deg`,
            "--zl-avatar-sway-b": `${swayB}deg`,
          }}
          fields={<zl-field label="Password" type="password" autocomplete="off" />}
        />
      </div>
    </LoginSurface>
  );
}
