import type { SsoProvider } from "@zitadel/components/atoms";
import type { ReactNode } from "react";

import { type Brand, COLORS } from "../brands";
import { ADA, Card, SIGN_IN, SIGN_UP } from "../card";
import { IdentifierShot } from "../scenes/identifier";
import { type App, AppFrame } from "./app-frame";
import { AvatarShot } from "./avatar-shot";
import { IDENTIFIER_BEATS, IDENTIFIERS } from "./identifiers";

// The montage, shot by shot: what each shows, in which brand, for how many
// beats. It gathers speed with the music (soundtrack.tsx): the cold open's
// view of the identifier step held while a user schema makes the identifier
// something else, in a brand of its own each time, two beats each over the
// calm opening pad and the riser; from the drop, whole screens of other steps,
// one a beat; the avatar moving in its account chip; close-ups of the parts,
// two a beat; and the login inside apps of every kind, each with its own
// brand and words, two a beat. Outside the apps, the copy is the default
// template's English (packages/components/src/orchestrator/locales/en.ts).

export type ShotSpec = { beats: number } & (
  | {
      brand: Brand;
      /** A close-up's fixed scale; a whole screen is fitted to the frame. */
      scale?: number;
      /** How far the camera pushes in over the shot. */
      push?: number;
      /** What the shot shows `frame` frames in, framed by the montage's own camera. */
      content: (frame: number) => ReactNode;
    }
  | {
      /** A shot that sets up its own camera and the whole frame, `length` frames long. */
      scene: (length: number) => ReactNode;
    }
);

const GOOGLE: SsoProvider = { id: "idp_google", name: "Google", template: "google" };
const GITHUB: SsoProvider = { id: "idp_github", name: "GitHub", template: "github" };
const APPLE: SsoProvider = { id: "idp_apple", name: "Apple", template: "apple" };
const ACME: SsoProvider = { id: "idp_acme", name: "Acme SSO", template: "oidc-generic" };

const CONTINUE_WITH = "Continue with {name}";
const PASSWORD = "correct-horse-battery";

/** A field shaken off a wrong entry: a quick tremor that dies out in a few frames. */
const shake = (frame: number) => 12 * Math.sin(frame * 1.9) * Math.exp(-frame / 5);

/** A close-up's width before it is scaled: a card's content column. */
const PART = { width: 336 };

const primary = (label: string, pressed = false) => (
  <zl-button
    hierarchy="primary"
    size="medium"
    type="button"
    label={label}
    block
    data-state={pressed ? "pressed" : undefined}
  />
);
const secondary = (label: string) => (
  <zl-button hierarchy="secondary" size="medium" type="button" label={label} block />
);
const providers = (list: SsoProvider[]) => (
  <zl-sso-providers providers={list} labelFormat={CONTINUE_WITH} />
);

