import type { CSSProperties, ReactNode } from "react";

import { Card, SIGN_IN } from "../card";
import { HEIGHT, WIDTH } from "../timeline";
import { APPLE, GITHUB, GOOGLE, primary, providers } from "./atoms";

// The login inside apps of every kind, each placed the way such an app would
// place it, some over a picture of their own, drawn here rather than
// photographed: a wide desktop sign-in card, a split screen beside a travel
// picture, a dialog over a dashboard whose session ran out, a landing page's
// sign-up, a phone app, a store's checkout. The apps, their names and their content
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

/** Fills the frame behind a scene's content, slightly out of focus, like a photo behind a page. */
function Backdrop({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 1920 1080"
      preserveAspectRatio="xMidYMid slice"
      role="presentation"
      style={{
        position: "absolute",
        inset: -12,
        width: WIDTH + 24,
        height: HEIGHT + 24,
        filter: "blur(3px)",
      }}
    >
      {children}
    </svg>
  );
}

// A skyline's towers: left edge, width and height, in px of the frame.
const TOWERS = [
  [0, 150, 420],
  [140, 110, 560],
  [240, 170, 380],
  [400, 120, 640],
  [510, 160, 470],
  [660, 100, 720],
  [750, 190, 520],
  [930, 130, 600],
  [1050, 170, 430],
  [1210, 110, 690],
  [1310, 180, 500],
  [1480, 120, 580],
  [1590, 160, 410],
  [1740, 190, 540],
];

/** A city at dusk: the towers dark against the last light, a scatter of windows lit. */
function CityAtDusk() {
  return (
    <Backdrop>
      <defs>
        <linearGradient id="dusk" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0b1640" />
          <stop offset="0.55" stopColor="#3b4fa8" />
          <stop offset="0.8" stopColor="#f0a07a" />
          <stop offset="1" stopColor="#ffd9a8" />
        </linearGradient>
      </defs>
      <rect width="1920" height="1080" fill="url(#dusk)" />
      {TOWERS.map(([left = 0, width = 0, height = 0], tower) => (
        <g key={left}>
          <rect x={left} y={1080 - height} width={width} height={height} fill="#0d1330" />
          {Array.from({ length: Math.floor(height / 34) }, (_, row) =>
            Array.from({ length: Math.floor(width / 26) }, (_, column) =>
              // A fixed scatter: about a third of the windows lit.
              (tower * 7 + row * 5 + column * 3) % 3 === 0 ? (
                <rect
                  // biome-ignore lint/suspicious/noArrayIndexKey: a fixed grid, never reordered
                  key={`${row}-${column}`}
                  x={left + 10 + column * 26}
                  y={1080 - height + 14 + row * 34}
                  width={12}
                  height={16}
                  fill="#ffd27a"
                  opacity={0.85}
                />
              ) : null,
            ),
          )}
        </g>
      ))}
    </Backdrop>
  );
}

/** Hills in the morning: a pale sky, the sun low, the hills fading back into the haze. */
function MorningHills() {
  return (
    <Backdrop>
      <defs>
        <linearGradient id="morning" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#dbe7ff" />
          <stop offset="0.6" stopColor="#f7e8f7" />
          <stop offset="1" stopColor="#fff4e6" />
        </linearGradient>
      </defs>
      <rect width="1920" height="1080" fill="url(#morning)" />
      <circle cx="1460" cy="420" r="120" fill="#fff6d8" />
      <path
        d="M0 640 C 380 520, 700 600, 1000 560 S 1600 520, 1920 600 L1920 1080 L0 1080 Z"
        fill="#d6c8f2"
      />
      <path
        d="M0 760 C 300 680, 640 760, 980 700 S 1560 680, 1920 740 L1920 1080 L0 1080 Z"
        fill="#b9a6e8"
      />
      <path
        d="M0 880 C 360 820, 760 900, 1120 840 S 1700 830, 1920 870 L1920 1080 L0 1080 Z"
        fill="#9b86d8"
      />
    </Backdrop>
  );
}

