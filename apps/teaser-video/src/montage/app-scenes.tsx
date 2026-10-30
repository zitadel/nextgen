import type { CSSProperties, ReactNode } from "react";

import { Card, SIGN_IN } from "../card";
import { HEIGHT, WIDTH } from "../timeline";
import { APPLE, GITHUB, GOOGLE, primary, providers } from "./atoms";

// The login inside apps of every kind, each placed the way such an app would
// place it: a wide desktop sign-in card, a split screen beside a travel
// picture, a dialog over a dashboard whose session ran out, a landing page's
// sign-up, a concert hall's tickets, a store's checkout. The apps, their names and their content
// are invented; everything paints with the --zl-* properties of the app's
// brand, so the login and its app read as one product.

const faint = (share: number) => `color-mix(in srgb, var(--zl-foreground) ${share}%, transparent)`;
const tint = (share: number) =>
  `color-mix(in srgb, var(--zl-primary) ${share}%, var(--zl-background))`;

const heading: CSSProperties = { fontFamily: "var(--zl-font-family-heading)", margin: 0 };

/** The full frame a scene lays out. */
function Frame({ style, children }: { style?: CSSProperties; children: ReactNode }) {
  return (
    <div
      style={{
        position: "relative",
        width: WIDTH,
        height: HEIGHT,
        overflow: "hidden",
        color: "var(--zl-foreground)",
        background: "var(--zl-background)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** The app's mark: its initial on its brand colour. */
function Mark({ name, size = 40 }: { name: string; size?: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: "var(--zl-radius-md)",
        background: "var(--zl-primary)",
        color: "var(--zl-primary-foreground)",
        display: "grid",
        placeItems: "center",
        ...heading,
        fontSize: size * 0.55,
        fontWeight: 600,
      }}
    >
      {name.charAt(0)}
    </div>
  );
}

function Logo({ name, size = 40, color }: { name: string; size?: number; color?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: size * 0.4, color }}>
      <Mark name={name} size={size} />
      <span style={{ ...heading, fontSize: size * 0.65, fontWeight: 600 }}>{name}</span>
    </div>
  );
}

/** Scales the login to read at video size, without moving where it sits. */
function Large({ scale, children }: { scale: number; children: ReactNode }) {
  return <div style={{ transform: `scale(${scale})` }}>{children}</div>;
}

/** A bank's sign-in, laid out as desktop sign-in pages lay it out: one wide card, the app and the title on the left, the field and the way on to the right. */
export function BankSignIn() {
  return (
    <Frame
      style={{
        // A solid ground in the bank's deep navy, as its sign-in page would be.
        background: "#10213f",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Large scale={1.3}>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div
            style={{
              width: 1040,
              minHeight: 400,
              boxSizing: "border-box",
              padding: "40px 44px",
              borderRadius: 28,
              background: "var(--zl-card)",
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 56,
            }}
          >
            <div>
              <Mark name="Brightwell" size={48} />
              <h1 style={{ ...heading, fontSize: 44, fontWeight: 400, margin: "28px 0 14px" }}>
                Sign in
              </h1>
              <p style={{ margin: 0, fontSize: 17, color: faint(70) }}>
                to continue to Brightwell Online Banking
              </p>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 18, paddingTop: 88 }}>
              <zl-field
                label="Email or phone"
                type="email"
                placeholder="you@example.com"
                autocomplete="off"
                data-state="focused"
              />
              <span style={{ fontSize: 14, fontWeight: 600, color: "var(--zl-primary)" }}>
                Forgot email?
              </span>
              <p style={{ margin: "10px 0 0", fontSize: 14, color: faint(65) }}>
                Not your computer? Use a private window to sign in.
              </p>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, marginTop: 28 }}>
                <div style={{ width: 160 }}>
                  <zl-button hierarchy="text" type="button" label="Create account" block />
                </div>
                <div style={{ width: 110 }}>{primary("Next")}</div>
              </div>
            </div>
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: 13,
              color: "rgb(255 255 255 / 0.85)",
              padding: "0 8px",
            }}
          >
            <span>English (United States) ▾</span>
            <span style={{ display: "flex", gap: 28 }}>
              <span>Help</span>
              <span>Privacy</span>
              <span>Terms</span>
            </span>
          </div>
        </div>
      </Large>
    </Frame>
  );
}

