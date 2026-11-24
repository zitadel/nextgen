// Renders the timeline page frame by frame and encodes an MP4.
// usage:
//   node scripts/render.mjs                 -> out/login-video.mp4
//   node scripts/render.mjs --at 3,20.5,48  -> out/stills/<t>.png
//   node scripts/render.mjs --mux           -> re-mux the music onto out/login-video-silent.mp4
// Needs Playwright (from the repo's e2e package) and ffmpeg on PATH.
import { createRequire } from "node:module";
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(join(here, "../../e2e/package.json"));
const { chromium } = require("@playwright/test");

const atArg = process.argv.indexOf("--at");
const stills = atArg > 0 ? process.argv[atArg + 1].split(",").map(Number) : null;
const muxOnly = process.argv.includes("--mux");
const FPS = 30;
const WORKERS = 4;
const url = pathToFileURL(join(here, "index.html")).href;

const browser = await chromium.launch({ args: ["--allow-file-access-from-files"] });
async function openPage() {
  const page = await browser.newPage({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
  });
  page.on("pageerror", (e) => console.error("page error:", e.message));
  await page.goto(url);
  return { page, info: await page.evaluate(() => window.ready) };
}

if (stills) {
  const { page, info } = await openPage();
  const dir = join(here, "out", "stills");
  mkdirSync(dir, { recursive: true });
  for (const t of stills) {
    await page.evaluate((x) => window.seek(x), t);
    await page.screenshot({ path: join(dir, `${t.toFixed(2)}.png`) });
  }
  const { music, ...schedule } = info.schedule;
  console.log(
    JSON.stringify({ duration: info.duration, build: info.build, ladder: info.ladder, schedule }),
  );
  await browser.close();
  process.exit(0);
}

const frames = join(here, "out", "frames");
const first = await openPage();
const total = Math.ceil(first.info.duration * FPS);
const out = join(here, "out", "login-video.mp4");
const silent = join(here, "out", "login-video-silent.mp4");
if (muxOnly) {
  await browser.close();
} else {
  rmSync(frames, { recursive: true, force: true });
  mkdirSync(frames, { recursive: true });
  const pages = [first.page];
  for (let i = 1; i < WORKERS; i++) pages.push((await openPage()).page);
  let done = 0;
  await Promise.all(
    pages.map(async (page, w) => {
      for (let f = w; f < total; f += WORKERS) {
        await page.evaluate((x) => window.seek(x), f / FPS);
        await page.screenshot({
          path: join(frames, `${String(f).padStart(5, "0")}.jpg`),
          type: "jpeg",
          quality: 94,
        });
        if (++done % 150 === 0) console.log(`${done}/${total}`);
      }
    }),
  );
  await browser.close();
  const r = spawnSync(
    "ffmpeg",
    [
      "-y",
      "-loglevel",
      "error",
      "-framerate",
      String(FPS),
      "-i",
      join(frames, "%05d.jpg"),
      "-c:v",
      "libx264",
      "-preset",
      "slow",
      "-crf",
      "17",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      silent,
    ],
    { stdio: "inherit" },
  );
  if (r.status !== 0) {
    console.log("ffmpeg failed");
    process.exit(1);
  }
}

