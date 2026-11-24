// Draws any moment of the video: window.seek(t) puts the stage in its state
// at t seconds. Nothing animates on its own, so a renderer can step through
// frames deterministically. One cut: the one-minute master.
//
// The build segment replays a real run on a build clock T (seconds since the
// first command was pasted). Terminal output keeps its recorded timing
// (data/terminal.js); the browser's server-side steps keep the timings the
// capture measured (marked "recorded" below). A person's part (opening the
// browser, typing, autofill, clicks) uses the paces marked "person".

const $ = (id) => document.getElementById(id);
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const seg = (t, a, b) => clamp((t - a) / (b - a));
const ease = (p) => 1 - (1 - p) ** 3;
const easeIO = (p) => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2);
const lerp = (a, b, p) => a + (b - a) * p;
const fade = (t, inA, inB, outA = Infinity, outB = Infinity) =>
  Math.min(ease(seg(t, inA, inB)), Number.isFinite(outA) ? 1 - ease(seg(t, outA, outB)) : 1);
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// CSS cubic-bezier timing, as the website's logo animation uses.
function bezier(x1, y1, x2, y2) {
  const bx = (t) => 3 * x1 * t * (1 - t) ** 2 + 3 * x2 * t * t * (1 - t) + t ** 3;
  const by = (t) => 3 * y1 * t * (1 - t) ** 2 + 3 * y2 * t * t * (1 - t) + t ** 3;
  return (p) => {
    if (p <= 0) return 0;
    if (p >= 1) return 1;
    let lo = 0,
      hi = 1;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (bx(mid) < p) lo = mid;
      else hi = mid;
    }
    return by((lo + hi) / 2);
  };
}
const spinEase = bezier(0.108, 0, 0, 1);
const rollEase = bezier(0.199, 0, 0.121, 1);

// Art: each graphic from the guidelines appears once. The cover's fan opens the
// video, a ring of shards is the minute (then the clock's dial), a rosette marks
// the turn, a stack of rings builds under the close, and the website's hero
// Lottie ends it. Orange is the highlight; the brand's purple carries the light
// and the shapes around it.
const HERO_FRAMES = 217; // capture/lottie/hero/000-216.webp, 30 fps, 550x448
const heroSrc = (i) => `capture/lottie/hero/${String(i).padStart(3, "0")}.webp`;
const TERM = window.TERMINAL;
const DEV = TERM.marks.dev_start;

// ---- the build, on the build clock ------------------------------------------
const B = {};
B.browserOpen = DEV + 0.55; // person: opens the URL once "Ready" shows (Ready printed at +0.40, recorded)
B.registerShown = DEV + 3.74; // recorded: GET /register 200, first compile included
B.focus = B.registerShown + 0.35; // person: clicks the email field
B.charEvery = 0.1; // person: types the email at 10 characters a second
B.email = "ada.lovelace@example.com";
B.typed = B.focus + B.email.length * B.charEvery;
B.enter1 = B.typed + 0.25; // person: presses Enter
B.passwordShown = B.enter1 + 0.068; // recorded: email step to password step
B.pwFocus = B.passwordShown + 0.3; // person: clicks the password field
B.pwFilled = B.pwFocus + 0.5; // person: picks the password manager's suggestion
B.signup = B.pwFilled + 0.35; // person: clicks Sign up
B.profile = B.signup + 0.607; // recorded: sign-up to the profile page
const BUILD_TOTAL = B.profile;

const SHOT = "capture/shots/";
const pad = (n) => String(n).padStart(3, "0");
function signupShot(T) {
  if (T < B.registerShown) return null;
  if (T < B.focus) return `${SHOT}signup/000-register-empty.png`;
  if (T < B.enter1) {
    const i = clamp(Math.floor((T - B.focus) / B.charEvery), 0, B.email.length);
    return i === 0
      ? `${SHOT}signup/000-register-empty.png`
      : `${SHOT}signup/${pad(i)}-email-typing.png`;
  }
  if (T < B.passwordShown) return `${SHOT}signup/025-email-submitted.png`;
  if (T < B.pwFilled) return `${SHOT}signup/026-password-empty.png`;
  if (T < B.signup) return `${SHOT}signup/027-password-filled.png`;
  if (T < B.profile) return `${SHOT}signup/028-signup-pending.png`;
  return `${SHOT}signup/029-profile.png`;
}

const M = TERM.marks;