/** A travel app's sign-up, split: a destination on the left, the login on the right. */
export function TravelSplit() {
  // Ridges fading into the haze: each farther one paler, softer and higher,
  // as distance does it in a photograph, never a hard cut-out shape.
  const ridges = [
    {
      d: "M0 690 C 160 600 300 640 430 560 S 700 600 960 520 L960 1080 L0 1080 Z",
      fill: "#6b5566",
      blur: 10,
      opacity: 0.55,
    },
    {
      d: "M0 790 C 200 700 360 760 520 680 S 800 720 960 650 L960 1080 L0 1080 Z",
      fill: "#3d2f3e",
      blur: 5,
      opacity: 0.8,
    },
    {
      d: "M0 900 C 220 830 420 880 600 820 S 860 850 960 800 L960 1080 L0 1080 Z",
      fill: "#1e1820",
      blur: 2,
      opacity: 1,
    },
  ];
  return (
    <Frame style={{ display: "grid", gridTemplateColumns: "1fr 1fr" }}>
      <div style={{ position: "relative", overflow: "hidden" }}>
        <svg
          viewBox="0 0 960 1080"
          preserveAspectRatio="xMidYMid slice"
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
          role="presentation"
        >
          <defs>
            <linearGradient id="travel-dusk" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#1d1a23" />
              <stop offset="0.45" stopColor="#4a3a4c" />
              <stop offset="0.7" stopColor="#a47c74" />
              <stop offset="0.85" stopColor="#d8b597" />
            </linearGradient>
            <filter id="travel-sun">
              <feGaussianBlur stdDeviation="18" />
            </filter>
          </defs>
          <rect width="960" height="1080" fill="url(#travel-dusk)" />
          <circle
            cx="640"
            cy="600"
            r="70"
            fill="#f3dcc0"
            opacity="0.75"
            filter="url(#travel-sun)"
          />
          {ridges.map(({ d, fill, blur, opacity }) => (
            <path
              key={d}
              d={d}
              fill={fill}
              opacity={opacity}
              style={{ filter: `blur(${blur}px)` }}
            />
          ))}
        </svg>
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "linear-gradient(to top, rgb(0 0 0 / 0.55), transparent 45%)",
          }}
        />
        <div
          style={{
            position: "absolute",
            top: 56,
            left: 72,
            color: "#fff",
            ...heading,
            fontSize: 30,
            letterSpacing: 8,
          }}
        >
          ORBITLY
        </div>
        <div style={{ position: "absolute", left: 72, right: 72, bottom: 88, color: "#fff" }}>
          <div style={{ fontSize: 16, letterSpacing: 5, opacity: 0.75 }}>
            TRAVEL JOURNAL · Nº 14
          </div>
          <h2
            style={{
              ...heading,
              fontSize: 96,
              fontWeight: 400,
              lineHeight: 1,
              margin: "18px 0 26px",
            }}
          >
            Kyoto in spring
          </h2>
          <div style={{ height: 1, background: "rgb(255 255 255 / 0.35)", marginBottom: 20 }} />
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: 21,
              opacity: 0.85,
            }}
          >
            <span>Return flights from Zürich</span>
            <span>from CHF 642</span>
          </div>
        </div>
      </div>
      <div style={{ display: "grid", placeItems: "center" }}>
        <Large scale={1.35}>
          <Card
            title="Create your Orbitly account"
            subtitle="Save trips and get fare alerts"
            fields={
              <zl-field
                label="Email"
                type="email"
                placeholder="you@example.com"
                autocomplete="off"
              />
            }
            actions={
              <>
                {primary("Get started")}
                {providers([GOOGLE, APPLE])}
              </>
            }
            nav={SIGN_IN}
          />
        </Large>
      </div>
    </Frame>
  );
}

