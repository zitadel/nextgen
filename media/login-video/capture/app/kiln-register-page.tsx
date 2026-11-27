"use client";

import dynamic from "next/dynamic";

// Kiln's own sign-up page: the widget renders the card, everything else
// here is the app's. The card sits on the left, the studio on the right.
const ZitadelRegister = dynamic(
  async () => {
    const { ZitadelLogin: Login, configureZitadel } = await import("@zitadel/sdk-next/components");
    const project = configureZitadel({
      projectId: process.env.NEXT_PUBLIC_ZITADEL_PROJECT_ID ?? "",
      proxyPath: "/__nextgen",
    });
    return function Widget() {
      return (
        <Login variant="widget" project={project} purpose="register" postSignInUrl="/profile" />
      );
    };
  },
  { ssr: false },
);

const ink = "#2b1d16";
const muted = "#7d6656";

function Vessel({
  w,
  h,
  radius,
  from,
  to,
  rim,
}: {
  w: number;
  h: number;
  radius: string;
  from: string;
  to: string;
  rim?: number;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 0 }}>
      {rim ? (
        <div
          style={{
            width: rim,
            height: 12,
            borderRadius: "50%",
            background: "#3a241a",
            marginBottom: -7,
            zIndex: 1,
          }}
        />
      ) : null}
      <div
        style={{
          width: w,
          height: h,
          borderRadius: radius,
          background: `radial-gradient(120% 90% at 28% 22%, ${from} 0%, ${to} 70%)`,
          boxShadow:
            "inset -10px -14px 24px rgba(43,29,22,.22), 0 18px 26px -14px rgba(43,29,22,.45)",
        }}
      />
    </div>
  );
}

export default function RegisterPage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        background: "radial-gradient(90% 70% at 80% 100%, #efd9c3 0%, #f6efe7 60%)",
        color: ink,
        fontFamily: "'DM Sans', system-ui, sans-serif",
        colorScheme: "light",
      }}
    >
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700&family=DM+Serif+Display&display=swap"
      />
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "22px 48px",
        }}
      >
        <img src="/kiln.svg" alt="kiln" style={{ height: 30 }} />
        <nav style={{ display: "flex", gap: 30, fontSize: 14, color: muted }}>
          <span>Classes</span>
          <span>Open studio</span>
          <span>Firing</span>
          <span>Shop</span>
        </nav>
      </header>
      <div
        style={{
          flex: 1,
          display: "grid",
          gridTemplateColumns: "1fr 1.12fr",
          alignItems: "center",
          gap: 36,
          padding: "0 48px 40px",
        }}
      >
        <section style={{ display: "flex", flexDirection: "column", justifyContent: "center" }}>
          <ZitadelRegister />
        </section>
        <section style={{ paddingLeft: 24 }}>
          <div style={{ fontSize: 12, letterSpacing: "0.24em", color: "#c2461f", fontWeight: 700 }}>
            CERAMICS STUDIO · EST. 2019
          </div>
          <h1
            style={{
              fontFamily: "'DM Serif Display', Georgia, serif",
              fontSize: 66,
              lineHeight: 1.02,
              fontWeight: 400,
              margin: "16px 0 16px",
            }}
          >
            Make something
            <br />
            with your hands.
          </h1>
          <p style={{ fontSize: 17, lineHeight: 1.5, color: muted, maxWidth: 430, margin: 0 }}>
            Book wheel time, glaze nights and firings. Members keep the studio after hours.
          </p>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 26, marginTop: 40 }}>
            <Vessel
              w={96}
              h={150}
              radius="44% 44% 40% 40% / 26% 26% 60% 60%"
              from="#e8875a"
              to="#a9472a"
              rim={58}
            />
            <Vessel
              w={150}
              h={78}
              radius="12% 12% 50% 50% / 10% 10% 90% 90%"
              from="#9fc0b4"
              to="#5d8579"
            />
            <Vessel
              w={84}
              h={112}
              radius="18% 18% 30% 30% / 10% 10% 40% 40%"
              from="#f1dcc0"
              to="#c9a07a"
              rim={66}
            />
            <Vessel
              w={58}
              h={70}
              radius="30% 30% 45% 45% / 20% 20% 55% 55%"
              from="#8a5a44"
              to="#4e2b1c"
            />
          </div>
        </section>
      </div>
    </main>
  );
}