// ---- music: audio/track.mp3 ("Launch Sequence", 63.6 s) -----------------------------
// Measured on the track: 125.7 BPM, bars of 1.909 s with downbeats from 1.318 s.
// The intro runs to 7.0 s (one hit at 3.95 s), the groove comes in on bar 3, dips
// on bar 18 and returns on bar 19, breaks on bars 27-28, and bar 29 is the last
// hit before the fade. The video plays it straight through: video time is song time.
const MUSIC = { beat: 0.4772, bar0: 1.318, hit: 3.95, end: 63.6 };
const BEAT = MUSIC.beat;
const BAR = 4 * BEAT;
const atBar = (n, beats = 0) => MUSIC.bar0 + n * BAR + beats * BEAT; // time of bar n of the song

// ---- the ladder: from a color to a page the app owns ---------------------------------
// Every rung is the real register page of one scaffolded app, deployed with the CLI
// and captured (scripts/ladder.py). c: page point (of the 1280x800 page) the
// camera looks at; z: screen px per page px; beats from the rung's start.
const LAD = `${SHOT}ladder/`;
const RUNGS = [
  {
    beats: 6,
    cap: "Change the colors.",
    xfade: 0.15,
    z: [2.3, 2.5],
    c: [
      [640, 381],
      [640, 381],
    ],
    shots: [
      { at: 0, src: `${LAD}c0-default.png` },
      { at: 1, src: `${LAD}c1-violet.png` },
      { at: 2, src: `${LAD}c2-teal.png` },
      { at: 3, src: `${LAD}c3-coral.png` },
      { at: 4, src: `${LAD}c4-indigo.png` },
    ],
  },
  {
    beats: 6,
    cap: "Set a font and logo.",
    z: [2.05, 2.2],
    c: [
      [640, 389],
      [640, 389],
    ],
    shots: [
      { at: 0, src: `${LAD}b1-fernhill.png` },
      { at: 1, src: `${LAD}b2-kiln.png` },
      { at: 2, src: `${LAD}b3-signal.png` },
      { at: 3, src: `${LAD}b4-halcyon.png` },
      { at: 4, src: `${LAD}b5-orbitly.png` },
    ],
  },
  {
    beats: 4,
    cap: "Add sign-up fields.",
    z: [1.58, 1.7],
    c: [
      [640, 395],
      [640, 395],
    ],
    shots: [{ at: 0, src: `${LAD}f1-fields.png` }],
  },
  {
    beats: 12,
    cap: "Write the page yourself.",
    shots: [
      {
        at: 0,
        src: `${LAD}p1-orbitly.png`,
        z: [2.0, 1.5],
        c: [
          [1006, 360],
          [640, 440],
        ],
      },
      {
        at: 6,
        src: `${LAD}p2-kiln.png`,
        z: [2.15, 1.5],
        c: [
          [319, 395],
          [640, 377],
        ],
      },
    ],
  },
];
let acc = 0;
RUNGS.forEach((r, i) => {
  r.n = i + 1;
  r.at = acc;
  r.len = r.beats * BEAT;
  r.shots.forEach((s, k) => {
    s.t = s.at * BEAT;
    s.end = k + 1 < r.shots.length ? r.shots[k + 1].at * BEAT : r.len;
  });
  acc += r.len;
});
const LADDER_LEN = acc;

// ---- the close: what Zitadel does behind the page ----------------------------------
// A ring lands on the stack with every word; the last word lands on the break.
const WORDS = [
  "sessions.",
  "cookies.",
  "password hashing.",
  "passkeys.",
  "audit trail.",
  "rollbacks.",
  "plumbing.",
];
const KIN = { len: 12 * BEAT, k1: 0, k2: BEAT, w0: 2 * BEAT, every: BEAT };

