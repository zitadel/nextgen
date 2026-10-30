import type { ReactNode } from "react";

import { type Brand, COLORS } from "../brands";
import { ADA, Card, SIGN_IN, SIGN_UP } from "../card";
import { IdentifierShot } from "../scenes/identifier";
import { ACME, APPLE, GITHUB, GOOGLE, primary, providers, secondary } from "./atoms";
import {
  BankSignIn,
  DashboardSession,
  LandingSignUp,
  Tickets,
  Checkout,
  TravelSplit,
} from "./app-scenes";
import { AvatarShot } from "./avatar-shot";
import { FocusShot } from "./focus-shot";
import { Scene, ScreenShot } from "./shot";
import { IDENTIFIER_BEATS, IDENTIFIERS } from "./identifiers";
import { FPS, seconds } from "../timeline";

// The montage, shot by shot: what each shows, in which brand, for how many
// beats. It gathers speed with the music (soundtrack.tsx): the cold open's
// view of the identifier step held while a user schema makes the identifier
// something else, in a brand of its own each time, two beats each over the
// calm opening pad and the riser; from the drop, whole screens of other steps,
// one a beat; the avatar moving in its account chip; close-ups of the parts,
// two a beat; and the login inside apps of every kind, each placed as such an
// app would place it, a beat each. Outside the apps, the copy is the default
// template's English (packages/components/src/orchestrator/locales/en.ts).

export type ShotSpec = {
  beats: number;
  /** The shot, `length` frames long; `seed` tells it from the others, so its camera drifts its own way. */
  scene: (length: number, seed: number) => ReactNode;
};

/** A whole screen, in its brand (ScreenShot in shot.tsx). */
type Screen = {
  beats: number;
  brand: Brand;
  content: (frame: number) => ReactNode;
};

/** When a close-up's button presses or its box ticks, in seconds into it. */
const CLICK = 0.12;

const PASSWORD = "correct-horse-battery";

/** A field shaken off a wrong entry: a quick tremor that dies out in a few frames. */
const shake = (frame: number) => {
  const time = frame / FPS;
  return 12 * Math.sin(time * 114) * Math.exp(-time / 0.083);
};

const SCREENS: Screen[] = [
  {
    beats: 1,
    brand: { theme: "dark", color: COLORS.purple, corners: "round", headings: "sans" },
    content: () => (
      <Card
        title="Sign in"
        subtitle="Enter your email to continue"
        fields={
          <zl-field label="Email" type="email" placeholder="you@example.com" autocomplete="off" />
        }
        actions={
          <>
            {primary("Continue")}
            {providers([GOOGLE, GITHUB, APPLE, ACME])}
          </>
        }
        nav={SIGN_UP}
      />
    ),
  },
  {
    beats: 1,
    brand: { theme: "light", color: COLORS.blue, corners: "soft", headings: "sans" },
    content: () => (
      <Card
        title="Sign in"
        subtitle="Enter your password"
        account
        fields={
          <zl-field
            label="Password"
            type="password"
            value={PASSWORD}
            autocomplete="off"
            data-state="focused"
          />
        }
        actions={
          <>
            {primary("Sign in")}
            {secondary("Sign in with a passkey")}
          </>
        }
        nav={SIGN_UP}
      />
    ),
  },
  {
    beats: 1,
    brand: { theme: "light", color: COLORS.orange, corners: "round", headings: "sans" },
    content: (frame) => (
      <Card
        title="Sign in"
        subtitle="Enter your password"
        account
        fields={
          <div style={{ transform: `translateX(${shake(frame)}px)` }}>
            <zl-field
              label="Password"
              type="password"
              value="hunter2"
              autocomplete="off"
              error="Wrong email or password."
              invalid
            />
          </div>
        }
        actions={primary("Sign in")}
        nav={SIGN_UP}
      />
    ),
  },
  {
    beats: 1,
    brand: { theme: "light", color: COLORS.green, corners: "sharp", headings: "serif" },
    content: () => (
      <Card
        title="Sign in faster next time"
        subtitle="No password needed ever again. Sign in with Face ID, Touch ID, or PIN."
        account
        actions={
          <>
            {primary("Set up passkey")}
            {secondary("Skip for now")}
          </>
        }
      />
    ),
  },
  {
    beats: 1,
    brand: { theme: "dark", color: COLORS.orange, corners: "sharp", headings: "mono" },
    content: () => (
      <Card
        title="Create your account"
        subtitle="Set up your email and password"
        fields={
          <>
            <zl-field label="Email" type="email" value={ADA} autocomplete="off" />
            <zl-field
              label="Password"
              type="password"
              value={PASSWORD}
              autocomplete="off"
              data-state="focused"
            />
          </>
        }
        actions={primary("Sign up")}
        nav={SIGN_IN}
      />
    ),
  },
];

/** A close look at one part of a screen, half a beat long (focus-shot.tsx). */
const closeUp = (
  brand: Brand,
  scale: number,
  render: (frame: number) => ReactNode,
  { anchor }: { anchor?: { x: number; y: number } } = {},
): ShotSpec => ({
  beats: 0.5,
  scene: (length, seed) => (
    <FocusShot
      brand={brand}
      length={length}
      seed={seed}
      scale={scale}
      anchor={anchor}
      render={render}
    />
  ),
});