const DEPLOYS = [
  {
    status: "Ready",
    message: "fix: retry webhook delivery on 5xx",
    branch: "main",
    sha: "3f9c2a1",
    when: "2m ago",
  },
  {
    status: "Building",
    message: "chore: bump the runtime to Node 24",
    branch: "deps/node-24",
    sha: "1c07e9f",
    when: "just now",
  },
  {
    status: "Ready",
    message: "feat: usage-based billing page",
    branch: "main",
    sha: "8be41d0",
    when: "1h ago",
  },
  {
    status: "Ready",
    message: "perf: cache edge config for 60s",
    branch: "main",
    sha: "a4d2b17",
    when: "3h ago",
  },
  {
    status: "Failed",
    message: "test: checkout e2e on Safari",
    branch: "ci/e2e",
    sha: "5e1a930",
    when: "5h ago",
  },
  {
    status: "Ready",
    message: "docs: rotate API keys guide",
    branch: "main",
    sha: "c93f604",
    when: "yesterday",
  },
];

const STATUS = { Ready: "#22c55e", Building: "#f59e0b", Failed: "#ef4444" } as const;

function Sparkline({ points }: { points: number[] }) {
  const path = points
    .map((value, index) => `${(index / (points.length - 1)) * 240},${48 - value * 44}`)
    .join(" ");
  return (
    <svg width="240" height="50" role="presentation">
      <polyline points={path} fill="none" stroke="var(--zl-primary)" strokeWidth="3" />
    </svg>
  );
}

/** A developer dashboard, sharp behind a dimmed dialog: the session ran out mid-deploy. */
export function DashboardSession() {
  const stats = [
    { label: "Requests (24h)", value: "1.28M", points: [0.3, 0.4, 0.35, 0.6, 0.55, 0.8, 0.7, 0.9] },
    { label: "Error rate", value: "0.02%", points: [0.5, 0.3, 0.4, 0.2, 0.25, 0.15, 0.2, 0.1] },
    { label: "P95 latency", value: "184 ms", points: [0.6, 0.5, 0.55, 0.45, 0.5, 0.4, 0.42, 0.38] },
  ];
  return (
    <Frame style={{ display: "grid", gridTemplateColumns: "280px 1fr" }}>
      <aside
        style={{
          background: faint(4),
          borderRight: `1px solid ${faint(10)}`,
          padding: "32px 24px",
          display: "flex",
          flexDirection: "column",
          gap: 10,
          fontSize: 19,
        }}
      >
        <div style={{ marginBottom: 28 }}>
          <Logo name="Kitebase" size={36} />
        </div>
        {["Overview", "Deployments", "Logs", "Domains", "Analytics", "Settings"].map((item) => (
          <div
            key={item}
            style={{
              padding: "10px 14px",
              borderRadius: "var(--zl-radius-md)",
              background: item === "Deployments" ? faint(10) : "transparent",
              color: item === "Deployments" ? "var(--zl-foreground)" : faint(65),
            }}
          >
            {item}
          </div>
        ))}
      </aside>
      <main style={{ padding: "28px 48px", display: "flex", flexDirection: "column", gap: 28 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18, fontSize: 20 }}>
          <span style={{ color: faint(65) }}>kitebase /</span>
          <span style={{ fontWeight: 600 }}>web-app</span>
          <span
            style={{
              fontSize: 15,
              padding: "4px 12px",
              borderRadius: 999,
              background: "#22c55e22",
              color: "#22c55e",
            }}
          >
            Production
          </span>
        </div>
        <h2 style={{ ...heading, fontSize: 40 }}>Deployments</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 24 }}>
          {stats.map(({ label, value, points }) => (
            <div
              key={label}
              style={{
                padding: 24,
                borderRadius: "var(--zl-radius-xl)",
                border: `1px solid ${faint(10)}`,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-end",
              }}
            >
              <div>
                <div style={{ fontSize: 16, color: faint(60) }}>{label}</div>
                <div style={{ fontSize: 40, fontWeight: 600, marginTop: 8 }}>{value}</div>
              </div>
              <Sparkline points={points} />
            </div>
          ))}
        </div>
        <div style={{ border: `1px solid ${faint(10)}`, borderRadius: "var(--zl-radius-xl)" }}>
          {DEPLOYS.map(({ status, message, branch, sha, when }, index) => (
            <div
              key={sha}
              style={{
                display: "grid",
                gridTemplateColumns: "140px 1fr 220px 140px 140px",
                alignItems: "center",
                padding: "18px 24px",
                fontSize: 18,
                borderTop: index === 0 ? "none" : `1px solid ${faint(8)}`,
              }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 5,
                    background: STATUS[status as keyof typeof STATUS],
                  }}
                />
                {status}
              </span>
              <span>{message}</span>
              <span style={{ color: faint(60) }}>{branch}</span>
              <span style={{ color: faint(60) }}>{sha}</span>
              <span style={{ color: faint(60), textAlign: "right" }}>{when}</span>
            </div>
          ))}
        </div>
      </main>
      <div style={{ position: "absolute", inset: 0, background: "rgb(0 0 0 / 0.58)" }} />
      <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>
        <Large scale={1.35}>
          <Card
            title="Session expired"
            subtitle="Sign in again to keep deploying"
            fields={
              <zl-field
                label="Work email"
                type="email"
                placeholder="you@company.com"
                autocomplete="off"
                data-state="focused"
              />
            }
            actions={
              <>
                {primary("Continue")}
                {providers([GITHUB])}
              </>
            }
          />
        </Large>
      </div>
    </Frame>
  );
}