// ---- schedule ----------------------------------------------------------------------
// On the song's bars. The intro is the title; the first command lands as the groove
// comes in; sign-in lands on a downbeat; "Now make it yours." sits in the dip and
// the ladder starts where the groove returns; the close's last word lands on the
// break; the logo lands on the last hit. The build has 14 bars, so the waits that
// show nothing but a spinner play at 4×, as many as needed (scaffolding and npm
// install first): the clock keeps real build time and its badge says 4×.
const FF_RATE = 4;
const S = (() => {
  const s = {
    buildStart: atBar(3),
    buildEnd: atBar(17),
    turn: atBar(18),
    ladder: atBar(19),
    close: atBar(26),
    end: atBar(29),
  };
  s.duration = s.end + 4.0;
  s.pre = s.buildStart;
  const save = BUILD_TOTAL - (s.buildEnd - s.buildStart);
  const gain = (f) => (f.to - f.from) * (1 - 1 / f.rate);
  const optional = [
    { from: 12.4, to: 15.9, rate: FF_RATE }, // scaffolding after the last prompt
    { from: 28.6, to: 31.15, rate: FF_RATE }, // the first page compile
    { from: 6.3, to: 7.95, rate: FF_RATE }, // setup starting
  ];
  const fixed = [];
  let install;
  for (;;) {
    const rest = save - fixed.reduce((n, f) => n + gain(f), 0);
    install = { from: 16.8, to: 16.8 + rest / (1 - 1 / FF_RATE), rate: FF_RATE };
    if (install.to <= 26.04) break;
    if (!optional.length) throw new Error(`the install wait cannot absorb ${rest.toFixed(2)} s`);
    fixed.push(optional.shift());
  }
  s.ff = [...fixed, install].sort((a, b) => a.from - b.from);
  s.music = {
    edl: [[0, MUSIC.end]],
    fadeIn: 0.3,
    fadeOut: 2.0,
    // The song plays as delivered. A low-pass envelope ([video time, cutoff Hz],
    // 20 kHz open) can hold a track back under the build; none for this one.
    filter: [],
  };
  return s;
})();
window.DURATION = S.duration;
// build clock T for video time t, through the fast-forwards
function buildT(t) {
  let u = t - S.pre;
  if (u <= 0) return 0;
  let T = 0;
  for (const f of S.ff) {
    if (u <= f.from - T) return T + u;
    u -= f.from - T;
    T = f.from;
    if (u <= (f.to - f.from) / f.rate) return T + u * f.rate;
    u -= (f.to - f.from) / f.rate;
    T = f.to;
  }
  return clamp(T + u, 0, BUILD_TOTAL);
}
const ffAt = (T) => (S.ff.find((f) => T > f.from && T < f.to) || {}).rate || 0;

// ---- setup -----------------------------------------------------------------------
const FRAMEWORKS = [
  "Next.js",
  "Nuxt",
  "React",
  "Vue",
  "Svelte",
  "SvelteKit",
  "Solid",
  "SolidStart",
  "Angular",
  "Qwik",
  "Qwik Router",
  "TanStack Start",
];
const AGENTS = ["Claude Code", "Cursor", "Copilot", "Codex"];
const PETALS = 9,
  PETAL_R = 138,
  PETAL_D = 168;
const RING = { rx: 150, ry: 44, th: 42, gap: 32 };

// 12 leaning shards, one per 5 s of a minute
const P = (r, a) => `${(r * Math.cos(a)).toFixed(2)},${(r * Math.sin(a)).toFixed(2)}`;
function shard(i) {
  const rad = Math.PI / 180,
    a0 = (-90 + i * 30 + 3) * rad,
    a1 = (-90 + i * 30 + 27) * rad,
    lean = 10 * rad;
  return `M${P(26, a0 + lean)}L${P(47, a0)}L${P(47, a1)}L${P(26, a1 + lean)}Z`;
}