/** A bank's sign-in, laid out as desktop sign-in pages lay it out: one wide card, the app and the title on the left, the field and the way on to the right. */
export function BankSignIn() {
  return (
    <Frame
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <CityAtDusk />
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
            <linearGradient id="travel-sky" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#1b1340" />
              <stop offset="0.45" stopColor="#6d28d9" />
              <stop offset="0.72" stopColor="#f97316" />
              <stop offset="0.86" stopColor="#fbbf24" />
            </linearGradient>
          </defs>
          <rect width="960" height="1080" fill="url(#travel-sky)" />
          <circle cx="600" cy="700" r="110" fill="#fde68a" opacity="0.9" />
          <path
            d="M0 760 L160 600 L300 720 L470 520 L640 700 L800 580 L960 690 L960 1080 L0 1080 Z"
            fill="#3b1d5e"
            opacity="0.85"
          />
          <path
            d="M0 860 L200 720 L380 830 L560 690 L760 840 L960 760 L960 1080 L0 1080 Z"
            fill="#25123f"
          />
          <path d="M0 960 L240 870 L520 950 L760 880 L960 940 L960 1080 L0 1080 Z" fill="#140a26" />
        </svg>
        <div style={{ position: "absolute", top: 56, left: 64 }}>
          <Logo name="Orbitly" size={44} color="#fff" />
        </div>
        <div style={{ position: "absolute", left: 64, bottom: 80, color: "#fff" }}>
          <div style={{ fontSize: 18, letterSpacing: 4, opacity: 0.8 }}>TRENDING THIS WEEK</div>
          <h2 style={{ ...heading, fontSize: 84, fontWeight: 600, margin: "10px 0" }}>
            Kyoto in spring
          </h2>
          <div style={{ fontSize: 24, opacity: 0.85 }}>Return flights from CHF 642 · 12 h</div>
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

function Notice({
  icon,
  title,
  detail,
  style,
}: {
  icon: string;
  title: string;
  detail: string;
  style: CSSProperties;
}) {
  return (
    <div
      style={{
        position: "absolute",
        display: "flex",
        alignItems: "center",
        gap: 20,
        padding: "22px 28px",
        borderRadius: 24,
        background: "var(--zl-card)",
        boxShadow: "0 24px 60px rgb(0 0 0 / 0.12)",
        ...style,
      }}
    >
      <span
        style={{
          width: 56,
          height: 56,
          borderRadius: 28,
          display: "grid",
          placeItems: "center",
          fontSize: 28,
          background: tint(18),
        }}
      >
        {icon}
      </span>
      <div>
        <div style={{ fontSize: 22, fontWeight: 600 }}>{title}</div>
        <div style={{ fontSize: 18, color: faint(60), marginTop: 4 }}>{detail}</div>
      </div>
    </div>
  );
}

/** A clinic's phone app: the login on a phone, the app's notifications around it. */
export function PhoneApp() {
  return (
    <Frame
      style={{
        display: "grid",
        placeItems: "center",
      }}
    >
      <MorningHills />
      <Notice
        icon="✓"
        title="Your lab results are ready"
        detail="Today, 08:12"
        style={{ left: 250, top: 300 }}
      />
      <Notice
        icon="◷"
        title="Next appointment"
        detail="Tue 14 Nov · 09:30 · Dr. Okafor"
        style={{ right: 230, top: 620 }}
      />
      <Large scale={1.18}>
        <div
          style={{
            width: 408,
            height: 860,
            boxSizing: "border-box",
            borderRadius: 60,
            border: "12px solid #111",
            background: "var(--zl-background)",
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            boxShadow: "0 40px 90px rgb(0 0 0 / 0.25)",
          }}
        >
          <div
            style={{
              height: 44,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "0 26px",
              fontSize: 15,
              fontWeight: 600,
            }}
          >
            <span>9:41</span>
            <span style={{ letterSpacing: 2 }}>▮▮▮ ◔</span>
          </div>
          <div style={{ padding: "18px 22px 26px" }}>
            <Logo name="Mosaic Clinic" size={30} />
          </div>
          <div style={{ display: "flex", justifyContent: "center" }}>
            <div style={{ width: 384 }}>
              <Card
                title="Patient portal"
                subtitle="Sign in to see your appointments"
                fields={
                  <zl-field
                    label="Phone"
                    type="tel"
                    placeholder="079 000 00 00"
                    autocomplete="off"
                    data-state="focused"
                  />
                }
                actions={primary("Continue")}
                nav={{ lead: "First visit? ", link: "Register" }}
              />
            </div>
          </div>
          <div
            style={{
              marginTop: "auto",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 22,
              padding: "0 0 12px",
              fontSize: 14,
              color: faint(60),
            }}
          >
            <span>Need help? Call 044 000 00 00</span>
            <span style={{ width: 130, height: 5, borderRadius: 3, background: faint(80) }} />
          </div>
        </div>
      </Large>
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