/** A notes app's landing page: the pitch on the left, the sign-up in line on the right. */
export function LandingSignUp() {
  const people = ["#f25543", "#2563eb", "#16a34a", "#9333ea", "#f59e0b"];
  return (
    <Frame style={{ background: tint(4) }}>
      <header
        style={{
          height: 104,
          display: "flex",
          alignItems: "center",
          gap: 56,
          padding: "0 120px",
          fontSize: 20,
        }}
      >
        <Logo name="Fernhill" size={40} />
        <nav style={{ display: "flex", gap: 40, color: faint(65) }}>
          {["Product", "Templates", "Pricing", "Changelog"].map((link) => (
            <span key={link}>{link}</span>
          ))}
        </nav>
        <span style={{ marginLeft: "auto", color: faint(80) }}>Log in</span>
      </header>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 640px",
          alignItems: "center",
          gap: 80,
          padding: "60px 120px 0",
        }}
      >
        <div>
          <span
            style={{
              display: "inline-block",
              padding: "8px 18px",
              borderRadius: 999,
              border: `1px solid ${faint(15)}`,
              fontSize: 18,
              color: faint(75),
            }}
          >
            New · Shared notebooks →
          </span>
          <h1 style={{ ...heading, fontSize: 96, lineHeight: 1.02, margin: "28px 0 24px" }}>
            Notes that think with you.
          </h1>
          <p style={{ fontSize: 26, lineHeight: 1.5, color: faint(70), margin: 0, maxWidth: 760 }}>
            Capture ideas, link them, and find them again. Fernhill keeps your notebook in sync on
            every device.
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: 18, marginTop: 40 }}>
            <div style={{ display: "flex" }}>
              {people.map((color, index) => (
                <span
                  key={color}
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 22,
                    background: color,
                    border: "3px solid var(--zl-background)",
                    marginLeft: index === 0 ? 0 : -12,
                  }}
                />
              ))}
            </div>
            <span style={{ fontSize: 20, color: faint(70) }}>Loved by 40,000 writers</span>
          </div>
        </div>
        <div style={{ display: "grid", placeItems: "center" }}>
          <Large scale={1.4}>
            <Card
              title="Create your notebook"
              subtitle="Free for personal use"
              fields={
                <zl-field
                  label="Email"
                  type="email"
                  placeholder="you@example.com"
                  autocomplete="off"
                />
              }
              actions={primary("Start free")}
              nav={{ lead: "Already have a notebook? ", link: "Log in" }}
            />
          </Large>
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          bottom: 64,
          left: 120,
          right: 120,
          display: "flex",
          alignItems: "center",
          gap: 72,
          color: faint(45),
          fontSize: 26,
        }}
      >
        <span style={{ fontSize: 17, letterSpacing: 2 }}>TRUSTED BY TEAMS AT</span>
        {["Northgate", "Paperplane", "Halcyon", "Brightline", "Ostra"].map((name) => (
          <span key={name} style={{ ...heading, fontWeight: 600 }}>
            {name}
          </span>
        ))}
      </div>
    </Frame>
  );
}