const SCREENS: ShotSpec[] = [
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

const half = { beats: 0.5, push: 0.08 };

const CLOSE_UPS: ShotSpec[] = [
  {
    ...half,
    brand: { theme: "dark", corners: "soft", headings: "sans" },
    scale: 3.6,
    content: () => <div style={PART}>{providers([GOOGLE])}</div>,
  },
  {
    ...half,
    brand: { theme: "light", corners: "sharp", headings: "sans" },
    scale: 3.6,
    content: () => <div style={PART}>{providers([GITHUB])}</div>,
  },
  {
    ...half,
    brand: { theme: "dark", color: COLORS.purple, corners: "round", headings: "sans" },
    scale: 3.6,
    content: () => <div style={PART}>{providers([APPLE])}</div>,
  },
  {
    ...half,
    brand: { theme: "light", color: COLORS.green, corners: "round", headings: "sans" },
    scale: 3.6,
    content: () => <div style={PART}>{providers([ACME])}</div>,
  },
  {
    ...half,
    brand: { theme: "dark", color: COLORS.blue, corners: "soft", headings: "sans" },
    scale: 3.2,
    content: () => (
      <div style={PART}>
        <zl-alert severity="info">Waiting for your passkey…</zl-alert>
      </div>
    ),
  },
  {
    ...half,
    brand: { theme: "light", corners: "sharp", headings: "sans" },
    scale: 3.4,
    content: (frame) => (
      <div style={PART}>
        <zl-field
          label="Password"
          type="password"
          value={PASSWORD.slice(0, 2 + Math.floor(frame / 2))}
          autocomplete="off"
          data-state="focused"
        />
      </div>
    ),
  },
  {
    ...half,
    brand: { theme: "light", color: COLORS.orange, corners: "round", headings: "sans" },
    scale: 3.2,
    content: (frame) => (
      <div style={{ ...PART, transform: `translateX(${shake(frame)}px)` }}>
        <zl-field
          label="Email"
          type="email"
          value="ada@zitadel"
          autocomplete="off"
          error="Please enter a valid email"
          invalid
        />
      </div>
    ),
  },
  {
    ...half,
    brand: { theme: "dark", color: COLORS.green, corners: "soft", headings: "sans" },
    scale: 5,
    content: (frame) => <zl-checkbox label="Remember me" checked={frame >= 6} />,
  },
  {
    ...half,
    brand: { theme: "light", color: COLORS.blue, corners: "soft", headings: "sans" },
    scale: 4,
    content: (frame) => <div style={PART}>{primary("Sign in", frame >= 6)}</div>,
  },
  {
    ...half,
    brand: { theme: "dark", color: COLORS.purple, corners: "round", headings: "sans" },
    scale: 4,
    content: () => <div style={PART}>{secondary("Sign in with a passkey")}</div>,
  },
];

type AppShot = {
  app: App;
  brand: Brand;
  title: string;
  subtitle: string;
  field: { label: string; type: "email" | "text" | "tel"; placeholder: string };
  action: string;
  nav?: { lead: string; link: string };
};

/**
 * The login inside apps of every kind, each with its own brand and its own
 * words: what an app's copy overrides and --zl-* properties make of the same
 * step. The apps are invented.
 */
const APPS: AppShot[] = [
  {
    app: {
      name: "Brightwell",
      nav: ["Accounts", "Cards", "Savings"],
      layout: "page",
      tagline: "Banking that keeps up with you",
    },
    brand: { theme: "light", color: COLORS.blue, corners: "soft", headings: "serif" },
    title: "Sign in to Brightwell",
    subtitle: "Your money, one step away",
    field: { label: "Email", type: "email", placeholder: "you@example.com" },
    action: "Continue",
    nav: { lead: "New here? ", link: "Open an account" },
  },
  {
    app: {
      name: "Orbitly",
      nav: ["Flights", "Stays", "Trips"],
      layout: "dialog",
      tagline: "Where to next?",
    },
    brand: { theme: "dark", color: COLORS.purple, corners: "round", headings: "sans" },
    title: "Create your Orbitly account",
    subtitle: "Save trips and get fare alerts",
    field: { label: "Email", type: "email", placeholder: "you@example.com" },
    action: "Get started",
    nav: { lead: "Already travelling with us? ", link: "Sign in" },
  },
  {
    app: {
      name: "Fernhill",
      nav: ["Notes", "Shared", "Archive"],
      layout: "page",
      tagline: "Pick up where you left off",
    },
    brand: { theme: "light", color: COLORS.green, corners: "sharp", headings: "serif" },
    title: "Welcome back",
    subtitle: "Log in to your notebook",
    field: { label: "Username", type: "text", placeholder: "ada" },
    action: "Log in",
  },
  {
    app: {
      name: "Kitebase",
      nav: ["Projects", "Deploys", "Logs"],
      layout: "dialog",
      tagline: "Ship on Fridays",
    },
    brand: { theme: "dark", color: COLORS.orange, corners: "sharp", headings: "mono" },
    title: "Log in to Kitebase",
    subtitle: "Use your work email",
    field: { label: "Work email", type: "email", placeholder: "you@company.com" },
    action: "Continue",
    nav: { lead: "No team yet? ", link: "Start free" },
  },
  {
    app: {
      name: "Mosaic Clinic",
      nav: ["Appointments", "Results", "Messages"],
      layout: "page",
      tagline: "Your care, in one place",
    },
    brand: { theme: "light", color: COLORS.purple, corners: "round", headings: "sans" },
    title: "Patient portal",
    subtitle: "Sign in to see your appointments",
    field: { label: "Phone", type: "tel", placeholder: "+41 79 000 00 00" },
    action: "Continue",
  },
  {
    app: {
      name: "Quillworks",
      nav: ["Drafts", "Publish", "Readers"],
      layout: "page",
      tagline: "Words worth reading",
    },
    brand: { theme: "dark", color: COLORS.blue, corners: "soft", headings: "serif" },
    title: "Start writing today",
    subtitle: "Create your free account",
    field: { label: "Email", type: "email", placeholder: "you@example.com" },
    action: "Create account",
    nav: SIGN_IN,
  },
  {
    app: {
      name: "Harborline",
      nav: ["Shipments", "Fleet", "Reports"],
      layout: "dialog",
      tagline: "Track every shipment",
    },
    brand: { theme: "light", color: COLORS.orange, corners: "sharp", headings: "sans" },
    title: "Sign in to your workspace",
    subtitle: "Use your company email",
    field: { label: "Company email", type: "email", placeholder: "you@company.com" },
    action: "Next",
  },
  {
    app: {
      name: "Lumora",
      nav: ["Explore", "Collections", "Studio"],
      layout: "dialog",
      tagline: "Share your best shots",
    },
    brand: { theme: "dark", color: COLORS.green, corners: "round", headings: "mono" },
    title: "Join Lumora",
    subtitle: "Create an account to start posting",
    field: { label: "Email", type: "email", placeholder: "you@example.com" },
    action: "Sign up",
    nav: SIGN_IN,
  },
];

const IN_APPS: ShotSpec[] = APPS.map(({ app, brand, title, subtitle, field, action, nav }) => ({
  beats: 0.5,
  brand,
  scale: 1,
  push: 0.03,
  content: () => (
    <AppFrame app={app}>
      <Card
        title={title}
        subtitle={subtitle}
        fields={
          <zl-field
            label={field.label}
            type={field.type}
            placeholder={field.placeholder}
            autocomplete="off"
          />
        }
        actions={primary(action)}
        nav={nav}
      />
    </AppFrame>
  ),
}));

const IDENTIFIER_SHOTS: ShotSpec[] = IDENTIFIERS.map((identifier) => ({
  beats: IDENTIFIER_BEATS,
  scene: () => <IdentifierShot {...identifier} />,
}));

const AVATAR: ShotSpec = {
  beats: 2,
  scene: (length) => (
    <AvatarShot
      brand={{ theme: "dark", color: COLORS.purple, corners: "round", headings: "sans" }}
      length={length}
    />
  ),
};

export const SHOTS: ShotSpec[] = [
  ...IDENTIFIER_SHOTS,
  ...SCREENS,
  AVATAR,
  ...CLOSE_UPS,
  ...IN_APPS,
];