function buildDom() {
  $("frameworks").innerHTML = FRAMEWORKS.map((f) => `<span class="chip">${f}</span>`).join("");
  $("agents").innerHTML = AGENTS.map((f) => `<span class="chip">${f}</span>`).join("");
  const L = window.LOGO;
  $("endLogo").innerHTML =
    `<defs><clipPath id="lw"><rect x="129.2" y="16.99" width="398.88" height="88.48"/></clipPath></defs>` +
    `<path id="logoIcon" fill="#fff" d="${L.icon}"/>` +
    `<g clip-path="url(#lw)">` +
    L.letters
      .map(
        (d, i) => `<g id="ll${i}"><path fill="#fff" transform="translate(0,-100)" d="${d}"/></g>`,
      )
      .join("") +
    `</g>`;
  $("fan").innerHTML = [0, 1, 2, 3, 4].map((i) => `<div class="blade" id="bl${i}"></div>`).join("");

  // the opening's minute: the same ring, large, in the brand's purple
  $("bigDial").innerHTML =
    `<defs><radialGradient id="bg" cx="0" cy="0" r="47" gradientUnits="userSpaceOnUse">` +
    `<stop offset="0.45" stop-color="#401889" stop-opacity="0.35"/><stop offset="0.8" stop-color="#6a4cc2"/><stop offset="1" stop-color="#bba5e4"/></radialGradient></defs>` +
    Array.from(
      { length: 12 },
      (_, i) => `<path id="bs${i}" d="${shard(i)}" fill="url(#bg)" opacity="0"/>`,
    ).join("");

  // the turn's rosette: overlapping gradient discs around a small void, in purple
  $("rosette").innerHTML =
    `<defs><linearGradient id="pg" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="#1d0b45"/><stop offset="0.55" stop-color="#5a3bb4"/><stop offset="1" stop-color="#c9b6f2"/></linearGradient></defs>` +
    Array.from(
      { length: PETALS },
      (_, i) =>
        `<g id="pt${i}"><circle cx="${PETAL_D}" cy="0" r="${PETAL_R}" fill="url(#pg)"/></g>`,
    ).join("");

  // the close's stack: a ring per word, the newest on top, in purple
  const { rx, ry, th } = RING;
  $("stack").innerHTML =
    `<defs><linearGradient id="rs" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="#1d0b45"/><stop offset="0.55" stop-color="#4b2c9e"/><stop offset="1" stop-color="#8f6fe0"/></linearGradient>` +
    `<linearGradient id="rf" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d4c4f6"/><stop offset="1" stop-color="#6a4cc2"/></linearGradient>` +
    `<linearGradient id="rh" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0c0620"/><stop offset="1" stop-color="#341a7a"/></linearGradient></defs>` +
    WORDS.map(
      (_, k) =>
        `<g id="rg${k}"><g transform="translate(0,${-k * RING.gap})">` +
        `<rect x="${-rx}" y="${-(ry + th / 2)}" width="${2 * rx}" height="${2 * ry + th}" rx="${rx}" ry="${ry}" fill="url(#rs)"/>` +
        `<ellipse cx="0" cy="${-th / 2}" rx="${rx}" ry="${ry}" fill="url(#rf)"/>` +
        `<ellipse cx="0" cy="${-th / 2}" rx="${rx * 0.42}" ry="${ry * 0.42}" fill="url(#rh)"/></g></g>`,
    ).join("");
}

const urls = new Set();
async function preload() {
  for (let T = B.registerShown; T <= BUILD_TOTAL + 0.01; T += 0.01) urls.add(signupShot(T));
  for (const r of RUNGS) for (const s of r.shots) urls.add(s.src);
  for (let i = 0; i < HERO_FRAMES; i++) urls.add(heroSrc(i));
  await Promise.all(
    [...urls].filter(Boolean).map(async (u) => {
      const im = new Image();
      im.src = u;
      await im.decode();
    }),
  );
}

// where the clock's time sits, for the opening's minute to land on
let CLOCK_AT = null;
function measureClock() {
  const r = $("clockTime").getBoundingClientRect();
  CLOCK_AT = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

// ---- drawing helpers ---------------------------------------------------------------
function setOpacity(el, o) {
  el.style.opacity = o.toFixed(3);
  el.style.visibility = o <= 0.001 ? "hidden" : "visible";
}
function place(el, x, y, scale = 1) {
  el.style.transform = `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px) scale(${scale.toFixed(4)})`;
}
function setText(el, html) {
  if (el.innerHTML !== html) el.innerHTML = html;
}

let lastTermFrame = -1;
function drawTerminal(T, t) {
  const F = TERM.frames;
  let lo = 0,
    hi = F.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (F[mid].t <= T) lo = mid;
    else hi = mid - 1;
  }
  const last = F[lo].rows[F[lo].rows.length - 1] || [];
  const idle = last
    .map((s) => s[0])
    .join("")
    .startsWith("myapp $");
  const blinkOn = Math.floor(t * 1.6) % 2 === 0;
  const key = lo * 2 + (idle && blinkOn ? 1 : 0);
  if (key === lastTermFrame) return;
  lastTermFrame = key;
  const rows = F[lo].rows.map((spans) =>
    spans
      .map(([txt, cls]) => (cls ? `<span class="${cls}">${esc(txt)}</span>` : esc(txt)))
      .join(""),
  );
  if (idle && blinkOn) rows[rows.length - 1] += '<span class="cursor"></span>';
  $("termText").innerHTML = rows.join("\n");
}