/** The seats a concert hall holds while the visitor signs in. */
const SEATS = [
  ["Parterre · Row 7", "Seats 12–13"],
  ["2 × Standard", "CHF 136.00"],
  ["Booking fee", "CHF 4.00"],
];

/** A concert hall's tickets: the ticket on the left, held, the login on the right to claim it. */
export function Tickets() {
  return (
    <Frame>
      <header
        style={{
          height: 104,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 120px",
          borderBottom: `1px solid ${faint(10)}`,
        }}
      >
        <span style={{ ...heading, fontSize: 34, letterSpacing: 6 }}>SALA NOVA</span>
        <span style={{ display: "flex", gap: 44, fontSize: 18, color: faint(60) }}>
          <span>Programme</span>
          <span>Venue</span>
          <span style={{ color: "var(--zl-foreground)" }}>Seats held for 9:42</span>
        </span>
      </header>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "620px 1fr",
          gap: 96,
          padding: "160px 120px 0",
          alignItems: "start",
        }}
      >
        <article
          style={{
            borderRadius: "var(--zl-radius-xl)",
            border: `1px solid ${faint(12)}`,
            overflow: "hidden",
            background: faint(3),
          }}
        >
          <div style={{ position: "relative", height: 300, background: "#0b0b0d" }}>
            <svg
              viewBox="0 0 620 300"
              width="620"
              height="300"
              role="presentation"
              style={{ position: "absolute", inset: 0 }}
            >
              {Array.from({ length: 14 }, (_, ring) => (
                <circle
                  // biome-ignore lint/suspicious/noArrayIndexKey: fixed rings, never reordered
                  key={ring}
                  cx="470"
                  cy="150"
                  r={24 + ring * 22}
                  fill="none"
                  stroke="#fafafa"
                  strokeOpacity={0.5 - ring * 0.03}
                  strokeWidth="1"
                />
              ))}
            </svg>
            <div style={{ position: "absolute", left: 40, bottom: 34 }}>
              <div style={{ fontSize: 16, letterSpacing: 4, color: faint(60) }}>
                SAT 14 DEC · 20:00
              </div>
              <h2 style={{ ...heading, fontSize: 52, fontWeight: 500, margin: "10px 0 0" }}>
                Liminal Orchestra
              </h2>
              <div style={{ fontSize: 20, color: faint(70), marginTop: 6 }}>Winter Programme</div>
            </div>
          </div>
          <div
            style={{ padding: "30px 40px 36px", display: "flex", flexDirection: "column", gap: 20 }}
          >
            {SEATS.map(([label, value]) => (
              <div
                key={label}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: 20,
                  color: faint(70),
                }}
              >
                <span>{label}</span>
                <span>{value}</span>
              </div>
            ))}
            <div style={{ height: 1, background: faint(12) }} />
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 26,
                fontWeight: 600,
              }}
            >
              <span>Total</span>
              <span>CHF 140.00</span>
            </div>
          </div>
        </article>
        {/* Room above for the card's scale, which grows it from its centre. */}
        <div style={{ display: "grid", placeItems: "center", paddingTop: 110 }}>
          <Large scale={1.4}>
            <Card
              title="Sign in to get your tickets"
              subtitle="They go straight to your account"
              fields={
                <zl-field
                  label="Email"
                  type="email"
                  placeholder="you@example.com"
                  autocomplete="off"
                />
              }
              actions={
                <>
                  {primary("Continue")}
                  {providers([GOOGLE, APPLE])}
                  <zl-button hierarchy="text" type="button" label="Continue as guest" block />
                </>
              }
            />
          </Large>
        </div>
      </div>
    </Frame>
  );
}

