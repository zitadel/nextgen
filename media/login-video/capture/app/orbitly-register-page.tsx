"use client";

import dynamic from "next/dynamic";

// Orbitly's own sign-up page: the widget renders the card, everything else
// here is the app's.
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

export default function RegisterPage() {
  return (
    <main
      style={{
        display: "grid",
        gridTemplateColumns: "1.35fr 1fr",
        minHeight: "100vh",
        background: "#0b1020",
        color: "#f4f1ea",
        fontFamily: "'Manrope', system-ui, sans-serif",
        colorScheme: "dark",
      }}
    >
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;600;700;800&display=swap"
      />
      <section
        style={{
          position: "relative",
          overflow: "hidden",
          padding: "40px 48px",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background:
            "radial-gradient(circle at 62% 64%, #ffd58a 0 7%, #ff9e5e 12%, transparent 30%), linear-gradient(180deg, #1b2450 0%, #6b3f7a 42%, #f08a5d 72%, #f6b27a 100%)",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: "auto -10% -8% -10%",
            height: "38%",
            background: "#1a1430",
            borderRadius: "50% 50% 0 0 / 70% 70% 0 0",
            opacity: 0.92,
          }}
        />
        <div
          style={{
            position: "absolute",
            inset: "auto -20% -14% 30%",
            height: "34%",
            background: "#0f0c22",
            borderRadius: "50% 50% 0 0 / 80% 80% 0 0",
          }}
        />
        <img src="/orbitly.svg" alt="Orbitly" style={{ position: "relative", width: 170 }} />
        <div style={{ position: "relative" }}>
          <div style={{ fontSize: 12, letterSpacing: "0.28em", opacity: 0.8 }}>
            TRAVEL JOURNAL · Nº 7
          </div>
          <h1 style={{ fontSize: 64, lineHeight: 1.02, fontWeight: 800, margin: "14px 0 18px" }}>
            Lisbon in May
          </h1>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: 15,
              opacity: 0.9,
              borderTop: "1px solid rgba(255,255,255,.3)",
              paddingTop: 14,
            }}
          >
            <span>Return flights from Berlin</span>
            <span>from €189</span>
          </div>
        </div>
      </section>
      <section
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "40px 56px",
        }}
      >
        <div style={{ fontSize: 12, letterSpacing: "0.22em", color: "#ffb15e", fontWeight: 700 }}>
          JOIN 2 MILLION TRAVELLERS
        </div>
        <h2 style={{ fontSize: 28, fontWeight: 800, margin: "10px 0 6px" }}>
          Save trips, get fare alerts
        </h2>
        <p style={{ margin: "0 0 26px", color: "#9aa6c2", fontSize: 15 }}>
          One account for every journey.
        </p>
        <ZitadelRegister />
      </section>
    </main>
  );
}