const pending = [];
const shown = {};
function setImg(id, src) {
  const el = $(id);
  if (shown[id] === src) return;
  shown[id] = src;
  if (!src) return;
  el.src = src;
  pending.push(el.decode().catch(() => {}));
}
// Screenshots are 2560x1600 of a 1280x800 page: z is screen px per page px.
function lookAt(id, z, cx, cy, vw, vh) {
  place($(id), vw / 2 - cx * z, vh / 2 - cy * z, z / 2);
}
function clockText(T) {
  const m = Math.floor(T / 60);
  const s = T - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
}

// ---- the opening: the cover's fan, then the minute ---------------------------------------
// The fan sweeps open as the picture fades up, then sweeps on and away; the minute's
// twelve shards draw in on sixteenths, and the ring flies into the clock.
const OPEN = {
  fan: 0.45,
  fanOut: MUSIC.hit - 0.75,
  shards: MUSIC.hit,
  fly: 5.55,
  flyLen: 1.0,
  titleOut: 5.95,
};
function drawFan(t) {
  const fan = $("fan");
  const a = OPEN.fan;
  const o = fade(t, a - 0.05, a + 0.9, OPEN.fanOut, OPEN.fanOut + 1.0);
  setOpacity(fan, o);
  if (o <= 0) return;
  const angles = [142, 164, 186, 208, 230]; // deg, clockwise from pointing right
  fan.style.transform = "translate(2080px, 560px)";
  const away = easeIO(seg(t, OPEN.fanOut, OPEN.fanOut + 1.0));
  angles.forEach((ang, i) => {
    const p = spinEase(seg(t - a - i * 0.12, 0, 2.2));
    const drift = Math.max(0, t - a) * 1.2 + away * (36 + i * 6);
    $(`bl${i}`).style.transform =
      `rotate(${(lerp(226, ang, p) + drift).toFixed(2)}deg) scale(${lerp(0.7, 1, p).toFixed(3)})`;
  });
}
function drawMinute(t) {
  const el = $("bigDial");
  const on = t >= OPEN.shards - 0.05 && t < OPEN.fly + OPEN.flyLen + 0.05;
  const f = easeIO(seg(t, OPEN.fly, OPEN.fly + OPEN.flyLen));
  // it shrinks into the clock's time and is gone as the time appears
  setOpacity(el, on ? 1 - ease(seg(f, 0.45, 1)) : 0);
  if (!on) return;
  for (let i = 0; i < 12; i++) {
    const p = ease(seg(t, OPEN.shards + (i * BEAT) / 4, OPEN.shards + (i * BEAT) / 4 + 0.3));
    const s = $(`bs${i}`);
    s.setAttribute("opacity", p.toFixed(3));
    s.setAttribute("transform", `scale(${lerp(0.55, 1, p).toFixed(3)})`);
  }
  // from beside the title into the clock's time
  const home = { x: 1390, y: 540, size: 470 };
  const to = { ...(CLOCK_AT || { x: 1760, y: 100 }), size: 46 };
  const x = lerp(home.x, to.x, f),
    y = lerp(home.y, to.y, f),
    size = lerp(home.size, to.size, f);
  el.style.width = el.style.height = `${size.toFixed(1)}px`;
  el.style.transform = `translate(${(x - size / 2).toFixed(1)}px, ${(y - size / 2).toFixed(1)}px) rotate(${lerp(-8, 0, easeIO(seg(t, OPEN.shards, OPEN.fly + OPEN.flyLen))).toFixed(2)}deg)`;
}

// ---- the turn's rosette: it blooms with "Now make it yours." -------------------------------
function drawRosette(t) {
  const el = $("rosette");
  const a = t - S.turn;
  const o = fade(a, 0, 0.3, S.ladder - S.turn - 0.25, S.ladder - S.turn + 0.02);
  setOpacity(el, o);
  if (o <= 0) return;
  const spin = a * 8;
  for (let i = 0; i < PETALS; i++) {
    const p = spinEase(seg(a - i * 0.035, 0, 1.2));
    const ang = (360 / PETALS) * i + lerp(-70, 0, p) + spin;
    const d = lerp(0.35, 1, p) * PETAL_D - PETAL_D;
    $(`pt${i}`).setAttribute(
      "transform",
      `rotate(${ang.toFixed(2)}) translate(${d.toFixed(2)},0) scale(${lerp(0.6, 1, p).toFixed(3)})`,
    );
  }
}

