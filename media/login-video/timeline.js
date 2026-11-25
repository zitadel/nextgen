// Draws any moment of the video: window.seek(t) puts the stage in its state at
// t seconds. Nothing animates on its own, so a renderer can step through frames
// deterministically.
//
// The story: an agent built an app (Crux, a bouldering gym's bookings). Prompt 1
// asks it to add sign-up and login with Zitadel; prompt 2 asks it to make the
// sign-in match the app. The agent pane replays both real runs (data/agent.js,
// from scripts/build-agent.py) in their order, faster than real time, with the
// real elapsed time in its title bar. The browser shows the app as captured after
// each run.

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

const HERO_FRAMES = 217; // capture/lottie/hero/000-216.webp, 30 fps, 550x448
const heroSrc = (i) => `capture/lottie/hero/${String(i).padStart(3, "0")}.webp`;

// ---- music: audio/track.mp3 ("Launch Sequence", 63.6 s) -----------------------------
// Measured on the track: 125.7 BPM, bars of 1.909 s with downbeats from 1.318 s.
// The intro runs to 7.0 s (one hit at 3.95 s), the groove comes in on bar 3, dips
// on bar 18 and returns on bar 19, breaks on bars 27-28, and bar 29 is the last
// hit before the fade. The video plays it straight through: video time is song time.
const MUSIC = { beat: 0.4772, bar0: 1.318, hit: 3.95, end: 63.6 };
const BEAT = MUSIC.beat;
const BAR = 4 * BEAT;
const atBar = (n, beats = 0) => MUSIC.bar0 + n * BAR + beats * BEAT; // time of bar n of the song

// ---- schedule ----------------------------------------------------------------------
// The intro shows the app; prompt 1 lands as the groove comes in; the signed-in
// app sits in the dip; "Fits any app." starts where the groove returns; "rest."
// lands on the break; the logo lands on the last hit.
const S = {
  split: atBar(3),
  p1: atBar(3) + 0.25,
  p1End: atBar(10),
  p2: atBar(11) + 0.15,
  p2End: atBar(15.5),
  signup: atBar(15.5) + 1.0,
  signedIn: atBar(18),
  montage: atBar(19),
  close: atBar(26),
  rest: atBar(28),
  end: atBar(29),
};
S.duration = S.end + 4.0;
S.music = {
  edl: [[0, MUSIC.end]],
  fadeIn: 0.3,
  fadeOut: 2.0,
  // The song plays as delivered. A low-pass envelope ([video time, cutoff Hz],
  // 20 kHz open) can hold a track back; none for this one.
  filter: [],
};
window.DURATION = S.duration;

// ---- the agent pane -----------------------------------------------------------------
const PROMPTS = ["Add sign-up and login with Zitadel.", "Make it match the rest of the app."];
const TYPE = 0.9; // a prompt is typed in 0.9 s
const ICON = { prompt: "›", say: "●", skill: "◆", read: "○", run: "$", edit: "✎", check: "✓" };
const RUNS = window.AGENT.map((run, k) => {
  const start = k === 0 ? S.p1 : S.p2;
  const stop = k === 0 ? S.p1End : S.p2End;
  const a = start + TYPE + 0.25;
  const b = stop - 0.1;
  // real seconds into the run -> video time
  const at = (rt) => a + (rt / run.total) * (b - a);
  return { ...run, start, a, b, at, prompt: PROMPTS[k] };
});
const LINES = RUNS.flatMap((r) => [
  { kind: "prompt", text: r.prompt, at: r.start, run: r },
  ...r.steps.map((s) => ({ kind: s.kind, text: s.text, at: r.at(s.t), run: r })),
]);
// the agent's real elapsed time, both runs back to back
function agentTime(t) {
  const [r1, r2] = RUNS;
  const part = (r) => clamp((t - r.a) / (r.b - r.a)) * r.total;
  return part(r1) + (t >= r2.a ? part(r2) : 0);
}
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

