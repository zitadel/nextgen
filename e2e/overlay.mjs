/**
 * The demo chrome the recorder injects into every page it drives.
 *
 * A recorded browser has no cursor and no address bar, so a video of one shows
 * screens changing for no visible reason. This adds back the two things a
 * viewer needs: a pointer that is actually following the driver's mouse, and a
 * bar naming the origin the page is served from, so a redirect to the provider
 * reads as leaving the app rather than as another screen.
 *
 * It is a recording artefact only. Nothing here is loaded by the app, the
 * components, or any test that asserts behaviour.
 */
export const OVERLAY = `
(() => {
  if (window.__demoOverlay) return;
  window.__demoOverlay = true;

  const install = () => {
    if (!document.body || document.getElementById("__demo_hud")) return;

    const css = document.createElement("style");
    css.textContent = \`
      #__demo_hud{position:fixed;inset:0 0 auto 0;height:44px;z-index:2147483646;
        display:flex;align-items:center;gap:12px;padding:0 14px;box-sizing:border-box;
        background:#17171a;color:#e4e4e7;font:13px/1 ui-sans-serif,system-ui;
        border-bottom:1px solid #2a2a30;pointer-events:none}
      #__demo_url{display:flex;align-items:center;gap:8px;background:#0d0d10;border:1px solid #2f2f37;
        border-radius:999px;padding:6px 14px;color:#a9d5ff;font:12px ui-monospace,Menlo,monospace;
        max-width:46%;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
      #__demo_dot{width:8px;height:8px;border-radius:50%;background:#4ade80;flex:0 0 auto}
      #__demo_cap{flex:1;color:#fafafa;font-weight:550;letter-spacing:.1px;
        overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
      #__demo_tag{color:#facc15;font-weight:650;font-size:12px;flex:0 0 auto}
      html{padding-top:44px !important;box-sizing:border-box}
      #__demo_cursor{position:fixed;top:0;left:0;width:26px;height:26px;z-index:2147483647;
        pointer-events:none;transform:translate(-3px,-2px);transition:opacity .2s;filter:drop-shadow(0 2px 3px #0007)}
      .__demo_ring{position:fixed;z-index:2147483645;pointer-events:none;border-radius:50%;
        border:3px solid #38bdf8;width:12px;height:12px;margin:-6px 0 0 -6px;
        animation:__demo_pop .55s ease-out forwards}
      @keyframes __demo_pop{to{width:64px;height:64px;margin:-32px 0 0 -32px;opacity:0}}
    \`;
    document.documentElement.appendChild(css);

    const hud = document.createElement("div");
    hud.id = "__demo_hud";
    hud.innerHTML =
      '<span id="__demo_url"><span id="__demo_dot"></span><span id="__demo_loc"></span></span>' +
      '<span id="__demo_cap"></span><span id="__demo_tag"></span>';
    document.documentElement.appendChild(hud);

    const cursor = document.createElement("div");
    cursor.id = "__demo_cursor";
    cursor.innerHTML =
      '<svg viewBox="0 0 24 24" width="26" height="26">' +
      '<path d="M5 2.5 19 12.2l-6.1.55 3.2 6.9-2.6 1.2-3.2-6.9L5 18.4z" fill="#fff" stroke="#111" stroke-width="1.3" stroke-linejoin="round"/>' +
      "</svg>";
    document.documentElement.appendChild(cursor);

    const loc = document.getElementById("__demo_loc");
    const host = location.host;
    // The provider is a different origin; saying so is the whole point of the
    // bar, so it is called out rather than left for the viewer to spot. The
    // origin shown is the real one: dressing the fixture up as a vendor's own
    // domain would make the recording lie about where the browser went.
    const provider = /:9100$/.test(host);
    loc.textContent = location.origin + location.pathname;
    document.getElementById("__demo_tag").textContent = provider ? "IDENTITY PROVIDER (mock)" : "YOUR APP";
    document.getElementById("__demo_dot").style.background = provider ? "#f59e0b" : "#4ade80";
    if (provider) document.getElementById("__demo_hud").style.background = "#2a1f05";

    const at = window.__demoAt;
    if (at) place(at.x, at.y);
  };

  const place = (x, y) => {
    const c = document.getElementById("__demo_cursor");
    if (c) c.style.transform = "translate(" + (x - 3) + "px," + (y - 2) + "px)";
  };

  window.__demoCaption = (text) => {
    const el = document.getElementById("__demo_cap");
    if (el) el.textContent = text;
  };

  addEventListener("mousemove", (e) => {
    window.__demoAt = { x: e.clientX, y: e.clientY };
    place(e.clientX, e.clientY);
  }, true);

  addEventListener("mousedown", (e) => {
    const ring = document.createElement("div");
    ring.className = "__demo_ring";
    ring.style.left = e.clientX + "px";
    ring.style.top = e.clientY + "px";
    document.documentElement.appendChild(ring);
    setTimeout(() => ring.remove(), 600);
  }, true);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", install);
  } else {
    install();
  }
  // Frameworks that replace the body after hydration would drop the HUD.
  new MutationObserver(install).observe(document.documentElement, { childList: true });
})();
`;