const CLOSE_UPS: ShotSpec[] = [
  closeUp({ theme: "dark", corners: "soft", headings: "sans" }, 3.8, () => (
    <Card
      title="Sign in"
      subtitle="Enter your email to continue"
      fields={
        <zl-field label="Email" type="email" placeholder="you@example.com" autocomplete="off" />
      }
      actions={
        <>
          {primary("Continue")}
          <div data-focus>{providers([GOOGLE, GITHUB, APPLE])}</div>
        </>
      }
      nav={SIGN_UP}
    />
  )),
  closeUp({ theme: "dark", color: COLORS.blue, corners: "soft", headings: "sans" }, 4.4, () => (
    <Card
      title="Sign in"
      subtitle="Enter your password"
      account
      actions={
        <>
          <div data-focus>
            <zl-alert severity="info">Waiting for your passkey…</zl-alert>
          </div>
          {secondary("Cancel")}
        </>
      }
    />
  )),
  closeUp(
    { theme: "light", color: COLORS.orange, corners: "round", headings: "sans" },
    4.4,
    (frame) => (
      <Card
        title="Sign in"
        subtitle="Enter your email to continue"
        fields={
          <div data-focus style={{ transform: `translateX(${shake(frame)}px)` }}>
            <zl-field
              label="Email"
              type="email"
              value="ada@zitadel"
              autocomplete="off"
              error="Please enter a valid email"
              invalid
            />
          </div>
        }
        actions={primary("Continue")}
        nav={SIGN_UP}
      />
    ),
  ),
  closeUp(
    { theme: "dark", color: COLORS.green, corners: "soft", headings: "sans" },
    4.6,
    (frame) => (
      <Card
        title="Sign in"
        subtitle="Enter your email to continue"
        fields={
          <>
            <zl-field label="Email" type="email" value={ADA} autocomplete="off" />
            <zl-checkbox data-focus label="Remember me" checked={frame >= seconds(CLICK)} />
          </>
        }
        actions={primary("Continue")}
        nav={SIGN_UP}
      />
    ),
  ),
  closeUp(
    { theme: "light", color: COLORS.blue, corners: "soft", headings: "sans" },
    4.4,
    (frame) => (
      <Card
        title="Sign in"
        subtitle="Enter your password"
        account
        fields={<zl-field label="Password" type="password" value={PASSWORD} autocomplete="off" />}
        actions={<div data-focus>{primary("Sign in", frame >= seconds(CLICK))}</div>}
        nav={SIGN_UP}
      />
    ),
  ),
  closeUp(
    { theme: "light", color: COLORS.green, corners: "sharp", headings: "serif" },
    4.2,
    (frame) => (
      <Card
        title="Sign in faster next time"
        subtitle="No password needed ever again. Sign in with Face ID, Touch ID, or PIN."
        account
        actions={
          <>
            <div data-focus>{primary("Set up passkey", frame >= seconds(CLICK))}</div>
            {secondary("Skip for now")}
          </>
        }
      />
    ),
    { anchor: { x: 0.5, y: 0.66 } },
  ),
];

/** The login inside apps of every kind (app-scenes.tsx), a beat each, so their surroundings read. */
const IN_APPS: ShotSpec[] = (
  [
    [BankSignIn, { theme: "light", color: COLORS.blue, corners: "round", headings: "sans" }],
    [Tickets, { theme: "dark", corners: "soft", headings: "serif" }],
    [TravelSplit, { theme: "dark", color: COLORS.purple, corners: "round", headings: "sans" }],
    [LandingSignUp, { theme: "light", color: COLORS.green, corners: "sharp", headings: "serif" }],
    [DashboardSession, { theme: "dark", color: COLORS.orange, corners: "sharp", headings: "mono" }],
    [Checkout, { theme: "light", corners: "soft", headings: "serif" }],
  ] as const
).map(([App, brand], index, apps) => ({
  beats: 1,
  scene: (length: number, seed: number) => (
    // The last blurs away into the dark the outro comes out of.
    <Scene
      brand={brand}
      length={length}
      seed={seed}
      blurOut={index === apps.length - 1 ? seconds(0.33) : 0}
    >
      <App />
    </Scene>
  ),
}));

const IDENTIFIER_SHOTS: ShotSpec[] = IDENTIFIERS.map((identifier) => ({
  beats: IDENTIFIER_BEATS,
  scene: () => <IdentifierShot {...identifier} />,
}));

const SCREEN_SHOTS: ShotSpec[] = SCREENS.map(({ beats, brand, content }) => ({
  beats,
  scene: (length, seed) => (
    <ScreenShot brand={brand} length={length} seed={seed} render={content} />
  ),
}));

const AVATAR: ShotSpec = {
  beats: 2,
  scene: (length, seed) => (
    <AvatarShot
      brand={{ theme: "dark", color: COLORS.purple, corners: "round", headings: "sans" }}
      length={length}
      seed={seed}
    />
  ),
};

export const SHOTS: ShotSpec[] = [
  ...IDENTIFIER_SHOTS,
  ...SCREEN_SHOTS,
  AVATAR,
  ...CLOSE_UPS,
  ...IN_APPS,
];