// ---- the browser --------------------------------------------------------------------
// Screenshots are 2560x1600 of a 1280x800 page: z is screen px per page px.
const AG = "capture/shots/agent/";
const SIGNUP = [
  "101-email-half",
  "102-email",
  "103-given",
  "104-family",
  "105-password-empty",
  "106-password-filled",
  "107-signup-pending",
  "108-profile",
];
const navAt = RUNS[0].at(
  RUNS[0].steps.find((s) => s.kind === "edit" && s.text === "app/page.tsx").t,
);
function browserShot(t) {
  if (t < navAt) return { src: `${AG}00-app.png`, url: "localhost:3000", cam: "home", reload: 0 };
  if (t < S.p1End)
    return { src: `${AG}01-app-nav.png`, url: "localhost:3000", cam: "home", reload: navAt };
  if (t < S.p2End)
    return {
      src: `${AG}02-register-default.png`,
      url: "localhost:3000/register",
      cam: "card",
      reload: S.p1End,
    };
  if (t < S.signup)
    return {
      src: `${AG}100-register-empty.png`,
      url: "localhost:3000/register",
      cam: "page",
      reload: S.p2End,
    };
  if (t < S.signedIn) {
    const step = (S.signedIn - 0.55 - S.signup) / (SIGNUP.length - 1);
    const i = clamp(Math.floor((t - S.signup) / step), 0, SIGNUP.length - 1);
    const name = SIGNUP[i];
    return {
      src: `${AG}${name}.png`,
      url: name === "108-profile" ? "localhost:3000/profile" : "localhost:3000/register",
      cam: "page",
      reload: name === "108-profile" ? S.signup + i * step : 0,
    };
  }
  return {
    src: `${AG}109-home-signed-in.png`,
    url: "localhost:3000",
    cam: "signedIn",
    reload: S.signedIn,
  };
}
// the browser sits centre stage over the intro, then beside the agent
const OPEN_RECT = { l: 340, t: 196, w: 1240, h: 760 };
const SPLIT_RECT = { l: 876, t: 196, w: 948, h: 760 };

// ---- "Fits any app.": the same sign-in in other apps' pages ------------------------------
// Real register pages of one scaffolded app in four fictional brands, deployed with
// the CLI (scripts/ladder.py). c: page point the camera looks at; z: screen px per page px.
const LAD = "capture/shots/ladder/";
const ANY = [
  {
    bars: 2,
    src: `${LAD}p2-kiln.png`,
    z: [2.15, 1.5],
    c: [
      [319, 395],
      [640, 377],
    ],
  },
  {
    bars: 2,
    src: `${LAD}p1-orbitly.png`,
    z: [2.0, 1.5],
    c: [
      [1006, 360],
      [640, 440],
    ],
  },
  {
    bars: 1.5,
    src: `${LAD}b3-signal.png`,
    z: [2.05, 2.2],
    c: [
      [640, 389],
      [640, 389],
    ],
  },
  {
    bars: 1.5,
    src: `${LAD}b1-fernhill.png`,
    z: [2.05, 2.2],
    c: [
      [640, 389],
      [640, 389],
    ],
  },
];
{
  let at = S.montage;
  for (const s of ANY) {
    s.t = at;
    at += s.bars * BAR;
    s.end = at;
  }
}

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

// ---- setup -------------------------------------------------------------------------
let BOTTOMS = []; // each pane line's bottom edge, for scrolling
function buildDom() {
  $("frameworks").innerHTML = FRAMEWORKS.map((f) => `<span class="chip">${f}</span>`).join("");
  $("agents").innerHTML = AGENTS.map((f) => `<span class="chip">${f}</span>`).join("");
  $("agentLines").innerHTML = LINES.map(
    (l, i) =>
      `<div class="ln ${l.kind}" id="ln${i}"><span class="ic">${ICON[l.kind]}</span><span class="tx">${esc(l.text)}</span></div>`,
  ).join("");
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
}
function measureLines() {
  BOTTOMS = LINES.map((_, i) => {
    const el = $(`ln${i}`);
    return el.offsetTop + el.offsetHeight;
  });
}