// The music (audio/track.mp3, not in git), cut to the timeline's edit: the
// source ranges in schedule.music.edl play back to back from t = 0, joined with
// 6 ms cross-fades so no join clicks, then faded in and padded to the end.
const track = join(here, "audio", "track.mp3");
const music = first.info.schedule.music;
if (music && existsSync(track)) {
  const SR = 48000;
  const dec = spawnSync(
    "ffmpeg",
    ["-v", "error", "-i", track, "-f", "s16le", "-ac", "2", "-ar", String(SR), "-"],
    { maxBuffer: 1 << 30 },
  );
  const src = new Int16Array(dec.stdout.buffer, dec.stdout.byteOffset, dec.stdout.length >> 1);
  const srcFrames = src.length >> 1;
  const H = Math.round(0.003 * SR); // half a cross-fade
  const segs = music.edl.map(([a, b]) => [
    Math.round(a * SR),
    Math.min(Math.round(b * SR), srcFrames),
  ]);
  const len = segs.reduce((n, [a, b]) => n + (b - a), 0);
  const mix = new Float32Array(len * 2);
  let pos = 0;
  segs.forEach(([a, b], i) => {
    const inH = i > 0 ? H : 0;
    const outH = i < segs.length - 1 ? H : 0;
    for (let k = -inH; k < b - a + outH; k++) {
      const o = pos + k;
      const s = a + k;
      if (o < 0 || o >= len || s < 0 || s >= srcFrames) continue;
      let g = 1;
      if (k < inH) g = Math.min(g, (k + inH) / (2 * inH));
      if (k >= b - a - outH) g = Math.min(g, (b - a + outH - k) / (2 * outH));
      mix[2 * o] += g * src[2 * s];
      mix[2 * o + 1] += g * src[2 * s + 1];
    }
    pos += b - a;
  });
  // The low-pass envelope (schedule.music.filter, [t, Hz] pairs, interpolated in
  // log frequency): a 2-pole low-pass whose cutoff is updated every 32 samples,
  // bypassed where it is fully open.
  const env = music.filter || [];
  const cutoff = (t) => {
    if (!env.length) return 20000;
    if (t <= env[0][0]) return env[0][1];
    for (let i = 1; i < env.length; i++) {
      const [t1, f1] = env[i],
        [t0, f0] = env[i - 1];
      if (t <= t1)
        return Math.exp(Math.log(f0) + (Math.log(f1) - Math.log(f0)) * ((t - t0) / (t1 - t0)));
    }
    return env[env.length - 1][1];
  };
  if (env.length) {
    const Q = Math.SQRT1_2;
    const z = [
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ]; // x1, x2, y1, y2 per channel
    let b0 = 1,
      b1 = 0,
      b2 = 0,
      a1 = 0,
      a2 = 0,
      open = true;
    for (let n = 0; n < len; n++) {
      if (n % 32 === 0) {
        const f = cutoff(n / SR);
        open = f >= 19000;
        if (!open) {
          const w = (2 * Math.PI * f) / SR,
            cw = Math.cos(w),
            al = Math.sin(w) / (2 * Q),
            a0 = 1 + al;
          b0 = (1 - cw) / 2 / a0;
          b1 = (1 - cw) / a0;
          b2 = b0;
          a1 = (-2 * cw) / a0;
          a2 = (1 - al) / a0;
        }
      }
      for (let c = 0; c < 2; c++) {
        const x = mix[2 * n + c],
          st = z[c];
        const y = open ? x : b0 * x + b1 * st[0] + b2 * st[1] - a1 * st[2] - a2 * st[3];
        st[1] = st[0];
        st[0] = x;
        st[3] = st[2];
        st[2] = y;
        mix[2 * n + c] = y;
      }
    }
  }
  const pcm = new Int16Array(mix.length);
  for (let i = 0; i < mix.length; i++)
    pcm[i] = Math.max(-32768, Math.min(32767, Math.round(mix[i])));
  const raw = join(here, "out", "music-edit.pcm");
  writeFileSync(raw, Buffer.from(pcm.buffer));
  const m = spawnSync(
    "ffmpeg",
    [
      "-y",
      "-loglevel",
      "error",
      "-i",
      silent,
      "-f",
      "s16le",
      "-ar",
      String(SR),
      "-ac",
      "2",
      "-i",
      raw,
      "-filter_complex",
      `[1:a]afade=t=in:d=${music.fadeIn ?? 0.25},` +
        (music.fadeOut
          ? `afade=t=out:st=${(first.info.duration - music.fadeOut).toFixed(3)}:d=${music.fadeOut},`
          : "") +
        `volume=-2dB,apad[a]`,
      "-map",
      "0:v",
      "-map",
      "[a]",
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-shortest",
      "-movflags",
      "+faststart",
      out,
    ],
    { stdio: "inherit" },
  );
  console.log(
    m.status === 0
      ? `wrote ${out} (${total} frames, music cut to ${segs.length} bars)`
      : "muxing the music failed",
  );
} else {
  renameSync(silent, out);
  console.log(`wrote ${out} (${total} frames, no music)`);
}