// ---- the close's stack: a ring drops onto it with each rolling word -------------------------
function drawStack(ka) {
  WORDS.forEach((_, k) => {
    const at = KIN.w0 + k * KIN.every;
    const p = rollEase(seg(ka - at, 0, Math.min(0.32, KIN.every * 0.7)));
    const g = $(`rg${k}`);
    g.setAttribute("opacity", ease(seg(ka - at, 0, 0.1)).toFixed(3));
    g.setAttribute("transform", `translate(0,${lerp(-80, 0, p).toFixed(2)})`);
  });
}

// ---- the website's hero Lottie: ends the video -------------------------------------------
// Bright on the last hit, then it dims into a band behind the end card.
function drawHero(t) {
  const el = $("heroArt");
  const ea = t - S.end;
  const o = ease(seg(ea, -0.05, 0.25)) * lerp(0.9, 0.34, easeIO(seg(ea, 0.9, 2.3)));
  setOpacity(el, o);
  if (o <= 0) return;
  const z = lerp(2.3, 2.6, easeIO(seg(ea, 0, 3)));
  el.style.transform = `translate(${(960 - 275 * z).toFixed(1)}px, ${(560 - 224 * z).toFixed(1)}px) scale(${z.toFixed(3)})`;
  setImg("heroArt", heroSrc(Math.floor(Math.max(0, ea) * 30) % HERO_FRAMES));
}

// ---- the background light: orange from below, the brand's purple from above ----------------
function drawLight(t) {
  const g = $("glow");
  g.style.transform = `translateX(${(Math.sin(t * 0.25) * 40).toFixed(1)}px)`;
  const warm = 0.55 + 0.25 * Math.sin(t * 0.4) + (t > S.close ? 0.25 : 0);
  g.style.opacity = (warm * ease(seg(t, 0.2, 2.6))).toFixed(3);
  // purple: full over the opening, low under the build, up again for the turn, the close and the end
  const build = t >= S.buildStart - 0.6 && t < S.turn;
  const level = build ? 0.38 : 0.95;
  const p = $("glow2");
  p.style.opacity = (level * ease(seg(t, 0.3, 3.0)) * (0.9 + 0.1 * Math.sin(t * 0.5))).toFixed(3);
  const endP = easeIO(seg(t, S.end - 0.4, S.end + 1.2));
  p.style.transform = `translate(${(Math.cos(t * 0.2) * 50 + endP * 560).toFixed(1)}px, ${(Math.sin(t * 0.17) * 30 + endP * 120).toFixed(1)}px)`;
}

// ---- the ladder -----------------------------------------------------------------------
function drawLadder(t) {
  const la = t - S.ladder;
  const on = la >= 0 && la < LADDER_LEN;
  setOpacity($("montage"), on ? 1 : 0);
  setOpacity($("montageCap"), on ? fade(la, 0, 0.2, LADDER_LEN - 0.2, LADDER_LEN) : 0);
  if (!on) return;
  let r = RUNGS[0];
  for (const x of RUNGS) if (x.at <= la) r = x;
  const ra = la - r.at;
  let k = 0;
  r.shots.forEach((s, i) => {
    if (s.t <= ra) k = i;
  });
  const s = r.shots[k];
  const sa = ra - s.t;
  // camera: one move across a rung, or one per shot where the shots move on their own
  const own = !!s.z;
  const zz = own ? s.z : r.z,
    cc = own ? s.c : r.c;
  // a shot that moves on its own pulls out over most of its time, then holds on the whole page
  const q = own ? easeIO(seg(sa, 0, 0.68 * (s.end - s.t))) : seg(ra, 0, r.len);
  const z = lerp(zz[0], zz[1], q);
  // keep the frame inside the 1280x800 page
  const hw = 960 / z,
    hh = 540 / z;
  const cx = clamp(lerp(cc[0][0], cc[1][0], q), Math.min(640, hw), Math.max(640, 1280 - hw));
  const cy = clamp(lerp(cc[0][1], cc[1][1], q), Math.min(400, hh), Math.max(400, 800 - hh));
  // colors cross-fade (one page, moving color); everything else cuts on the beat
  const xf = r.xfade || 0;
  if (xf && k > 0 && sa < xf) {
    setImg("mA", r.shots[k - 1].src);
    setImg("mB", s.src);
    setOpacity($("mB"), easeIO(sa / xf));
  } else {
    setImg("mA", s.src);
    setOpacity($("mB"), 0);
  }
  setOpacity($("mA"), 1);
  const pop = xf ? 1 : 1 + 0.04 * (1 - ease(seg(sa, 0, 0.22)));
  lookAt("mA", z * pop, cx, cy, 1920, 1080);
  lookAt("mB", z * pop, cx, cy, 1920, 1080);
  const cut = !xf && (k > 0 || r.n > 1);
  setOpacity($("flash"), cut ? 0.1 * (1 - seg(sa, 0, 0.12)) : 0);
  setText($("montageCap"), `<span class="step">0${r.n}</span>${esc(r.cap)}`);
}