// The shop's order: what is in the bag, drawn as simple product shots.
const ORDER = [
  { name: "Wool overshirt", detail: "Charcoal · M", price: "CHF 129.00", tone: "#3f3f46" },
  { name: "Canvas tote", detail: "Natural", price: "CHF 39.00", tone: "#d6cbb5" },
  { name: "Merino beanie", detail: "Rust", price: "CHF 29.00", tone: "#b45534" },
];

const STEPS = ["Bag", "Sign in", "Shipping", "Payment"];

/** A store's checkout: the steps along the top, the login where the order goes on, the bag beside it. */
export function Checkout() {
  return (
    <Frame>
      <header
        style={{
          height: 104,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 120px",
          borderBottom: `1px solid ${faint(10)}`,
        }}
      >
        <span style={{ ...heading, fontSize: 34, letterSpacing: 6 }}>ATELIER NORD</span>
        <span style={{ fontSize: 18, color: faint(60) }}>Secure checkout</span>
      </header>
      <div style={{ display: "flex", justifyContent: "center", gap: 18, padding: "40px 0 0" }}>
        {STEPS.map((step, index) => (
          <span key={step} style={{ display: "flex", alignItems: "center", gap: 18, fontSize: 19 }}>
            <span
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                color: index <= 1 ? "var(--zl-foreground)" : faint(45),
                fontWeight: index === 1 ? 600 : 400,
              }}
            >
              <span
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 16,
                  display: "grid",
                  placeItems: "center",
                  fontSize: 15,
                  background: index <= 1 ? "var(--zl-primary)" : faint(8),
                  color: index <= 1 ? "var(--zl-primary-foreground)" : faint(50),
                }}
              >
                {index === 0 ? "✓" : index + 1}
              </span>
              {step}
            </span>
            {index < STEPS.length - 1 && (
              <span style={{ width: 64, height: 1, background: faint(index < 1 ? 50 : 15) }} />
            )}
          </span>
        ))}
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 620px",
          gap: 96,
          padding: "72px 120px 0",
          alignItems: "start",
        }}
      >
        {/* Room above for the card's scale, which grows it from its centre. */}
        <div style={{ display: "grid", placeItems: "center", paddingTop: 130 }}>
          <Large scale={1.4}>
            <Card
              title="Sign in to check out"
              subtitle="We'll keep your order and your address"
              fields={
                <zl-field
                  label="Email"
                  type="email"
                  placeholder="you@example.com"
                  autocomplete="off"
                />
              }
              actions={
                <>
                  {primary("Continue")}
                  {providers([GOOGLE, APPLE])}
                  <zl-button hierarchy="text" type="button" label="Continue as guest" block />
                </>
              }
            />
          </Large>
        </div>
        <aside
          style={{
            padding: 40,
            borderRadius: "var(--zl-radius-xl)",
            background: faint(3),
            border: `1px solid ${faint(8)}`,
            display: "flex",
            flexDirection: "column",
            gap: 28,
          }}
        >
          <h3 style={{ ...heading, fontSize: 30, fontWeight: 500 }}>Your bag</h3>
          {ORDER.map(({ name, detail, price, tone }) => (
            <div key={name} style={{ display: "flex", alignItems: "center", gap: 24 }}>
              <div
                style={{
                  width: 96,
                  height: 112,
                  borderRadius: "var(--zl-radius-md)",
                  background: `linear-gradient(160deg, ${tone}, color-mix(in srgb, ${tone} 70%, #000))`,
                }}
              />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 22, fontWeight: 600 }}>{name}</div>
                <div style={{ fontSize: 18, color: faint(55), marginTop: 6 }}>{detail}</div>
              </div>
              <div style={{ fontSize: 20 }}>{price}</div>
            </div>
          ))}
          <div style={{ height: 1, background: faint(10) }} />
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: 20,
              color: faint(65),
            }}
          >
            <span>Shipping</span>
            <span>Free</span>
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: 26,
              fontWeight: 600,
            }}
          >
            <span>Total</span>
            <span>CHF 197.00</span>
          </div>
        </aside>
      </div>
    </Frame>
  );
}