const urls = new Set();
async function preload() {
  for (let t = 0; t < S.montage; t += 0.05) urls.add(browserShot(t).src);
  for (const s of ANY) urls.add(s.src);
  for (let i = 0; i < HERO_FRAMES; i++) urls.add(heroSrc(i));
  await Promise.all(
    [...urls].map(async (u) => {
      const im = new Image();
      im.src = u;
      await im.decode();
    }),
  );
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
// frame a 2x screenshot of a 1280x800 page, kept inside the page
function lookAt(id, z, cx, cy, vw, vh) {
  const hw = vw / 2 / z,
    hh = vh / 2 / z;
  const x = hw * 2 >= 1280 ? 640 : clamp(cx, hw, 1280 - hw);
  const y = hh * 2 >= 800 ? 400 : clamp(cy, hh, 800 - hh);
  place($(id), vw / 2 - x * z, vh / 2 - y * z, z / 2);
}

// ---- the agent pane -------------------------------------------------------------------
function drawAgent(t) {
  const on = fade(t, S.split, S.split + 0.5, S.montage - 0.35, S.montage);
  setOpacity($("agent"), on);
  place($("agent"), lerp(-40, 0, ease(seg(t, S.split, S.split + 0.6))), 0);
  if (on <= 0) return;
  let k = 0;
  LINES.forEach((l, i) => {
    const el = $(`ln${i}`);
    const o = fade(t, l.at, l.at + 0.15);
    setOpacity(el, o);
    el.style.transform = `translateY(${lerp(6, 0, o).toFixed(2)}px)`;
    if (l.at <= t) k = i + 1;
    if (l.kind === "prompt") {
      const n = Math.round(clamp((t - l.at) / TYPE) * l.text.length);
      const typing = t >= l.at && t < l.at + TYPE + 0.3;
      setText(
        el.lastChild,
        esc(l.text.slice(0, n)) + (typing ? '<span class="typing"></span>' : ""),
      );
    }
  });
  // keep the newest line in view
  const viewH = $("agentBody").clientHeight;
  const target = (n) => (n > 0 ? Math.max(0, BOTTOMS[n - 1] + 28 - viewH) : 0);
  const last = LINES[k - 1];
  const off = last ? lerp(target(k - 1), target(k), easeIO(seg(t, last.at, last.at + 0.22))) : 0;
  $("agentLines").style.transform = `translateY(${(-off).toFixed(1)}px)`;
  $("agentClock").textContent = mmss(agentTime(t));
}

// ---- the browser ------------------------------------------------------------------------
function drawBrowser(t) {
  const bw = $("browser");
  const on = fade(t, 0.6, 1.4, S.montage - 0.35, S.montage);
  setOpacity(bw, on);
  if (on <= 0) return;
  const p = easeIO(seg(t, S.split - 0.1, S.split + 0.6));
  const r = {
    l: lerp(OPEN_RECT.l, SPLIT_RECT.l, p),
    t: lerp(OPEN_RECT.t, SPLIT_RECT.t, p),
    w: lerp(OPEN_RECT.w, SPLIT_RECT.w, p),
    h: lerp(OPEN_RECT.h, SPLIT_RECT.h, p),
  };
  bw.style.left = `${r.l.toFixed(1)}px`;
  bw.style.top = `${r.t.toFixed(1)}px`;
  bw.style.width = `${r.w.toFixed(1)}px`;
  bw.style.height = `${r.h.toFixed(1)}px`;
  place(bw, 0, lerp(30, 0, ease(seg(t, 0.6, 1.6))));
  const vw = r.w,
    vh = r.h - 44;
  const fit = Math.max(vw / 1280, vh / 800);

  const now = browserShot(t);
  if ($("url").textContent !== now.url) $("url").textContent = now.url;
  // a page that reloads cross-fades from what was there before
  const xf = now.reload && t - now.reload < 0.25 ? easeIO((t - now.reload) / 0.25) : 1;
  const before = xf < 1 ? browserShot(now.reload - 0.01) : null;
  setImg("shotA", before ? before.src : now.src);
  setImg("shotB", now.src);
  setOpacity($("shotA"), before ? 1 : 0);
  setOpacity($("shotB"), before ? xf : 1);
  const cam = (c) => {
    if (c === "card") {
      const q = easeIO(seg(t, S.p1End, S.p1End + 1.6));
      return [lerp(fit, fit * 1.22, q), 640, lerp(400, 300, q)];
    }
    if (c === "page") {
      const q = seg(t, S.p2End, S.signedIn);
      return [lerp(fit, fit * 1.1, q), 640, lerp(400, 380, q)];
    }
    if (c === "signedIn") {
      const q = easeIO(seg(t, S.signedIn, S.montage));
      return [lerp(fit, fit * 1.16, q), lerp(640, 760, q), lerp(400, 330, q)];
    }
    return [fit, 640, 400];
  };
  const [z, cx, cy] = cam(now.cam);
  lookAt("shotB", z, cx, cy, vw, vh);
  if (before) {
    const [zb, bx, by] = cam(before.cam);
    lookAt("shotA", zb, bx, by, vw, vh);
  }
}

// ---- "Fits any app." ------------------------------------------------------------------------
function drawMontage(t) {
  const on = t >= S.montage && t < S.close;
  setOpacity($("montage"), on ? 1 : 0);
  if (!on) return;
  const s = ANY.findLast((x) => x.t <= t) || ANY[0];
  const sa = t - s.t;
  // a whole page pulls out over most of its time, then holds; a centred one pushes in
  const q = s.z[1] < s.z[0] ? easeIO(seg(sa, 0, 0.68 * (s.end - s.t))) : seg(sa, 0, s.end - s.t);
  const pop = 1 + 0.04 * (1 - ease(seg(sa, 0, 0.22)));
  setImg("mA", s.src);
  setOpacity($("mA"), 1);
  setOpacity($("mB"), 0);
  lookAt(
    "mA",
    lerp(s.z[0], s.z[1], q) * pop,
    lerp(s.c[0][0], s.c[1][0], q),
    lerp(s.c[0][1], s.c[1][1], q),
    1920,
    1080,
  );
  setOpacity($("flash"), s !== ANY[0] ? 0.1 * (1 - seg(sa, 0, 0.12)) : 0);
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
  // purple: full over the intro, low behind the agent and the app, up again from the montage
  const work = t >= S.split - 0.6 && t < S.montage;
  const p = $("glow2");
  p.style.opacity = (
    (work ? 0.38 : 0.95) *
    ease(seg(t, 0.3, 3.0)) *
    (0.9 + 0.1 * Math.sin(t * 0.5))
  ).toFixed(3);
  const endP = easeIO(seg(t, S.end - 0.4, S.end + 1.2));
  p.style.transform = `translate(${(Math.cos(t * 0.2) * 50 + endP * 560).toFixed(1)}px, ${(Math.sin(t * 0.17) * 30 + endP * 120).toFixed(1)}px)`;
}

// ---- the caption: one label, top left -------------------------------------------------------
const CAPTIONS = [
  {
    a: 0.9,
    b: S.split - 0.2,
    text: (t) =>
      `Your agent built the app.${t >= MUSIC.hit ? " <em>Now it needs sign-in.</em>" : ""}`,
  },
  { a: S.p1End + 0.2, b: S.p2 - 0.05, text: () => "It works. It doesn't look like Crux yet." },
  { a: S.p2End + 0.15, b: S.signedIn - 0.05, text: () => "Now it looks like Crux." },
  { a: S.signedIn, b: S.montage - 0.2, text: () => "Signed in." },
  { a: S.montage, b: S.close - 0.2, text: () => "Fits any app." },
];
function drawCaption(t) {
  const c = CAPTIONS.find((x) => t >= x.a - 0.05 && t < x.b + 0.2);
  setOpacity($("caption"), c ? fade(t, c.a, c.a + 0.2, c.b, c.b + 0.2) : 0);
  if (c) setText($("caption"), c.text(t));
}

// ---- the frame -----------------------------------------------------------------------
window.seek = function seek(t) {
  pending.length = 0;
  setOpacity($("black"), 1 - ease(seg(t, 0, 1.2)));
  drawLight(t);
  drawHero(t);
  drawAgent(t);
  drawBrowser(t);
  drawMontage(t);
  drawCaption(t);

  // the close: you own the whole experience, Zitadel owns the rest
  const inClose = t >= S.close && t < S.end + 0.1;
  setOpacity($("close"), inClose ? fade(t, S.close, S.close + 0.25, S.end - 0.3, S.end + 0.05) : 0);
  if (inClose) {
    setOpacity($("c1"), fade(t, S.close, S.close + 0.35));
    place($("c1"), 0, lerp(16, 0, ease(seg(t, S.close, S.close + 0.4))));
    const c2 = S.close + 2 * BEAT;
    setOpacity($("c2"), fade(t, c2, c2 + 0.35));
    place($("c2"), 0, lerp(16, 0, ease(seg(t, c2, c2 + 0.4))));
    setOpacity($("cRest"), fade(t, S.rest, S.rest + 0.18));
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
  measureLines();
  await window.seek(0);
  const runs = RUNS.map((r) => ({
    total: r.total,
    steps: r.steps.length,
    shown: +(r.b - r.a).toFixed(2),
  }));
  return { duration: S.duration, schedule: S, runs };
})();