// ---- the frame -----------------------------------------------------------------------
window.seek = function seek(t) {
  pending.length = 0;
  const T = buildT(t);

  drawLight(t);
  drawFan(t);
  drawMinute(t);
  drawRosette(t);
  drawHero(t);

  // title: fades up from black and sits through the intro
  setOpacity($("black"), 1 - ease(seg(t, 0, 1.2)));
  setOpacity($("title"), fade(t, 1.0, 1.7, OPEN.titleOut, OPEN.titleOut + 0.5));
  place($("title"), 0, -lerp(0, 26, seg(t, 0, S.pre)));

  // clock: a quiet timestamp where the opening's minute lands
  const clockIn = OPEN.fly + OPEN.flyLen - 0.4;
  setOpacity($("clock"), fade(t, clockIn, clockIn + 0.4, S.turn + 0.0, S.turn + 0.3));
  $("clockTime").textContent = clockText(T);
  const ff = ffAt(T);
  $("clockBadge").textContent = t >= S.buildEnd ? "SIGNED IN" : ff ? `${ff}×` : "";
  $("clockBadge").style.color = t >= S.buildEnd ? "var(--accent)" : "var(--lilac)";
  $("clock").classList.toggle("done", t >= S.buildEnd);

  // terminal, with punch-ins
  const browserIn = ease(seg(T, B.browserOpen, B.browserOpen + 0.45));
  const termOut = S.turn;
  const termIn = S.pre - 0.45;
  setOpacity(
    $("term"),
    fade(t, termIn, termIn + 0.45, termOut - 0.4, termOut + 0.1) * lerp(1, 0.35, browserIn),
  );
  // no punch-ins: one slow push across the build
  $("term").style.transformOrigin = "50% 40%";
  place($("term"), 0, 0, lerp(1, 1.03, seg(t, S.pre, S.buildEnd)));
  drawTerminal(T <= 0 ? -1 : T, t);

  // callouts while setup writes the app
  const wrote = M.enter1 + 9.89;
  const cOut = B.browserOpen;
  setOpacity($("calloutPages"), fade(T, wrote, wrote + 0.4, cOut - 0.3, cOut));
  setOpacity($("calloutConfig"), fade(T, wrote + 0.4, wrote + 0.8, cOut - 0.3, cOut));
  place($("calloutPages"), lerp(30, 0, ease(seg(T, wrote, wrote + 0.4))), 0);
  place($("calloutConfig"), lerp(30, 0, ease(seg(T, wrote + 0.4, wrote + 0.8))), 0);

  // captions
  let cap = "";
  if (t >= S.pre && t < S.buildEnd) {
    if (T >= 0.35 && T < M.enter1) cap = "Start Zitadel locally. <em>No account. No Docker.</em>";
    else if (T >= M.enter1 && T < M.enter1 + 9.85)
      cap = "Answer a few questions. The defaults are fine.";
    else if (T >= M.enter1 + 9.85 && T < M.paste2)
      cap = "Setup writes your pages and deploys your config.";
    else if (T >= M.paste2 && T < B.registerShown) cap = "Start your app.";
    else if (T >= B.registerShown) cap = "Sign up on your own page.";
  }
  // the clock already says the time and "signed in"; the caption adds where it started
  if (t >= S.buildEnd && t < S.turn) cap = "From an empty folder.";
  setText($("caption"), cap);
  setOpacity($("caption"), cap ? fade(t, S.pre + 0.1, S.pre + 0.35, S.turn - 0.2, S.turn) : 0);

  // browser window: the build
  const bw = $("browser");
  let cy = 378;
  const url = T >= B.profile ? "localhost:3000/profile" : "localhost:3000/register";
  const srcA = signupShot(T);
  const loading = T >= B.browserOpen && T < B.registerShown;
  const bo = browserIn * fade(t, -1, 0, termOut - 0.3, termOut + 0.15);
  const z = lerp(1240 / 1280, 1.62, easeIO(seg(T, B.registerShown + 0.15, B.registerShown + 0.75)));
  if (srcA && srcA.includes("profile")) cy = 395;
  place(bw, 0, lerp(80, 0, browserIn), 1);
  setOpacity(bw, bo);
  if ($("url").textContent !== url) $("url").textContent = url;
  setOpacity($("loading"), loading ? 1 : 0);
  $("spin").style.transform = `rotate(${(t * 360) % 360}deg)`;
  setImg("shotA", srcA);
  setOpacity($("shotA"), srcA && !loading ? 1 : 0);
  lookAt("shotA", z, 640, cy, 1238, 734);

  // the turn
  setText($("midcap"), "Now make it yours.");
  setOpacity($("midcap"), fade(t, S.turn, S.turn + 0.35, S.ladder - 0.2, S.ladder));
  place($("midcap"), 0, 0, lerp(0.94, 1, ease(seg(t, S.turn, S.turn + 1.4))));

  drawLadder(t);

  // the close: you own the whole experience, Zitadel owns the plumbing
  const ka = t - S.close;
  const inKin = ka >= 0 && t < S.end + 0.1;
  // gone by the last hit, which belongs to the logo
  setOpacity($("kinetic"), inKin ? fade(ka, 0, 0.25, KIN.len - 0.3, KIN.len + 0.05) : 0);
  if (inKin) {
    setOpacity($("k1"), fade(ka, KIN.k1, KIN.k1 + 0.35));
    place($("k1"), 0, lerp(16, 0, ease(seg(ka, KIN.k1, KIN.k1 + 0.4))));
    setOpacity($("k2"), fade(ka, KIN.k2, KIN.k2 + 0.3));
    const wi = clamp(Math.floor((ka - KIN.w0) / KIN.every), -1, WORDS.length - 1);
    const roll =
      wi >= 0 ? rollEase(seg(ka - KIN.w0 - wi * KIN.every, 0, Math.min(0.22, KIN.every * 0.6))) : 0;
    const prev = wi > 0 ? WORDS[wi - 1] : "";
    const cur = wi >= 0 ? WORDS[wi] : "";
    setText(
      $("k2in"),
      `<span style="display:block;height:100px">${esc(prev)}</span><span style="display:block;height:100px">${esc(cur)}</span>`,
    );
    $("k2in").style.transform =
      `translateY(${(-100 * (wi >= 0 ? roll : 0) - (wi < 0 ? 100 : 0)).toFixed(1)}px)`;
    drawStack(ka);
  }

  // end card, with the website's logo animation
  const ea = t - S.end;
  setOpacity($("end"), fade(ea, 0, 0.3));
  if (ea > -0.1) {
    $("logoIcon").setAttribute(
      "transform",
      `rotate(${(-360 * (1 - spinEase(seg(ea, 0, 2.0)))).toFixed(2)} 63 63)`,
    );
    window.LOGO.letters.forEach((_, i) => {
      const y = 100 * rollEase(seg(ea - 0.15 - i / 6, 0, 1));
      $(`ll${i}`).setAttribute("transform", `translate(0,${y.toFixed(2)})`);
    });
    const kids = [...$("end").children];
    kids.slice(1).forEach((el, i) => {
      if (el.classList.contains("row")) return;
      setOpacity(el, fade(ea, 1.1 + i * 0.18, 1.45 + i * 0.18));
    });
    place($("end"), 0, lerp(16, 0, ease(seg(ea, 0, 0.8))));
    for (const [i, c] of [...$("frameworks").children].entries())
      setOpacity(c, fade(ea, 1.7 + i * 0.04, 1.95 + i * 0.04));
    for (const [i, c] of [...$("agents").children].entries())
      setOpacity(c, fade(ea, 2.4 + i * 0.07, 2.65 + i * 0.07));
  }

  return Promise.all(pending).then(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
};

window.ready = (async () => {
  buildDom();
  await document.fonts.ready;
  await Promise.all([...document.fonts].map((f) => f.load().catch(() => {})));
  await preload();
  setOpacity($("clock"), 1);
  measureClock();
  await window.seek(0);
  return { duration: S.duration, build: BUILD_TOTAL, schedule: S, ladder: LADDER_LEN };
})();
